'use client';
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
const SceneView = lazy(() =>
  import('./graph-scene-view.tsx').then((module) => ({
    default: module.GraphSceneView,
  })),
);
import type { GraphScene } from '../services/graph-scene.ts';
import { RendererCanvas } from './renderer-canvas.tsx';
import {
  graphRenderData,
  graphColors as colors,
} from '../services/renderer-adapter.ts';
import './graph-controls.css';
import { curveMotionKey } from '../services/curve-motion.ts';
import {
  GraphExpressionPanel,
  GraphVisibility,
  useGraphVisibility,
} from './graph-expression-panel.tsx';
import { Plus, X } from 'lucide-react';
import {
  graphSegments,
  graphAverageRate,
  type GraphComparison,
  graphFunction,
  defaultGraphRange,
  type GraphRange,
  type GraphTrace,
} from '../services/graph.ts';
import { MathInput } from '../../math/ui.ts';
import {
  previewGraphDraft,
  graphDraftChanged,
} from '../services/graph-draft.ts';
const emptyExpressions: string[] = [];
type GraphDraft = ReturnType<typeof previewGraphDraft> & { saved: string };
function LegacyGraphView({
  expression,
  expressions = emptyExpressions,
  range = defaultGraphRange,
  yRange = defaultGraphRange,
  onCommand,
  trace,
  comparisonPoints,
  interactive = true,
  onRendered,
  capture = false,
  controls = true,
  recordingMotion = false,
}: {
  capture?: boolean;
  controls?: boolean;
  recordingMotion?: boolean;
  expression: string;
  trace?: GraphTrace;
  comparisonPoints?: GraphComparison;
  expressions?: string[];
  range?: GraphRange;
  yRange?: GraphRange;
  onCommand: (command: string) => void;
  interactive?: boolean;
  onRendered?: () => void;
}) {
  const curves = useMemo(
    () => [expression, ...expressions],
    [expression, expressions],
  );
  const [drafts, setDrafts] = useState<Record<number, GraphDraft>>({});
  const [added, setAdded] = useState<GraphDraft>();
  const [adding, setAdding] = useState(false);
  const newInput = useRef<{ focus(): void }>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const { hidden, toggle } = useGraphVisibility(curves);
  const restoreAddFocus = useRef(false);
  // Enter and blur can finish the same draft; save it only once.
  const pendingAdd = useRef(false);
  const [focusedExpression, setFocusedExpression] = useState<number | null>(
    null,
  );
  useEffect(() => {
    if (adding) newInput.current?.focus();
    else if (restoreAddFocus.current) {
      addButton.current?.focus();
      restoreAddFocus.current = false;
    }
  }, [adding]);
  const command = useRef(onCommand);
  useEffect(() => {
    command.current = onCommand;
  });
  const savedSignature = JSON.stringify(curves);
  const [lastSavedSignature, setLastSavedSignature] = useState(savedSignature);
  // Saved changes end editing so old drafts cannot replace newer curves.
  if (lastSavedSignature !== savedSignature) {
    setLastSavedSignature(savedSignature);
    setDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([i, draft]) => draft.saved === curves[Number(i)],
        ),
      ),
    );
    setAdded((previous) =>
      previous?.saved === lastSavedSignature &&
      JSON.parse(lastSavedSignature).length === curves.length
        ? { ...previous, saved: savedSignature }
        : undefined,
    );
  }
  // Save only valid, changed expressions after typing pauses. Cleanup prevents
  // a superseded draft or an unmounted problem from sending a delayed edit.
  useEffect(() => {
    const pending = Object.entries(drafts).filter(
      ([i, draft]) =>
        draft.saved === curves[Number(i)] &&
        !draft.error &&
        draft.source.trim() &&
        graphDraftChanged(draft.saved, draft.source),
    );
    if (!pending.length) return;
    const timer = setTimeout(() => {
      for (const [i, draft] of pending)
        command.current(`edit graph ${Number(i) + 1} to ${draft.source}`);
    }, 600);
    return () => clearTimeout(timer);
  }, [drafts, curves]);
  const addCurve = (restoreFocus = false) => {
    if (
      !pendingAdd.current ||
      added?.saved !== savedSignature ||
      !added.source.trim() ||
      added.error
    )
      return;
    pendingAdd.current = false;
    restoreAddFocus.current = restoreFocus;
    setFocusedExpression(null);
    onCommand(`add graph ${added.source}`);
    setAdded(undefined);
    setAdding(false);
  };
  const previewCurves = curves.map((curve, i) =>
    drafts[i]?.saved === curve ? drafts[i].expression : curve,
  );
  if (
    added?.saved === savedSignature &&
    added.source &&
    added.expression &&
    curves.length < 8
  )
    previewCurves.push(added.expression);
  const activeTrace =
    trace && curves[trace.graph - 1] === trace.expression ? trace : undefined;
  const index = activeTrace ? activeTrace.graph - 1 : 0;
  const renderData = graphRenderData(previewCurves, range, yRange);
  let point: { x: number; y: number | null };
  try {
    point =
      activeTrace && activeTrace.graph === index + 1
        ? {
            x: activeTrace.x,
            y: graphFunction(previewCurves[index]).value(activeTrace.x),
          }
        : graphSegments(previewCurves[index], range)[100];
  } catch {
    return <p>This graph needs an expression in x, such as y = x squared.</p>;
  }
  const markers = point.y === null ? [] : [{ x: point.x, y: point.y }];
  const endpointPair =
    comparisonPoints && previewCurves.includes(comparisonPoints.expression)
      ? graphAverageRate(
          comparisonPoints.expression,
          comparisonPoints.start,
          comparisonPoints.end,
        )
      : null;
  if (endpointPair) {
    const { start: a, end: b } = endpointPair;
    renderData.result.plots.push({
      id: 'secant',
      kind: 'line',
      color: '#d32419',
      positions: [a.x, a.y, 0, b.x, b.y, 0],
    });
    renderData.result.plots.push({
      id: 'comparison-markers',
      kind: 'point',
      color: '#d32419',
      positions: [a.x, a.y, 0, b.x, b.y, 0],
    });
    renderData.result.labels = [a, b].map((p, i) => ({
      text: i ? 'B' : 'A',
      position: [p.x, p.y, 0],
    }));
  }
  renderData.result.plots.push({
    id: 'markers',
    kind: 'point',
    color: colors[index],
    positions: markers.flatMap((p) => [p.x, p.y, 0]),
  });
  if (controls) {
    // Renderer IDs tie each curve to its row. Hide its trace and comparison
    // annotations too, while retaining the saved expression for calculations.
    renderData.result.plots = renderData.result.plots.filter(
      (plot) =>
        !hidden.some((i) => plot.id === `curve-${i}`) &&
        !(hidden.includes(index) && plot.id === 'markers') &&
        !(
          hidden.includes(curves.indexOf(comparisonPoints?.expression ?? '')) &&
          (plot.id === 'secant' || plot.id === 'comparison-markers')
        ),
    );
    if (hidden.includes(curves.indexOf(comparisonPoints?.expression ?? '')))
      renderData.result.labels = [];
  }
  if (!controls)
    return (
      <RendererCanvas
        capture={capture}
        {...renderData}
        recordingMotion={recordingMotion}
        curveMotion={
          recordingMotion ? curveMotionKey(previewCurves) : undefined
        }
        interactive={interactive}
        onRendered={onRendered}
        onSelect={(point) =>
          onCommand(`trace graph ${index + 1} at x ${point.x}`)
        }
        onViewport={(bounds) =>
          onCommand(
            `view x ${bounds.min} to ${bounds.max} y ${bounds.y!.min} to ${bounds.y!.max}`,
          )
        }
      />
    );
  return (
    <div className="graph-studio learnunlock-controls">
      <GraphExpressionPanel>
        {curves.map((curve, i) => (
          <form
            className="graph-expression"
            key={i}
            onSubmit={(e) => {
              e.preventDefault();
              const text = new FormData(e.currentTarget).get('expression');
              if (typeof text === 'string' && graphDraftChanged(curve, text))
                onCommand(`edit graph ${i + 1} to ${text}`);
            }}
          >
            <GraphVisibility
              index={i}
              color={colors[i]}
              hidden={hidden.includes(i)}
              onToggle={() => toggle(i)}
            />
            <MathInput
              name="expression"
              label={`Graph expression ${i + 1}`}
              value={drafts[i]?.saved === curve ? drafts[i].source : curve}
              required
              validate={(source) => {
                graphFunction(source);
              }}
              onFocus={() => setFocusedExpression(i)}
              invalid={
                focusedExpression !== i &&
                drafts[i]?.saved === curve &&
                Boolean(drafts[i].error)
              }
              describedBy={
                focusedExpression !== i &&
                drafts[i]?.saved === curve &&
                drafts[i].error
                  ? `graph-draft-${i}`
                  : undefined
              }
              onChange={(source) =>
                setDrafts((previous) => ({
                  ...previous,
                  [i]: {
                    saved: curve,
                    ...previewGraphDraft(
                      previous[i]?.saved === curve
                        ? previous[i].expression
                        : curve,
                      source,
                    ),
                  },
                }))
              }
              onBlur={() => {
                setFocusedExpression(null);
                const draft = drafts[i];
                if (
                  draft?.saved === curve &&
                  !draft.error &&
                  draft.source.trim() &&
                  graphDraftChanged(curve, draft.source)
                )
                  onCommand(`edit graph ${i + 1} to ${draft.source}`);
              }}
              onEscape={() =>
                setDrafts((previous) => {
                  const next = { ...previous };
                  delete next[i];
                  return next;
                })
              }
            />
            <button
              type="button"
              className="graph-remove"
              aria-label={`Remove graph ${i + 1}`}
              disabled={curves.length === 1}
              title={
                curves.length === 1 ? 'Keep at least one expression' : undefined
              }
              onClick={() => onCommand(`remove graph ${i + 1}`)}
            >
              <X size={16} aria-hidden="true" />
            </button>
            {focusedExpression !== i &&
              drafts[i]?.saved === curve &&
              drafts[i].error && (
                <span id={`graph-draft-${i}`} className="graph-draft-error">
                  {drafts[i].error} The last valid curve is still shown.
                </span>
              )}
          </form>
        ))}
        {adding && curves.length < 8 && (
          <form
            className="graph-expression graph-add"
            onSubmit={(e) => {
              e.preventDefault();
              addCurve(true);
            }}
          >
            <span
              className="graph-draft-color"
              style={{ color: colors[curves.length % colors.length] }}
              aria-hidden="true"
            />
            <MathInput
              name="expression"
              ref={newInput}
              label="New graph expression"
              onFocus={() => setFocusedExpression(-1)}
              onBlur={() => {
                setFocusedExpression(null);
                addCurve();
              }}
              required
              value={added?.saved === savedSignature ? added.source : ''}
              validate={(source) => {
                graphFunction(source);
              }}
              onChange={(source) =>
                setAdded((previous) => ({
                  saved: savedSignature,
                  ...previewGraphDraft(
                    previous?.saved === savedSignature
                      ? previous.expression
                      : '',
                    source,
                  ),
                }))
              }
              onEscape={() => {
                pendingAdd.current = false;
                restoreAddFocus.current = true;
                setAdded(undefined);
                setAdding(false);
              }}
            />
            <span className="graph-remove-space" aria-hidden="true" />
            {focusedExpression !== -1 &&
              added?.saved === savedSignature &&
              added.error && (
                <span className="graph-draft-error">{added.error}</span>
              )}
          </form>
        )}
        <button
          ref={addButton}
          type="button"
          className="graph-add-button"
          disabled={curves.length >= 8}
          onClick={() => {
            if (adding) newInput.current?.focus();
            else {
              pendingAdd.current = true;
              setAdding(true);
            }
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Add expression
        </button>
      </GraphExpressionPanel>
      <div className="chart-wrap">
        <RendererCanvas
          capture={capture}
          {...renderData}
          recordingMotion={recordingMotion}
          curveMotion={
            recordingMotion ? curveMotionKey(previewCurves) : undefined
          }
          interactive={interactive}
          onRendered={onRendered}
          onSelect={(point) =>
            onCommand(`trace graph ${index + 1} at x ${point.x}`)
          }
          onViewport={(bounds) =>
            onCommand(
              `view x ${bounds.min} to ${bounds.max} y ${bounds.y!.min} to ${bounds.y!.max}`,
            )
          }
        />
      </div>
    </div>
  );
}

export function GraphView(
  props: Parameters<typeof LegacyGraphView>[0] & { scene?: GraphScene },
) {
  return props.scene ? (
    <Suspense fallback={<output>Opening graph…</output>}>
      <SceneView
        capture={props.capture}
        controls={props.controls}
        scene={props.scene}
        x={props.range ?? defaultGraphRange}
        y={props.yRange ?? defaultGraphRange}
        onCommand={props.onCommand}
        onRendered={props.onRendered}
        interactive={props.interactive ?? true}
      />
    </Suspense>
  ) : (
    <LegacyGraphView {...props} />
  );
}
