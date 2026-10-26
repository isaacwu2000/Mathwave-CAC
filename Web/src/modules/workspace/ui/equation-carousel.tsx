'use client';
import { createElement, useEffect, useRef, useState } from 'react';
import { parseMath, speakMath } from '../../math/index.ts';
import { MathInput } from '../../math/ui.ts';
import { GraphSceneNotation, mathElement } from '../../visuals/ui.ts';
import { otherBranches, type Problem } from '../../problems/index.ts';

function Equation({ expression }: { expression: string }) {
  const node = parseMath(expression);
  return (
    <span className="step-equation">
      {createElement(
        'math',
        { 'aria-label': speakMath(node) },
        mathElement(node),
      )}
    </span>
  );
}
export function EquationCarousel({
  problem,
  focused,
  onFocus,
  onRevise,
  onBranch,
  busy,
  revisionStorage,
  holdActions = false,
  onStepAction,
}: {
  problem: Problem;
  focused: number;
  onFocus: (index: number) => void;
  onRevise: (step: number, expression: string) => Promise<void>;
  onBranch: (index: number) => Promise<void>;
  busy: boolean;
  holdActions?: boolean;
  onStepAction?: (step: number, action: 'read' | 'remove') => void;
  revisionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}) {
  type Revision = { step: number; at: string; expression: string };
  const storage =
    revisionStorage ??
    (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const draftKey = `mathwave-revision:${problem.id}`;
  const [revision, setRevision] = useState<Revision | null>(() => {
    try {
      const value = JSON.parse(storage?.getItem(draftKey) || 'null');
      return value &&
        Number.isInteger(value.step) &&
        typeof value.at === 'string' &&
        typeof value.expression === 'string'
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const keepRevision = (value: Revision | null) => {
    setRevision(value);
    try {
      if (value) storage?.setItem(draftKey, JSON.stringify(value));
      else storage?.removeItem(draftKey);
    } catch {
      /* Keep unsent work in memory when storage is unavailable. */
    }
  };
  const editing = revision !== null;
  const expression = revision?.expression || '';
  const [failure, setFailure] = useState('');
  const [branchesOpen, setBranchesOpen] = useState(false);
  const scroll = useRef<HTMLElement>(null);
  const rows = useRef(new Map<number, HTMLButtonElement>());
  const branchField = useRef<{ focus(): void }>(null);
  const branches = otherBranches(problem);
  const centerStep = (index: number) => {
    const row = rows.current.get(index),
      container = scroll.current;
    if (!row || !container) return;
    container.scrollTo({
      top:
        row.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        (container.clientHeight - row.clientHeight) / 2,
      behavior: 'instant',
    });
  };
  const scrollSize = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Only resize should recenter instantly; clicking retains its smooth motion.
      if (
        width === scrollSize.current.width &&
        height === scrollSize.current.height
      )
        return;
      scrollSize.current = { width, height };
      centerStep(focused);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [focused]);
  const latestStep = problem.steps.at(-1);
  useEffect(() => {
    centerStep(problem.steps.length - 1);
  }, [latestStep?.at, latestStep?.state.expression, problem.steps.length]);
  const focus = (index: number) => {
    onFocus(index);
    requestAnimationFrame(() => {
      const row = rows.current.get(index),
        container = scroll.current;
      if (!row || !container) return;
      const top =
        row.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        (container.clientHeight - row.clientHeight) / 2;
      container.scrollTo({
        top,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    });
  };
  const [contextStep, setContextStep] = useState<number>();
  // Undo or new work can remove the held step while native controls remain reachable.
  const contextRevision = `${latestStep?.at}:${problem.steps.length}`;
  const [lastContextRevision, setLastContextRevision] =
    useState(contextRevision);
  if (lastContextRevision !== contextRevision) {
    setLastContextRevision(contextRevision);
    if (contextStep !== undefined) setContextStep(undefined);
  }
  const menu = useRef<HTMLDialogElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStart = useRef({ x: 0, y: 0 });
  const cancelHold = () => clearTimeout(hold.current);
  useEffect(() => cancelHold, []);
  useEffect(() => {
    if (contextStep !== undefined) menu.current?.showModal();
  }, [contextStep]);
  const openOptions = (index: number) => {
    cancelHold();
    focus(index);
    setContextStep(index);
  };
  const startRevision = (index: number) => {
    const step = problem.steps[index];
    focus(index);
    keepRevision({
      step: index + 1,
      at: step.at,
      expression: step.state.expression,
    });
    setFailure('');
    requestAnimationFrame(() => branchField.current?.focus());
  };
  return (
    <section className="worksheet-equations" aria-label="Equation steps">
      <section
        className="equation-scroll"
        ref={scroll}
        aria-label="Scroll equation steps"
      >
        <ol className="equation-carousel">
          {problem.steps
            .map((step, index) => ({ step, index }))
            .filter(({ step }) => step.state.mode === 'equation')
            .reverse()
            .map(({ step, index }) => (
              <li key={`${step.at}-${index}`} data-focused={index === focused}>
                <button
                  ref={(element) => {
                    if (element) rows.current.set(index, element);
                    else rows.current.delete(index);
                  }}
                  className="equation-step"
                  aria-label={`Focus step ${index + 1}: ${step.state.graphScene ? step.state.graphScene.rows.map((row) => row.expression).join('; ') : step.state.expression}`}
                  aria-current={index === focused ? 'step' : undefined}
                  aria-haspopup={holdActions ? 'dialog' : undefined}
                  onContextMenu={
                    holdActions
                      ? (event) => {
                          event.preventDefault();
                          openOptions(index);
                        }
                      : undefined
                  }
                  onPointerDown={
                    holdActions
                      ? (event) => {
                          if (event.button !== 0) return;
                          cancelHold();
                          pointerStart.current = {
                            x: event.clientX,
                            y: event.clientY,
                          };
                          hold.current = setTimeout(
                            () => openOptions(index),
                            500,
                          );
                        }
                      : undefined
                  }
                  onPointerMove={
                    holdActions
                      ? (event) => {
                          if (
                            Math.hypot(
                              event.clientX - pointerStart.current.x,
                              event.clientY - pointerStart.current.y,
                            ) > 8
                          )
                            cancelHold();
                        }
                      : undefined
                  }
                  onPointerUp={cancelHold}
                  onPointerCancel={cancelHold}
                  onPointerLeave={cancelHold}
                  onKeyDown={
                    holdActions
                      ? (event) => {
                          if (
                            event.key === 'ContextMenu' ||
                            (event.shiftKey && event.key === 'F10')
                          ) {
                            event.preventDefault();
                            openOptions(index);
                          }
                        }
                      : undefined
                  }
                  onClick={() => focus(index)}
                >
                  <span className="step-number">{index + 1}</span>
                  {step.state.mode === 'equation' ? (
                    step.state.graphScene ? (
                      <GraphSceneNotation scene={step.state.graphScene} />
                    ) : (
                      <Equation expression={step.state.expression} />
                    )
                  ) : (
                    <span className="step-description">
                      {step.displayCommand || step.command}
                    </span>
                  )}
                </button>
              </li>
            ))}
        </ol>
      </section>
      <div className="worksheet-actions">
        {!holdActions && branches.length > 0 && (
          <button
            className="branch-link"
            aria-expanded={branchesOpen}
            onClick={() => setBranchesOpen(!branchesOpen)}
          >
            {branchesOpen ? 'Hide saved versions' : 'View saved version'}
          </button>
        )}
      </div>
      {contextStep !== undefined && problem.steps[contextStep] && (
        <dialog
          ref={menu}
          className="step-options"
          aria-label={`Step ${contextStep + 1} options`}
          onCancel={() => setContextStep(undefined)}
          onClose={() => setContextStep(undefined)}
        >
          {problem.steps[contextStep].state.mode === 'equation' &&
            !problem.steps[contextStep].state.graphScene && (
              <button
                disabled={busy}
                onClick={() => {
                  startRevision(contextStep);
                  setContextStep(undefined);
                }}
              >
                Edit step {contextStep + 1}
              </button>
            )}
          {onStepAction && (
            <button
              onClick={() => {
                onStepAction(contextStep + 1, 'read');
                setContextStep(undefined);
              }}
            >
              Read step
            </button>
          )}
          {branches.length > 0 && (
            <button
              onClick={() => {
                setBranchesOpen(true);
                setContextStep(undefined);
              }}
            >
              View saved versions
            </button>
          )}
          {onStepAction && (
            <button
              disabled={busy}
              onClick={() => {
                onStepAction(contextStep + 1, 'remove');
                setContextStep(undefined);
              }}
            >
              Remove step
            </button>
          )}
          <button onClick={() => setContextStep(undefined)}>Cancel</button>
        </dialog>
      )}
      {failure && !editing && !branchesOpen && <p role="alert">{failure}</p>}
      {editing && (
        <form
          className="revision-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            setFailure('');
            try {
              await onRevise(revision!.step, expression);
              keepRevision(null);
              requestAnimationFrame(() =>
                rows.current.get(revision!.step - 1)?.focus(),
              );
            } catch {
              setFailure(
                'This revision could not be saved. Check the equation and retry saving before submitting again.',
              );
            }
          }}
        >
          <label htmlFor="revision-equation">Edit step {revision!.step}</label>
          <MathInput
            ref={branchField}
            id="revision-equation"
            label={`Equation for step ${revision!.step}`}
            value={expression}
            onChange={(value) =>
              keepRevision({ ...revision!, expression: value })
            }
            validate={(source) => {
              if (parseMath(source).kind !== 'equation')
                throw new Error('Enter an equation with an equals sign.');
            }}
          />
          <p>Your previous work stays saved in history.</p>
          {problem.steps[revision!.step - 1]?.at !== revision!.at && (
            <p role="alert">
              This step is in another saved version. Your draft is kept; restore
              that version to save it.
            </p>
          )}
          {failure && <p role="alert">{failure}</p>}
          <div className="worksheet-actions">
            <button
              className="primary-button"
              disabled={
                busy ||
                !expression.trim() ||
                problem.steps[revision!.step - 1]?.at !== revision!.at
              }
            >
              Save edit
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                const step = revision!.step - 1;
                keepRevision(null);
                requestAnimationFrame(() => rows.current.get(step)?.focus());
              }}
            >
              Cancel edit
            </button>
          </div>
        </form>
      )}
      {branchesOpen && (
        <div className="other-branches" aria-label="Saved versions">
          {branches.map((branch, index) => (
            <div key={index}>
              <p>Saved version · {branch.steps.length} steps</p>
              {branch.state.mode === 'equation' &&
                (branch.state.graphScene ? (
                  <GraphSceneNotation scene={branch.state.graphScene} />
                ) : (
                  <Equation expression={branch.state.expression} />
                ))}
              <button
                className="soft-button"
                disabled={busy}
                onClick={() => {
                  void onBranch(index)
                    .then(() => {
                      setBranchesOpen(false);
                      requestAnimationFrame(() => {
                        const current =
                          scroll.current?.querySelector<HTMLButtonElement>(
                            '[aria-current="step"]',
                          );
                        current?.focus();
                      });
                    })
                    .catch(() =>
                      setFailure(
                        'Could not restore that version. Retry saving.',
                      ),
                    );
                }}
              >
                Restore this version
              </button>
            </div>
          ))}
          {failure && <p role="alert">{failure}</p>}
        </div>
      )}
    </section>
  );
}
