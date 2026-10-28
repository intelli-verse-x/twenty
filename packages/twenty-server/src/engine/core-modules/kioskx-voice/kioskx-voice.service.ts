import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';
import { NoteTargetWorkspaceEntity } from 'src/modules/note/standard-objects/note-target.workspace-entity';
import {
  advanceCall,
  type CallState,
  KIOSKX_WORKSPACE_ID,
  voiceEnabled,
} from './kioskx-call';
import { KioskxVoiceClient } from './kioskx-voice.client';

@Injectable()
export class KioskxVoiceService {
  constructor(
    private readonly orm: GlobalWorkspaceOrmManager,
    private readonly redis: RedisClientService,
    private readonly voice: KioskxVoiceClient,
    @InjectMessageQueue(MessageQueue.messagingQueue)
    private readonly queue: MessageQueueService,
  ) {}

  private key(personId: string) {
    return `kioskx-voice:${KIOSKX_WORKSPACE_ID}:${personId}`;
  }
  private async load(personId: string): Promise<CallState | null> {
    const value = await this.redis.getClient().get(this.key(personId));
    return value ? JSON.parse(value) : null;
  }

  private async personPhone(workspaceId: string, personId: string) {
    const repo = await this.orm.getRepository(
      workspaceId,
      PersonWorkspaceEntity,
    );
    const person = await repo.findOne({ where: { id: personId } });
    const phones = person?.phones;
    const additional = phones?.additionalPhones?.find((phone) =>
      phone.number?.trim(),
    );
    const primary = Boolean(phones?.primaryPhoneNumber?.trim());
    const raw = (
      primary ? phones?.primaryPhoneNumber : additional?.number
    )?.trim();
    if (!raw) return '';
    const country = primary
      ? phones?.primaryPhoneCountryCode
      : additional?.countryCode;
    const callingCode = primary
      ? phones?.primaryPhoneCallingCode
      : additional?.callingCode;
    try {
      const phone = parsePhoneNumberFromString(
        raw.startsWith('+') || !callingCode
          ? raw
          : `+${callingCode.replace(/\D/g, '')}${raw}`,
        country as CountryCode,
      );
      return phone?.isValid() ? phone.number : '';
    } catch {
      return '';
    }
  }

  async status(workspaceId: string, personId: string) {
    if (!voiceEnabled(workspaceId))
      return { available: false, status: '', message: '' };
    return this.orm.executeInWorkspaceContext(async () => {
      const phone = await this.personPhone(workspaceId, personId);
      const state = phone ? await this.load(personId) : null;
      return {
        available: Boolean(phone),
        status: state?.status || '',
        message: state?.message || '',
      };
    });
  }

  async start(workspaceId: string, personId: string, requestId: string) {
    if (!voiceEnabled(workspaceId))
      throw new ForbiddenException('Calling is unavailable.');
    return this.orm.executeInWorkspaceContext(async () => {
      if (
        !(await this.personPhone(workspaceId, personId)) ||
        !this.voice.configured()
      ) {
        return {
          available: true,
          status: 'unavailable',
          message: 'Voice Studio is unavailable for this record.',
        };
      }
      const state: CallState = {
        personId,
        operationId: randomUUID(),
        requestId,
        status: 'queued',
        message: 'Starting call…',
        attempts: 0,
      };
      // One durable operation per person. Never clear an ambiguous attempt automatically.
      const previous = await this.load(personId);
      if (previous?.status === 'complete' && previous.requestId !== requestId) {
        // Compare-and-set prevents two tabs from replacing the same completed call.
        await this.redis
          .getClient()
          .eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('SET', KEYS[1], ARGV[2]) end return nil",
            1,
            this.key(personId),
            JSON.stringify(previous),
            JSON.stringify(state),
          );
      } else {
        await this.redis
          .getClient()
          .set(this.key(personId), JSON.stringify(state), 'NX');
      }
      const current = await this.load(personId);
      if (current?.status === 'queued')
        await this.schedule(personId, current.operationId, 0);
      return this.status(workspaceId, personId);
    });
  }

  private schedule(personId: string, operationId: string, attempt: number) {
    return this.queue.add(
      'KioskxVoiceJob',
      { personId, operationId },
      {
        id: `${operationId}-${attempt}`,
        delay: attempt === 0 ? 0 : 10000,
        retryLimit: 3,
      },
    );
  }

  async advance(personId: string, operationId: string) {
    const state = await this.load(personId);
    if (!state || state.operationId !== operationId) return;
    // Recheck the switch before placing a call; finish collecting already-started calls if disabled.
    if (!state.callId && !voiceEnabled(KIOSKX_WORKSPACE_ID)) {
      state.status = 'failed';
      state.message = 'Calling is unavailable.';
      await this.redis
        .getClient()
        .set(this.key(personId), JSON.stringify(state));
      return;
    }
    await this.orm.executeInWorkspaceContext(async () => {
      await advanceCall({
        load: async () => {
          const current = await this.load(personId);
          return current?.operationId === operationId ? current : null;
        },
        save: async (next) => {
          await this.redis
            .getClient()
            .set(this.key(personId), JSON.stringify(next));
        },
        claimDial: async () =>
          Boolean(
            await this.redis
              .getClient()
              .set(`${this.key(personId)}:dial:${operationId}`, '1', 'NX'),
          ),
        phone: () => this.personPhone(KIOSKX_WORKSPACE_ID, personId),
        create: (phone) => {
          if (!phone) throw new Error('No phone available.');
          return this.voice.create(phone);
        },
        read: (ref) => this.voice.read(ref),
        note: (id, target, transcript) =>
          this.writeNote(id, target, transcript),
        schedule: async () => {
          const next = await this.load(personId);
          if (next)
            await this.schedule(personId, operationId, next.attempts + 1);
        },
      });
    }, buildSystemAuthContext(KIOSKX_WORKSPACE_ID));
  }

  private async writeNote(id: string, personId: string, transcript: string) {
    const notes = await this.orm.getRepository(
      KIOSKX_WORKSPACE_ID,
      NoteWorkspaceEntity,
    );
    const targets = await this.orm.getRepository(
      KIOSKX_WORKSPACE_ID,
      NoteTargetWorkspaceEntity,
    );
    const source = await this.orm.getGlobalWorkspaceDataSource();
    await source.transaction(async (manager) => {
      const transaction = manager as WorkspaceEntityManager;
      if (await notes.findOne({ where: { id } }, transaction)) return;
      await notes.insert(
        {
          id,
          title: 'KioskX call',
          bodyV2: {
            markdown: transcript,
            blocknote: JSON.stringify([
              {
                id: randomUUID(),
                type: 'paragraph',
                props: {},
                content: [{ type: 'text', text: transcript, styles: {} }],
                children: [],
              },
            ]),
          },
        },
        transaction,
      );
      await targets.insert(
        { noteId: id, targetPersonId: personId },
        transaction,
      );
    });
  }
}
