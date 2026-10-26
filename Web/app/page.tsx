import { WorkspaceView } from '../src/modules/workspace/index.ts';
import { AccountBoundary } from '../src/modules/accounts/ui.ts';

export default function Page() {
  return (
    <AccountBoundary>
      <WorkspaceView />
    </AccountBoundary>
  );
}
