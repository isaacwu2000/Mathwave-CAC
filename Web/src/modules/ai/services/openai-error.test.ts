import { test } from 'vitest';
import assert from 'node:assert/strict';
import { openAIErrorMessage } from '../index.ts';
const failure = (code: string, type = '', status = 429) =>
  Response.json(
    { error: { code, type, message: 'private provider details' } },
    { status },
  );
test('API credit exhaustion, quota, and spend limits require account action rather than retries', async () => {
  assert.match(
    await openAIErrorMessage(
      failure('credit_balance_exhausted', 'insufficient_quota'),
    ),
    /credits are exhausted/,
  );
  assert.match(
    await openAIErrorMessage(
      failure('project_spend_limit_exceeded', 'insufficient_quota'),
    ),
    /spending limit reached/,
  );
  assert.match(
    await openAIErrorMessage(failure('insufficient_quota')),
    /Check API billing/,
  );
});
test('temporary throttling is distinguished from exhausted credits', async () => {
  for (const code of ['slow_down', 'rate_limit_exceeded']) {
    const message = await openAIErrorMessage(failure(code, 'rate_limit_error'));
    assert.match(message, /temporarily rate-limiting/);
    assert.doesNotMatch(message, /Add API credits/);
  }
});
test('authentication and access failures have specific public messages', async () => {
  assert.match(
    await openAIErrorMessage(failure('invalid_api_key', '', 401)),
    /authentication failed/,
  );
  assert.match(
    await openAIErrorMessage(failure('model_not_found', '', 404)),
    /model or project access/,
  );
});
test('unknown and malformed provider failures do not expose provider details or invent a cause', async () => {
  const unknown = await openAIErrorMessage(failure('unknown'));
  assert.match(unknown, /unspecified limit/);
  assert.doesNotMatch(unknown, /private provider details/);
  const malformed = await openAIErrorMessage(
    new Response('not JSON', { status: 502 }),
  );
  assert.match(malformed, /could not connect/);
  assert.match(malformed, /Your work is saved.*local math commands/);
});
