'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAccount } from '../hooks/use-account.tsx';
import { getAuthClient, accountChanged } from '../runtime/client.ts';
import { formatAllowance } from '../services/quota.ts';

export function SignInButton() {
  return (
    <Link className="soft-button guest-signin-button" href="/auth">
      <span>Sign in</span>
      <svg
        className="guest-signin-arrow"
        aria-hidden="true"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </svg>
    </Link>
  );
}

export function GuestSignIn() {
  const account = useAccount();
  if (account?.status.identity.kind !== 'guest') return null;
  return (
    <div className="guest-signin">
      <SignInButton />
      <QuotaNotice trialOnly />
    </div>
  );
}

export function QuotaNotice({ trialOnly = false }: { trialOnly?: boolean }) {
  const account = useAccount();
  if (!account) return null;
  const { identity, remainingMs, allowanceMs } = account.status;
  if (identity.kind === 'guest') {
    if (remainingMs > 0) return null;
    return (
      <output className="quota-notice">
        <Link href="/auth">Sign in to keep using AI</Link>
      </output>
    );
  }
  if (trialOnly) return null;
  const allowance = Math.max(0, allowanceMs);
  const remaining = Math.min(Math.max(0, remainingMs), allowance);
  const remainingText = `${formatAllowance(remaining)} AI time left this month`;
  return (
    <div className="quota-notice quota-usage">
      <progress
        className="quota-bar"
        aria-label="Monthly AI time remaining"
        aria-valuetext={remainingText}
        max={allowance || 1}
        value={remaining}
      />
      <span>{remainingText}</span>
      {remainingMs <= 30000 && (
        <output>
          {remainingMs > 0
            ? ' Your AI time is nearly used up.'
            : ' AI is paused. Your saved work is still available.'}
        </output>
      )}
    </div>
  );
}

/** Account actions leave all existing problem, audio, export and backup settings in place. */
export function AccountDetails({ beforeChange }: { beforeChange: () => void }) {
  const account = useAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!account) return null;
  const { identity, resetsAt } = account.status;
  if (identity.kind === 'guest')
    return (
      <>
        <p>
          You’re using your private guest trial. Create an account to keep your
          work across devices.
        </p>
        <Link className="soft-button" href="/auth">
          Sign in / create account
        </Link>
      </>
    );
  return (
    <>
      <p>{identity.email ?? 'Development account'}</p>
      <QuotaNotice />
      {resetsAt && (
        <p>
          Resets{' '}
          {new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'long',
          }).format(new Date(resetsAt))}{' '}
          at midnight, New York time.
        </p>
      )}
      <div className="data-actions">
        <button
          className="soft-button"
          disabled={pending}
          onClick={() => {
            beforeChange();
            setPending(true);
            void getAuthClient()
              .then((client) => client.signOut())
              .then((r) => {
                if (r.error) {
                  setError('Could not sign out. Try again.');
                  setPending(false);
                } else accountChanged();
              })
              .catch(() => {
                setError('Could not sign out. Try again.');
                setPending(false);
              });
          }}
        >
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function DeleteAccountControl({
  beforeChange,
}: {
  beforeChange: () => void;
}) {
  const account = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const guest = !account || account.status.identity.kind === 'guest';
  return (
    <div className="account-delete-control">
      <p>
        {guest
          ? 'Sign in to manage account deletion. You can export your trial work above.'
          : 'Permanently delete your account and saved problems. Download an export or backup above first if you want to keep a copy.'}
      </p>
      {!confirming ? (
        <button
          className="destructive-button"
          disabled={guest}
          onClick={() => {
            beforeChange();
            setConfirming(true);
          }}
        >
          Delete account
        </button>
      ) : (
        <div className="account-delete-confirm">
          <p>This cannot be undone. Delete your account and all saved work?</p>
          <button
            className="destructive-button"
            disabled={pending}
            onClick={() => {
              beforeChange();
              setPending(true);
              setError('');
              void fetch('/api/account', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: 'Delete my account' }),
              })
                .then(async (response) => {
                  const result = (await response.json()) as { error?: string };
                  if (!response.ok)
                    throw new Error(result.error ?? 'Deletion failed. Retry.');
                  accountChanged();
                })
                .catch((failure) => setError(failure.message))
                .finally(() => setPending(false));
            }}
          >
            {pending ? 'Deleting…' : 'Delete my account permanently'}
          </button>
          <button
            className="soft-button"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep my account
          </button>
          <Link href="/auth">Sign in again to confirm ownership</Link>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
