'use client';
import { useId, useMemo } from 'react';
import { ConstructionView } from './construction-view.tsx';
import { MathInput } from '../../math/ui.ts';
import { RendererCanvas } from './renderer-canvas.tsx';
import { geometryRenderData } from '../services/geometry-renderer.ts';
import './graph-controls.css';
import {
  triangleDiagram,
  type TriangleOverlay,
} from '../services/triangle-diagram.ts';
import {
  describeGeometry,
  geometryMeasures,
  type Geometry,
} from '../services/geometry.ts';
import { displayNumber } from '../../math/index.ts';
export function GeometryView({
  geometry: g,
  construction,
  onCommand,
  canUndo,
  overlay,
  onRendered,
  capture = false,
  controls = true,
}: {
  capture?: boolean;
  controls?: boolean;
  geometry?: Geometry;
  construction?: string;
  canUndo: boolean;
  overlay?: TriangleOverlay;
  onRendered?: () => void;
  onCommand: (command: string) => void;
}) {
  const inputId = useId();
  const renderData = useMemo(
    () => (g ? geometryRenderData(g, overlay) : null),
    [g, overlay],
  );
  if (construction)
    return (
      <ConstructionView
        capture={capture}
        controls={controls}
        source={construction}
        canUndo={canUndo}
        onCommand={onCommand}
        onRendered={onRendered}
      />
    );
  if (!g || !renderData) return null;
  const d = g.dimensions;
  const measures = Object.keys(geometryMeasures(g));
  const advanced = measures.filter((metric) =>
    /^(inradius|circumradius|altitude [abc]|median [abc])$/.test(metric),
  );
  const segmentDescription =
    g.shape === 'sector'
      ? `Shaded circular segment between the specified arc and its chord: ${displayNumber(geometryMeasures(g)['segment area'].value)} square units.`
      : '';
  const diagram = triangleDiagram(g, overlay);
  if (!controls)
    return (
      <RendererCanvas
        capture={capture}
        {...renderData}
        interactive={false}
        onRendered={onRendered}
      />
    );
  const overlayDescription =
    diagram && overlay
      ? overlay === 'centroid'
        ? 'Centroid: intersection of three medians, two thirds from each vertex toward the opposite midpoint.'
        : `${overlay}: ${displayNumber(diagram.value!)} units. ${overlay === 'inradius' ? 'Circle tangent to all three sides.' : overlay === 'circumradius' ? 'Circle through all three vertices.' : overlay.startsWith('median') ? `From the opposite vertex to the midpoint of side ${overlay.slice(-1)}.` : `Perpendicular from the opposite vertex to side ${overlay.slice(-1)}${diagram.altitude?.outside ? ', extended outside the triangle' : ''}.`}`
      : '';
  return (
    <section
      className="problem-canvas learnunlock-controls"
      aria-label="Current geometry"
    >
      <div className="geometry-header">
        <div>
          <span className="eyebrow">GEOMETRY</span>
          <h2>{g.shape[0].toUpperCase() + g.shape.slice(1)}</h2>
        </div>
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
        <figcaption>
          {describeGeometry(g)} {overlayDescription} {segmentDescription}{' '}
          {[
            'cube',
            'rectangular prism',
            'sphere',
            'cylinder',
            'cone',
            'parallelogram',
            'trapezoid',
          ].includes(g.shape) || 'base' in d
            ? 'Schematic view.'
            : ''}
        </figcaption>
      </figure>
      <dl className="geometry-dimensions">
        {Object.entries(d).map(([key, value]) => (
          <div key={key}>
            <dt>
              {g.shape === 'right triangle' ? 'Leg ' : ''}
              {['outer', 'inner'].includes(key) ? `${key} radius` : key}
            </dt>
            <dd>
              {displayNumber(value)}
              {key === 'sides'
                ? ' sides'
                : key === 'angle'
                  ? ' degrees'
                  : ' units'}
            </dd>
          </div>
        ))}
      </dl>
      <details className="geometry-editor">
        <summary>Edit dimensions</summary>
        <form
          key={`${g.shape}:${JSON.stringify(d)}`}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const values = Object.keys(d).map((key) => {
              const value = form.get(key);
              return [key, typeof value === 'string' ? value : ''] as const;
            });
            if (values.every(([key, value]) => Number(value) === d[key]))
              return;
            onCommand(
              `${g.shape} ${values.map(([key, value]) => `${key} ${value}`).join(' ')}`,
            );
          }}
        >
          {Object.entries(d).map(([key, value]) => (
            <label key={key} htmlFor={`${inputId}-${key}`}>
              {g.shape === 'trapezoid' && ['a', 'b'].includes(key)
                ? `Parallel base ${key}`
                : key === 'height' &&
                    ['triangle', 'parallelogram', 'trapezoid'].includes(g.shape)
                  ? 'Perpendicular height'
                  : ['outer', 'inner'].includes(key)
                    ? `${key} radius`
                    : key}
              <MathInput
                id={`${inputId}-${key}`}
                numeric
                label={key}
                name={key}
                required
                min={key === 'sides' ? 3 : 0}
                max={key === 'sides' ? 50 : key === 'angle' ? 360 : 1000000}
                integer={key === 'sides'}
                defaultValue={value}
              />
            </label>
          ))}
          <button className="soft-button" type="submit">
            Save dimensions
          </button>
        </form>
      </details>
      <div className="geometry-actions">
        {['triangle', 'right triangle'].includes(g.shape) && (
          <button
            className="soft-button"
            onClick={() => onCommand('classify triangle')}
          >
            Classify triangle
          </button>
        )}
        <button
          className="soft-button"
          onClick={() => onCommand('scale shape by 2')}
        >
          Double size
        </button>
        <button
          className="soft-button"
          onClick={() => onCommand('scale shape by 0.5')}
        >
          Half size
        </button>
        <button
          className="soft-button"
          onClick={() => onCommand('describe shape')}
        >
          Read shape
        </button>
        {measures
          .filter((metric) => !advanced.includes(metric))
          .map((metric) => (
            <button
              className="soft-button"
              key={metric}
              onClick={() => onCommand(metric)}
            >
              Find {metric}
            </button>
          ))}
      </div>
      {advanced.length > 0 && (
        <details className="geometry-editor">
          <summary>Triangle constructions</summary>
          <div className="geometry-actions">
            {overlay && (
              <button
                className="soft-button"
                onClick={() => onCommand('hide construction')}
              >
                Hide construction
              </button>
            )}
            <button
              className="soft-button"
              aria-pressed={overlay === 'centroid'}
              onClick={() => onCommand('show centroid')}
            >
              Show centroid
            </button>
            {advanced.map((metric) => (
              <button
                className="soft-button"
                key={metric}
                aria-pressed={overlay === metric}
                onClick={() => onCommand(metric)}
              >
                {metric === 'inradius'
                  ? 'Inscribed circle radius'
                  : metric === 'circumradius'
                    ? 'Circumscribed circle radius'
                    : metric.startsWith('median')
                      ? `Median to side ${metric.slice(-1)}`
                      : `Height to side ${metric.slice(-1)}`}
              </button>
            ))}
          </div>
        </details>
      )}
      <p className="geometry-hint">
        Change a dimension with “set{' '}
        {Object.keys(d).find((key) => key !== 'sides')} to five”.
      </p>
    </section>
  );
}
