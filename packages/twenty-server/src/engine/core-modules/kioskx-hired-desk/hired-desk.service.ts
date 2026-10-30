import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID, publicEncrypt, createPublicKey, constants } from 'node:crypto';
import { In } from 'typeorm';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';
import { NoteTargetWorkspaceEntity } from 'src/modules/note/standard-objects/note-target.workspace-entity';
import { HIRED_WORKSPACE } from './hired-policy';
import { formContacts, inquiryText, redactContactText } from './hired-redact';
import { HIRED_MAIL, type HiredMail } from './hired-mail';

export const HIRED_GOOGLE_VOICE = Symbol('HIRED_GOOGLE_VOICE');
// Retained for constructor compatibility only. The hired call path never invokes
// this legacy adapter; Google Voice runs in the paired browser extension.
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
  company: string;
  messages: { id: string; body: string; createdAt: string }[];
};

@Injectable()
export class HiredDeskService {
  constructor(
    private readonly orm: GlobalWorkspaceOrmManager,
    @Optional()
    @Inject(HIRED_GOOGLE_VOICE)
    private readonly voice?: HiredGoogleVoice,
    @Optional()
    @Inject(HIRED_MAIL)
    private readonly mail?: HiredMail,
  ) {}
  private voiceOn() {
    return process.env.KIOSKX_HIRED_VOICE !== 'false' &&
      !!process.env.KIOSKX_GOOGLE_VOICE_NUMBER?.trim();
  }
  private readonly bridgeNote = '4694fd8b-c7e3-4d0a-9e57-703253445802';
  private async bridgeSession() {
    const notes = await this.repo<NoteWorkspaceEntity>('note');
    const note = await notes.findOne({ where: { id: this.bridgeNote } });
    try { return JSON.parse(note?.bodyV2?.markdown || '{}'); }
    catch { return {}; }
  }
  async bridgeConfig() {
    return {
      enabled: this.voiceOn(),
      officeHash: createHash('sha256').update(
        (process.env.KIOSKX_GOOGLE_VOICE_NUMBER || '').replace(/\D/g, ''),
      ).digest('hex'),
    };
  }
  async bridge(input: Record<string, unknown>) {
    return this.system(async () => {
      if (!this.voiceOn()) return { status: 'unavailable' };
      const notes = await this.repo<NoteWorkspaceEntity>('note');
      const session = await this.bridgeSession();
      if (input.action === 'connect') {
        if (typeof input.publicKey !== 'string' || input.publicKey.length > 1000 ||
            typeof input.sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.sessionId))
          return { status: 'unavailable' };
        const key = createPublicKey(input.publicKey);
        if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048)
          return { status: 'unavailable' };
        // One desk browser at a time. Replacing a live session requires its key.
        if (session.expires > Date.now() && session.sessionId !== input.sessionId)
          return { status: 'busy' };
        const bodyV2 = { markdown: JSON.stringify({
          sessionId: input.sessionId, publicKey: input.publicKey,
          expires: Date.now() + 15000,
        }), blocknote: null };
        if (!session.sessionId) {
          try { await notes.insert({ id: this.bridgeNote, title: 'KioskX Voice browser session', bodyV2 }); }
          catch { return { status: 'busy' }; }
        } else await notes.update(this.bridgeNote, { bodyV2 });
        return { status: 'connected' };
      }
      if (!session.sessionId || session.sessionId !== input.sessionId || session.expires < Date.now())
        return { status: 'connect' };
      if (input.action === 'poll') {
        const pending = await notes.find({ where: { title: 'KioskX Google Voice queued' }, order: { createdAt: 'ASC' } });
        for (const note of pending) {
          let payload;
          try { payload = JSON.parse(note.bodyV2?.markdown || '{}'); } catch { continue; }
          if (payload.sessionId !== session.sessionId) continue;
          const expired = payload.expires < Date.now();
          // Atomic compare-and-set: never hand a call to two tabs/replicas, never replay.
          const claim = await notes.update({ id: note.id, title: 'KioskX Google Voice queued' }, {
            title: expired ? 'KioskX Google Voice expired — not dialed' : 'KioskX Google Voice handed off — outcome unknown',
            bodyV2: { markdown: JSON.stringify({ sessionId: session.sessionId }), blocknote: null },
          });
          if (!expired && claim.affected === 1)
            return { status: 'claimed', operationId: note.id, ciphertext: payload.ciphertext };
        }
        return { status: 'idle' };
      }
      if (input.action === 'result' && typeof input.operationId === 'string' &&
          /^[a-f0-9-]{36}$/i.test(input.operationId)) {
        const note = await notes.findOne({ where: { id: input.operationId } });
        if (note?.title !== 'KioskX Google Voice handed off — outcome unknown' ||
            JSON.parse(note.bodyV2?.markdown || '{}').sessionId !== session.sessionId)
          return { status: 'unavailable' };
        const status = input.status === 'opened' ? 'Google Voice opened — call outcome unverified; no transcript' :
          input.status === 'no-session' ? 'Google Voice disconnected — not dialed' : 'Google Voice outcome unknown — do not retry';
        await notes.update(note.id, { title: `KioskX hired call: ${status}` });
        return { status: 'saved' };
      }
      return { status: 'unavailable' };
    });
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
        label:
          contacts.find((c) => c.name)?.name ||
          redactContactText(
            [person.name?.firstName, person.name?.lastName]
              .filter(Boolean)
              .join(' '),
          ) ||
          `Inquiry ${createHash('sha256').update(person.id).digest('hex').slice(0, 8)}`,
        company: contacts.find((c) => c.company)?.company || '',
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
  private destination(phone: string) {
    const number = phone.trim();
    if (!number) return '';
    const normalized = number.startsWith('+')
      ? `+${number.replace(/\D/g, '')}`
      : '';
    return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : '';
  }
  async leads(): Promise<{ unavailable: boolean; leads: HiredLead[] }> {
    try {
      return await this.system(async () => {
        const records = await this.records();
        const notes = await this.repo<NoteWorkspaceEntity>('note');
        const targets =
          await this.repo<NoteTargetWorkspaceEntity>('noteTarget');
        const links = records.length
          ? await targets.find({
              where: {
                targetPersonId: In(records.map(({ person }) => person.id)),
              },
            })
          : [];
        const sent = links.length
          ? await notes.find({
              where: {
                id: In(links.map((link) => link.noteId)),
                title: 'KioskX hired email',
              },
              order: { createdAt: 'ASC' },
            })
          : [];
        return {
          unavailable: false,
          leads: records.map(
            ({ person, label, company, inquiry, email, phone }) => ({
              id: person.id,
              label,
              company,
              inquiry,
              email: email ? '••••@••••' : '',
              phone: phone ? '••• ••• ••••' : '',
              canCall: this.voiceOn() && !!this.destination(phone),
              messages: sent
                .filter(
                  (note) =>
                    note.title === 'KioskX hired email' &&
                    links.some(
                      (link) =>
                        link.noteId === note.id &&
                        link.targetPersonId === person.id,
                    ),
                )
                .map((note) => ({
                  id: note.id,
                  body: inquiryText(note.bodyV2),
                  createdAt: new Date(note.createdAt).toISOString(),
                })),
            }),
          ),
        };
      });
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
        const session = await this.bridgeSession();
        if (!session.sessionId || session.expires < Date.now()) return { status: 'connect' };
        const record = (await this.records()).find(
          ({ person }) => person.id === leadId,
        );
        const destination = record && this.destination(record.phone);
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
            title: 'KioskX Google Voice preparing',
          });
        } catch {
          return { status: 'alreadySubmitted' };
        }
        await targets.insert({ noteId: operationId, targetPersonId: leadId });
        const ciphertext = publicEncrypt({ key: session.publicKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256',
        }, Buffer.from(destination)).toString('base64');
        await notes.update(operationId, {
          title: 'KioskX Google Voice queued',
          bodyV2: { markdown: JSON.stringify({ sessionId: session.sessionId,
            ciphertext, expires: Date.now() + 20000 }), blocknote: null },
        });
        return { status: 'queued' };
      });
    } catch {
      // Retain the claim for admin reconciliation; do not retry or disclose errors.
      return { status: 'unknown' };
    }
  }
  async importVoiceTranscript(operationId: string, transcript: string, source: string) {
    return this.system(async () => {
      const notes = await this.repo<NoteWorkspaceEntity>('note');
      const note = await notes.findOne({ where: { id: operationId } });
      if (!note || !/^KioskX (?:Google Voice handed off|hired call:)/.test(note.title))
        return { status: 'unavailable' };
      const targets = await this.repo<NoteTargetWorkspaceEntity>('noteTarget');
      const links = await targets.find({ where: { noteId: operationId } });
      if (!links.some(link => !!link.targetPersonId)) return { status: 'unavailable' };
      const id = createHash('sha256').update(`voice-transcript:${operationId}`).digest('hex');
      const transcriptId = `${id.slice(0,8)}-${id.slice(8,12)}-4${id.slice(13,16)}-a${id.slice(17,20)}-${id.slice(20,32)}`;
      const text = `Source: ${source}\nCall: ${operationId}\n\n${transcript}`;
      let created = true;
      try {
        await notes.insert({ id: transcriptId, title: 'KioskX Google Voice transcript',
          bodyV2: { markdown: text, blocknote: JSON.stringify([{
            id: transcriptId, type: 'paragraph', props: {},
            content: [{ type: 'text', text, styles: {} }], children: [],
          }]) } });
      } catch {
        const existing = await notes.findOne({ where: { id: transcriptId } });
        if (existing?.title !== 'KioskX Google Voice transcript' || existing.bodyV2?.markdown !== text)
          return { status: 'alreadySubmitted' };
        created = false;
      }
      // Repair an interrupted attachment without replacing or duplicating the transcript.
      const attached = await targets.find({ where: { noteId: transcriptId } });
      for (const link of links.filter(link => !!link.targetPersonId)) {
        if (attached.some(item => item.targetPersonId === link.targetPersonId)) continue;
        const digest = createHash('sha256').update(`${transcriptId}:${link.targetPersonId}`).digest('hex');
        const linkId = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
        await targets.insert({ id: linkId, noteId: transcriptId, targetPersonId: link.targetPersonId });
      }
      return { status: created ? 'saved' : 'alreadySubmitted' };
    });
  }
  async email(leadId: string, requestId: string, body: string) {
    try {
      return await this.system(async () => {
        if (
          process.env.KIOSKX_HIRED_EMAIL !== 'true' ||
          !this.mail?.configured()
        )
          return { status: 'unavailable' };
        const record = (await this.records()).find(
          ({ person }) => person.id === leadId,
        );
        if (
          !record ||
          !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(record.email) ||
          !body.trim() ||
          body.length > 10000
        )
          return { status: 'unavailable' };
        const notes = await this.repo<NoteWorkspaceEntity>('note');
        const targets =
          await this.repo<NoteTargetWorkspaceEntity>('noteTarget');
        const hash = createHash('sha256')
          .update(`${HIRED_WORKSPACE}:email:${leadId}:${requestId}`)
          .digest('hex');
        const operationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        try {
          await notes.insert({
            id: operationId,
            title: 'KioskX hired email pending',
            bodyV2: {
              markdown: body,
              blocknote: JSON.stringify([
                {
                  id: randomUUID(),
                  type: 'paragraph',
                  props: {},
                  content: [{ type: 'text', text: body, styles: {} }],
                  children: [],
                },
              ]),
            },
          });
        } catch {
          return { status: 'alreadySubmitted' };
        }
        await targets.insert({ noteId: operationId, targetPersonId: leadId });
        await this.mail.send({ destination: record.email, body, operationId });
        await notes.update(operationId, { title: 'KioskX hired email' });
        return {
          status: 'sent',
          message: {
            id: operationId,
            body: redactContactText(body),
            createdAt: new Date().toISOString(),
          },
        };
      });
    } catch {
      // Preserve the pending claim and body for admin reconciliation, never resend.
      return { status: 'unknown' };
    }
  }
}
