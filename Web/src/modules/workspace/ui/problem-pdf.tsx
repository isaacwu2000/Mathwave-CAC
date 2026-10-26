'use client';
import { createElement, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { parseMath } from '../../math/index.ts';
import {
  GraphView,
  GeometryView,
  GraphSceneNotation,
  Chart,
  mathElement,
} from '../../visuals/ui.ts';
import type { ProblemLibrary } from '../../problems/index.ts';
import type { Workspace } from '../types/index.ts';
import { planProblemsPdf } from '../services/pdf-plan.ts';
import './problem-pdf.css';

function Equation({ expression }: { expression: string }) {
  try {
    return createElement(
      'math',
      { display: 'block', 'aria-label': expression },
      mathElement(parseMath(expression)),
    );
  } catch {
    // Some graph collections have notation outside the equation parser's domain.
    return <p>{expression}</p>;
  }
}

/** Renders a saved state; signals completion only after its figure has finished drawing. */
export function ProblemPdfWork({
  state,
  ready,
  stepNumber,
}: {
  state: Workspace;
  ready: () => void;
  stepNumber?: number;
}) {
  const geometry =
    (state.mode === 'geometry' ||
      (state.mode === 'equation' && !state.graph)) &&
    Boolean(state.geometry || state.construction);
  const figure = geometry || (state.mode === 'equation' && state.graph);
  useEffect(() => {
    if (!figure) ready();
  }, [figure, ready]);
  return (
    <>
      {state.mode === 'equation' && (
        <div className="pdf-equation-row">
          <span
            className="pdf-step-number"
            aria-label={stepNumber ? `Step ${stepNumber}` : undefined}
          >
            {stepNumber}
          </span>
          <div className="pdf-equation-content">
            {state.graphScene ? (
              <GraphSceneNotation
                scene={state.retainedGraph ?? state.graphScene}
              />
            ) : (
              [state.expression, ...(state.graphExpressions || [])]
                .filter(Boolean)
                .map((expression, index) => (
                  <Equation key={index} expression={expression} />
                ))
            )}
          </div>
          <span aria-hidden="true" />
        </div>
      )}
      {state.mode === 'statistics' && (
        <>
          {createElement(
            'math',
            { display: 'block', 'aria-label': state.data.join(', ') },
            createElement(
              'mrow',
              {},
              state.data.flatMap((value, index) => [
                ...(index
                  ? [createElement('mo', { key: `comma-${index}` }, ',')]
                  : []),
                createElement('mn', { key: index }, value.toString()),
              ]),
            ),
          )}
          <Chart
            values={state.data}
            labels={state.data.map((_, i) => `${i + 1}`)}
            selected={-1}
            onSelect={() => {}}
          />
        </>
      )}
      {figure && (
        <div className="pdf-figure" data-coordinate={!geometry}>
          {geometry ? (
            <GeometryView
              geometry={state.geometry}
              construction={state.construction}
              overlay={state.geometryOverlay}
              canUndo={false}
              controls={false}
              capture
              onCommand={() => {}}
              onRendered={ready}
            />
          ) : (
            <GraphView
              expression={state.expression}
              expressions={state.graphExpressions}
              scene={state.retainedGraph ?? state.graphScene}
              range={state.graphRange}
              yRange={state.graphYRange}
              trace={state.graphTrace}
              comparisonPoints={state.graphComparison}
              interactive={false}
              controls={false}
              capture
              onCommand={() => {}}
              onRendered={ready}
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * - Downloads one selected problem or all problems from a copied library.
 * - Uses the app's math and figure renderers, one step at a time.
 * - Waits for complete figures and fonts; failures leave work intact.
 * - Releases the temporary tree and graph resources even when rendering fails.
 */
export async function downloadProblemsPdf(
  book: ProblemLibrary,
  problemId?: string,
) {
  const problems = planProblemsPdf(book, problemId);
  const title = problemId ? problems[0].title : 'All problems';
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  pdf.setProperties({
    title,
    subject: 'Mathwave saved work',
    creator: 'Mathwave',
  });
  const host = document.createElement('div');
  host.className = 'problem-pdf-host';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  document.body.appendChild(host);
  const viewport = document.createElement('div');
  const background = getComputedStyle(host).backgroundColor;
  viewport.style.cssText = `width:720px;overflow:hidden;background:${background}`;
  const mount = document.createElement('div');
  viewport.appendChild(mount);
  host.appendChild(viewport);
  const root = createRoot(mount);
  // Fill the paper itself, including margins and continuation pages, with the app surface.
  const paintPage = () => {
    pdf.setFillColor(background);
    pdf.rect(0, 0, 612, 792, 'F');
  };
  paintPage();
  let y = 42;
  let pageUsed = false;
  const nextPage = () => {
    pdf.addPage();
    paintPage();
    y = 42;
    pageUsed = false;
  };
  try {
    for (const [index, problem] of problems.entries()) {
      if (index && pageUsed) nextPage();
      const steps = problem.steps;
      const blocks: {
        content?: ReactNode;
        state?: Workspace;
        stepNumber?: number;
      }[] = [
        {
          content: (
            <header>
              <h1>{problem.title}</h1>
            </header>
          ),
        },
        ...steps.map((step, i) => ({ state: step.state, stepNumber: i + 1 })),
      ];
      for (const [blockIndex, block] of blocks.entries()) {
        let rendered = !block.state;
        flushSync(() =>
          root.render(
            <article
              key={`${index}-${blockIndex}`}
              className="problem-pdf-sheet"
            >
              {block.content}
              {block.state && (
                <ProblemPdfWork
                  state={block.state}
                  stepNumber={block.stepNumber}
                  ready={() => {
                    rendered = true;
                  }}
                />
              )}
            </article>,
          ),
        );
        const start = Date.now();
        while (!rendered) {
          if (
            host.querySelector('[role="alert"]') ||
            Date.now() - start > 20000
          )
            throw new Error(
              'A graph or diagram could not render. Please try exporting again.',
            );
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await document.fonts.ready;
        // Let text and figure labels reach the browser's next painted frame before capture.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const sheet = mount.firstElementChild as HTMLElement;
        // Fit wide equations before capture so nothing is silently clipped at the page edge.
        for (const node of sheet.querySelectorAll<HTMLElement>(
          'math, .graph-step-notation',
        )) {
          if (node.scrollWidth > 720)
            node.style.fontSize = `${Math.max(8, (24 * 720) / node.scrollWidth)}px`;
        }
        const height = sheet.getBoundingClientRect().height;
        const width = Math.max(720, sheet.scrollWidth);
        // Long work is captured in bounded pieces; keep equations and figures whole.
        const cuts = [0];
        if (height > 900) {
          const top = sheet.getBoundingClientRect().top;
          for (const child of sheet.children) {
            const bottom = child.getBoundingClientRect().bottom - top;
            if (bottom - cuts[cuts.length - 1] > 900) {
              const start = child.getBoundingClientRect().top - top;
              if (start > cuts[cuts.length - 1]) cuts.push(start);
              if (bottom - cuts[cuts.length - 1] > 900) cuts.push(bottom);
            }
          }
        }
        if (cuts.at(-1) !== height) cuts.push(height);
        for (let part = 1; part < cuts.length; part++) {
          const partHeight = cuts[part] - cuts[part - 1];
          viewport.style.width = `${width}px`;
          viewport.style.height = `${partHeight}px`;
          mount.style.transform = `translateY(-${cuts[part - 1]}px)`;
          const image = await toPng(viewport, {
            width,
            height: partHeight,
            pixelRatio: 2,
            backgroundColor: background,
          });
          const scale = Math.min(528 / width, 696 / partHeight);
          const printHeight = partHeight * scale;
          if (pageUsed && y + printHeight > 738) nextPage();
          pdf.addImage(image, 'PNG', 42, y, width * scale, printHeight);
          y += printHeight + 14;
          pageUsed = true;
        }
        mount.style.transform = '';
      }
    }
    const filename =
      title
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .trim()
        .slice(0, 80) || 'work';
    pdf.save(`Mathwave-${filename}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}
