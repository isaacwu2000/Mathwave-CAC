import type { InterpretationProgress } from '../types/cloud-problem-library.ts';

/** Streams temporary observations before the ordinary durable response. Disconnects never undo a save. */
export function progressResponse(
  task: (
    progress: (value: InterpretationProgress) => void,
  ) => Promise<Response>,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  return new Response(
    new ReadableStream({
      start(controller) {
        const send = (value: unknown) => {
          if (!cancelled)
            controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
        };
        void task((progress) => send({ type: 'progress', progress }))
          .then(async (response) => {
            const text = await response.text();
            send({
              type: 'result',
              status: response.status,
              body: text ? JSON.parse(text) : {},
              timing: response.headers.get('Server-Timing'),
            });
          })
          .catch(() =>
            send({
              type: 'result',
              status: 503,
              body: { error: 'Your save could not be confirmed.' },
            }),
          )
          .finally(() => {
            if (!cancelled) controller.close();
          });
      },
      cancel() {
        cancelled = true;
      },
    }),
    {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
      },
    },
  );
}

/** Reads observations without treating them as saved state. Only a final frame confirms the request. */
export async function readProgressResponse(
  response: Response,
  progress?: (value: InterpretationProgress) => void,
): Promise<Response> {
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson'))
    return response;
  if (!response.body) throw new Error('The request stream is unavailable.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done)
        throw new Error('The request ended before saving was confirmed.');
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 20_000_000)
        throw new Error('The request stream is too large.');
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const row = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!row.trim()) continue;
        const event = JSON.parse(row);
        if (
          event.type === 'progress' &&
          ['checking', 'fixing'].includes(event.progress?.phase)
        )
          progress?.(event.progress);
        else if (
          event.type === 'result' &&
          Number.isInteger(event.status) &&
          event.status >= 200 &&
          event.status < 600 &&
          event.body &&
          typeof event.body === 'object'
        ) {
          const result = Response.json(event.body, { status: event.status });
          if (typeof event.timing === 'string')
            result.headers.set('Server-Timing', event.timing);
          return result;
        } else throw new Error('Invalid request progress.');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
