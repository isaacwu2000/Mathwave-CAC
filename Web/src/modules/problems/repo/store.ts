import type { database } from './database.ts';
import type { ProblemLibrary } from '../types/problem-library.ts';
import type {
  ProblemLibraryStore,
  CloudSnapshot,
  Receipt,
} from '../types/cloud-api.ts';

/**
 * - Persists each owner's problem and retry receipts in Neon transactions.
 * - Only the expected revision can save; problem and receipt changes roll back together.
 * - The runtime supplies problem creation. Database failures propagate to the API.
 * - Concurrent saves preserve one winner and at most twenty recent retry receipts.
 */
export function createProblemLibraryStore(
  connect: typeof database,
  createEmpty: () => ProblemLibrary,
): ProblemLibraryStore {
  return {
    async load(owner) {
      const sql = connect();
      // ReadCommitted gives the SELECT a fresh view after a concurrent insert finishes.
      const [, rows] = await sql.transaction(
        [
          sql`INSERT INTO math_audio_notebooks (owner_id, notebook) SELECT ${owner}, ${JSON.stringify(createEmpty())}::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM mathwave_deleted_accounts WHERE owner_id = ${owner}) ON CONFLICT (owner_id) DO NOTHING`,
          sql`SELECT notebook AS book, clarification, revision FROM math_audio_notebooks WHERE owner_id = ${owner}
            AND NOT EXISTS (SELECT 1 FROM mathwave_deleted_accounts WHERE owner_id = ${owner})`,
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      if (!rows[0]) throw new Error('This account was deleted.');
      return {
        ...rows[0],
        revision: Number(rows[0].revision),
      } as CloudSnapshot;
    },
    async receipt(owner, id) {
      const rows =
        await connect()`SELECT request, result FROM math_audio_requests WHERE owner_id = ${owner} AND request_id = ${id}
          AND NOT EXISTS (SELECT 1 FROM mathwave_deleted_accounts WHERE owner_id = ${owner})`;
      return (rows[0] as Receipt | undefined) ?? null;
    },
    async commit(owner, id, revision, outcome, request) {
      const result = JSON.stringify({ ...outcome, revision: revision + 1 });
      const sql = connect();
      const [rows] = await sql.transaction(
        [
          sql`WITH changed AS (
      UPDATE math_audio_notebooks SET notebook = ${JSON.stringify(outcome.book)}::jsonb,
        clarification = ${JSON.stringify(outcome.clarification)}::jsonb, revision = revision + 1, updated_at = now()
      WHERE owner_id = ${owner} AND revision = ${revision}
        AND NOT EXISTS (SELECT 1 FROM mathwave_deleted_accounts WHERE owner_id = ${owner}) RETURNING owner_id
    )
      INSERT INTO math_audio_requests (owner_id, request_id, request, result)
      SELECT owner_id, ${id}, ${request}, ${result}::jsonb FROM changed RETURNING request_id`,
          // A separate statement sees the new receipt. The update holds the problem
          // row lock until pruning finishes, so saves on other servers cannot interleave.
          sql`
      DELETE FROM math_audio_requests WHERE owner_id = ${owner} AND request_id IN (
        SELECT request_id FROM math_audio_requests WHERE owner_id = ${owner}
        ORDER BY (result->>'revision')::bigint DESC, request_id DESC OFFSET 20
      ) AND EXISTS (
        SELECT 1 FROM math_audio_notebooks WHERE owner_id = ${owner} AND revision = ${revision + 1}
      ) AND EXISTS (
        SELECT 1 FROM math_audio_requests WHERE owner_id = ${owner} AND request_id = ${id} AND request = ${request}
      )`,
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      // Older retries still cannot execute: their expected revision no longer matches.
      return rows.length === 1;
    },
  };
}
