import app from 'vinext/server/fetch-handler';
import { cleanupDeletedAccounts } from './src/modules/accounts/server.ts';
const worker = {
  ...app,
  scheduled: async () => {
    await cleanupDeletedAccounts();
  },
};
export default worker;
export { VoiceQuota } from './src/modules/accounts/runtime/voice-quota.ts';
