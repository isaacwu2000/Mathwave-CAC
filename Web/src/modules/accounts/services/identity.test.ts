import { expect, test } from 'vitest';
import { verifiedIdentity } from './identity.ts';

test('unverified and expired accounts cannot acquire private work or paid AI access', () => {
  const session = {
    user: { id: 'student-a', email: 'a@example.test', emailVerified: false },
    session: {
      createdAt: '2026-10-19T12:00:00Z',
      expiresAt: '2026-11-18T12:00:00Z',
    },
  };
  expect(() =>
    verifiedIdentity(session, '', new Date('2026-10-19T13:00:00Z')),
  ).toThrow();
  session.user.emailVerified = true;
  expect(
    verifiedIdentity(session, '', new Date('2026-10-19T13:00:00Z')),
  ).toMatchObject({ owner: 'user:student-a', verified: true, kind: 'student' });
  expect(() =>
    verifiedIdentity(session, '', new Date('2026-11-19T13:00:00Z')),
  ).toThrow();
});
