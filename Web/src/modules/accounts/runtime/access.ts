import { accountConfig } from './config.ts';
import { accountDatabase } from '../repo/database.ts';
import { readAuthSession } from './auth.ts';
import { verifiedIdentity } from '../services/identity.ts';
import type { AccountIdentity } from '../types/index.ts';

const guestCookie = 'mathwave.guest';
const encoder = new TextEncoder();

async function signature(value: string) {
  const secret = accountConfig().NEON_AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('Account cookie secret is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Returns only an authenticated guest cookie issued by this app. */
export async function guestOwner(request: Request) {
  const raw = request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${guestCookie}=`))
    ?.slice(guestCookie.length + 1);
  if (!raw) return null;
  const [id, supplied] = raw.split('.');
  if (!/^[a-f0-9-]{36}$/.test(id) || !supplied || supplied.length !== 64)
    return null;
  const expected = await signature(id);
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference ? null : `guest:${id}`;
}

export async function issueGuest(request: Request) {
  const id = crypto.randomUUID();
  const cookie = `${guestCookie}=${id}.${await signature(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  await accountDatabase()`INSERT INTO mathwave_guests(owner_id) VALUES (${`guest:${id}`})`;
  return { owner: `guest:${id}`, cookie };
}

/** Resolves identity on the server; request identity headers never select an owner. */
export async function accountIdentity(
  request: Request,
): Promise<AccountIdentity> {
  const checked = (identity: AccountIdentity) => {
    const expected = request.headers.get('X-Mathwave-Owner');
    if (expected && expected !== identity.owner)
      throw Response.json(
        {
          error: 'Your signed-in account changed. Reload to continue.',
          code: 'account_changed',
        },
        { status: 409 },
      );
    return identity;
  };
  const config = accountConfig();
  const hostname = new URL(request.url).hostname;
  if (
    config.CLOUD_TEST_MODE === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  )
    return checked({
      owner:
        config.CLOUD_TEST_PROBLEM_OWNER ??
        config.CLOUD_TEST_NOTEBOOK_OWNER ??
        'test:shared',
      kind: 'development',
      verified: true,
    });
  const session = await readAuthSession(request);
  if (session) {
    const identity = verifiedIdentity(
      session,
      config.MATHWAVE_DEVELOPMENT_USER_ID ?? '',
      new Date(),
    );
    const deleted =
      await accountDatabase()`SELECT owner_id FROM mathwave_deleted_accounts WHERE owner_id = ${identity.owner}`;
    if (deleted.length)
      throw Response.json(
        { error: 'This account was deleted.' },
        { status: 401 },
      );
    return checked(identity);
  }
  const owner = await guestOwner(request);
  if (owner) {
    const rows =
      await accountDatabase()`SELECT owner_id FROM mathwave_guests WHERE owner_id = ${owner}`;
    if (rows.length) return checked({ owner, kind: 'guest', verified: false });
  }
  throw Response.json(
    { error: 'Sign in again or start a guest trial.', code: 'session_expired' },
    { status: 401 },
  );
}

export async function accountOwner(request: Request) {
  return (await accountIdentity(request)).owner;
}

/** Hashes the Cloudflare-supplied address with a monthly salt; raw addresses are never stored. */
export async function guestIpBucket(request: Request, month: string) {
  const address = request.headers.get('cf-connecting-ip');
  if (!address) return null;
  return `ip:${await signature(`${month}:${address}`)}`;
}
