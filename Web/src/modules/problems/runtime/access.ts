import { env } from 'cloudflare:workers';

/**
 * - Returns the server-configured synthetic owner, independently of request cookies.
 * - Disabled test mode throws a 503 response before problem access.
 * - No data changes here; requests cannot select another problem owner.
 */
export function testProblemLibraryOwner(_request: Request): string {
  const bindings = env as unknown as {
    CLOUD_TEST_MODE?: string;
    CLOUD_TEST_PROBLEM_OWNER?: string;
    CLOUD_TEST_NOTEBOOK_OWNER?: string;
  };
  if (bindings.CLOUD_TEST_MODE !== 'true') {
    throw Response.json(
      { error: 'Cloud testing mode is disabled. Account access is deferred.' },
      { status: 503 },
    );
  }
  // Dev configuration supplies an isolated owner; built previews keep their existing problem.
  return (
    bindings.CLOUD_TEST_PROBLEM_OWNER ??
    bindings.CLOUD_TEST_NOTEBOOK_OWNER ??
    'test:shared'
  );
}
