import { readFile, writeFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

/** Provisions one ordinary preverified synthetic account; no development-only sign-in bypass. */
const filename = new URL('../.env', import.meta.url);
let source = await readFile(filename, 'utf8');
const authUrl = process.env.NEON_AUTH_BASE_URL;
const databaseUrl = process.env.DATABASE_URL;
const expectedHost = process.argv
  .find((value) => value.startsWith('--expected-host='))
  ?.slice('--expected-host='.length);
if (
  !authUrl ||
  !databaseUrl ||
  !expectedHost ||
  new URL(databaseUrl).hostname !== expectedHost
)
  throw new Error(
    'Set NEON_AUTH_BASE_URL and DATABASE_URL, and pass --expected-host for the intended database.',
  );
const email = process.env.MATHWAVE_TEST_EMAIL ?? 'agent-test@mathwave.invalid';
const password =
  process.env.MATHWAVE_TEST_PASSWORD ??
  crypto.randomUUID() + crypto.randomUUID();
const secret =
  process.env.NEON_AUTH_COOKIE_SECRET ??
  crypto.randomUUID() + crypto.randomUUID();
const sql = neon(databaseUrl);
let [user] = await sql`SELECT id FROM neon_auth."user" WHERE email = ${email}`;
if (user && !process.env.MATHWAVE_TEST_PASSWORD)
  throw new Error(
    'The test user already exists. Supply its existing MATHWAVE_TEST_PASSWORD; setup never resets it.',
  );
if (!user) {
  const response = await fetch(`${authUrl}/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: 'http://localhost:5173',
      'x-neon-auth-proxy': 'mathwave-setup',
    },
    body: JSON.stringify({ email, password, name: 'Agent Test' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Test-account provisioning failed (${response.status}). No credentials were logged.`,
    );
  [user] = await sql`SELECT id FROM neon_auth."user" WHERE email = ${email}`;
}
if (!user) throw new Error('The synthetic test account was not created.');
await sql`UPDATE neon_auth."user" SET "emailVerified" = true WHERE id = ${user.id} AND email = ${email}`;
for (const [key, value] of Object.entries({
  NEON_AUTH_BASE_URL: authUrl,
  NEON_AUTH_COOKIE_SECRET: secret,
  MATHWAVE_TEST_EMAIL: email,
  MATHWAVE_TEST_PASSWORD: password,
  MATHWAVE_DEVELOPMENT_USER_ID: String(user.id),
  CLOUD_TEST_MODE: 'false',
})) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  source = pattern.test(source)
    ? source.replace(pattern, line)
    : `${source.trimEnd()}\n${line}\n`;
}
await writeFile(filename, source, { mode: 0o600 });
console.log(
  `Synthetic test account ready: ${email}. Credentials are saved only in ignored Web/.env.`,
);
