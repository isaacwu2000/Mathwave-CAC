import { expect, test, vi } from 'vitest';
import { DrawingReceipt } from './drawing-receipt.ts';

test('drawing completion waits for its rendered frame, not an earlier preview', async () => {
  const receipt = new DrawingReceipt();
  let finished = false;
  const waiting = receipt.wait('triangle-with-h').then(() => {
    finished = true;
  });
  receipt.rendered('triangle-preview');
  await Promise.resolve();
  expect(finished).toBe(false);
  receipt.rendered('triangle-with-h');
  await waiting;
  expect(finished).toBe(true);
  await expect(receipt.wait('triangle-with-h')).resolves.toBeUndefined();
});

test('a failed or cancelled render never reports completion', async () => {
  vi.useFakeTimers();
  try {
    const receipt = new DrawingReceipt();
    const pending = expect(receipt.wait('missing')).rejects.toThrow(
      'not finished rendering',
    );
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    const controller = new AbortController();
    const cancelled = expect(
      receipt.wait('cancelled', controller.signal),
    ).rejects.toThrow('cancelled');
    controller.abort();
    await cancelled;
  } finally {
    vi.useRealTimers();
  }
});

test('an unmounted canvas cannot satisfy a later identical drawing', async () => {
  const receipt = new DrawingReceipt();
  receipt.rendered('triangle');
  receipt.invalidate();
  let completed = false;
  const pending = receipt.wait('triangle').then(() => { completed = true; });
  await Promise.resolve();
  expect(completed).toBe(false);
  receipt.rendered('triangle');
  await pending;
  receipt.dispose();
  await expect(receipt.wait('triangle')).rejects.toThrow('cancelled');
});
