import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { completeGoogleSignIn, signInWithEmail } from './client.ts';

const auth = vi.hoisted(() => ({
  email: vi.fn(),
  getSession: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@neondatabase/auth/next', () => ({
  createAuthClient: () => ({
    signIn: { email: auth.email },
    getSession: auth.getSession,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { location: { assign: auth.navigate } });
  vi.stubGlobal('localStorage', { setItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it('continues an unverified email sign-in into verification automatically', async () => {
  auth.email.mockRejectedValue(
    Object.assign(new Error('Email verification required'), {
      code: 'email_not_confirmed',
    }),
  );
  await expect(
    signInWithEmail('student@example.com', 'password'),
  ).resolves.toBe('verify-email');
  expect(auth.navigate).not.toHaveBeenCalled();
});

it('does not treat an empty Google session as a completed sign-in', async () => {
  auth.getSession.mockResolvedValue({ data: null, error: null });
  await expect(completeGoogleSignIn()).rejects.toThrow(
    'Google sign-in could not finish',
  );
  expect(auth.navigate).not.toHaveBeenCalled();
});

it('opens saved work after Google supplies both the user and session', async () => {
  auth.getSession.mockResolvedValue({
    data: { user: { id: 'student' }, session: { id: 'session' } },
    error: null,
  });
  await completeGoogleSignIn();
  expect(auth.navigate).toHaveBeenCalledWith('/');
});

it('keeps a wrong password on sign-in instead of sending a verification code', async () => {
  auth.email.mockResolvedValue({
    data: null,
    error: {
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Check your password.',
    },
  });
  await expect(signInWithEmail('student@example.com', 'wrong')).rejects.toThrow(
    'Check your password.',
  );
});

it('requires verification when the provider returns an unverified user', async () => {
  auth.email.mockResolvedValue({
    data: { user: { emailVerified: false } },
    error: null,
  });
  await expect(
    signInWithEmail('student@example.com', 'password'),
  ).resolves.toBe('verify-email');
});
