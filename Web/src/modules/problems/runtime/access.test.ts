import { expect, test, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: { CLOUD_TEST_MODE: 'true' } }));
import { env } from 'cloudflare:workers';

import { testProblemLibraryOwner } from './access.ts';

test('local browsers load the shared test problem regardless of existing cookies', () => {
  for (const cookie of [
    '',
    'theme=light',
    'math-audio-test-notebook=c33e8138-5b58-4f0d-b657-e727ce2e786b',
  ]) {
    const request = new Request('http://localhost:3000/api/problems', {
      headers: { cookie },
    });
    expect(testProblemLibraryOwner(request)).toBe('test:shared');
  }
});

test('dev instances select their server-configured problem without trusting browser cookies', () => {
  const bindings = env as unknown as {
    CLOUD_TEST_MODE: string;
    CLOUD_TEST_NOTEBOOK_OWNER?: string;
  };
  bindings.CLOUD_TEST_NOTEBOOK_OWNER = 'test:dev:agent-one';
  try {
    expect(
      testProblemLibraryOwner(
        new Request('http://localhost:3001/api/problems'),
      ),
    ).toBe('test:dev:agent-one');
    bindings.CLOUD_TEST_MODE = 'false';
    expect(() =>
      testProblemLibraryOwner(
        new Request('http://localhost:3001/api/problems'),
      ),
    ).toThrow();
  } finally {
    bindings.CLOUD_TEST_MODE = 'true';
    delete bindings.CLOUD_TEST_NOTEBOOK_OWNER;
  }
});
