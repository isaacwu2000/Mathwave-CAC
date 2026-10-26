import { mathProgramCommand } from '../../commands/index.ts';

/**
 * - Reads complete command records from the provider's text stream.
 * - Rejects malformed, oversized, refused, or unfinished responses.
 * - Releases the reader on completion or failure; partial commands are never returned.
 */
export async function* graphStreamOutput(
  response: Response,
  signal: AbortSignal,
  recordUsage?: (value: unknown) => void,
): AsyncGenerator<
  | { command: string }
  | { status: 'clarification' | 'unsupported'; message: string }
> {
  if (!response.ok || !response.body)
    throw new Error('Graph generation is unavailable.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let wire = '',
    text = '',
    total = 0,
    completed = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      wire += decoder.decode(chunk.value, { stream: true });
      if (wire.length > 200000) throw new Error('Graph stream is too large.');
      let end: number;
      while ((end = wire.indexOf('\n')) !== -1) {
        const line = wire.slice(0, end).trim();
        wire = wire.slice(end + 1);
        if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]')
          continue;
        const event = JSON.parse(line.slice(5));
        if (event.type === 'response.completed') {
          completed = event.response?.status === 'completed';
          recordUsage?.({
            usage: event.response?.usage,
            responseId: event.response?.id,
            model: event.response?.model,
          });
        }
        if (
          event.type === 'error' ||
          event.type === 'response.failed' ||
          event.type === 'response.incomplete' ||
          event.type === 'response.refusal.delta'
        )
          throw new Error('Graph generation did not complete.');
        if (event.type !== 'response.output_text.delta') continue;
        if (typeof event.delta !== 'string')
          throw new Error('Invalid graph stream.');
        text += event.delta;
        total += event.delta.length;
        if (total > 16000) throw new Error('Graph output is too large.');
        let stop: number;
        while ((stop = text.indexOf('\n')) !== -1) {
          const row = text.slice(0, stop).trim();
          text = text.slice(stop + 1);
          if (!row) continue;
          yield parseRow(row);
        }
      }
    }
    if (!completed) throw new Error('Graph generation is incomplete.');
    if (text.trim()) yield parseRow(text.trim());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseRow(
  row: string,
):
  | { command: string }
  | { status: 'clarification' | 'unsupported'; message: string } {
  const item = JSON.parse(row);
  if (
    typeof item.program === 'string' &&
    item.program.trim() &&
    item.program.length <= 1800
  ) {
    if (item.command !== undefined)
      throw new Error('Use a program or legacy command, never both.');
    return { command: mathProgramCommand(item.program) };
  }
  if (
    typeof item.command === 'string' &&
    item.command.trim() &&
    item.command.length <= 2000
  )
    return { command: item.command };
  if (
    ['clarification', 'unsupported'].includes(item.status) &&
    typeof item.message === 'string' &&
    item.message.length <= 1000
  )
    return { status: item.status, message: item.message };
  throw new Error('Graph generation returned an invalid operation.');
}
