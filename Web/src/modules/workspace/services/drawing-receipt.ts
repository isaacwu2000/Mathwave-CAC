import type { Workspace } from '../types/index.ts';

/** Identifies the exact geometry frame, including symbolic labels and overlays. */
export function drawingKey(state: Workspace) {
  return JSON.stringify([
    state.geometry,
    state.construction,
    state.geometryOverlay,
  ]);
}

/** Waits for the matching canvas frame before voice can confirm a saved drawing.
 * Preview frames cannot complete a different drawing. Cancellation, unmount and
 * display timeouts reject rather than announcing a result that was never shown.
 */
export class DrawingReceipt {
  private latest = '';
  private disposed = false;
  private pending = new Set<{ key: string; finish: (error?: Error) => void }>();

  activate() {
    this.disposed = false;
  }

  invalidate() {
    this.latest = '';
  }

  rendered(key: string) {
    if (this.disposed) return;
    this.latest = key;
    for (const waiter of this.pending) if (waiter.key === key) waiter.finish();
  }

  wait(key: string, signal?: AbortSignal): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Drawing cancelled.'));
    if (signal?.aborted) return Promise.reject(new Error('Drawing cancelled.'));
    if (key === this.latest) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cancel = () => waiter.finish(new Error('Drawing cancelled.'));
      const timer = setTimeout(
        () =>
          waiter.finish(
            new Error(
              'Your work is saved, but the drawing has not finished rendering.',
            ),
          ),
        10000,
      );
      const waiter = {
        key,
        finish: (error?: Error) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          this.pending.delete(waiter);
          if (error) reject(error);
          else resolve();
        },
      };
      this.pending.add(waiter);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
    for (const waiter of this.pending)
      waiter.finish(new Error('Drawing cancelled.'));
  }
}
