// Same MCP create-call contract used by kiosk-x/app/voice.py.
export class KioskxVoiceClient {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  configured() {
    return Boolean(
      this.env.FONOSTER_MCP_TOKEN &&
      this.env.KIOSKX_VOICE_APP_REF &&
      this.env.KIOSKX_VOICE_FROM_NUMBER,
    );
  }

  private async tool(name: string, args: Record<string, unknown>) {
    if (!this.configured()) throw new Error('Voice Studio is unavailable.');
    const response = await fetch(
      this.env.FONOSTER_MCP_URL || 'http://fonoster-mcp:3030',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.FONOSTER_MCP_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error('Voice Studio is unavailable.');
    const payload = await response.json();
    if (payload.error || payload.result?.isError)
      throw new Error('Voice Studio rejected the request.');
    const block = payload.result?.content?.find(
      (item: { type: string }) => item.type === 'text',
    );
    return JSON.parse(block?.text || '{}');
  }

  async create(to: string): Promise<string> {
    const result = await this.tool('fonoster_create_call', {
      from: this.env.KIOSKX_VOICE_FROM_NUMBER,
      to,
      appRef: this.env.KIOSKX_VOICE_APP_REF,
    });
    if (typeof result.ref !== 'string' || !result.ref)
      throw new Error('No call reference returned.');
    return result.ref;
  }

  async read(
    ref: string,
  ): Promise<{ ended: boolean; transcript?: string; failed?: boolean }> {
    const result = await this.tool('fonoster_get_call', { ref });
    if (result.ref !== ref) throw new Error('Call reference mismatch.');
    const ended = Boolean(
      result.endedAt && new Date(result.endedAt).getTime() > 0,
    );
    return {
      ended,
      ...(ended && result.status && result.status !== 'NORMAL_CLEARING'
        ? { failed: true }
        : {}),
      transcript:
        typeof result.transcript === 'string' ? result.transcript : undefined,
    };
  }
}
