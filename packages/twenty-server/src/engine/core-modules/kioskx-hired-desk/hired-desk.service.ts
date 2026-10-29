import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { In } from 'typeorm';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';
import { NoteTargetWorkspaceEntity } from 'src/modules/note/standard-objects/note-target.workspace-entity';
import { HIRED_WORKSPACE } from './hired-policy';
import { formContacts, inquiryText } from './hired-redact';

export const HIRED_GOOGLE_VOICE = Symbol('HIRED_GOOGLE_VOICE');
// No production provider is registered: no provisioned Google Voice forwarding
// exists. Never substitute the existing Voice Studio/Fonoster transport.
export interface HiredGoogleVoice {
  configured(): boolean;
  // An adapter must verify the existing forwarding and recording setup and
  // resolve only after the call ends. Numbers and provider errors stay server-side.
  conversation(input: {
    destination: string;
    operationId: string;
  }): Promise<{ transcript: string }>;
}
export type HiredLead = {
  id: string;
  label: string;
  inquiry: string;
  email: string;
  phone: string;
  canCall: boolean;
};

@Injectable()
export class HiredDeskService {
  constructor(
    private readonly orm: GlobalWorkspaceOrmManager,
    @Optional()
    @Inject(HIRED_GOOGLE_VOICE)
    private readonly voice?: HiredGoogleVoice,
  ) {}
  private voiceOn() {
    return (
      process.env.KIOSKX_HIRED_VOICE === 'true' && !!this.voice?.configured()
    );
  }
  private system<T>(fn: () => Promise<T>) {
    return this.orm.executeInWorkspaceContext(
      fn,
      buildSystemAuthContext(HIRED_WORKSPACE),
    );
  }
  private repo<T>(name: 'note' | 'noteTarget' | 'person') {
    return this.orm.getRepository<T>(HIRED_WORKSPACE, name, {
      shouldBypassPermissionChecks: true,
    });
  }
  private async records() {
    const notes = await this.repo<NoteWorkspaceEntity>('note');
    const targets = await this.repo<NoteTargetWorkspaceEntity>('noteTarget');
    const people = await this.repo<PersonWorkspaceEntity>('person');
    // Provenance is the existing linked form note, not membership in People.
    const forms = await notes.find({
      where: {
        title: In(['KioskX contact form', 'KioskX newsletter']),
      },
      order: { createdAt: 'DESC' },
    });
    if (!forms.length) return [];
    const links = await targets.find({
      where: { noteId: In(forms.map((note) => note.id)) },
    });
    const ids = [
      ...new Set(
        links
          .map((link) => link.targetPersonId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (!ids.length) return [];
    const persons = await people.find({ where: { id: In(ids) } });
    return persons.map((person) => {
      const noteIds = new Set(
        links
          .filter((link) => link.targetPersonId === person.id)
          .map((link) => link.noteId),
      );
      const linkedForms = forms.filter((note) => noteIds.has(note.id));
      const contacts = linkedForms.map((note) => formContacts(note.bodyV2));
      const number = person.phones?.primaryPhoneNumber?.trim() ?? '';
      const code = person.phones?.primaryPhoneCallingCode?.trim() ?? '';
      return {
        person,
        email:
          person.emails?.primaryEmail?.trim() ||
          contacts.find((c) => c.email)?.email ||
          '',
        phone: number
          ? number.startsWith('+') || !code
            ? number
            : `+${code.replace(/\D/g, '')} ${number}`
          : contacts.find((c) => c.phone)?.phone || '',
        inquiry: forms
          .filter((note) => noteIds.has(note.id))
          .map((note) => inquiryText(note.bodyV2))
          .join('\n\n'),
      };
    });
  }
  private destination(person: PersonWorkspaceEntity) {
    const number = person.phones?.primaryPhoneNumber?.trim();
    if (!number) return '';
    const prefix =
      person.phones?.primaryPhoneCallingCode?.replace(/\D/g, '') ?? '';
    const normalized = number.startsWith('+')
      ? `+${number.replace(/\D/g, '')}`
      : `+${prefix}${number.replace(/\D/g, '')}`;
    return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : '';
  }
  async leads(): Promise<{ unavailable: boolean; leads: HiredLead[] }> {
    try {
      return await this.system(async () => ({
        unavailable: false,
        leads: (await this.records()).map(
          ({ person, inquiry, email, phone }) => ({
            id: person.id,
            // A safe stable label cannot accidentally contain a name-field email/phone.
            label: `Inquiry ${createHash('sha256').update(person.id).digest('hex').slice(0, 8)}`,
            inquiry,
            email,
            phone,
            canCall: this.voiceOn() && !!this.destination(person),
          }),
        ),
      }));
    } catch (error) {
      const code =
        error instanceof Error
          ? error.name
          : typeof error === 'string'
            ? 'Error'
            : 'unknown';
      console.error(`HiredDeskService.leads failed: ${code}`);
      return { unavailable: true, leads: [] };
    }
  }
  async call(leadId: string, requestId: string) {
    try {
      return await this.system(async () => {
        if (!this.voiceOn()) return { status: 'unavailable' };
        const record = (await this.records()).find(
          ({ person }) => person.id === leadId,
        );
        const destination = record && this.destination(record.person);
        if (!destination) return { status: 'unavailable' };
        const notes = await this.repo<NoteWorkspaceEntity>('note');
        const targets =
          await this.repo<NoteTargetWorkspaceEntity>('noteTarget');
        const hash = createHash('sha256')
          .update(`${HIRED_WORKSPACE}:${leadId}:${requestId}`)
          .digest('hex');
        const operationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        // Unique durable claim before dialing. An ambiguous POST is never replayed.
        try {
          await notes.insert({
            id: operationId,
            title: 'KioskX hired call pending',
          });
        } catch {
          return { status: 'alreadySubmitted' };
        }
        await targets.insert({ noteId: operationId, targetPersonId: leadId });
        const result = await this.voice!.conversation({
          destination,
          operationId,
        });
        await notes.update(operationId, {
          title: 'KioskX hired call',
          bodyV2: {
            markdown: result.transcript,
            blocknote: JSON.stringify([
              {
                id: randomUUID(),
                type: 'paragraph',
                props: {},
                content: [
                  { type: 'text', text: result.transcript, styles: {} },
                ],
                children: [],
              },
            ]),
          },
        });
        return { status: 'complete' };
      });
    } catch {
      // Retain the claim for admin reconciliation; do not retry or disclose errors.
      return { status: 'unknown' };
    }
  }
}
