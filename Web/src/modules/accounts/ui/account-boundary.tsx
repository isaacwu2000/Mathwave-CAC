'use client';
import Link from 'next/link';
import { UsageLimitDialog } from './usage-limit-dialog.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import { AccountContext } from '../hooks/use-account.tsx';
import type { AccountStatus } from '../types/index.ts';
import { completeGoogleSignIn } from '../runtime/client.ts';

/** Initializes a private guest or signed-in account before mounting saved work. */
export function AccountBoundary({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState('');
  const refresh = async (initialize = false) => {
    if (
      initialize &&
      new URLSearchParams(window.location.search).has(
        'neon_auth_session_verifier',
      )
    ) {
      await completeGoogleSignIn();
      return;
    }
    const response = await fetch('/api/account', {
      method: initialize ? 'POST' : 'GET',
      cache: 'no-store',
    });
    const body = (await response.json()) as AccountStatus & { error?: string };
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) setStatus(null);
      throw new Error(body.error ?? 'Your account could not be loaded.');
    }
    setStatus(body);
    setError('');
  };
  useEffect(() => {
    let active = true;
    const update = (initialize = false) => {
      if (active)
        void refresh(initialize).catch((failure) => {
          if (active) setError(failure.message);
        });
    };
    update(true);
    const timer = setInterval(() => update(), 15000);
    const changed = (event: StorageEvent) => {
      if (event.key === 'mathwave-account-change') {
        setStatus(null);
        update(true);
      }
    };
    const visible = () => {
      if (!document.hidden) update();
    };
    window.addEventListener('storage', changed);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('storage', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  if (!status)
    return (
      <main className="auth-page">
        <section className="auth-content">
          <Link className="auth-brand" href="/">
            Mathwave
          </Link>
          <h1>
            {error
              ? 'Let’s get you back to your work'
              : 'Opening your workspace…'}
          </h1>
          {error ? (
            <>
              <p role="alert">{error}</p>
              <Link className="soft-button" href="/auth">
                Sign in
              </Link>
              <button
                className="soft-button"
                onClick={() =>
                  void refresh(true).catch((failure) =>
                    setError(failure.message),
                  )
                }
              >
                Retry
              </button>
            </>
          ) : (
            <output>Checking your account and saved work.</output>
          )}
        </section>
      </main>
    );
  return (
    <AccountContext.Provider value={{ status, refresh }}>
      <div key={status.identity.owner}>{children}</div>
      <UsageLimitDialog status={status} refresh={refresh} />
    </AccountContext.Provider>
  );
}
