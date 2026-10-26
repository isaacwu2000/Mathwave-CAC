import { notFound } from 'next/navigation';
import { WorkspaceView } from '../../src/modules/workspace/index.ts';
import { AccountBoundary } from '../../src/modules/accounts/ui.ts';
import './recording.css';

/** Recording controls are available only in the local development app. */
export default function RecordingPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <AccountBoundary>
      <WorkspaceView recording />
    </AccountBoundary>
  );
}
