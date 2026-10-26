import {
  runCommand,
  validateInterpretation,
  storeCommandGroup,
} from '../../Web/src/modules/commands/index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  otherBranches,
  type ProblemLibrary,
} from '../../Web/src/modules/problems/index.ts';
import { applyCloudOperation } from '../../Web/src/modules/problems/index.ts';
import { assessBackendAnswer, backendCases } from './backend-journey.ts';

export type PromptCase = { id: string; text: string; book: ProblemLibrary };
function fixture(commands: string[]): ProblemLibrary {
  let book = createProblemLibrary();
  for (const command of commands)
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, command).state,
      command,
    );
  return book;
}
export const promptCases: PromptCase[] = [
  ...backendCases.map((example) => ({
    ...example,
    book: fixture(['write 2*x+3=11']),
  })),
  {
    id: 'coefficient',
    text: 'Change the coefficient of x from two to four; leave the other numbers alone.',
    book: fixture(['write 2*x+3=11']),
  },
  {
    id: 'revise-step',
    text: 'Change saved step two to 2x equals ten, keeping the old work recoverable.',
    book: fixture(['write 2*x+3=11', 'subtract 3 from both sides', 'simplify']),
  },
  {
    id: 'geometry',
    text: 'What is the area of this circle? Read the result without changing my work.',
    book: fixture(['circle radius 3']),
  },
  {
    id: 'statistics',
    text: 'What is the mean of this data? Leave the data unchanged.',
    book: fixture(['data 2,4,9']),
  },
  {
    id: 'linked-graph',
    text: 'Change a to five and keep f linked to a.',
    book: fixture([
      'typescript\nproblem.save(graph.scene(["a=2","f(x)=a*x^2"]));',
    ]),
  },
];

/**
 * Executes a proposal through real validation and math/history execution, never the direct-request bypass.
 * Checks authored outcomes, query values, step boundaries and recovery on synthetic copies.
 * Explanation scoring covers non-mutation and response type, not teaching quality.
 */
export async function assessPromptAnswer(example: PromptCase, value: unknown) {
  const standard = backendCases.find((item) => item.id === example.id);
  if (standard) return assessBackendAnswer(value, standard);
  const initial = currentProblem(example.book).state;
  const plan = validateInterpretation(
    value,
    initial,
    {
      steps: currentProblem(example.book).steps.map((step, i) => ({
        number: i + 1,
        command: step.command,
      })),
      total: currentProblem(example.book).steps.length,
      undoCount: 3,
      redoCount: 0,
    },
    example.text,
  );
  let book = example.book;
  let readback = plan.message;
  if (plan.status === 'command') {
    const result = await applyCloudOperation(
      { book, clarification: null },
      {
        kind: 'command',
        text: plan.commands?.length
          ? storeCommandGroup(plan.commands)
          : plan.command,
        interpret: false,
      },
    );
    if (result.status !== 'command') throw new Error(result.message);
    book = result.book;
    readback += ' ' + result.message;
  }
  const problem = currentProblem(book);
  const sameState = JSON.stringify(problem.state) === JSON.stringify(initial);
  let passed = false;
  if (example.id === 'coefficient')
    passed =
      plan.status === 'command' &&
      problem.state.expression === '4 * x + 3 = 11';
  if (example.id === 'revise-step')
    passed =
      plan.status === 'command' &&
      problem.state.expression === '2 * x = 10' &&
      problem.steps.length === 2 &&
      otherBranches(problem).some((branch) => branch.steps.length === 3);
  if (example.id === 'geometry')
    passed =
      ['command', 'explanation'].includes(plan.status) &&
      sameState &&
      /28\.2743|9\s*[×*]?\s*(?:π|pi)/i.test(readback);
  if (example.id === 'statistics')
    passed =
      ['command', 'explanation'].includes(plan.status) &&
      sameState &&
      /mean[^\d]*5\b/i.test(readback);
  if (example.id === 'linked-graph') {
    const rows = problem.state.graphScene?.rows.map((row) =>
      row.expression.replace(/\s/g, ''),
    );
    passed =
      plan.status === 'command' &&
      rows?.length === 2 &&
      rows[0] === 'a=5' &&
      rows[1] === 'f(x)=a*x^2';
  }
  return {
    passed,
    status: plan.status,
    expression: problem.state.expression,
    readback,
    graphScene: problem.state.graphScene,
  };
}
