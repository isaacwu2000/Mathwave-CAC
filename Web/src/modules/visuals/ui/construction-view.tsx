'use client';
import { useMemo, useState } from 'react';
import { RendererCanvas } from './renderer-canvas.tsx';
import { constructionRenderData } from '../services/construction-renderer.ts';
import {
  describeConstructionValue,
  validateConstruction,
  editConstruction,
} from '../services/construction.ts';
import { MathInput } from '../../math/ui.ts';
import { evaluateMath, parseMath } from '../../math/index.ts';
import './graph-controls.css';

/** Shows computed geometry and commits point edits through the same validated command path as voice. */
export function ConstructionView({
  source,
  canUndo,
  onCommand,
  onRendered,
  capture = false,
  controls = true,
}: {
  capture?: boolean;
  controls?: boolean;
  source: string;
  canUndo: boolean;
  onCommand: (command: string) => void;
  onRendered?: () => void;
}) {
  const compiled = useMemo(() => validateConstruction(source), [source]);
  const renderData = useMemo(
    () => constructionRenderData(source, compiled),
    [source, compiled],
  );
  const points = [...compiled.values].filter(
    ([name, value]) =>
      value.kind === 'point' &&
      new RegExp(`^\\s*${name}\\s*=\\s*point\\(`, 'm').test(source),
  );
  const description = [...compiled.values]
    .map(([name, value]) => describeConstructionValue(name, value))
    .join(' ');
  const [error, setError] = useState('');
  if (!controls)
    return (
      <RendererCanvas
        capture={capture}
        {...renderData}
        interactive={false}
        onRendered={onRendered}
      />
    );
  return (
    <section
      className="problem-canvas learnunlock-controls"
      aria-label="Current geometry"
    >
      <div className="geometry-header">
        <h2>Construction</h2>
        <button
          className="soft-button"
          disabled={!canUndo}
          onClick={() => onCommand('undo')}
        >
          Undo last change
        </button>
      </div>
      <figure className="geometry-figure">
        <RendererCanvas
          capture={capture}
          {...renderData}
          interactive={false}
          onRendered={onRendered}
        />
        <figcaption>{description}</figcaption>
      </figure>
      <details className="geometry-editor">
        <summary>Edit named points</summary>
        {points.map(
          ([name, value]) =>
            value.kind === 'point' && (
              <form
                key={`${name}-${source}`}
                className="construction-point"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    const data = new FormData(event.currentTarget);
                    const rawX = data.get('x'),
                      rawY = data.get('y');
                    if (typeof rawX !== 'string' || typeof rawY !== 'string')
                      throw new Error('Enter both coordinates.');
                    const x = evaluateMath(parseMath(rawX)),
                      y = evaluateMath(parseMath(rawY));
                    const next = `point(${x},${y})`;
                    // Check dependencies here for immediate feedback; the server repeats validation before saving.
                    editConstruction(source, name, next);
                    setError('');
                    onCommand(
                      `typescript\nproblem.save(geometry.editObject(geometry.current(),${JSON.stringify(name)},${JSON.stringify(next)}));`,
                    );
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : 'Check these coordinates.',
                    );
                  }
                }}
              >
                <span>{name}</span>
                <MathInput
                  name="x"
                  label={`${name} x coordinate`}
                  defaultValue={String(value.x)}
                  required
                />
                <MathInput
                  name="y"
                  label={`${name} y coordinate`}
                  defaultValue={String(value.y)}
                  required
                />
                <button className="soft-button">Move {name}</button>
              </form>
            ),
        )}
        {error && (
          <p role="alert">{error} Your saved construction is unchanged.</p>
        )}
      </details>
      <button
        className="soft-button"
        onClick={() => onCommand('describe construction')}
      >
        Read construction
      </button>
    </section>
  );
}
