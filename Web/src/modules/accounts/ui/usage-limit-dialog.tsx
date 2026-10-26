'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowRight } from 'lucide-react';
import type { AccountStatus } from '../types/index.ts';
import { SignInButton } from './account-controls.tsx';
import './usage-limit-dialog.css';

/** Blocks continued use at exhaustion until sign-in or a refreshed allowance. */
export function UsageLimitDialog({
  status,
  refresh,
}: {
  status: AccountStatus;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const guest = status.identity.kind === 'guest';
  return (
    <Dialog
      open={status.remainingMs <= 0}
      onOpenChange={(_open, event) => event.cancel()}
    >
      <DialogContent
        className="usage-limit-dialog"
        showCloseButton={false}
        aria-describedby={guest ? undefined : 'usage-reset'}
      >
        <DialogTitle>
          {guest
            ? 'Continue dictating your math after you sign in'
            : 'You’ve used your math dictation time for this month'}
        </DialogTitle>
        {!guest && (
          <DialogDescription id="usage-reset">
            {status.resetsAt
              ? `You can continue when your usage resets on ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric' }).format(new Date(status.resetsAt))} at midnight, New York time.`
              : 'You can continue when your usage resets.'}
          </DialogDescription>
        )}
        <div className="guest-signin">
          {guest ? (
            <SignInButton />
          ) : (
            <button
              className="soft-button guest-signin-button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setError('');
                try {
                  await refresh();
                } catch {
                  setError('Could not check your usage. Try again.');
                } finally {
                  setPending(false);
                }
              }}
            >
              <span>{pending ? 'Checking…' : 'Check usage'}</span>
              <ArrowRight className="guest-signin-arrow" aria-hidden="true" />
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
