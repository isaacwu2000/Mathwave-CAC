'use client';
import Link from 'next/link';
import { MathwaveBrand } from '../../../components/ui/mathwave-brand';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  getAuthClient,
  accountChanged,
  signInWithEmail,
} from '../runtime/client.ts';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset' | 'verify';

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="auth-google-icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
    >
      <path
        d="M21.805 10.023h-9.587v3.955h5.516c-.237 1.27-.955 2.347-2.034 3.07v2.55h3.292c1.926-1.774 3.038-4.386 3.038-7.48 0-.71-.064-1.394-.225-2.095z"
        fill="#4285F4"
      />
      <path
        d="M12.218 22c2.75 0 5.057-.91 6.743-2.466l-3.292-2.55c-.914.612-2.081.973-3.451.973-2.65 0-4.894-1.79-5.695-4.196H3.126v2.63C4.804 19.722 8.249 22 12.218 22z"
        fill="#34A853"
      />
      <path
        d="M6.523 13.762a5.993 5.993 0 0 1 0-3.827v-2.63H3.126a10.008 10.008 0 0 0 0 9.087l3.397-2.63z"
        fill="#FBBC05"
      />
      <path
        d="M12.218 5.978c1.495 0 2.838.514 3.895 1.523l2.925-2.925C17.275 2.932 14.968 2 12.218 2 8.249 2 4.804 4.278 3.126 7.305l3.397 2.63c.801-2.406 3.045-3.957 5.695-3.957z"
        fill="#EA4335"
      />
    </svg>
  );
}

/** One task per form, using the same real email/password flow locally and deployed. */
export function AuthPage({
  initialMode = 'signin',
  resetToken = '',
  oauthError = false,
}: {
  initialMode?: Mode;
  resetToken?: string;
  oauthError?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [token] = useState(resetToken);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(
    oauthError ? 'Sign-in could not finish. Try again or use email.' : '',
  );
  const [configured, setConfigured] = useState(true);
  const [verificationSent, setVerificationSent] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current !== mode) heading.current?.focus();
    previousMode.current = mode;
  }, [mode]);
  useEffect(() => {
    void fetch('/api/account/config')
      .then((r) => r.json())
      .then((v: unknown) =>
        setConfigured(Boolean((v as { configured?: boolean }).configured)),
      )
      .catch(() => setConfigured(false));
  }, []);
  const changeMode = (next: Mode) => {
    setMode(next);
    setError('');
    setMessage('');
    setPassword('');
    setVerificationSent(false);
  };
  // Enter verification before sending, so delivery failures can be retried here.
  const beginVerification = async () => {
    setMode('verify');
    setVerificationSent(false);
    const result = await (
      await getAuthClient()
    ).emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
    if (result.error)
      throw new Error(
        'Could not send a code. Use Send verification code to retry.',
      );
    setVerificationSent(true);
    setMessage('Check your inbox for a verification code.');
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'signin') {
        const result = await signInWithEmail(email, password);
        if (result === 'verify-email') await beginVerification();
        else accountChanged();
      } else if (mode === 'signup') {
        const result = await (
          await getAuthClient()
        ).signUp.email({
          email,
          password,
          name: 'Student',
        });
        if (result.error)
          throw new Error(result.error.message ?? 'Account creation failed.');
        await beginVerification();
      } else if (mode === 'verify') {
        const result = await (
          await getAuthClient()
        ).emailOtp.verifyEmail({ email, otp });
        if (result.error)
          throw new Error(
            result.error.message ??
              'That code did not work. Request a new one.',
          );
        if (password) {
          const signedIn = await (
            await getAuthClient()
          ).signIn.email({ email, password });
          if (signedIn.error)
            throw new Error(
              signedIn.error.message ?? 'Email confirmed. Sign in to continue.',
            );
          accountChanged();
        } else {
          setMode('signin');
          setMessage('Email confirmed. Sign in to continue.');
        }
      } else if (mode === 'forgot') {
        const result = await (
          await getAuthClient()
        ).requestPasswordReset({
          email,
          redirectTo: new URL('/auth', window.location.origin).href,
        });
        if (result.error)
          throw new Error(
            'Recovery email could not be sent. Try again in a moment.',
          );
        setMessage(
          'If an account exists for this email, you’ll receive a password-reset link.',
        );
      } else {
        const result = await (
          await getAuthClient()
        ).resetPassword({
          token,
          newPassword: password,
        });
        if (result.error)
          throw new Error(
            result.error.message ??
              'This reset link may have expired. Request another.',
          );
        setMode('signin');
        setMessage('Password reset. Sign in with your new password.');
        setPassword('');
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Sign-in is unavailable. Try again.',
      );
    } finally {
      setPending(false);
    }
  };
  const google = async () => {
    setPending(true);
    setError('');
    try {
      const result = await (
        await getAuthClient()
      ).signIn.social({
        provider: 'google',
        callbackURL: new URL('/auth/callback', window.location.origin).href,
        errorCallbackURL: new URL('/auth?error=google', window.location.origin)
          .href,
      });
      if (result.error)
        throw new Error(
          result.error.message ?? 'Google sign-in is unavailable.',
        );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Google sign-in is unavailable.',
      );
      setPending(false);
    }
  };
  const social = mode === 'signin' || mode === 'signup';
  return (
    <main className="auth-page auth-signin-page">
      <div className="auth-brand">
        <MathwaveBrand />
      </div>
      <section
        className={`auth-content auth-entry-content${social ? '' : ' auth-entry-single'}`}
        aria-labelledby="auth-heading"
      >
        <h1 id="auth-heading" ref={heading} tabIndex={-1}>
          {
            {
              signin: 'Sign in',
              signup: 'Create an account',
              forgot: 'Reset your password',
              reset: 'Choose a new password',
              verify: 'Confirm your email',
            }[mode]
          }
        </h1>
        {mode !== 'signin' && (
          <p className="auth-intro">
            {mode === 'signup'
              ? 'Keep your problems and steps together. Your account includes 5 hours of AI time each month.'
              : mode === 'verify'
                ? verificationSent
                  ? `Enter the code sent to ${email}. You only need to confirm ownership once.`
                  : 'Enter your email and request a verification code. You only need to confirm ownership once.'
                : 'Enter your details to get back to your work.'}
          </p>
        )}
        {!configured && (
          <p role="alert">
            Sign-in is temporarily unavailable. Please try again shortly.
          </p>
        )}
        <div className={social ? 'auth-methods' : undefined}>
          {social && (
            <div className="auth-social">
              <button
                className="soft-button auth-google"
                disabled={pending || !configured}
                onClick={() => void google()}
              >
                <GoogleIcon />
                <span>Sign in with Google</span>
              </button>
            </div>
          )}
          <div className="auth-email">
            <form onSubmit={(event) => void submit(event)}>
              {mode !== 'reset' && (
                <label>
                  Email
                  <input
                    autoComplete="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setVerificationSent(false);
                    }}
                    disabled={pending}
                  />
                </label>
              )}
              {['signin', 'signup', 'reset'].includes(mode) && (
                <label>
                  Password
                  <input
                    autoComplete={
                      mode === 'signin' ? 'current-password' : 'new-password'
                    }
                    type="password"
                    required
                    minLength={mode === 'signin' ? undefined : 12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                  />
                  {mode !== 'signin' && (
                    <span className="auth-guidance">
                      Use at least 12 characters. A few memorable words work
                      well.
                    </span>
                  )}
                </label>
              )}
              {mode === 'verify' && (
                <label>
                  Verification code
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    disabled={pending}
                  />
                </label>
              )}
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              {message && <output>{message}</output>}
              <button
                className="soft-button auth-submit"
                disabled={pending || !configured}
              >
                {pending
                  ? 'Please wait…'
                  : {
                      signin: 'Sign in with email',
                      signup: 'Create account',
                      forgot: 'Send reset link',
                      reset: 'Save new password',
                      verify: 'Confirm email',
                    }[mode]}
              </button>
            </form>
            <div className="auth-links">
              {mode === 'signin' ? (
                <>
                  <button onClick={() => changeMode('signup')}>
                    Create an account
                  </button>
                  <button onClick={() => changeMode('forgot')}>
                    Forgot password?
                  </button>
                </>
              ) : (
                <button onClick={() => changeMode('signin')}>
                  Back to sign in
                </button>
              )}
              {mode === 'verify' && (
                <button
                  disabled={pending || !email}
                  onClick={() => {
                    setPending(true);
                    void getAuthClient()
                      .then((client) =>
                        client.emailOtp.sendVerificationOtp({
                          email,
                          type: 'email-verification',
                        }),
                      )
                      .then((r) => {
                        setVerificationSent(!r.error);
                        setMessage(
                          r.error
                            ? 'Could not send a code. Try again.'
                            : 'A new code is on its way.',
                        );
                      })
                      .catch(() =>
                        setError('Could not send a code. Try again.'),
                      )
                      .finally(() => setPending(false));
                  }}
                >
                  {verificationSent
                    ? 'Send a new code'
                    : 'Send verification code'}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      <nav className="information-links auth-footer" aria-label="Information">
        <Link href="/privacy">Privacy</Link>
      </nav>
    </main>
  );
}
