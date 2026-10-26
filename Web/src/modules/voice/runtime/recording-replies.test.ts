import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RecordingReplies } from './recording-replies.ts';
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'AudioContext',
    class {
      createMediaStreamDestination() {
        return { stream: { getTracks: () => [] } };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal(
    'MediaRecorder',
    class {
      start() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test('a spoken reply must actually start and finish before the next student turn', async () => {
  const replies = new RecordingReplies();
  const send = vi.fn();
  const done = vi.fn();
  const pending = replies.reply(send, new AbortController().signal).then(done);
  replies.playback(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(done).not.toHaveBeenCalled();
  replies.playback(true);
  replies.playback(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(done).not.toHaveBeenCalled();
  replies.playback(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(done).not.toHaveBeenCalled();
  replies.playback(false);
  await vi.advanceTimersByTimeAsync(250);
  await pending;
  expect(send).toHaveBeenCalledOnce();
  expect(done).toHaveBeenCalledOnce();
});
test('cancelling a pending spoken reply clears its timers', async () => {
  const replies = new RecordingReplies();
  const controller = new AbortController();
  const pending = expect(
    replies.reply(() => {}, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});

test('the final reply releases confetti on playback end only after its whole confirmation', async () => {
  const replies = new RecordingReplies();
  const done = vi.fn();
  const pending = replies
    .reply(() => {}, new AbortController().signal, 'Looks like you solved it!')
    .then(done);
  replies.playback(true);
  replies.transcript('Looks like');
  replies.playback(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(done).not.toHaveBeenCalled();
  replies.playback(true);
  replies.transcript('Looks like you solved it!');
  await vi.advanceTimersByTimeAsync(500);
  expect(done).not.toHaveBeenCalled();
  replies.playback(false);
  await vi.advanceTimersByTimeAsync(0);
  await pending;
  expect(done).toHaveBeenCalledOnce();
});
