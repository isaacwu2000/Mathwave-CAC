'use client';
import { createElement, useId } from 'react';
import { explorationView, type Exploration } from '../services/exploration.ts';
import { graphSegments, graphValueTable } from '../services/graph.ts';
import { parseMath, displayNumber } from '../../math/index.ts';
import { mathElement } from './math-and-data.tsx';
const colors = ['#6558d3', '#b83e53', '#087461'];
export function ExplorationView({
  lesson,
  onChange,
  onSpeak,
  onDismiss,
}: {
  lesson: Exploration;
  onChange: (name: string, value: number) => void;
  onSpeak: (text: string) => void;
  onDismiss: () => void;
}) {
  const id = useId(),
    view = explorationView(lesson);
  const x = (v: number) =>
    40 +
    ((v - lesson.xRange.min) / (lesson.xRange.max - lesson.xRange.min)) * 520;
  const y = (v: number) =>
    240 -
    ((v - lesson.yRange.min) / (lesson.yRange.max - lesson.yRange.min)) * 220;
  const summary = [
    lesson.title,
    lesson.description,
    ...lesson.controls.map((c) => `${c.label}: ${c.value}.`),
    ...view.readouts.map((r) => `${r.label}: ${r.value ?? r.spoken}.`),
    ...view.plots.map(
      (p, i) =>
        `Curve ${i + 1}: ${p}. ${graphValueTable(p, lesson.xRange)
          .map(
            (v) =>
              `At x ${displayNumber(v.x)}, y ${v.y === null ? 'undefined' : displayNumber(v.y)}`,
          )
          .join('. ')}.`,
    ),
  ].join(' ');
  return (
    <section className="exploration-card" aria-labelledby={`${id}-title`}>
      <div className="exploration-heading">
        <h2 id={`${id}-title`}>{lesson.title}</h2>
        <button
          className="text-button"
          onClick={onDismiss}
          aria-label="Close interactive explanation"
        >
          Close
        </button>
      </div>
      <p>{lesson.description}</p>
      {lesson.controls.map((c) => (
        <div className="exploration-control" key={c.name}>
          <label htmlFor={`${id}-${c.name}`}>
            {c.label} <span>{displayNumber(c.value)}</span>
          </label>
          <input
            id={`${id}-${c.name}`}
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={c.value}
            aria-valuetext={`${c.label}: ${displayNumber(c.value)}`}
            onChange={(e) => onChange(c.name, Number(e.target.value))}
          />
        </div>
      ))}
      <div
        className="exploration-readouts"
        aria-live="polite"
        aria-atomic="true"
      >
        {view.readouts.map((r, i) => (
          <div key={i}>
            <strong>{r.label}</strong>
            {createElement(
              'math',
              { 'aria-label': r.spoken, display: 'block' },
              mathElement(parseMath(r.expression)),
            )}
            {r.value && <output>{r.value}</output>}
          </div>
        ))}
      </div>
      {view.plots.length > 0 && (
        <>
          <svg
            viewBox="0 0 600 270"
            aria-label={`Interactive graph. ${view.plots.map((p, i) => `Curve ${i + 1}: ${p}`).join('. ')}. Exact sampled values are in the table below.`}
          >
            <defs>
              <clipPath id={`${id}-clip`}>
                <rect x="40" y="20" width="520" height="220" />
              </clipPath>
            </defs>
            <rect x="40" y="20" width="520" height="220" fill="#f7f7fc" />
            <g clipPath={`url(#${id}-clip)`}>
              <path d={`M40 ${y(0)}H560 M${x(0)} 20V240`} stroke="#c8c8d5" />
              {view.plots.map((p, i) => (
                <path
                  key={i}
                  d={graphSegments(p, lesson.xRange)
                    .map((v) =>
                      v.y === null
                        ? ''
                        : `${v.breakBefore ? 'M' : 'L'}${x(v.x).toFixed(2)},${y(Math.max(-1e6, Math.min(1e6, v.y))).toFixed(2)}`,
                    )
                    .join(' ')}
                  fill="none"
                  stroke={colors[i]}
                  strokeWidth="2.5"
                  strokeDasharray={
                    i === 1 ? '7 4' : i === 2 ? '2 4' : undefined
                  }
                />
              ))}
            </g>
            <text x="40" y="260" fontSize="12">
              x: {lesson.xRange.min} to {lesson.xRange.max} · y:{' '}
              {lesson.yRange.min} to {lesson.yRange.max}
            </text>
          </svg>
          <details>
            <summary>Equations and values</summary>
            {view.plots.map((p, i) => (
              <div key={i}>
                <p>
                  Curve {i + 1}: {p}
                </p>
                <table>
                  <caption>Curve {i + 1} sampled values</caption>
                  <thead>
                    <tr>
                      <th scope="col">x</th>
                      <th scope="col">y</th>
                    </tr>
                  </thead>
                  <tbody>
                    {graphValueTable(p, lesson.xRange).map((v, j) => (
                      <tr key={j}>
                        <td>{displayNumber(v.x)}</td>
                        <td>
                          {v.y === null ? 'Undefined' : displayNumber(v.y)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </details>
        </>
      )}
      <button className="soft-button" onClick={() => onSpeak(summary)}>
        Read explanation and values
      </button>
    </section>
  );
}
