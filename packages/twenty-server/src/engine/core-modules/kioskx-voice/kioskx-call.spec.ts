import {
  advanceCall,
  type CallState,
  KIOSKX_WORKSPACE_ID,
  voiceEnabled,
} from './kioskx-call';

const makeCall = () => {
  let state: CallState = {
    personId: 'fake-person',
    operationId: 'fake-operation',
    status: 'queued',
    message: '',
    attempts: 0,
  };
  const ports = {
    load: jest.fn(async () => ({ ...state })),
    save: jest.fn(async (next: CallState) => {
      state = { ...next };
    }),
    claimDial: jest.fn(async () => true),
    phone: jest.fn(async () => 'fake-destination'),
    create: jest.fn(async () => 'fake-call'),
    read: jest.fn(
      async (): Promise<{ ended: boolean; transcript?: string }> => ({
        ended: true,
        transcript: 'Operator: Hello. Person: Please send details.',
      }),
    ),
    note: jest.fn(async () => undefined),
    schedule: jest.fn(async () => undefined),
  };
  return { ports, state: () => state };
};

describe('KioskX call outcome', () => {
  it.each([undefined, '', 'false', 'TRUE', '1'])(
    'defaults off for %s',
    (flag) => {
      const original = process.env.KIOSKX_VOICE_CALL;
      delete process.env.KIOSKX_VOICE_CALL;
      expect(voiceEnabled(KIOSKX_WORKSPACE_ID, flag)).toBe(false);
      if (original !== undefined) process.env.KIOSKX_VOICE_CALL = original;
    },
  );
  it('requires both the exact flag and KioskX workspace', () => {
    expect(voiceEnabled(KIOSKX_WORKSPACE_ID, 'true')).toBe(true);
    expect(voiceEnabled('apple-workspace', 'true')).toBe(false);
  });
  it('writes the returned transcript to the same person only after completion', async () => {
    const { ports, state } = makeCall();
    await advanceCall(ports);
    expect(ports.note).not.toHaveBeenCalled();
    expect(ports.create).toHaveBeenCalledWith('fake-destination');
    await advanceCall(ports);
    expect(ports.note).toHaveBeenCalledWith(
      'fake-operation',
      'fake-person',
      'Operator: Hello. Person: Please send details.',
    );
    expect(state().status).toBe('complete');
    await advanceCall(ports);
    expect(ports.note).toHaveBeenCalledTimes(1);
    expect(ports.create).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, '', '   '])(
    'never invents a transcript when voice returns %s',
    async (transcript) => {
      const { ports, state } = makeCall();
      ports.read.mockResolvedValue({ ended: true, transcript });
      await advanceCall(ports);
      for (let i = 0; i < 120; i++) await advanceCall(ports);
      expect(ports.note).not.toHaveBeenCalled();
      expect(state().status).toBe('failed');
      expect(state().message).toContain('No transcript returned');
      expect(ports.create).toHaveBeenCalledTimes(1);
    },
  );
  it('shows failure without a note when the voice client rejects', async () => {
    const { ports, state } = makeCall();
    ports.create.mockRejectedValue(new Error('private upstream details'));
    await advanceCall(ports);
    expect(state().status).toBe('failed');
    expect(state().message).not.toContain('private');
    expect(ports.note).not.toHaveBeenCalled();
    await advanceCall(ports);
    expect(ports.create).toHaveBeenCalledTimes(1);
  });
  it('does not redial an ambiguous create after a worker restart', async () => {
    const { ports, state } = makeCall();
    ports.claimDial.mockResolvedValue(false);
    await advanceCall(ports);
    expect(ports.create).not.toHaveBeenCalled();
    expect(ports.note).not.toHaveBeenCalled();
    expect(state().status).toBe('failed');
  });
  it('waits for the call to end even if partial text is available', async () => {
    const { ports } = makeCall();
    ports.read.mockResolvedValue({ ended: false, transcript: 'partial' });
    await advanceCall(ports);
    await advanceCall(ports);
    expect(ports.note).not.toHaveBeenCalled();
  });
  it('retries note persistence without placing another call', async () => {
    const { ports, state } = makeCall();
    ports.note.mockRejectedValueOnce(new Error('database unavailable'));
    await advanceCall(ports);
    await advanceCall(ports);
    await advanceCall(ports);
    expect(state().status).toBe('complete');
    expect(ports.create).toHaveBeenCalledTimes(1);
  });
  it('reports a failed save honestly when a transcript was returned', async () => {
    const { ports, state } = makeCall();
    ports.note.mockRejectedValue(new Error('database unavailable'));
    await advanceCall(ports);
    for (let i = 0; i < 6; i++) await advanceCall(ports);
    expect(state().status).toBe('failed');
    expect(state().message).toContain('Transcript could not be saved');
    expect(ports.create).toHaveBeenCalledTimes(1);
  });
});
