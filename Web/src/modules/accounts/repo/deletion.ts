import type { accountDatabase } from './database.ts';

/**
 * Cleans application data only after the provider user is gone.
 * Durable tombstones make partial deletions retryable without a login session.
 * Repeated calls are safe; failed transactions retain the cleanup job.
 */
export function createDeletionCleanup(connect: typeof accountDatabase) {
  return async function cleanupDeletedAccounts() {
    const sql = connect();
    const pending = await sql`SELECT d.owner_id FROM mathwave_deleted_accounts d
      LEFT JOIN neon_auth."user" u ON d.owner_id = 'user:' || u.id::text
      WHERE d.completed_at IS NULL AND u.id IS NULL ORDER BY d.created_at LIMIT 100`;
    for (const row of pending) {
      const owner = row.owner_id as string;
      await sql.transaction([
        sql`DELETE FROM math_audio_requests WHERE owner_id = ${owner}`,
        sql`DELETE FROM math_audio_notebooks WHERE owner_id = ${owner}`,
        sql`DELETE FROM math_audio_voice_negotiations WHERE owner_id = ${owner}`,
        sql`DELETE FROM mathwave_ai_usage WHERE owner_id = ${owner} OR owner_id IN (SELECT owner_id FROM mathwave_guests WHERE claimed_by = ${owner})`,
        sql`DELETE FROM mathwave_quota WHERE owner_id = ${owner} OR owner_id IN (SELECT owner_id FROM mathwave_guests WHERE claimed_by = ${owner})`,
        sql`DELETE FROM mathwave_guests WHERE claimed_by = ${owner}`,
        sql`UPDATE mathwave_deleted_accounts SET completed_at = now() WHERE owner_id = ${owner}`,
      ]);
    }
    return pending.length;
  };
}
