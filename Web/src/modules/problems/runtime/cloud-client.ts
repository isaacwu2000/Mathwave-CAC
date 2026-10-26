import {
  journeyPoint,
  journeySpan,
  journeyServerTiming,
} from '../../diagnostics/index.ts';
import type { CloudResponse, CloudSnapshot } from '../types/cloud-api.ts';
import type {
  CloudOperation,
  InterpretationProgress,
} from '../types/cloud-problem-library.ts';
import { readProgressResponse } from './command-progress.ts';

type PendingSave = { id: string; revision: number; operation: CloudOperation };
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const recoveryKey = 'math-audio-pending-cloud-save';

/**
 * Saves problem changes in order and confirms uncertain saves before new changes.
 * - Retries use the original request ID so a change executes at most once.
 * - Optional browser storage retains uncertain requests across tab reloads.
 * - Network failures keep the request; revision conflicts require a reload.
 */
export class CloudProblemLibraryClient {
  snapshot: CloudSnapshot | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private pending: PendingSave | null = null;
  private conflict = false;
  private fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  /** Restores a retained request without sending it; unavailable storage uses memory only. */
  constructor(
    fetcher: (url: string, init?: RequestInit) => Promise<Response>,
    private recoveryStorage?: RecoveryStorage,
  ) {
    // Calling a Window method with this client as its receiver is illegal in browsers.
    this.fetcher = (url, init) => fetcher(url, init);
    try {
      const saved = JSON.parse(recoveryStorage?.getItem(recoveryKey) ?? 'null');
      if (
        saved &&
        typeof saved.id === 'string' &&
        Number.isSafeInteger(saved.revision) &&
        saved.revision >= 0 &&
        typeof saved.operation?.kind === 'string'
      )
        this.pending = saved;
    } catch {
      // Recovery storage is optional; the server validates retained requests.
    }
  }
  /**
   * Loads the latest problem after confirming any retained save with its original ID.
   * Recovery may write to the server. An unconfirmed recovery rejects before the read.
   */
  load(): Promise<CloudSnapshot> {
    return this.enqueue(async () => {
      if (this.pending) await this.sendPending();
      return this.loadSnapshot();
    });
  }
  private async loadSnapshot(): Promise<CloudSnapshot> {
    const response = await this.fetcher('/api/problems', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const body = (await response.json()) as CloudResponse & {
      error?: string;
      snapshot?: CloudSnapshot;
    };
    if (!response.ok)
      throw new Error(body.error || 'Could not load your cloud problem.');
    this.snapshot = body;
    this.conflict = false;
    return body;
  }
  async settled() {
    await this.tail;
  }
  get saveUnconfirmed() {
    return this.pending !== null;
  }
  apply(
    operation: CloudOperation,
    id = crypto.randomUUID(),
    beforeSend?: () => void,
    progress?: (value: InterpretationProgress) => void,
  ): Promise<CloudResponse> {
    const queued = performance.now();
    return this.enqueue(async () => {
      journeySpan(id, 'save-queue', queued);
      // Confirm the original request before using its revision for another change.
      if (this.pending) await this.sendPending();
      beforeSend?.();
      if (this.conflict)
        throw new Error(
          'Reload the cloud problem before making another change. Your draft is retained in this tab.',
        );
      if (!this.snapshot) throw new Error('Wait for your problem to load.');
      this.retain({ id, revision: this.snapshot.revision, operation });
      return this.sendPending(progress);
    });
  }
  retry(): Promise<CloudSnapshot | null> {
    return this.enqueue(() =>
      this.pending
        ? this.sendPending()
        : this.conflict || !this.snapshot
          ? this.loadSnapshot()
          : Promise.resolve(null),
    );
  }
  /** Keeps retries and new mutations in one queue, including failed requests. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => {});
    return result;
  }
  /** Updates memory and optional tab storage; storage failures preserve the in-memory request. */
  private retain(pending: PendingSave | null) {
    this.pending = pending;
    try {
      if (pending)
        this.recoveryStorage?.setItem(recoveryKey, JSON.stringify(pending));
      else this.recoveryStorage?.removeItem(recoveryKey);
    } catch {
      // Keep the request in memory when browser storage is unavailable.
    }
  }
  private async sendPending(
    progress?: (value: InterpretationProgress) => void,
  ): Promise<CloudResponse> {
    const pending = this.pending!;
    const started = performance.now();
    try {
      const response = await readProgressResponse(
        await this.fetcher('/api/problems', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(progress ? { Accept: 'application/x-ndjson' } : {}),
          },
          body: JSON.stringify(pending),
          signal: AbortSignal.timeout(45000),
        }),
        progress,
      );
      const body = (await response.json()) as CloudResponse & {
        error?: string;
        snapshot?: CloudSnapshot;
      };
      journeyServerTiming(pending.id, response.headers.get('Server-Timing'));
      journeyPoint(
        pending.id,
        response.ok ? 'save-confirmed' : 'save-rejected',
      );
      if (!response.ok) {
        if (response.status === 409 && body.snapshot) {
          this.retain(null);
          this.conflict = true;
        } else if (response.status >= 400 && response.status < 500)
          this.retain(null);
        throw new Error(body.error || 'Your save could not be confirmed.');
      }
      this.snapshot = body;
      this.retain(null);
      return body;
    } catch (error) {
      journeyPoint(pending.id, 'request-failed');
      throw error;
    } finally {
      journeySpan(pending.id, 'request-body', started);
    }
  }
}
