import { neon } from '@neondatabase/serverless';
import { expect, test } from 'vitest';
import { createQuotaStore } from './quota-store.ts';

const url = process.env.MATH_AUDIO_TEST_DATABASE_URL;
test.skipIf(!url)(
  'concurrent paid requests cannot exceed the allowance and settlement is idempotent',
  async () => {
    const sql = neon(url!);
    const store = createQuotaStore(() => sql);
    const owner = `quota-test:${crypto.randomUUID()}`;
    await store.ensure(owner, 'trial', 180000);
    const grants = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.reserve(owner, 'trial', null, null, 40000, 'text'),
      ),
    );
    expect(
      grants.reduce((sum, item) => sum + (item?.milliseconds ?? 0), 0),
    ).toBe(180000);
    const first = grants.find((item) => item)!;
    await store.settle(first.id, 10000, {
      input_tokens: 20,
      output_tokens: 10,
    });
    await store.settle(first.id, 10000, {
      input_tokens: 20,
      output_tokens: 10,
    });
    const state = await store.status(owner, 'trial');
    expect(state.usedMs).toBe(10000);
    expect(state.availableMs).toBe(first.milliseconds - 10000);
    await sql`DELETE FROM mathwave_ai_usage WHERE owner_id = ${owner}`;
    await sql`DELETE FROM mathwave_quota WHERE owner_id = ${owner}`;
  },
);
