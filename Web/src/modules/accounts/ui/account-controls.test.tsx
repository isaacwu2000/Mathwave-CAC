import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuotaNotice, GuestSignIn } from './account-controls.tsx';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: import('react').ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const state = vi.hoisted(() => ({
  kind: 'guest',
  remainingMs: 180000,
  allowanceMs: 18000000,
}));
vi.mock('../hooks/use-account.tsx', () => ({
  useAccount: () => ({
    status: {
      identity: { kind: state.kind },
      remainingMs: state.remainingMs,
      allowanceMs: state.allowanceMs,
    },
  }),
}));
vi.mock('../runtime/client.ts', () => ({
  getAuthClient: vi.fn(),
  accountChanged: vi.fn(),
}));

describe('allowance visibility', () => {
  it('keeps the trial allowance hidden until exhausted', () => {
    state.kind = 'guest';
    for (const remainingMs of [180000, 30000, 1]) {
      state.remainingMs = remainingMs;
      expect(renderToStaticMarkup(<QuotaNotice trialOnly />)).toBe('');
    }
    state.remainingMs = 0;
    const notice = renderToStaticMarkup(<QuotaNotice trialOnly />);
    expect(notice).toContain('Sign in to keep using AI');
    expect(notice).toContain('href="/auth"');
    expect(notice).not.toContain('time left');
  });

  it('shows account hours in Settings but hides them from the trial notice', () => {
    state.kind = 'student';
    state.remainingMs = 18000000;
    expect(renderToStaticMarkup(<QuotaNotice trialOnly />)).toBe('');
    expect(renderToStaticMarkup(<QuotaNotice />)).toContain(
      '5 hr 0 min AI time left this month',
    );
  });
});

it('offers guest sign-in before exhaustion and hides it for signed-in accounts', () => {
  state.kind = 'guest';
  state.remainingMs = 180000;
  const notice = renderToStaticMarkup(<GuestSignIn />);
  expect(notice).toContain('href="/auth"');
  expect(notice).toContain('<span>Sign in</span>');
  expect(notice).not.toContain('time left');
  state.remainingMs = 0;
  expect(renderToStaticMarkup(<GuestSignIn />)).toContain(
    'Sign in to keep using AI',
  );
  state.kind = 'student';
  expect(renderToStaticMarkup(<GuestSignIn />)).toBe('');
});

it('shows the remaining monthly allowance as an accessible bar', () => {
  state.kind = 'student';
  state.allowanceMs = 18000000;
  for (const [remaining, expected] of [
    [18000000, 18000000],
    [9000000, 9000000],
    [0, 0],
    [-1, 0],
    [20000000, 18000000],
  ]) {
    state.remainingMs = remaining;
    const html = renderToStaticMarkup(<QuotaNotice />);
    expect(html).toContain('<progress');
    expect(html).toContain('max="18000000"');
    expect(html).toContain(`value="${expected}"`);
    expect(html).toContain('aria-label="Monthly AI time remaining"');
  }
  state.remainingMs = 0;
  expect(renderToStaticMarkup(<QuotaNotice />)).toContain(
    'AI is paused. Your saved work is still available.',
  );
  state.allowanceMs = 0;
  expect(renderToStaticMarkup(<QuotaNotice />)).toContain('max="1"');
});
