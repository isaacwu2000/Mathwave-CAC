import {
  extractNeonAuthCookies,
  handleAuthProxyRequest,
} from '@neondatabase/auth/server';
import { accountConfig } from './config.ts';
import type { AuthSession } from '../services/identity.ts';
import { accountDatabase } from '../repo/database.ts';
import { stopAccountVoices } from './voice-control.ts';

/** Fetches current provider state on every authorization; cached browser claims never grant access. */
export async function readAuthSession(
  request: Request,
): Promise<AuthSession | null> {
  const { NEON_AUTH_BASE_URL } = accountConfig();
  const cookie = extractNeonAuthCookies(request.headers);
  if (!cookie) return null;
  if (!NEON_AUTH_BASE_URL) throw new Error('Authentication is not configured.');
  const response = await fetch(
    `${NEON_AUTH_BASE_URL}/get-session?disableCookieCache=true`,
    {
      headers: { cookie, origin: new URL(request.url).origin },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error('Authentication is temporarily unavailable.');
  const data = (await response.json()) as AuthSession | null;
  if (data && (!data.user?.id || !data.session?.expiresAt))
    throw new Error('Invalid authentication response.');
  return data;
}

/** Uses the provider's supported proxy, including OAuth verifier and cookie handling. */
export async function authProxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const config = accountConfig();
  if (!config.NEON_AUTH_BASE_URL || !config.NEON_AUTH_COOKIE_SECRET)
    return Response.json(
      { error: 'Account sign-in is not configured yet.' },
      { status: 503 },
    );
  const path = (await context.params).path.join('/').replace(/^\/+|\/+$/g, '');
  // Deletion must pass our fresh-authentication check and remove owned application data.
  if (path === 'delete-user')
    return Response.json(
      { error: 'Delete your account from Settings.' },
      { status: 403 },
    );
  if (
    request.method !== 'GET' &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return Response.json(
      { error: 'Request origin is not allowed.' },
      { status: 403 },
    );
  let resettingUser: string | undefined;
  if (path === 'reset-password' && request.method === 'POST') {
    const body = (await request.clone().json()) as { token?: unknown };
    if (typeof body.token === 'string') {
      const [verification] =
        await accountDatabase()`SELECT value FROM neon_auth.verification WHERE identifier = ${`reset-password:${body.token}`} AND "expiresAt" > now()`;
      if (verification && typeof verification.value === 'string')
        resettingUser = verification.value;
    }
  }
  const response = await handleAuthProxyRequest({
    request,
    path,
    baseUrl: config.NEON_AUTH_BASE_URL,
    cookieSecret: config.NEON_AUTH_COOKIE_SECRET,
    sessionDataTtl: 1,
  });
  if (response.ok && resettingUser) {
    await accountDatabase()`DELETE FROM neon_auth.session WHERE "userId" = ${resettingUser}::uuid`;
    await stopAccountVoices(`user:${resettingUser}`);
  }
  return response;
}
