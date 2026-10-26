import type { GraphPreview } from '../types/graph-build-client.ts';
export type { GraphPreview } from '../types/graph-build-client.ts';

export class GraphBuildError extends Error {
  constructor(
    message: string,
    readonly status?: 'clarification' | 'unsupported',
  ) {
    super(message);
    this.name = 'GraphBuildError';
  }
}

/**
 * - Reads one preview stream and reports complete command lists to its caller.
 * - Cancels the previous build when a replacement starts and ignores its late output.
 * - Distinguishes clarification from generation failure; neither saves the problem.
 */
export class GraphBuildClient {
  private controller: AbortController | null = null;
  constructor(
    private fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}
  cancel() {
    this.controller?.abort();
    this.controller = null;
  }
  async start(
    text: string,
    revision: number,
    preview: (value: GraphPreview) => void,
    parentSignal?: AbortSignal,
  ) {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const signal = parentSignal
      ? AbortSignal.any([controller.signal, parentSignal])
      : controller.signal;
    const current = () => {
      signal.throwIfAborted();
      if (this.controller !== controller)
        throw new DOMException('Replaced graph build.', 'AbortError');
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const started = performance.now();
    let firstVisible: number | null = null;
    try {
      const response = await this.fetcher('/api/graph-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, revision }),
        signal,
      });
      current();
      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error || 'Graph generation could not start.');
      }
      if (!response.body) throw new Error('Graph streaming is unavailable.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (true) {
        const chunk = await reader.read();
        current();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 100000) throw new Error('Invalid graph stream.');
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          current();
          if (event.type === 'failed')
            throw new GraphBuildError(
              event.message || 'Graph generation failed.',
              event.status,
            );
          if (event.type !== 'preview' && event.type !== 'ready')
            throw new Error('Invalid graph stream.');
          if (
            event.revision !== revision ||
            !Array.isArray(event.commands) ||
            !event.commands.length ||
            event.commands.length > 6 ||
            !event.commands.every(
              (c: unknown) => typeof c === 'string' && c.length <= 2000,
            )
          )
            throw new Error('Invalid graph revision.');
          if (event.type === 'preview') {
            firstVisible ??= performance.now() - started;
            preview(event);
          } else
            return {
              commands: event.commands as string[],
              revision,
              firstVisibleMs: firstVisible,
              completedMs: performance.now() - started,
            };
        }
      }
      throw new Error('Graph generation stopped before completion.');
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      if (this.controller === controller) this.controller = null;
    }
  }
}
