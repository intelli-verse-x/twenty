export const KIOSKX_WORKSPACE_ID = '243e9c93-f7f9-47cc-ab7d-6a7dd6659774';
export const voiceEnabled = (
  workspaceId: string,
  flag = process.env.KIOSKX_VOICE_CALL,
) => flag === 'true' && workspaceId === KIOSKX_WORKSPACE_ID;

export type CallState = {
  personId: string;
  operationId: string;
  requestId?: string;
  status: 'queued' | 'dialing' | 'pending' | 'complete' | 'failed';
  callId?: string;
  message: string;
  attempts: number;
  endedReads?: number;
};

export interface CallPorts {
  load(): Promise<CallState | null>;
  save(state: CallState): Promise<void>;
  // An atomic persistent claim; never expires into an automatic redial.
  claimDial(): Promise<boolean>;
  phone(): Promise<string>;
  create(phone: string): Promise<string>;
  read(
    ref: string,
  ): Promise<{ ended: boolean; transcript?: string; failed?: boolean }>;
  note(id: string, personId: string, transcript: string): Promise<void>;
  schedule(): Promise<void>;
}

// Retries only read a known call. An ambiguous create is never replayed.
export async function advanceCall(ports: CallPorts) {
  const state = await ports.load();
  if (!state || state.status === 'complete' || state.status === 'failed')
    return;
  if (!state.callId) {
    if (!(await ports.claimDial())) {
      state.status = 'failed';
      state.message = 'Call unconfirmed. Check Voice Studio before retrying.';
      await ports.save(state);
      return;
    }
    state.status = 'dialing';
    await ports.save(state);
    try {
      state.callId = await ports.create(await ports.phone());
    } catch {
      state.status = 'failed';
      state.message = 'Call unconfirmed. Check Voice Studio before retrying.';
      await ports.save(state);
      return;
    }
    state.status = 'pending';
    state.message = 'Call started. Waiting for transcript…';
    await ports.save(state);
    await ports.schedule();
    return;
  }
  state.attempts += 1;
  let receivedTranscript = false;
  let readOrSaveFailed = false;
  try {
    const result = await ports.read(state.callId);
    if (result.failed) {
      state.status = 'failed';
      state.message = 'Voice Studio could not complete the call.';
      await ports.save(state);
      return;
    }
    if (result.ended) state.endedReads = (state.endedReads || 0) + 1;
    if (result.ended && result.transcript?.trim()) {
      receivedTranscript = true;
      await ports.note(state.operationId, state.personId, result.transcript);
      state.status = 'complete';
      state.message = 'Transcript saved as KioskX call.';
      await ports.save(state);
      return;
    }
  } catch {
    readOrSaveFailed = true;
    // Read/persistence failures may be retried; create-call may not.
  }
  if (state.attempts >= 120 || (state.endedReads || 0) >= 6) {
    state.status = 'failed';
    state.message = receivedTranscript
      ? 'Transcript could not be saved. Check Voice Studio.'
      : readOrSaveFailed
        ? 'Call status unavailable. Check Voice Studio.'
        : 'No transcript returned. Check Voice Studio.';
  }
  await ports.save(state);
  if (state.status === 'pending') await ports.schedule();
}
