export type RecordingLine = { text: string; wordMs: number; holdMs: number };

/** Waits without retaining a timer or abort listener after cancellation. */
function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Recording stopped.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/**
 * Streams authored words through the real audio panel, then awaits command processing.
 * Guided input can replace timed captions and wait for real speech completion.
 * Only automatic captions and narration holds are timed; command latency is never shortened.
 * Cancellation prevents later lines and propagates to the caller.
 */
export async function playRecordingTake(
  lines: readonly RecordingLine[],
  caption: (text: string) => void,
  execute: (text: string) => Promise<void>,
  signal: AbortSignal,
  listen?: (line: RecordingLine, index: number) => Promise<void>,
) {
  for (const [index, line] of lines.entries()) {
    if (listen) await listen(line, index);
    else {
      const words = line.text.split(/\s+/);
      for (let i = 1; i <= words.length; i++) {
        signal.throwIfAborted();
        caption(words.slice(0, i).join(' '));
        await pause(line.wordMs, signal);
      }
    }
    signal.throwIfAborted();
    await execute(line.text);
    await pause(line.holdMs, signal);
  }
}
