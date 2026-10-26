import { previewGraphCommands } from '../../commands/index.ts';
import { currentProblem } from '../services/problem-library.ts';
import type { CloudSnapshot } from '../types/cloud-api.ts';
import type { GraphGenerator } from '../types/graph-build-api.ts';
export type {
  GraphBuildOutput,
  GraphGenerator,
} from '../types/graph-build-api.ts';

/**
 * - Streams previews against the owner's saved problem revision.
 * - Checks each complete command before sending calculated preview state.
 * - Never saves mathematical work. The separate save checks the same revision.
 * - Stops on cancellation and reports generation failures without accepting partial work.
 */
export function createGraphBuildApi(deps: {
  owner(request: Request): Promise<string>;
  load(owner: string): Promise<CloudSnapshot>;
  generate: GraphGenerator;
}) {
  return async (request: Request) => {
    const json = (error: string, status: number) =>
      Response.json({ error }, { status });
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return json('Request origin is not allowed.', 403);
    try {
      const owner = await deps.owner(request);
      const raw = await request.text();
      if (raw.length > 10000) return json('Graph request is too large.', 413);
      const input = JSON.parse(raw);
      if (
        typeof input.text !== 'string' ||
        !input.text.trim() ||
        input.text.length > 4000 ||
        !Number.isSafeInteger(input.revision)
      )
        return json('Invalid graph request.', 400);
      const saved = await deps.load(owner);
      if (saved.revision !== input.revision)
        return json(
          'The problem changed. Retry using the current saved work.',
          409,
        );
      const controller = new AbortController();
      const signal = AbortSignal.any([
        request.signal,
        controller.signal,
        AbortSignal.timeout(15000),
      ]);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(output) {
          const send = (value: unknown) => {
            signal.throwIfAborted();
            output.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
          };
          const commands: string[] = [];
          try {
            for await (const item of deps.generate(input.text, saved, signal)) {
              signal.throwIfAborted();
              if ('status' in item) {
                send({
                  type: 'failed',
                  message: item.message,
                  status: item.status,
                });
                output.close();
                return;
              }
              const next = [...commands, item.command];
              const preview = previewGraphCommands(
                currentProblem(saved.book).state,
                next,
              );
              commands.push(item.command);
              send({
                type: 'preview',
                ...preview,
                commands: [...commands],
                revision: saved.revision,
              });
            }
            if (!commands.length)
              throw new Error('No graph operations were generated.');
            send({ type: 'ready', commands, revision: saved.revision });
            output.close();
          } catch (error) {
            if (!signal.aborted) {
              send({
                type: 'failed',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Graph generation failed.',
              });
              output.close();
            } else {
              try {
                output.error(new Error('Graph generation stopped.'));
              } catch {
                /* Reader already closed. */
              }
            }
          }
        },
        cancel() {
          controller.abort();
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      return error instanceof Response
        ? error
        : json('Could not start graph generation.', 503);
    }
  };
}
