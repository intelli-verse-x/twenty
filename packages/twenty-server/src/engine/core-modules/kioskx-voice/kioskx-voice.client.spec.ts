import { KioskxVoiceClient } from './kioskx-voice.client';

describe('existing Fonoster MCP contract', () => {
  const env = {
    FONOSTER_MCP_TOKEN: 'fake-token',
    KIOSKX_VOICE_APP_REF: 'fake-app',
    KIOSKX_VOICE_FROM_NUMBER: 'fake-from',
  };
  const fetchMock = jest.fn();
  const original = global.fetch;
  beforeEach(() => {
    global.fetch = fetchMock;
    fetchMock.mockReset();
  });
  afterAll(() => {
    global.fetch = original;
  });
  const response = (data: unknown) => ({
    ok: true,
    json: async () => ({
      result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
    }),
  });
  it('uses the configured application and caller, never the operator phone', async () => {
    fetchMock.mockResolvedValue(response({ ref: 'fake-call' }));
    expect(await new KioskxVoiceClient(env).create('fake-person-phone')).toBe(
      'fake-call',
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params).toEqual({
      name: 'fonoster_create_call',
      arguments: {
        from: 'fake-from',
        to: 'fake-person-phone',
        appRef: 'fake-app',
      },
    });
  });
  it('does not send a request when configuration is incomplete', async () => {
    await expect(new KioskxVoiceClient({}).create('fake')).rejects.toThrow(
      'unavailable',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects MCP tool errors and does not expose upstream details', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { isError: true, content: [{ text: 'sensitive' }] },
      }),
    });
    await expect(new KioskxVoiceClient(env).create('fake')).rejects.toThrow(
      'Voice Studio rejected',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reads only the returned reference and actual transcript', async () => {
    fetchMock.mockResolvedValue(
      response({
        ref: 'fake-call',
        endedAt: 123,
        transcript: 'Actual transcript',
      }),
    );
    expect(await new KioskxVoiceClient(env).read('fake-call')).toEqual({
      ended: true,
      transcript: 'Actual transcript',
    });
  });
  it('does not synthesize missing transcript fields', async () => {
    fetchMock.mockResolvedValue(response({ ref: 'fake-call', endedAt: 123 }));
    expect(
      (await new KioskxVoiceClient(env).read('fake-call')).transcript,
    ).toBeUndefined();
  });
  it('reports a terminal rejected call without transcript', async () => {
    fetchMock.mockResolvedValue(
      response({ ref: 'fake-call', endedAt: 123, status: 'CALL_REJECTED' }),
    );
    expect(await new KioskxVoiceClient(env).read('fake-call')).toEqual({
      ended: true,
      failed: true,
      transcript: undefined,
    });
  });
  it('does not mistake an epoch placeholder for a completed call', async () => {
    fetchMock.mockResolvedValue(
      response({ ref: 'fake-call', endedAt: '1970-01-01T00:00:00.000Z' }),
    );
    expect((await new KioskxVoiceClient(env).read('fake-call')).ended).toBe(
      false,
    );
  });
});
