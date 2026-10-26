'use client';
import { lazy, Suspense, useState, useRef, useMemo } from 'react';
import { validateGraphRange } from '../services/graph.ts';
import type { GraphDocument, GraphResult } from '../types.ts';
const Canvas = lazy(() =>
  import('./GraphCanvas.tsx').then((m) => ({
    default: m.GraphCanvas,
  })),
);

export function RendererCanvas({
  document,
  result,
  onViewport,
  capture = false,
  interactive = true,
  onRendered,
  onSelect,
  recordingMotion = false,
  curveMotion,
}: {
  capture?: boolean;
  recordingMotion?: boolean;
  curveMotion?: string;
  document: GraphDocument;
  result: GraphResult;
  onViewport?: (bounds: GraphDocument['bounds']) => void;
  interactive?: boolean;
  onRendered?: () => void;
  onSelect?: (point: { x: number; y: number }) => void;
}) {
  // Caption renders carry identical samples; keep them from restarting motion.
  const signature = recordingMotion ? JSON.stringify(result) : '';
  const snapshot = useMemo(
    () => (signature ? (JSON.parse(signature) as GraphResult) : null),
    [signature],
  );
  const stableResult = snapshot ?? result;
  const host = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [reset, setReset] = useState(0);
  return (
    <div
      className="learnunlock-canvas"
      ref={host}
      data-recording-graph-ready={
        recordingMotion ? (ready ? 'true' : 'pending') : undefined
      }
    >
      <Suspense fallback={<output>Opening graph…</output>}>
        <Canvas
          capture={capture}
          document={document}
          result={stableResult}
          resetKey={reset}
          curveMotion={curveMotion}
          viewportMotion={recordingMotion}
          interactive={interactive}
          onSelect={onSelect}
          onRendered={(frame) => {
            if (frame !== stableResult) return;
            if (recordingMotion && !entered.current) {
              entered.current = true;
              setReady(true);
            }
            onRendered?.();
          }}
          onFailure={() =>
            setFailure('Graph display is not working. Your saved work is safe.')
          }
          onViewport={(bounds) => {
            try {
              validateGraphRange(bounds);
              validateGraphRange(bounds.y!);
              const same = (a: number, b: number) =>
                Math.abs(a - b) <=
                Math.max(1, Math.abs(a), Math.abs(b)) * 1e-10;
              if (
                same(bounds.min, document.bounds.min) &&
                same(bounds.max, document.bounds.max) &&
                document.bounds.y &&
                same(bounds.y!.min, document.bounds.y.min) &&
                same(bounds.y!.max, document.bounds.y.max)
              )
                return;
              onViewport?.(bounds);
            } catch {
              setFailure(
                'That view is outside the supported range. Reset the display to continue.',
              );
            }
          }}
        />
      </Suspense>
      {failure && (
        <div className="graph-display-failure" role="alert">
          <p>{failure}</p>
          <button
            onClick={() => {
              setFailure('');
              setReset((v) => v + 1);
            }}
          >
            Reset display
          </button>
        </div>
      )}
    </div>
  );
}
