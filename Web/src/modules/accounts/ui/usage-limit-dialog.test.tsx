import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountStatus } from '../types/index.ts';
import { UsageLimitDialog } from './usage-limit-dialog.tsx';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <dialog open>{children}</dialog> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../runtime/client.ts', () => ({
  getAuthClient: vi.fn(),
  accountChanged: vi.fn(),
}));

const status: AccountStatus = {
  identity: { owner: 'guest:test', kind: 'guest', verified: false },
  remainingMs: 0,
  allowanceMs: 180000,
  resetsAt: null,
  authConfigured: true,
};

test('requires sign-in after the guest trial, using the shared arrow button', () => {
  const markup = renderToStaticMarkup(
    <UsageLimitDialog status={status} refresh={async () => {}} />,
  );
  expect(markup).toContain('Continue dictating your math after you sign in');
  expect(markup).toContain('href="/auth"');
  expect(markup).toContain('guest-signin-button');
  expect(markup).toContain('guest-signin-arrow');
});

test('blocks exhausted signed-in accounts with the New York reset date', () => {
  for (const kind of ['student', 'development'] as const) {
    const markup = renderToStaticMarkup(
      <UsageLimitDialog
        status={{
          ...status,
          identity: { ...status.identity, kind },
          resetsAt: '2026-11-01T04:00:00.000Z',
        }}
        refresh={async () => {}}
      />,
    );
    expect(markup).toContain(
      'You’ve used your math dictation time for this month',
    );
    expect(markup).toContain('November 1');
    expect(markup).toContain('New York time');
    expect(markup).toContain('Check usage');
    expect(markup).not.toContain('href="/auth"');
  }
});

test('leaves accounts with remaining usage unblocked, including the final millisecond', () => {
  expect(
    renderToStaticMarkup(
      <UsageLimitDialog
        status={{ ...status, remainingMs: 1 }}
        refresh={async () => {}}
      />,
    ),
  ).toBe('');
});
