import { extractNeonAuthCookies } from '@neondatabase/auth/server';
import { accountIdentity, guestOwner, issueGuest } from './access.ts';
import { readAuthSession } from './auth.ts';
import { accountConfig } from './config.ts';
import { quotaAccess, quotaStore } from './quota.ts';
import { quotaPeriod, allowanceMilliseconds } from '../services/quota.ts';
import { accountDatabase } from '../repo/database.ts';
import { transferGuest } from '../repo/transfer.ts';
import { verifiedIdentity } from '../services/identity.ts';
import { createDeletionCleanup } from '../repo/deletion.ts';
import { stopAccountVoices } from './voice-control.ts';

export const cleanupDeletedAccounts = createDeletionCleanup(accountDatabase);

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Returns only this browser's account and allowance; POST initializes or transfers guest work. */
export async function accountStatus(request: Request) {
  if (
    request.method === 'POST' &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return reply({ error: 'Request origin is not allowed.' }, 403);
  try {
    let cookie: string | undefined;
    let identity;
    try {
      identity = await accountIdentity(request);
    } catch (error) {
      if (
        !(error instanceof Response) ||
        error.status !== 401 ||
        request.method !== 'POST' ||
        extractNeonAuthCookies(request.headers)
      )
        throw error;
      const guest = await issueGuest(request);
      cookie = guest.cookie;
      identity = {
        owner: guest.owner,
        kind: 'guest' as const,
        verified: false,
      };
    }
    if (request.method === 'POST' && identity.kind !== 'guest') {
      const guest = await guestOwner(request);
      if (guest) await transferGuest(guest, identity.owner);
    }
    const access = await quotaAccess(identity, request);
    const quota = access
      ? await quotaStore.status(access.owner, access.period)
      : {
          remainingMs: allowanceMilliseconds(identity.kind),
          allowanceMs: allowanceMilliseconds(identity.kind),
        };
    const response = reply({
      identity,
      ...quota,
      resetsAt:
        identity.kind === 'guest' ? null : quotaPeriod(new Date()).resetsAt,
      authConfigured: Boolean(accountConfig().NEON_AUTH_BASE_URL),
    });
    if (cookie) response.headers.append('Set-Cookie', cookie);
    return response;
  } catch (error) {
    return error instanceof Response
      ? error
      : reply(
          { error: 'Your account could not be loaded. Retry in a moment.' },
          503,
        );
  }
}

/** Deletes current owned work after fresh provider authentication and explicit confirmation. */
export async function deleteAccount(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return reply({ error: 'Request origin is not allowed.' }, 403);
  try {
    const session = await readAuthSession(request);
    if (!session)
      return reply(
        { error: 'Sign in again before deleting your account.' },
        401,
      );
    const identity = verifiedIdentity(
      session,
      accountConfig().MATHWAVE_DEVELOPMENT_USER_ID ?? '',
      new Date(),
    );
    if (Date.now() - Date.parse(session.session.createdAt) > 10 * 60000)
      return reply(
        {
          error: 'Sign in again to confirm account deletion.',
          code: 'reauthenticate',
        },
        403,
      );
    const input = (await request.json()) as { confirmation?: unknown };
    if (input.confirmation !== 'Delete my account')
      return reply(
        { error: 'Confirm that you want to delete your account.' },
        400,
      );
    const sql = accountDatabase();
    // Deny all application access before asking the identity provider to delete the user.
    await sql`INSERT INTO mathwave_deleted_accounts(owner_id) VALUES (${identity.owner}) ON CONFLICT DO NOTHING`;
    await stopAccountVoices(identity.owner);
    // Managed Auth owns no public self-delete endpoint. Its user foreign keys
    // cascade to credentials and sessions in this same Postgres database.
    await sql.transaction([
      sql`DELETE FROM neon_auth.verification WHERE value = ${session.user.id}
        OR identifier IN (${session.user.email}, ${`email-verification-otp-${session.user.email}`}, ${`forget-password-otp-${session.user.email}`}, ${`sign-in-otp-${session.user.email}`})`,
      sql`DELETE FROM neon_auth."user" WHERE id = ${session.user.id}::uuid`,
    ]);
    await cleanupDeletedAccounts();
    const response = reply({ deleted: true });
    for (const name of [
      '__Secure-neon-auth.session_token',
      '__Secure-neon-auth.local.session_data',
      '__Secure-neon-auth.session_challenge',
      'mathwave.guest',
    ])
      response.headers.append(
        'Set-Cookie',
        `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
      );
    return response;
  } catch (error) {
    return error instanceof Response
      ? error
      : reply(
          { error: 'Deletion could not be completed. Retry from Settings.' },
          503,
        );
  }
}
