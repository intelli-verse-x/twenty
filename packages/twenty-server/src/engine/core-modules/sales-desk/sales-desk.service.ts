import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createTransport } from 'nodemailer';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';

export const SALES_QUEUES = ['cleaning', 'cars', 'jobs', 'turo'] as const;
export type SalesQueue = (typeof SALES_QUEUES)[number];
export type SalesRow = {
  id: string;
  label: string;
  company: string;
  inquiry: string;
  email?: string;
  phone?: string;
  active?: boolean;
  nextStep?: string;
  dueAt?: string;
  hiringStatus?: 'new' | 'reviewing' | 'contacted';
};
const fixtures: Record<Exclude<SalesQueue, 'turo'>, SalesRow[]> = {
  cleaning: [
    {
      id: 'fixture-cleaning',
      label: 'Fixture Cleaning Applicant',
      company: 'Fixture Company',
      inquiry: 'Service: Office cleaning request',
      active: true,
    },
  ],
  cars: [
    {
      id: 'fixture-cars',
      label: 'Fixture Rental Applicant',
      company: 'Fixture Company',
      inquiry: 'Rental: Weekend car request',
      active: true,
    },
  ],
  jobs: ['truck driver', 'delivery helper', 'housekeeper'].map(
    (role, index) => ({
      id: `fixture-job-${index}`,
      label: `Fixture Job Applicant ${index + 1}`,
      company: 'Fixture Employer',
      inquiry: `Role: ${role}`,
      hiringStatus: 'new',
    }),
  ),
};

@Injectable()
export class SalesDeskService {
  constructor(private readonly orm: GlobalWorkspaceOrmManager) {}

  allowed(email: string) {
    return (process.env.DESK_SALES_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.trim().toLowerCase());
  }
  channels() {
    return {
      email:
        process.env.DESK_SALES_EMAIL === 'true' &&
        !!process.env.EMAIL_SMTP_HOST &&
        /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(
          process.env.DESK_SALES_EMAIL_FROM ?? '',
        ),
      // The existing Voice bridge is bound to hired inquiries, not these sources.
      voice: false,
      voiceStatus:
        process.env.DESK_SALES_VOICE === 'true'
          ? 'Calling is unavailable. Google Voice is not connected to this desk.'
          : 'Calling is off.',
    };
  }
  private noteId(workspace: string, queue: string, id: string) {
    const hash = createHash('sha256')
      .update(`sales-desk:${workspace}:${queue}:${id}`)
      .digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }
  private system<T>(workspace: string, fn: () => Promise<T>) {
    return this.orm.executeInWorkspaceContext(
      fn,
      buildSystemAuthContext(workspace),
    );
  }
  private notes(workspace: string) {
    return this.orm.getRepository<NoteWorkspaceEntity>(workspace, 'note', {
      shouldBypassPermissionChecks: true,
    });
  }
  private source(queue: Exclude<SalesQueue, 'turo'>): SalesRow[] {
    // No provenance-backed reader for these three businesses exists in this fork.
    // Never classify arbitrary CRM people as sales requests.
    return process.env.DESK_SALES_FIXTURES === 'true'
      ? fixtures[queue].map((row) => ({ ...row }))
      : [];
  }
  async read(workspace: string, queue: SalesQueue) {
    if (queue === 'turo') {
      const raw = process.env.DESK_TURO_REPORT_JSON;
      if (!raw)
        return { rows: [], empty: 'The fleet report is not connected.' };
      const report = JSON.parse(raw);
      if (!report || !Array.isArray(report.cars) || report.cars.length > 500)
        throw new Error('Invalid fleet report');
      const rows: SalesRow[] = report.cars.map(
        (car: Record<string, unknown>, index: number) => {
          if (
            !car ||
            typeof car.name !== 'string' ||
            !car.name.trim() ||
            typeof car.idleGap !== 'string' ||
            typeof car.hostEarn !== 'string' ||
            typeof car.paidByTuro !== 'string'
          )
            throw new Error('Invalid fleet report');
          return {
            id: `turo-${index}`,
            label: car.name,
            company: 'Turo fleet report',
            inquiry: `Idle gap: ${car.idleGap}\nHost earn: ${car.hostEarn}\nMoney Turo has sent: ${car.paidByTuro}`,
          };
        },
      );
      return { rows, empty: 'The fleet report has no cars.' };
    }
    const rows = this.source(queue);
    if (!rows.length)
      return { rows, empty: 'No requests are connected to this queue yet.' };
    return this.system(workspace, async () => {
      const notes = await this.notes(workspace);
      for (const row of rows) {
        const note = await notes.findOne({
          where: { id: this.noteId(workspace, queue, row.id) },
        });
        if (note?.bodyV2?.markdown) {
          const saved = JSON.parse(note.bodyV2.markdown);
          row.nextStep = saved.nextStep;
          row.dueAt = saved.dueAt;
          if (queue === 'jobs') row.hiringStatus = saved.hiringStatus ?? 'new';
        }
      }
      return { rows, empty: 'No requests in this queue.' };
    });
  }
  async save(
    workspace: string,
    queue: SalesQueue,
    id: string,
    input: Record<string, unknown>,
  ) {
    if (queue === 'turo')
      throw new BadRequestException('The fleet report is read-only.');
    const row = this.source(queue).find((item) => item.id === id);
    if (!row) throw new BadRequestException('Request not found.');
    if (queue === 'jobs') {
      if (
        !['new', 'reviewing', 'contacted'].includes(String(input.hiringStatus))
      )
        throw new BadRequestException('Hiring status is required.');
      row.hiringStatus = input.hiringStatus as SalesRow['hiringStatus'];
    } else {
      const missing = [];
      if (typeof input.nextStep !== 'string' || !input.nextStep.trim())
        missing.push('Next step');
      if (typeof input.dueAt !== 'string' || !input.dueAt.trim())
        missing.push('Due time');
      if (missing.length)
        throw new BadRequestException(`${missing.join(' and ')} required.`);
      if (
        (input.nextStep as string).length > 2000 ||
        !Number.isFinite(Date.parse(input.dueAt as string))
      )
        throw new BadRequestException('Enter a valid next step and due time.');
      row.nextStep = (input.nextStep as string).trim();
      row.dueAt = new Date(input.dueAt as string).toISOString();
    }
    await this.system(workspace, async () => {
      const notes = await this.notes(workspace);
      await notes.upsert(
        {
          id: this.noteId(workspace, queue, id),
          title: 'Sales desk follow-up',
          bodyV2: {
            markdown: JSON.stringify({
              nextStep: row.nextStep,
              dueAt: row.dueAt,
              hiringStatus: row.hiringStatus,
            }),
            blocknote: null,
          },
        },
        ['id'],
      );
    });
    return { row };
  }
  async email(
    workspace: string,
    queue: SalesQueue,
    id: string,
    requestId: string,
    body: string,
  ) {
    if (queue === 'turo' || !this.channels().email)
      return { status: 'unavailable' };
    const row = this.source(queue).find((item) => item.id === id);
    // Fixtures deliberately have no deliverable addresses.
    if (
      !row?.email ||
      !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(row.email)
    )
      return { status: 'unavailable' };
    return this.system(workspace, async () => {
      const notes = await this.notes(workspace);
      const operationId = this.noteId(
        workspace,
        'email',
        `${queue}:${id}:${requestId}`,
      );
      try {
        await notes.insert({
          id: operationId,
          title: 'Sales desk email pending',
          bodyV2: { markdown: body, blocknote: null },
        });
      } catch {
        return { status: 'alreadySubmitted' };
      }
      // Same awaited SMTP transport pattern as hired-mail; no retrying mail queue.
      const port = Number(process.env.EMAIL_SMTP_PORT || 587);
      const transport = createTransport({
        host: process.env.EMAIL_SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: true,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
        ...(process.env.EMAIL_SMTP_USER
          ? {
              auth: {
                user: process.env.EMAIL_SMTP_USER,
                pass: process.env.EMAIL_SMTP_PASSWORD,
              },
            }
          : {}),
      });
      try {
        const result = await transport.sendMail({
          from: process.env.DESK_SALES_EMAIL_FROM,
          to: row.email,
          subject: 'Your inquiry',
          text: body,
          messageId: `<${operationId}@intelli-verse-x.ai>`,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (!result.accepted?.length || result.rejected?.length)
          return { status: 'unknown' };
        await notes.update(operationId, { title: 'Sales desk email sent' });
        return { status: 'sent' };
      } catch {
        return { status: 'unknown' };
      } finally {
        transport.close();
      }
    });
  }
  call() {
    return { status: 'unavailable' };
  }
}
