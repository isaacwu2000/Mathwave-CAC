/**
 * Reads Responses events and reports complete program strings in order.
 * Previews are provisional; only a completed response can be validated and saved.
 * Partial strings, refusals and interrupted streams never become final results.
 */
export async function interpretationStream(
  response: Response,
  signal: AbortSignal,
  preview: (programs: string[]) => void,
): Promise<{
  output?: {
    type?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
    content?: { type: string; text?: string }[];
  }[];
  usage?: unknown;
  id?: unknown;
}> {
  if (!response.body) throw new Error('No interpretation stream.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  let wire = '',
    text = '',
    count = 0,
    bytes = 0;
  let completed: Awaited<ReturnType<typeof interpretationStream>> | undefined;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 2000000)
        throw new Error('Interpretation stream is too large.');
      wire += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = wire.indexOf('\n')) !== -1) {
        const line = wire.slice(0, end).trim();
        wire = wire.slice(end + 1);
        if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]')
          continue;
        const event = JSON.parse(line.slice(5));
        if (
          [
            'error',
            'response.failed',
            'response.incomplete',
            'response.refusal.delta',
          ].includes(event.type)
        )
          throw new Error('Interpretation did not complete.');
        if (event.type === 'response.completed') {
          if (event.response?.status !== 'completed')
            throw new Error('Interpretation is incomplete.');
          completed = event.response;
        }
        if (event.type !== 'response.output_text.delta') continue;
        if (typeof event.delta !== 'string')
          throw new Error('Invalid interpretation stream.');
        text += event.delta;
        if (text.length > 32000)
          throw new Error('Interpretation output is too large.');
        // The schema puts intent first. Never preview suggestions or corrections.
        const start =
          /^\s*\{\s*"status"\s*:\s*"command"\s*,\s*"programs"\s*:\s*\[/.exec(
            text,
          );
        if (!start) continue;
        let rest = text.slice(start[0].length);
        const programs: string[] = [];
        while (true) {
          const value = /^\s*("(?:[^"\\]|\\.)*")/.exec(rest);
          if (!value) break;
          const program = JSON.parse(value[1]);
          if (program.length > 1800 || programs.length === 6) break;
          programs.push(program);
          rest = rest.slice(value[0].length);
          const comma = /^\s*,/.exec(rest);
          if (!comma) break;
          rest = rest.slice(comma[0].length);
        }
        if (programs.length > count) {
          count = programs.length;
          preview(programs);
        }
      }
    }
    if (!completed) throw new Error('Interpretation is incomplete.');
    return completed;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
