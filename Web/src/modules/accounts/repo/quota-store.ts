import type { accountDatabase } from './database.ts';

/**
 * Reserves paid time before a provider call, across all tabs and workers.
 * Locks owner and optional shared-IP buckets in stable order. Settlement refunds
 * unused reserved time once; uncertain calls retain their reservation.
 */
export function createQuotaStore(connect: typeof accountDatabase) {
  return {
    /** Creates the server-owned allowance without resetting usage or held reservations. */
    async ensure(owner: string, period: string, allowance: number) {
      await connect()`INSERT INTO mathwave_quota(owner_id, period, allowance_ms) VALUES (${owner}, ${period}, ${allowance}) ON CONFLICT(owner_id, period) DO UPDATE SET allowance_ms = excluded.allowance_ms`;
    },
    /** Returns observed time separately from time held for concurrent paid work. */
    async status(owner: string, period: string) {
      const [row] = await connect()`SELECT allowance_ms, used_ms, reserved_ms,
        (SELECT COALESCE(SUM(CASE WHEN kind = 'voice' THEN reported_ms ELSE LEAST(reserved_ms, GREATEST(0, EXTRACT(EPOCH FROM now() - created_at) * 1000)) END), 0)
        FROM mathwave_ai_usage WHERE owner_id = ${owner} AND period = ${period} AND settled_at IS NULL) AS pending_ms
        FROM mathwave_quota WHERE owner_id = ${owner} AND period = ${period}`;
      return {
        allowanceMs: Number(row.allowance_ms),
        usedMs: Number(row.used_ms),
        remainingMs: Math.max(
          0,
          Number(row.allowance_ms) -
            Number(row.used_ms) -
            Number(row.pending_ms),
        ),
        availableMs: Math.max(
          0,
          Number(row.allowance_ms) -
            Number(row.used_ms) -
            Number(row.reserved_ms),
        ),
      };
    },
    /** Records cumulative provider duration; duplicate or older events cannot reduce it. */
    async progress(id: string, milliseconds: number) {
      await connect()`UPDATE mathwave_ai_usage SET reported_ms = GREATEST(reported_ms, ${Math.ceil(milliseconds)}) WHERE id = ${id} AND settled_at IS NULL`;
    },
    /** Atomically reserves available owner/IP time, or returns null before paid work starts. */
    async reserve(
      owner: string,
      period: string,
      ip: string | null,
      ipPeriod: string | null,
      requested: number,
      kind: string,
    ) {
      const id = crypto.randomUUID();
      const rows = await connect()`WITH locked AS MATERIALIZED (
        SELECT * FROM mathwave_quota WHERE (owner_id = ${owner} AND period = ${period})
          OR (owner_id = ${ip} AND period = ${ipPeriod}) ORDER BY owner_id, period FOR UPDATE
      ), available AS MATERIALIZED (
        SELECT GREATEST(0, LEAST(${Math.ceil(requested)}::bigint, MIN(allowance_ms - used_ms - reserved_ms))) AS grant
        FROM locked HAVING COUNT(*) = ${ip ? 2 : 1}
      ), updated AS (
        UPDATE mathwave_quota q SET reserved_ms = q.reserved_ms + available.grant
        FROM locked, available WHERE q.owner_id = locked.owner_id AND q.period = locked.period AND available.grant > 0
        RETURNING q.owner_id
      ) INSERT INTO mathwave_ai_usage(id, owner_id, period, ip_owner, ip_period, kind, reserved_ms)
        SELECT ${id}, ${owner}, ${period}, ${ip}, ${ipPeriod}, ${kind}, available.grant
        FROM available WHERE available.grant > 0 AND (SELECT COUNT(*) FROM updated) = ${ip ? 2 : 1}
        RETURNING id, reserved_ms`;
      return rows.length
        ? { id, milliseconds: Number(rows[0].reserved_ms) }
        : null;
    },
    /** Charges actual time and refunds the unused reservation once, retaining provider usage. */
    async settle(id: string, milliseconds: number, usage: unknown) {
      const actual = Math.max(0, Math.ceil(milliseconds));
      await connect()`WITH settled AS (
        UPDATE mathwave_ai_usage SET used_ms = ${actual}, provider_usage = ${JSON.stringify(usage ?? null)}::jsonb, settled_at = now()
        WHERE id = ${id} AND settled_at IS NULL RETURNING *
      ) UPDATE mathwave_quota q SET used_ms = q.used_ms + settled.used_ms, reserved_ms = GREATEST(0, q.reserved_ms - settled.reserved_ms)
        FROM settled WHERE (q.owner_id = settled.owner_id AND q.period = settled.period)
          OR (q.owner_id = settled.ip_owner AND q.period = settled.ip_period)`;
    },
  };
}
