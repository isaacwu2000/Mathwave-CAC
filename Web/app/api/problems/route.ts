import {
  createProblemLibraryApi,
  problemLibraryStore,
} from '../../../src/modules/problems/server.ts';
import { interpretProblemLibraryCommand } from '../../../src/modules/ai/server.ts';
import {
  accountIdentity,
  quotaAccess,
} from '../../../src/modules/accounts/server.ts';

function apiFor(request: Request) {
  let identity: ReturnType<typeof accountIdentity> | undefined;
  const getIdentity = () => (identity ??= accountIdentity(request));
  return createProblemLibraryApi({
    store: problemLibraryStore,
    owner: async () => (await getIdentity()).owner,
    interpret: async (text, saved, timing, progress) =>
      interpretProblemLibraryCommand(
        text,
        saved,
        undefined,
        timing,
        progress,
        await quotaAccess(await getIdentity(), request),
      ),
  });
}
export const GET = (request: Request) => apiFor(request).GET(request);
export const POST = (request: Request) => apiFor(request).POST(request);
