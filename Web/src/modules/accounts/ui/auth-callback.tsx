'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { completeGoogleSignIn } from '../runtime/client.ts';

/** Completes Neon's supported OAuth verifier exchange, including popup callbacks. */
export function AuthCallback() {
  const [error, setError] = useState('');
  useEffect(() => {
    void completeGoogleSignIn().catch(() =>
      setError('Google sign-in could not finish. Try again.'),
    );
  }, []);
  return (
    <main className="auth-page">
      <section className="auth-content">
        <h1>Finishing sign-in…</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <Link href="/auth">Back to sign in</Link>
          </>
        )}
      </section>
    </main>
  );
}
