import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthPage } from './auth-page.tsx';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: import('react').ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('../runtime/client.ts', () => ({
  getAuthClient: vi.fn(),
  accountChanged: vi.fn(),
}));

it('offers Google and email sign-in without a guest-trial exit', () => {
  const html = renderToStaticMarkup(<AuthPage />);
  expect(html).toContain('Sign in with Google');
  expect(html).toContain('Sign in with email');
  expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain('href="/privacy"');
  expect(html).not.toContain('href="/about"');
  expect(html).not.toContain('Confirm your email');
  expect(html).not.toMatch(/trial|guest|href="\/"/i);
});

it('keeps recovery focused on email without a social sign-in action', () => {
  const html = renderToStaticMarkup(<AuthPage initialMode="forgot" />);
  expect(html).toContain('Send reset link');
  expect(html).not.toContain('Sign in with Google');
  expect(html).not.toContain('type="password"');
});

it('requests a verification code before claiming one has been sent', () => {
  const html = renderToStaticMarkup(<AuthPage initialMode="verify" />);
  expect(html).toContain('request a verification code');
  expect(html).toContain('Send verification code');
  expect(html).not.toContain('Enter the code sent to');
});
