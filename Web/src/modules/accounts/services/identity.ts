import type { AccountIdentity } from '../types/index.ts';

export type AuthSession = {
  user: { id: string; email: string; emailVerified: boolean };
  session: { createdAt: string; expiresAt: string };
};

/** Verifies ownership and absolute session age before returning a server-owned identity. */
export function verifiedIdentity(
  session: AuthSession,
  developmentUserId: string,
  now: Date,
): AccountIdentity {
  if (session.user.emailVerified !== true)
    throw Response.json(
      { error: 'Confirm your email before signing in.', code: 'verify_email' },
      { status: 403 },
    );
  const created = Date.parse(session.session.createdAt);
  const expires = Date.parse(session.session.expiresAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    now.getTime() >= expires ||
    now.getTime() - created >= 30 * 86400000
  )
    throw Response.json(
      {
        error: 'Your session expired. Sign in again.',
        code: 'session_expired',
      },
      { status: 401 },
    );
  return {
    owner: `user:${session.user.id}`,
    email: session.user.email,
    verified: true,
    kind: session.user.id === developmentUserId ? 'development' : 'student',
    sessionCreatedAt: session.session.createdAt,
  };
}
