const prefix = 'math-audio:journey:';
const starts = new Map<string, number>();
const retained: string[] = [];
let sequence = 0;

/** Records local, bounded timing entries. Never stores transcripts or sends telemetry. */
export function journeySpan(
  id: string,
  stage: string,
  start: number,
  end = performance.now(),
  kind: 'span' | 'milestone' = 'span',
) {
  try {
    const name = `${prefix}${stage}:${++sequence}`;
    performance.measure(name, { start, end, detail: { id, kind, stage } });
    retained.push(name);
    if (retained.length > 300) {
      const expired = retained.shift()!;
      performance.clearMeasures(expired);
    }
  } catch {
    // Timing support must never prevent a command or audio response.
  }
}

/** Records elapsed time from the first milestone for this request, on the browser clock. */
export function journeyPoint(
  id: string,
  stage: string,
  at = performance.now(),
) {
  if (!starts.has(id)) {
    starts.set(id, at);
    if (starts.size > 100) starts.delete(starts.keys().next().value!);
  }
  journeySpan(id, stage, starts.get(id)!, at, 'milestone');
}

/** Adds server durations to a browser request without comparing different machines' clocks. */
export function journeyServerTiming(
  id: string,
  header: string | null,
  source: 'problem-server' | 'live-server' = 'problem-server',
) {
  for (const metric of header?.split(',') ?? []) {
    const match = /^\s*([a-z][a-z0-9_]*);dur=(\d+(?:\.\d+)?)\s*$/.exec(metric);
    if (match) journeySpan(id, `${source}:${match[1]}`, 0, Number(match[2]));
  }
}

/** Measures request-local server stages, including failures; headers contain durations only. */
export class RequestTiming {
  private start = performance.now();
  private durations = new Map<string, number>();
  async measure<T>(stage: string, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await work();
    } finally {
      this.durations.set(
        stage,
        (this.durations.get(stage) ?? 0) + performance.now() - start,
      );
    }
  }
  header() {
    return [
      ...this.durations,
      ['total', performance.now() - this.start] as const,
    ]
      .map(([stage, duration]) => `${stage};dur=${duration.toFixed(1)}`)
      .join(', ');
  }
}
