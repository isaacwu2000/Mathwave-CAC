import { neon } from '@neondatabase/serverless';
import { migrateDslHistory } from './lib/dsl-history.ts';
import {
  decodeProblemLibrary,
  type ProblemLibrary,
} from '../src/modules/problems/index.ts';

const configured = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!configured) throw new Error('Database configuration is required.');
const url = new URL(configured);
if (process.env.MIGRATION_DATABASE_HOST)
  url.hostname = process.env.MIGRATION_DATABASE_HOST;
url.hostname = url.hostname.replace('-pooler.', '.');
const sql = neon(url.toString());
const rows =
  (await sql`SELECT owner_id, revision, notebook FROM math_audio_notebooks ORDER BY owner_id`) as {
    owner_id: string;
    revision: string;
    notebook: ProblemLibrary;
  }[];
const receipts =
  (await sql`SELECT owner_id, request_id, result FROM math_audio_requests ORDER BY owner_id, request_id`) as {
    owner_id: string;
    request_id: string;
    result: { book: ProblemLibrary };
  }[];
const changes = rows
  .map((row) => ({ ...row, next: migrateDslHistory(row.notebook) }))
  .filter((row) => JSON.stringify(row.next) !== JSON.stringify(row.notebook));
const receiptChanges = receipts
  .map((row) => ({ ...row, next: migrateDslHistory(row.result) }))
  .filter((row) => JSON.stringify(row.next) !== JSON.stringify(row.result));
for (const row of changes) decodeProblemLibrary(JSON.stringify(row.next));
for (const row of receiptChanges)
  decodeProblemLibrary(JSON.stringify(row.next.book));
console.log(
  JSON.stringify({
    mode: process.argv.includes('--apply') ? 'apply' : 'preview',
    notebooks: rows.length,
    changedNotebooks: changes.length,
    receipts: receipts.length,
    changedReceipts: receiptChanges.length,
  }),
);
if (process.argv.includes('--apply')) {
  // Revision guards abort the entire transaction if any notebook changed after preflight.
  // Backups stay in the same private database and are never written to reports or Git.
  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS mathwave_dsl_history_backup (kind text NOT NULL, owner_id text NOT NULL, item_id text NOT NULL, original jsonb NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(kind, owner_id, item_id))`,
    ...changes.flatMap((row) => [
      sql`INSERT INTO mathwave_dsl_history_backup(kind, owner_id, item_id, original) VALUES ('notebook', ${row.owner_id}, ${String(row.revision)}, ${JSON.stringify({ notebook: row.notebook, revision: row.revision })}::jsonb) ON CONFLICT DO NOTHING`,
      sql`WITH changed AS (UPDATE math_audio_notebooks SET notebook = ${JSON.stringify(row.next)}::jsonb, revision = revision + 1, updated_at = now() WHERE owner_id = ${row.owner_id} AND revision = ${row.revision} RETURNING owner_id) SELECT 1 / count(*)::int AS applied FROM changed`,
    ]),
    ...receiptChanges.flatMap((row) => [
      sql`INSERT INTO mathwave_dsl_history_backup(kind, owner_id, item_id, original) VALUES ('receipt', ${row.owner_id}, ${row.request_id}, ${JSON.stringify(row.result)}::jsonb) ON CONFLICT DO NOTHING`,
      sql`WITH changed AS (UPDATE math_audio_requests SET result = ${JSON.stringify(row.next)}::jsonb WHERE owner_id = ${row.owner_id} AND request_id = ${row.request_id} AND result = ${JSON.stringify(row.result)}::jsonb RETURNING request_id) SELECT 1 / count(*)::int AS applied FROM changed`,
    ]),
  ]);
  console.log(JSON.stringify({ applied: true }));
}
