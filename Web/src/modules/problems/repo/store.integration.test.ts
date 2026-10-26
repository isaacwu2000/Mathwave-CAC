import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { expect, test } from 'vitest';
import { createProblemLibrary } from '../services/problem-library.ts';
import { createProblemLibraryStore } from './store.ts';
import type { CloudOutcome } from '../types/cloud-problem-library.ts';

// Supply only a disposable branch URL. Normal application credentials never enable this test.
const url = process.env.MATH_AUDIO_TEST_DATABASE_URL;

test.skipIf(!url)(
  'receipts retain the latest twenty confirmed saves',
  async () => {
    const sql = neon(url!);
    const store = createProblemLibraryStore(() => sql, createProblemLibrary);
    const owner = `test:transaction:${randomUUID()}`;
    try {
      const snapshot = await store.load(owner);
      const outcome: CloudOutcome = {
        ...snapshot,
        status: 'command',
        message: 'Saved.',
      };
      for (let revision = 0; revision < 21; revision++) {
        expect(
          await store.commit(
            owner,
            `save-${revision}`,
            revision,
            outcome,
            `request-${revision}`,
          ),
        ).toBe(true);
      }
      expect(await store.receipt(owner, 'save-0')).toBeNull();
      expect((await store.receipt(owner, 'save-1'))?.result.revision).toBe(2);
      expect((await store.receipt(owner, 'save-20'))?.result.revision).toBe(21);
      expect((await store.load(owner)).revision).toBe(21);
    } finally {
      await sql.transaction([
        sql`DELETE FROM math_audio_requests WHERE owner_id = ${owner}`,
        sql`DELETE FROM math_audio_notebooks WHERE owner_id = ${owner}`,
      ]);
    }
  },
  30000,
);

test.skipIf(!url)(
  'parallel servers save one revision and keep the matching retry receipt',
  async () => {
    const sql = neon(url!);
    const store = createProblemLibraryStore(() => sql, createProblemLibrary);
    const owner = `test:transaction:${randomUUID()}`;
    try {
      const snapshots = await Promise.all(
        Array.from({ length: 8 }, () => store.load(owner)),
      );
      expect(
        new Set(snapshots.map((snapshot) => snapshot.book.problemId)).size,
      ).toBe(1);
      const outcome: CloudOutcome = {
        ...snapshots[0],
        status: 'command',
        message: 'Saved.',
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          store.commit(owner, `race-${index}`, 0, outcome, `request-${index}`),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = results.indexOf(true);
      expect((await store.load(owner)).revision).toBe(1);
      expect(
        (await store.receipt(owner, `race-${winner}`))?.result.revision,
      ).toBe(1);
      expect(
        await store.commit(
          owner,
          `race-${winner}`,
          0,
          outcome,
          `request-${winner}`,
        ),
      ).toBe(false);
      expect((await store.load(owner)).revision).toBe(1);

      // A reused ID at a fresh revision fails insertion; the problem update must roll back.
      await expect(
        store.commit(
          owner,
          `race-${winner}`,
          1,
          { ...outcome, message: 'Must roll back.' },
          'different-request',
        ),
      ).rejects.toThrow();
      expect((await store.load(owner)).revision).toBe(1);
      expect((await store.receipt(owner, `race-${winner}`))?.request).toBe(
        `request-${winner}`,
      );
    } finally {
      await sql.transaction([
        sql`DELETE FROM math_audio_requests WHERE owner_id = ${owner}`,
        sql`DELETE FROM math_audio_notebooks WHERE owner_id = ${owner}`,
      ]);
    }
  },
  30000,
);
