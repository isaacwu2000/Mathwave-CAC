import {
  createGraphBuildApi,
  problemLibraryStore,
} from '../../../src/modules/problems/server.ts';
import { streamGraphCommands } from '../../../src/modules/ai/server.ts';
import {
  accountIdentity,
  quotaAccess,
} from '../../../src/modules/accounts/server.ts';
export const POST = (request: Request) => {
  let identity: ReturnType<typeof accountIdentity> | undefined;
  const getIdentity = () => (identity ??= accountIdentity(request));
  return createGraphBuildApi({
    owner: async () => (await getIdentity()).owner,
    load: (owner) => problemLibraryStore.load(owner),
    generate: async function* (text, saved, signal) {
      yield* streamGraphCommands(
        text,
        saved,
        signal,
        await quotaAccess(await getIdentity(), request),
      );
    },
  })(request);
};
