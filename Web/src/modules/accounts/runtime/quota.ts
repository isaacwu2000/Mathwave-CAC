import { accountDatabase } from '../repo/database.ts';
import { createQuotaStore } from '../repo/quota-store.ts';
import { allowanceMilliseconds, quotaPeriod } from '../services/quota.ts';
import type { AccountIdentity } from '../types/index.ts';
import { accountConfig } from './config.ts';
import { guestIpBucket } from './access.ts';

export const quotaStore = createQuotaStore(accountDatabase);
export type QuotaAccess = {
  owner: string;
  period: string;
  ip: string | null;
  ipPeriod: string | null;
};

/** Initializes owner and optional guest-IP allowances from server configuration. */
export async function quotaAccess(
  identity: AccountIdentity,
  request?: Request,
): Promise<QuotaAccess | undefined> {
  if (
    request &&
    accountConfig().CLOUD_TEST_MODE === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
  )
    return undefined;
  const period = quotaPeriod(new Date());
  const key = identity.kind === 'guest' ? 'trial' : period.key;
  await quotaStore.ensure(
    identity.owner,
    key,
    allowanceMilliseconds(identity.kind),
  );
  const ip =
    identity.kind === 'guest' && request
      ? await guestIpBucket(request, period.key)
      : null;
  if (ip) {
    const configured = Number(accountConfig().GUEST_IP_MONTHLY_HOURS ?? 1000);
    await quotaStore.ensure(
      ip,
      period.key,
      (Number.isFinite(configured) && configured > 0 ? configured : 1000) *
        3600000,
    );
  }
  return {
    owner: identity.owner,
    period: key,
    ip,
    ipPeriod: ip ? period.key : null,
  };
}

/** Rejects deleted/exhausted owners before reserving paid work; no provider call happens here. */
export async function reserveAi(
  access: QuotaAccess,
  milliseconds: number,
  kind: string,
) {
  const deleted =
    await accountDatabase()`SELECT owner_id FROM mathwave_deleted_accounts WHERE owner_id = ${access.owner}`;
  if (deleted.length)
    throw Response.json(
      { error: 'This account was deleted.' },
      { status: 401 },
    );
  const grant = await quotaStore.reserve(
    access.owner,
    access.period,
    access.ip,
    access.ipPeriod,
    milliseconds,
    kind,
  );
  if (!grant)
    throw Response.json(
      {
        error:
          'Your AI allowance is used up. Your saved work and exports are still available.',
        code: 'quota_exhausted',
      },
      { status: 429 },
    );
  return grant;
}

/**
 * Runs a bounded paid request and records its returned usage separately from time.
 * The abort signal limits work to reserved time. Provider failures still consume
 * elapsed paid time; failures before a provider starts may settle with zero.
 */
export async function meteredAi<T>(
  access: QuotaAccess,
  work: (signal: AbortSignal, record: (usage: unknown) => void) => Promise<T>,
) {
  const grant = await reserveAi(access, 45000, 'text');
  const started = Date.now();
  const usage: unknown[] = [];
  try {
    return await work(AbortSignal.timeout(grant.milliseconds), (value) =>
      usage.push(value),
    );
  } finally {
    await quotaStore.settle(grant.id, Date.now() - started, usage);
  }
}
