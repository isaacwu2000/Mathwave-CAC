import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createProblemLibrary,
  currentProblem,
  applyMathPlan,
  rememberConversation,
  correctConversation,
  historyContext,
  decodeProblemLibrary,
} from '../src/modules/problems/index.ts';
import { validateInterpretation } from '../src/modules/commands/index.ts';

// Fresh multi-turn holdout: expectations are fixed before contacting the model.
const turns = [
  {
    request: 'Put down three x plus four equals nineteen.',
    status: 'command',
    equation: '3 * x + 4 = 19',
  },
  {
    request: 'Why would subtracting four help here?',
    status: 'explanation',
    equation: '3 * x + 4 = 19',
  },
  {
    request: 'Okay, go ahead and do that.',
    status: 'command',
    equation: '3 * x = 15',
  },
  {
    request: 'Actually I meant subtract six, not four.',
    status: 'correction',
    equation: '3 * x - 2 = 13',
  },
  {
    request: 'No, I meant subtract two instead.',
    status: 'correction',
    equation: '3 * x + 2 = 17',
  },
  {
    request: 'Can you explain why we have to do the same thing to both sides?',
    status: 'explanation',
    equation: '3 * x + 2 = 17',
  },
];
let book = createProblemLibrary();
const results = [];
const origin = process.env.EVAL_ORIGIN || 'http://localhost:3000';
for (const [index, turn] of turns.entries()) {
  const before = book;
  const problem = currentProblem(book);
  const start = performance.now();
  try {
    const response = await fetch(`${origin}/api/interpret`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: turn.request,
        state: problem.state,
        history: historyContext(book),
        conversation: problem.conversation,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Endpoint HTTP ${response.status}`);
    const result = validateInterpretation(
      await response.json(),
      problem.state,
      historyContext(book),
      turn.request,
    );
    if (result.status === 'correction') {
      book = correctConversation(
        book,
        result.commands || [],
        turn.request,
      ).book;
    } else {
      const applied =
        result.status === 'command'
          ? applyMathPlan(
              book,
              result.commands?.length ? result.commands : [result.command],
            )
          : { book, message: result.message };
      book = rememberConversation(
        before,
        applied.book,
        turn.request,
        applied.message,
        result.status,
        result.commands,
      );
    }
    const actual = currentProblem(book);
    const unchanged =
      result.status !== 'explanation' ||
      (JSON.stringify(actual.state) === JSON.stringify(problem.state) &&
        actual.steps.length === problem.steps.length);
    const pass =
      result.status === turn.status &&
      actual.state.expression === turn.equation &&
      unchanged;
    results.push({
      ...turn,
      pass,
      actual: actual.state.expression,
      prediction: result,
      latencyMs: Math.round(performance.now() - start),
    });
    console.log(
      JSON.stringify({
        turn: index + 1,
        pass,
        status: result.status,
        actual: actual.state.expression,
      }),
    );
    // Exercise the exact persisted conversation path between every turn.
    book = decodeProblemLibrary(JSON.stringify(book));
  } catch (error) {
    results.push({
      ...turn,
      pass: false,
      error: error instanceof Error ? error.message : String(error),
    });
    break;
  }
  if (index < turns.length - 1)
    await new Promise((resolve) => setTimeout(resolve, 6200));
}
const report = {
  createdAt: new Date().toISOString(),
  scope:
    'Live AI text dialogue and persisted problem state; no microphone claims.',
  total: turns.length,
  passed: results.filter((r) => r.pass).length,
  results,
};
mkdirSync('../Evals/evaluations', { recursive: true });
const destination = `../Evals/evaluations/conversation-${Date.now()}.json`;
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(destination);
if (report.passed !== turns.length) process.exitCode = 1;
