'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GraphExpressionPanel,
  GraphVisibility,
  useGraphVisibility,
} from './graph-expression-panel.tsx';
import { Plus, X } from 'lucide-react';
import './graph-controls.css';
import { RendererCanvas } from './renderer-canvas.tsx';
import { MathInput } from '../../math/ui.ts';
import { parseMath, evaluateMath } from '../../math/index.ts';
import { compileGraphScene, type GraphScene } from '../services/graph-scene.ts';
import { graphSceneRenderData } from '../services/graph-scene-renderer.ts';
import { graphColors } from '../services/renderer-adapter.ts';
import type { GraphRange } from '../services/graph.ts';

/** Previews complete valid edits and saves them through the shared command path; invalid input retains the saved graph. */
export function GraphSceneView({
  scene,
  x,
  y,
  onCommand,
  onRendered,
  capture = false,
  controls = true,
  interactive,
}: {
  capture?: boolean;
  controls?: boolean;
  scene: GraphScene;
  x: GraphRange;
  y: GraphRange;
  onCommand: (command: string) => void;
  onRendered?: () => void;
  interactive: boolean;
}) {
  const signature = JSON.stringify(scene);
  const kinds = useMemo(
    () => compileGraphScene(scene).rows.map((row) => row.kind),
    [scene],
  );
  const [drafts, setDrafts] = useState<
    Record<number, { source: string; error: string }>
  >({});
  const [adding, setAdding] = useState(false);
  const newInput = useRef<{ focus(): void }>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const { hidden, toggle } = useGraphVisibility(
    scene.rows.map((row) => row.expression),
  );
  const [added, setAdded] = useState('');
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
  const [error, setError] = useState('');
  const signatureRef = useRef(signature);
  const command = useRef(onCommand);
  useEffect(() => {
    command.current = onCommand;
    signatureRef.current = signature;
  }, [onCommand, signature]);
  // Switching problems or accepting saved edits cancels superseded drafts and their pending autosave.
  const [lastSignature, setLastSignature] = useState(signature);
  if (lastSignature !== signature) {
    setLastSignature(signature);
    setDrafts({});
    setAdding(false);
    setAdded('');
    setError('');
  }
  const preview = useMemo(() => {
    const rows = scene.rows.map((row, i) =>
      drafts[i] && !drafts[i].error
        ? { ...row, expression: drafts[i].source }
        : row,
    );
    try {
      compileGraphScene({ rows });
      return { rows };
    } catch {
      return scene;
    }
  }, [scene, drafts]);
  const rendered = useMemo(() => {
    try {
      const data = graphSceneRenderData(preview, x, y);
      // Keep hidden definitions available to dependent expressions; only omit their drawing.
      data.result.plots = data.result.plots.filter(
        (plot) =>
          !hidden.some(
            (i) => plot.id === `scene-${i}` || plot.id === `scene-fill-${i}`,
          ),
      );
      data.result.labels = data.result.labels?.filter(
        (label) => !hidden.some((i) => preview.rows[i]?.name === label.text),
      );
      return { data, error: '' };
    } catch (cause) {
      return {
        data: null,
        error:
          cause instanceof Error
            ? cause.message
            : 'This view could not be calculated.',
      };
    }
  }, [preview, x, y, hidden]);
  useEffect(() => {
    const edits = Object.entries(drafts).filter(
      ([i, draft]) =>
        !draft.error &&
        scene.rows[Number(i)] &&
        draft.source.trim() !== scene.rows[Number(i)].expression.trim(),
    );
    if (edits.length !== 1) return;
    const [i, draft] = edits[0];
    const timer = setTimeout(() => {
      if (signatureRef.current === signature)
        command.current(`edit graph ${Number(i) + 1} to ${draft.source}`);
    }, 600);
    return () => clearTimeout(timer);
  }, [drafts, scene, signature]);
  const add = (restoreFocus = false) => {
    try {
      if (!pendingAdd.current || !added.trim()) return;
      compileGraphScene({ rows: [...scene.rows, { expression: added }] });
      pendingAdd.current = false;
      restoreAddFocus.current = restoreFocus;
      setFocusedExpression(null);
      onCommand(`add graph ${added}`);
      setAdded('');
      setAdding(false);
      setError('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Check the expression.',
      );
    }
  };
  const visibleError =
    focusedExpression === -1
      ? ''
      : error || (focusedExpression === null ? rendered.error : '');
  if (!controls)
    return rendered.data ? (
      <RendererCanvas
        capture={capture}
        {...rendered.data}
        interactive={interactive}
        onRendered={onRendered}
        onViewport={(bounds) =>
          onCommand(
            `view x ${bounds.min} to ${bounds.max} y ${bounds.y!.min} to ${bounds.y!.max}`,
          )
        }
      />
    ) : (
      <p role="alert">{rendered.error}</p>
    );
  return (
    <div className="graph-studio graph-scene-studio learnunlock-controls">
      <GraphExpressionPanel>
        {scene.rows.map((row, i) => (
          <form
            key={i}
            className="graph-expression graph-scene-expression"
            onSubmit={(event) => {
              event.preventDefault();
              const value = drafts[i];
              if (value && !value.error && value.source !== row.expression)
                onCommand(`edit graph ${i + 1} to ${value.source}`);
            }}
          >
            <GraphVisibility
              index={i}
              color={graphColors[i % graphColors.length]}
              hidden={hidden.includes(i)}
              onToggle={() => toggle(i)}
            />
            <MathInput
              label={`Graph expression ${i + 1}`}
              graph
              value={drafts[i]?.source ?? row.expression}
              required
              onChange={(source) => {
                let message = '';
                try {
                  compileGraphScene({
                    rows: scene.rows.map((r, index) =>
                      index === i ? { ...r, expression: source } : r,
                    ),
                  });
                } catch (cause) {
                  message =
                    cause instanceof Error
                      ? cause.message
                      : 'Complete the expression.';
                }
                setDrafts({ [i]: { source, error: message } });
              }}
              onEscape={() => setDrafts({})}
              onFocus={() => setFocusedExpression(i)}
              onBlur={() => setFocusedExpression(null)}
              invalid={focusedExpression !== i && Boolean(drafts[i]?.error)}
              describedBy={
                focusedExpression !== i && drafts[i]?.error
                  ? `scene-error-${i}`
                  : undefined
              }
            />
            <button
              type="button"
              className="graph-remove"
              aria-label={`Remove graph ${i + 1}`}
              disabled={scene.rows.length === 1}
              title={
                scene.rows.length === 1
                  ? 'Keep at least one expression'
                  : undefined
              }
              onClick={() => onCommand(`remove graph ${i + 1}`)}
            >
              <X size={16} aria-hidden="true" />
            </button>
            {(kinds[i] === 'polar' || kinds[i] === 'parametric') && (
              <details className="graph-parameter-domain">
                <summary>Parameter range</summary>
                <MathInput
                  key={`parameter-min-${row.domain?.min ?? 0}`}
                  name="parameter-min"
                  label={`Parameter minimum for graph row ${i + 1}`}
                  defaultValue={String(row.domain?.min ?? 0)}
                  numeric
                />
                <MathInput
                  key={`parameter-max-${row.domain?.max ?? 2 * Math.PI}`}
                  name="parameter-max"
                  label={`Parameter maximum for graph row ${i + 1}`}
                  defaultValue={String(row.domain?.max ?? 2 * Math.PI)}
                  numeric
                />
                <button
                  type="button"
                  className="soft-button"
                  onClick={(event) => {
                    try {
                      const data = new FormData(event.currentTarget.form!);
                      const lower = data.get('parameter-min'),
                        upper = data.get('parameter-max');
                      if (
                        typeof lower !== 'string' ||
                        typeof upper !== 'string'
                      )
                        throw new Error('Enter both parameter bounds.');
                      const min = evaluateMath(parseMath(lower)),
                        max = evaluateMath(parseMath(upper));
                      compileGraphScene({
                        rows: scene.rows.map((r, index) =>
                          index === i ? { ...r, domain: { min, max } } : r,
                        ),
                      });
                      onCommand(
                        `typescript\nproblem.save(graph.domain(graph.current(${i + 1}),${min},${max}));`,
                      );
                      setError('');
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'Check the parameter range.',
                      );
                    }
                  }}
                >
                  Set parameter range
                </button>
              </details>
            )}
            {focusedExpression !== i && drafts[i]?.error && (
              <output id={`scene-error-${i}`} className="graph-draft-error">
                {drafts[i].error} The last saved graph is still shown.
              </output>
            )}
          </form>
        ))}
        {adding && scene.rows.length < 24 && (
          <form
            className="graph-expression graph-add"
            onSubmit={(event) => {
              event.preventDefault();
              add(true);
            }}
          >
            <span
              className="graph-draft-color"
              style={{
                color: graphColors[scene.rows.length % graphColors.length],
              }}
              aria-hidden="true"
            />
            <MathInput
              ref={newInput}
              label="New graph expression"
              graph
              value={added}
              onFocus={() => setFocusedExpression(-1)}
              onBlur={() => {
                setFocusedExpression(null);
                add();
              }}
              onChange={(source) => {
                setAdded(source);
                setError('');
              }}
              onEscape={() => {
                pendingAdd.current = false;
                restoreAddFocus.current = true;
                setAdded('');
                setError('');
                setAdding(false);
              }}
            />
            <span className="graph-remove-space" aria-hidden="true" />
          </form>
        )}
        <button
          ref={addButton}
          type="button"
          className="graph-add-button"
          disabled={scene.rows.length >= 24}
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
        {visibleError && (
          <p className="graph-draft-error" role="alert">
            {visibleError} Your saved work is unchanged.
          </p>
        )}
      </GraphExpressionPanel>
      <div className="chart-wrap">
        {rendered.data && (
          <RendererCanvas
            capture={capture}
            {...rendered.data}
            interactive={interactive}
            onRendered={onRendered}
            onViewport={(bounds) =>
              onCommand(
                `view x ${bounds.min} to ${bounds.max} y ${bounds.y!.min} to ${bounds.y!.max}`,
              )
            }
          />
        )}
      </div>
    </div>
  );
}
