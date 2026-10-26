import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
} from '../../problems/index.ts';
import { runCommand } from '../../commands/index.ts';
import { EquationCarousel } from './equation-carousel.tsx';

it('shows earlier work without review or continuation controls', () => {
  let book = createProblemLibrary();
  for (const command of ['write x+1=3', 'write x=2']) {
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, command).state,
      command,
    );
  }
  const html = renderToStaticMarkup(
    <EquationCarousel
      problem={currentProblem(book)}
      focused={0}
      busy={false}
      onFocus={() => {}}
      onRevise={async () => {}}
      onBranch={async () => {}}
    />,
  );
  expect(html).not.toContain('Reviewing step');
  expect(html).not.toContain('Back to latest step');
  expect(html).not.toContain('Continue from step');
  expect(html).not.toContain('Continue from this step');
  expect(html).toContain('Focus step 1');
  expect(html).toContain('Focus step 2');
});

it('renders fractions and a retained branch draft through an injected storage boundary', () => {
  let book = createProblemLibrary();
  const written = runCommand(currentProblem(book).state, 'write (x+1)/3=5');
  book = recordStep(book, written.state, 'write (x+1)/3=5');
  const problem = currentProblem(book);
  const storage = new Map([
    [
      `mathwave-revision:${problem.id}`,
      JSON.stringify({ step: 1, at: problem.steps[0].at, expression: 'x=7' }),
    ],
  ]);
  const html = renderToStaticMarkup(
    <EquationCarousel
      problem={problem}
      focused={0}
      busy={false}
      revisionStorage={{
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
        removeItem: (key) => {
          storage.delete(key);
        },
      }}
      onFocus={() => {}}
      onRevise={async () => {}}
      onBranch={async () => {}}
    />,
  );
  expect(html).toContain('<mfrac>');
  expect(html).toContain('Save edit');
  expect(html).toContain('Edit step 1');
});

it('renders without browser storage during server rendering', () => {
  const html = renderToStaticMarkup(
    <EquationCarousel
      problem={currentProblem(createProblemLibrary())}
      focused={0}
      busy={false}
      onFocus={() => {}}
      onRevise={async () => {}}
      onBranch={async () => {}}
    />,
  );
  expect(html).toContain('Equation steps');
});

it('keeps branching out of the worksheet when step actions require a hold', () => {
  let book = createProblemLibrary();
  const result = runCommand(currentProblem(book).state, 'write x+1=3');
  book = recordStep(book, result.state, 'write x+1=3');
  const html = renderToStaticMarkup(
    <EquationCarousel
      problem={currentProblem(book)}
      focused={0}
      busy={false}
      holdActions
      onFocus={() => {}}
      onRevise={async () => {}}
      onBranch={async () => {}}
    />,
  );
  expect(html).not.toContain('class="step-branch"');
  expect(html).toContain('aria-haspopup="dialog"');
});

it('offers equation focus without a fork control', () => {
  let book = createProblemLibrary();
  const written = runCommand(currentProblem(book).state, 'write x+1=3');
  book = recordStep(book, written.state, 'write x+1=3');
  const html = renderToStaticMarkup(
    <EquationCarousel
      problem={currentProblem(book)}
      focused={0}
      busy={false}
      onFocus={() => {}}
      onRevise={async () => {}}
      onBranch={async () => {}}
    />,
  );
  expect(html).not.toContain('class="step-branch"');
  expect(html).not.toContain('Branch from step');
});

it('keeps non-equation requests out of equation history', () => {
  let book = createProblemLibrary();
  currentProblem(book).steps.push({
    at: '2026-10-24T00:00:00Z',
    state: { ...currentProblem(book).state, mode: 'statistics' },
    command: 'diagrams',
    displayCommand: 'Make a diagram. There you go',
  });
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, 'write x^2+3x+2').state,
    'write x^2+3x+2',
  );
  const html = renderToStaticMarkup(
    <EquationCarousel
      problem={currentProblem(book)}
      focused={1}
      busy={false}
      onFocus={() => {}}
      onRevise={async () => {}}
      onBranch={async () => {}}
    />,
  );
  expect(html).not.toContain('Make a diagram');
  expect(html).toContain('Focus step 2');
  expect(html).not.toContain('Focus step 1');
});
