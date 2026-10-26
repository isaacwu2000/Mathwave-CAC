import { neon } from '@neondatabase/serverless';
import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';

const origin = process.env.MATHWAVE_TEST_ORIGIN ?? 'http://localhost:5179';
const local = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname);
// Hosted checks send the synthetic password and delete a disposable account.
// Require the operator to name the same HTTPS origin twice before doing either.
if (
  !local &&
  (new URL(origin).protocol !== 'https:' ||
    process.env.MATHWAVE_TEST_ALLOW_ORIGIN !== origin)
)
  throw new Error(
    'Hosted checks require an explicitly matching MATHWAVE_TEST_ALLOW_ORIGIN.',
  );
if (
  !process.env.MATHWAVE_TEST_EMAIL ||
  !process.env.MATHWAVE_TEST_PASSWORD ||
  !process.env.DATABASE_URL
)
  throw new Error('Load the ignored account test environment.');
const sql = neon(process.env.DATABASE_URL);
const checks: string[] = [];
function browser() {
  const cookies = new Map<string, string>();
  return async (
    path: string,
    method = 'GET',
    body?: unknown,
    extra?: Record<string, string>,
  ) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        origin,
        'Content-Type': 'application/json',
        cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join('; '),
        ...extra,
      },
      ...(method === 'GET' || method === 'HEAD' || body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const split = pair.indexOf('=');
      if (split >= 0) {
        if (!pair.slice(split + 1) || /Max-Age=0/i.test(cookie))
          cookies.delete(pair.slice(0, split));
        else cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
    }
    return response;
  };
}
const first = browser(),
  second = browser();
const initial = await first('/api/account', 'POST');
assert.equal(initial.status, 200);
const guest = (await initial.json()) as {
  identity: { owner: string };
  remainingMs: number;
};
assert.equal(guest.remainingMs, 180000);
const other = (await (
  await second('/api/account', 'POST')
).json()) as typeof guest;
assert.notEqual(guest.identity.owner, other.identity.owner);
checks.push(
  'Separate browser guests receive separate private identities and three-minute trials.',
);
const book = (await (await first('/api/problems')).json()) as {
  revision: number;
};
const saved = await first('/api/problems', 'POST', {
  id: crypto.randomUUID(),
  revision: book.revision,
  operation: { kind: 'command', text: 'write x=7', interpret: false },
});
assert.equal(saved.status, 200);
const wrong = await second('/api/problems', 'GET', undefined, {
  'X-Mathwave-Owner': guest.identity.owner,
});
assert.equal(wrong.status, 409);
checks.push(
  'A different guest cannot submit a request under the first guest identity.',
);
await sql`UPDATE mathwave_quota SET used_ms = allowance_ms WHERE owner_id = ${guest.identity.owner} AND period = 'trial'`;
assert.equal(
  (await first('/api/interpret', 'POST', { text: 'Explain this problem' }))
    .status,
  429,
);
const snapshot = (await (await first('/api/problems')).json()) as {
  revision: number;
};
assert.equal(
  (
    await first('/api/live-token', 'POST', {
      sdp: 'v=0 synthetic offer',
      revision: String(snapshot.revision),
    })
  ).status,
  429,
);
const graph = await first('/api/graph-build', 'POST', {
  text: 'Graph y=x squared',
  revision: snapshot.revision,
});
assert.match(await graph.text(), /failed/);
assert.equal((await first('/api/problems')).status, 200);
checks.push(
  'Exhaustion blocks interpretation, graph generation, and voice before provider work; saved work remains readable.',
);
const signin = await first('/api/auth/sign-in/email', 'POST', {
  email: process.env.MATHWAVE_TEST_EMAIL,
  password: process.env.MATHWAVE_TEST_PASSWORD,
});
assert.equal(signin.status, 200);
const account = (await (await first('/api/account', 'POST')).json()) as {
  identity: { kind: string };
  allowanceMs: number;
};
assert.equal(account.identity.kind, 'development');
assert.equal(account.allowanceMs, 36000000);
const transferred = (await (await first('/api/problems')).json()) as {
  book: {
    assignmentId: string;
    problemId: string;
    assignments: {
      id: string;
      problems: { id: string; state: { expression: string } }[];
    }[];
  };
};
const active = transferred.book.assignments
  .find((item) => item.id === transferred.book.assignmentId)!
  .problems.find((item) => item.id === transferred.book.problemId)!;
assert.equal(active.state.expression, 'x = 7');
checks.push(
  'Ordinary email/password sign-in restores the ten-hour development account and carries guest work into it.',
);
assert.equal((await first('/api/auth/sign-out', 'POST', {})).status, 200);
const signedOut = await first('/api/account', 'POST');
assert.equal(signedOut.status, 200);
const signedOutGuest = (await signedOut.json()) as {
  identity: { kind: string };
  remainingMs: number;
};
assert.equal(signedOutGuest.identity.kind, 'guest');
assert.equal(signedOutGuest.remainingMs, 0);
checks.push(
  'Sign-out hides account work and retains the browser’s already-used trial allowance.',
);

// This disposable identity exercises reset/deletion without touching the shared agent account.
const disposable = browser(),
  alternateSession = browser();
const disposableEmail = `lifecycle-${crypto.randomUUID()}@mathwave.invalid`;
const disposablePassword = crypto.randomUUID() + crypto.randomUUID();
const registration = await disposable('/api/auth/sign-up/email', 'POST', {
  email: disposableEmail,
  password: disposablePassword,
  name: 'Synthetic Lifecycle Test',
});
assert.equal(registration.status, 200);
const [lifecycleUser] =
  await sql`SELECT id FROM neon_auth."user" WHERE email = ${disposableEmail}`;
assert.ok(lifecycleUser);
const beforeVerification = await disposable('/api/account', 'POST');
assert.equal(beforeVerification.status, 403);
await sql`UPDATE neon_auth."user" SET "emailVerified" = true WHERE id = ${lifecycleUser.id}`;
const verified = (await (await disposable('/api/account', 'POST')).json()) as {
  allowanceMs: number;
};
assert.equal(verified.allowanceMs, 18000000);
assert.equal(
  (
    await alternateSession('/api/auth/sign-in/email', 'POST', {
      email: disposableEmail,
      password: disposablePassword,
    })
  ).status,
  200,
);
const token = crypto.randomUUID();
await sql`INSERT INTO neon_auth.verification(id, identifier, value, "expiresAt", "createdAt", "updatedAt")
  VALUES (${crypto.randomUUID()}::uuid, ${`reset-password:${token}`}, ${String(lifecycleUser.id)}, now() + interval '5 minutes', now(), now())`;
const resetPassword = crypto.randomUUID() + crypto.randomUUID();
const reset = await disposable('/api/auth/reset-password', 'POST', {
  token,
  newPassword: resetPassword,
});
assert.equal(reset.status, 200);
assert.equal((await alternateSession('/api/problems')).status, 401);
checks.push(
  'Unverified identities cannot access work; verified student accounts receive five hours, and reset revokes another session.',
);
assert.equal(
  (
    await disposable('/api/auth/sign-in/email', 'POST', {
      email: disposableEmail,
      password: resetPassword,
    })
  ).status,
  200,
);
const deletion = await disposable('/api/account', 'DELETE', {
  confirmation: 'Delete my account',
});
assert.equal(deletion.status, 200);
assert.equal((await disposable('/api/problems')).status, 401);
checks.push(
  'A freshly authenticated disposable account can delete its identity and private work.',
);
await writeFile(
  new URL(
    process.env.MATHWAVE_TEST_REPORT ??
      '../../Evals/evaluations/auth-2026-10-19/http.json',
    import.meta.url,
  ),
  JSON.stringify(
    { origin, checkedAt: new Date().toISOString(), checks },
    null,
    2,
  ),
);
console.log(
  `${checks.length} account HTTP journeys passed. No paid AI calls were made.`,
);
