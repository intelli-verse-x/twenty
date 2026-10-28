import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, IsNull, Repository } from 'typeorm';
import { MessageParticipantRole } from 'twenty-shared/types';

import { EmailComposerService } from 'src/engine/core-modules/tool/tools/email-tool/email-composer.service';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';
import { NoteTargetWorkspaceEntity } from 'src/modules/note/standard-objects/note-target.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { SendEmailService } from 'src/modules/messaging/message-outbound-manager/services/send-email.service';
import {
  KioskxDeskActionInput,
  KioskxDeskContact,
  KioskxDeskResult,
} from './kioskx-hired-mask.dto';
import { inquiryText, redactContactText } from './kioskx-redact';

import {
  KIOSKX_DESK_WORKSPACE,
  KIOSKX_DESK_ROLE_ID,
} from './kioskx-desk-policy';
// The Voice Studio branch supplies this adapter; no second voice client here.
export const KIOSKX_HIRED_CALL_TRANSPORT = Symbol(
  'KIOSKX_HIRED_CALL_TRANSPORT',
);
export interface KioskxHiredCallTransport {
  start(input: {
    workspaceId: string;
    personId: string;
    phone: string;
    requestId: string;
  }): Promise<void>;
}

@Injectable()
export class KioskxHiredMaskService {
  constructor(
    @InjectRepository(RoleTargetEntity)
    private readonly roleTargets: Repository<RoleTargetEntity>,
    @InjectRepository(ConnectedAccountEntity)
    private readonly accounts: Repository<ConnectedAccountEntity>,
    private readonly orm: GlobalWorkspaceOrmManager,
    private readonly composer: EmailComposerService,
    private readonly sender: SendEmailService,
    @Optional()
    @Inject(KIOSKX_HIRED_CALL_TRANSPORT)
    private readonly voice?: KioskxHiredCallTransport,
  ) {}

  async isDesk(workspaceId: string, userWorkspaceId: string): Promise<boolean> {
    if (workspaceId !== KIOSKX_DESK_WORKSPACE || !userWorkspaceId) return false;
    const target = await this.roleTargets.findOne({
      where: { workspaceId, userWorkspaceId },
    });
    return target?.roleId === KIOSKX_DESK_ROLE_ID;
  }

  private async authorize(workspaceId: string, userWorkspaceId: string) {
    if (!(await this.isDesk(workspaceId, userWorkspaceId)))
      throw new ForbiddenException();
  }

  private system<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.orm.executeInWorkspaceContext(
      fn,
      buildSystemAuthContext(workspaceId),
    );
  }

  private repository<
    T extends
      | PersonWorkspaceEntity
      | NoteWorkspaceEntity
      | NoteTargetWorkspaceEntity
      | MessageWorkspaceEntity
      | MessageParticipantWorkspaceEntity,
  >(workspaceId: string, name: string) {
    return this.orm.getRepository<T>(workspaceId, name, {
      shouldBypassPermissionChecks: true,
    });
  }

  private async person(workspaceId: string, id: string) {
    const repo = await this.repository<PersonWorkspaceEntity>(
      workspaceId,
      'person',
    );
    // Deleted people cannot be contacted, and the workspace is fixed before escalation.
    return repo.findOne({ where: { id } });
  }

  private account(workspaceId: string) {
    // Explicit server-controlled shared sender, never a client-supplied account/destination.
    const id = process.env.KIOSKX_HIRED_EMAIL_ACCOUNT_ID;
    return this.accounts.findOne({
      where: {
        ...(id ? { id } : { handle: 'support@kiosk-x.ai' }),
        workspaceId,
        archivedAt: IsNull(),
        authFailedAt: IsNull(),
      },
    });
  }

  private callAvailable() {
    return process.env.KIOSKX_VOICE_CALL === 'true' && !!this.voice;
  }

  async contact(
    workspaceId: string,
    userWorkspaceId: string,
    personId: string,
  ): Promise<KioskxDeskContact | null> {
    // Admin/Member use their existing UI unchanged.
    if (!(await this.isDesk(workspaceId, userWorkspaceId))) return null;
    return this.system<KioskxDeskContact | null>(workspaceId, async () => {
      const person = await this.person(workspaceId, personId);
      if (!person) return null;
      const targets = await (
        await this.repository<NoteTargetWorkspaceEntity>(
          workspaceId,
          'noteTarget',
        )
      ).find({ where: { targetPersonId: personId }, take: 100 });
      const notes = targets.length
        ? await (
            await this.repository<NoteWorkspaceEntity>(workspaceId, 'note')
          ).find({
            where: {
              id: In(
                targets.map((t) => t.noteId).filter((id): id is string => !!id),
              ),
              title: 'KioskX contact form',
            },
            order: { createdAt: 'DESC' },
            take: 50,
          })
        : [];
      const participants = await (
        await this.repository<MessageParticipantWorkspaceEntity>(
          workspaceId,
          'messageParticipant',
        )
      ).find({
        where: { personId, role: MessageParticipantRole.FROM },
        order: { createdAt: 'DESC' },
        take: 100,
      });
      const messages = participants.length
        ? await (
            await this.repository<MessageWorkspaceEntity>(
              workspaceId,
              'message',
            )
          ).find({
            where: { id: In(participants.map((p) => p.messageId)) },
            order: { receivedAt: 'DESC' },
            take: 50,
          })
        : [];
      return {
        unavailable: false,
        hasEmail: !!person.emails?.primaryEmail,
        hasPhone: !!person.phones?.primaryPhoneNumber,
        emailAvailable: !!(await this.account(workspaceId)),
        callAvailable: this.callAvailable(),
        entries: [
          ...notes.map((note) => ({
            kind: 'Inquiry',
            text: inquiryText(note.bodyV2),
          })),
          ...messages.map((message) => ({
            kind: 'Reply arrived',
            text: redactContactText(message.text ?? ''),
          })),
        ],
      };
    }).catch(() => ({
      unavailable: true,
      hasEmail: false,
      hasPhone: false,
      emailAvailable: false,
      callAvailable: false,
      entries: [],
    }));
  }

  async action(
    workspaceId: string,
    userWorkspaceId: string,
    input: KioskxDeskActionInput,
  ): Promise<KioskxDeskResult> {
    await this.authorize(workspaceId, userWorkspaceId);
    // All provider exceptions are deliberately collapsed; they can contain the destination.
    try {
      return await this.system(workspaceId, async () => {
        const person = await this.person(workspaceId, input.personId);
        if (!person) return { ok: false, status: 'unavailable' };
        const account =
          input.action === 'email' ? await this.account(workspaceId) : null;
        if (
          input.action === 'email' &&
          (!person.emails?.primaryEmail ||
            !account ||
            !input.subject?.trim() ||
            !input.body?.trim())
        )
          return { ok: false, status: 'unavailable' };
        if (
          input.action === 'call' &&
          (!person.phones?.primaryPhoneNumber || !this.callAvailable())
        )
          return { ok: false, status: 'unavailable' };
        // Durable unique claim before any external side effect. Never replay an
        // ambiguous send/dial after a timeout or process restart. Hidden Note storage
        // avoids a second migration/schema, and contains no contact or transcript.
        const hash = createHash('sha256')
          .update(`${workspaceId}:${userWorkspaceId}:${input.requestId}`)
          .digest('hex');
        const claimId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        const notes = await this.repository<NoteWorkspaceEntity>(
          workspaceId,
          'note',
        );
        try {
          await notes.insert({
            id: claimId,
            title: 'KioskX desk action claimed',
          });
        } catch {
          return { ok: false, status: 'alreadySubmitted' };
        }
        if (input.action === 'call') {
          const number = person.phones.primaryPhoneNumber;
          const prefix = person.phones.primaryPhoneCallingCode ?? '';
          const phone = number.startsWith('+')
            ? number
            : `+${prefix.replace(/^\+/, '')}${number}`;
          await this.voice!.start({
            workspaceId,
            personId: person.id,
            phone,
            requestId: claimId,
          });
          await notes.update(claimId, { title: 'KioskX desk call started' });
          return { ok: true, status: 'callStarted' };
        }
        const composed = await this.composer.composeEmail(
          {
            recipients: { to: person.emails.primaryEmail },
            subject: input.subject!,
            body: input.body!,
            connectedAccountId: account!.id,
          },
          { workspaceId },
        );
        if (!composed.success) {
          await notes.update(claimId, {
            title: 'KioskX desk email unavailable',
          });
          return { ok: false, status: 'unavailable' };
        }
        const sent = await this.sender.sendComposedEmail(composed.data);
        await notes.update(claimId, { title: 'KioskX desk email sent' });
        if (composed.data.shouldPersistMessage)
          await this.sender.persistSentMessage(
            sent,
            composed.data,
            workspaceId,
          );
        return { ok: true, status: 'sent' };
      });
    } catch {
      return { ok: false, status: 'unknown' };
    }
  }
}
