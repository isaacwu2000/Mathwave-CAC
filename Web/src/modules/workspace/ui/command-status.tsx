/** A short, inline label keeps request progress beside the AI response. */
export function CommandStatus({
  progress,
}: {
  progress: { phase: 'working' | 'graphing' | 'checking' | 'fixing' };
}) {
  return (
    <em data-command-phase={progress.phase}>
      {progress.phase === 'fixing'
        ? 'Fixing…'
        : progress.phase === 'checking'
          ? 'Checking…'
          : progress.phase === 'graphing'
            ? 'Graphing…'
            : 'Working…'}
    </em>
  );
}
