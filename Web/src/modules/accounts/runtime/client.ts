'use client';
type AuthClient = ReturnType<
  typeof import('@neondatabase/auth/next').createAuthClient
>;
let client: Promise<AuthClient> | undefined;

/** Loads the browser SDK only when needed; its startup randomness is forbidden during Worker rendering. */
export function getAuthClient(): Promise<AuthClient> {
  return (client ??= import('@neondatabase/auth/next').then(
    ({ createAuthClient }) => createAuthClient(),
  ));
}

/** Signs in with the provider; unverified addresses continue into the code flow. */
export async function signInWithEmail(email: string, password: string) {
  try {
    const result = await (
      await getAuthClient()
    ).signIn.email({ email, password });
    if (!result.error && result.data?.user.emailVerified === false)
      return 'verify-email' as const;
    if (result.error) throw result.error;
    return 'signed-in' as const;
  } catch (error) {
    // Neon normalizes HTTP failures and throws them from its fetch adapter.
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'email_not_confirmed' ||
        error.code === 'EMAIL_NOT_VERIFIED')
    )
      return 'verify-email' as const;
    if (error instanceof Error) throw error;
    throw new Error(
      error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string'
        ? error.message
        : 'Sign-in failed. Check your email and password.',
    );
  }
}

/** Exchanges Google's callback through the SDK; only a real session opens saved work. */
export async function completeGoogleSignIn() {
  const result = await (
    await getAuthClient()
  ).getSession({
    query: { disableCookieCache: true },
  });
  if (result.error || !result.data?.session || !result.data.user)
    throw new Error('Google sign-in could not finish. Try again.');
  accountChanged();
}

/** Notifies other tabs to hide the previous account's work before loading another identity. */
export function accountChanged() {
  try {
    localStorage.setItem('mathwave-account-change', crypto.randomUUID());
  } catch {
    /* Reload still clears in-memory work. */
  }
  window.location.assign('/');
}
