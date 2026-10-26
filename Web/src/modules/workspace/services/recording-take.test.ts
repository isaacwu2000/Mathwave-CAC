import { afterEach, expect, test, vi } from 'vitest';
import { playRecordingTake } from './recording-take.ts';

afterEach(() => vi.useRealTimers());

test('streams complete captions and waits for the real command before advancing', async () => {
  vi.useFakeTimers();
  const captions: string[] = [];
  let finish!: () => void;
  const execute = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const done = playRecordingTake(
    [
      { text: 'Graph x squared', wordMs: 100, holdMs: 200 },
      { text: 'Zoom in', wordMs: 100, holdMs: 0 },
    ],
    (caption) => captions.push(caption),
    execute,
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(captions).toEqual(['Graph', 'Graph x', 'Graph x squared']);
  expect(execute.mock.calls).toEqual([['Graph x squared']]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(execute).toHaveBeenCalledTimes(1);
  finish();
  await vi.runAllTimersAsync();
  await done;
  expect(execute.mock.calls).toEqual([['Graph x squared'], ['Zoom in']]);
});

test('cancelling a caption prevents the command from being submitted', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const execute = vi.fn();
  const done = playRecordingTake(
    [{ text: 'Graph x squared', wordMs: 100, holdMs: 0 }],
    () => {},
    execute,
    controller.signal,
  );
  const rejected = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(execute).not.toHaveBeenCalled();
});

test('guided input waits indefinitely for the speaker and executes only the preset step', async () => {
  vi.useFakeTimers();
  const execute = vi.fn().mockResolvedValue(undefined);
  let finished!: () => void;
  const listen = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finished = resolve;
      }),
  );
  const done = playRecordingTake(
    [{ text: 'Zoom in.', wordMs: 1, holdMs: 0 }],
    () => {},
    execute,
    new AbortController().signal,
    listen,
  );
  await vi.advanceTimersByTimeAsync(10000);
  expect(execute).not.toHaveBeenCalled();
  expect(listen).toHaveBeenCalledOnce();
  finished();
  await vi.runAllTimersAsync();
  await done;
  expect(execute).toHaveBeenCalledWith('Zoom in.');
});
