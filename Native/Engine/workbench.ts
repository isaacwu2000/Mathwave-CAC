import { parseMath } from '../../Web/src/modules/math/index.ts';
import { runLocalAgent, type LocalModelRequest } from './agent.ts';
import { validateClarificationContext } from '../../Web/src/modules/commands/index.ts';
import { runCommand, directMathCommand, panelCommand } from '../../Web/src/modules/commands/index.ts';
import {
  createProblemLibrary, decodeProblemLibrary, currentProblem, saveDraft,
  recordStep, restoreStep, updateProblem, startProblem, selectProblem, deleteProblem,
  mergeProblemLibrary, currentProblemText, problemLibraryText, verifiedCompletion, otherBranches, switchBranch,
  applyHistoryCommand, contentChanged, applyMathPlan, splitMathPlan,
  type ProblemLibrary,
} from '../../Web/src/modules/problems/index.ts';
import { describeWorkspace, partsFor } from '../../Web/src/modules/workspace/state.ts';
import {
  defaultGraphRange, graphRenderData, geometryRenderData, numberedGraphs,
  curvePoints, explorationView, setExplorationValue, graphFunction, graphAverageRate,
  graphSceneRenderData, constructionRenderData,
} from '../../Web/src/modules/visuals/index.ts';

/** Retains plain text when a graph scene uses notation outside the scalar math parser. */
function notation(expression: string) {
  try { return parseMath(expression); } catch { return undefined; }
}

type Request = { operation: string; library?: string; text: string; index: number };

/** Executes bundled web domain code without network access. A failure returns no replacement library. */
export function perform(request: Request) {
  let book: ProblemLibrary = request.library ? decodeProblemLibrary(request.library) : createProblemLibrary();
  const before = currentProblem(book);
  let historyVisited = false;
  const inputDraft = book.draft;
  if (request.operation === 'submit') book = saveDraft(book, '');
  let message = 'Ready when you are.', action: string | undefined, audio: (number | null)[] = [];
  const text = request.text.trim();
  switch (request.operation) {
    case 'open':
    case 'export-problem': break;
    case 'draft': book = saveDraft(book, request.text); break;
    case 'new': book = startProblem(book, text || undefined); message = 'New problem started. Your other problems are saved.'; break;
    case 'select': {
      const group = book.assignments.find(a => a.problems.some(p => p.id === text));
      if (!group) throw new Error('That problem is unavailable.');
      book = selectProblem(book, group.id, text); break;
    }
    case 'delete': {
      const group = book.assignments.find(a => a.problems.some(p => p.id === text));
      if (!group) throw new Error('That problem is unavailable.');
      book = deleteProblem(book, group.id, text); message = 'Problem deleted.'; break;
    }
    case 'rename':
      if (!text || text.length > 200) throw new Error('Use a problem name with 1–200 characters.');
      book = updateProblem(book, p => ({ ...p, title: text })); break;
    case 'import': book = mergeProblemLibrary(book, decodeProblemLibrary(request.text)); message = 'Backup imported as independent problems.'; break;
    case 'revise': {
      const step = request.index;
      if (!Number.isInteger(step) || step < 1 || step > before.steps.length) throw new Error('That step does not exist.');
      if (parseMath(text).kind !== 'equation') throw new Error('Enter an equation with an equals sign.');
      const restored = restoreStep(book, step - 1);
      const result = runCommand(currentProblem(restored).state, `write ${text}`);
      book = recordStep(restored, result.state, `write ${text}`);
      message = 'Step revised. Your later work is available in the other branch.';
      break;
    }
    case 'branch': book = switchBranch(book, request.index); break;
    case 'dismiss-explanation': book = updateProblem(book, p => ({...p, exploration: undefined})); break;
    case 'adjust': {
      const exploration = currentProblem(book).exploration;
      if (!exploration) throw new Error('Open an interactive explanation first.');
      book = updateProblem(book, p => ({ ...p, exploration: setExplorationValue(exploration, text, request.index) })); break;
    }
    case 'submit':
    case 'command': {
      if (!text) throw new Error('Speak or type a command first.');
      if (/^(export|export work|export problem|export notebook|print|save pdf|export pdf)$/i.test(text)) { action = /pdf|print/i.test(text) ? 'print' : 'export'; break; }
      const panel = panelCommand(text);
      if (panel) { action = panel.open ? panel.panel : 'close-help'; break; }
      if (/^new problem$/i.test(text)) { book = startProblem(book); break; }
      const history = applyHistoryCommand(book, text);
      if (history) { historyVisited = true; book = history.book; message = history.message; break; }
      const plan = splitMathPlan(text);
      if (plan) { const applied = applyMathPlan(book, plan); book = applied.book; message = applied.message; break; }
      const state = currentProblem(book).state;
      const command = directMathCommand(text, state) || text;
      const result = runCommand(state, command);
      message = result.message; action = result.action;
      if (result.written || result.changed || contentChanged(state, result.state)) {
        // Selection and camera changes persist without introducing a mathematical step.
        book = result.written || contentChanged(state, result.state)
          ? recordStep(book, result.state, result.storedCommand || command, text)
          : updateProblem(book, p => ({ ...p, state: result.state }));
      }
      if (action === 'sonify') {
        const s = result.state;
        audio = s.mode === 'statistics' ? s.data : curvePoints(result.sonifyExpression || numberedGraphs(s)[0].expression, s.graphRange || defaultGraphRange).map(p => p.y);
      }
      break;
    }
    default: throw new Error('That local operation is unavailable.');
  }
  // Toolbar actions must not consume an unrelated, unfinished command.
  if (request.operation === 'command' || request.operation === 'revise') book = saveDraft(book, inputDraft);
  const problem = currentProblem(book), state = problem.state;
  let plot, renderWarning: string | undefined;
  try {
    if (state.mode === 'geometry') {
      if (state.construction) plot = constructionRenderData(state.construction);
      else if (state.geometry) plot = geometryRenderData(state.geometry, state.geometryOverlay);
    } else if (state.graph) {
      const x = state.graphRange || defaultGraphRange, y = state.graphYRange || defaultGraphRange;
      plot = state.graphScene ? graphSceneRenderData(state.graphScene, x, y)
        : graphRenderData(numberedGraphs(state).map(g => g.expression), x, y);
      const trace = state.graphTrace;
      if (trace && !state.graphScene) {
        const value = graphFunction(trace.expression).value(trace.x);
        if (value !== null) {
          plot.result.plots.push({ id: 'trace', kind: 'point', color: '#d32419', positions: [trace.x, value, 0] });
          plot.result.labels = [...(plot.result.labels || []), { text: `(${trace.x}, ${value})`, position: [trace.x, value, 0] }];
        }
      }
      const comparison = state.graphComparison;
      if (comparison && !state.graphScene) {
        const { start, end } = graphAverageRate(comparison.expression, comparison.start, comparison.end);
        plot.result.plots.push({ id: 'comparison', kind: 'line', color: '#2864b7', positions: [start.x, start.y, 0, end.x, end.y, 0] });
        plot.result.plots.push({ id: 'comparison-points', kind: 'point', color: '#2864b7', positions: [start.x, start.y, 0, end.x, end.y, 0] });
        plot.result.labels = [...(plot.result.labels || []), { text: 'A', position: [start.x, start.y, 0] }, { text: 'B', position: [end.x, end.y, 0] }];
      }
    }
  } catch (error) { renderWarning = error instanceof Error ? error.message : 'The drawing is unavailable; your work is saved.'; }
  const exploration = problem.exploration;
  const explanationPlot = exploration ? graphRenderData(explorationView(exploration).plots, exploration.xRange, exploration.yRange) : undefined;
  const explanation = exploration && explanationPlot ? {
    title: exploration.title, description: exploration.description, controls: exploration.controls,
    readouts: explorationView(exploration).readouts.map(r => ({ label: r.label, expression: r.expression, value: r.value || r.spoken })),
    plot: { bounds: explanationPlot.document.bounds, plots: explanationPlot.result.plots, labels: [], axes: true },
  } : undefined;
  return {
    completion: (request.operation === 'command' || request.operation === 'submit') && !historyVisited
      ? verifiedCompletion(before, problem, [text])?.answer : undefined,
    library: JSON.stringify(book), title: problem.title, problemId: problem.id,
    mode: state.mode, expression: state.expression, draft: book.draft, selection: state.selection,
    graphRows: state.graph ? numberedGraphs(state).map(g => g.expression) : [],
    description: describeWorkspace(state), message, action, audio,
    data: state.data,
    parts: partsFor(state).map(p => ({ id: p.id, label: p.label, spoken: p.spoken })),
    steps: problem.steps.map((s, i) => ({
      equations: s.state.mode === 'equation' ? (s.state.graph ? numberedGraphs(s.state).map(g => g.expression) : [s.state.expression]).map(expression => ({ expression, notation: notation(expression) })) : [],
      number: i + 1, expression: s.state.mode === 'equation' ? s.state.expression : s.displayCommand || s.command, command: s.displayCommand || s.command, description: describeWorkspace(s.state) })),
    problems: book.assignments.flatMap(a => a.problems.map(p => ({ id: p.id, title: p.title, assignment: a.title, steps: p.steps.length, at: p.steps.at(-1)?.at || '' }))),
    branches: otherBranches(problem).map((b, i) => ({ number: i, command: b.steps.at(-1)?.displayCommand || b.steps.at(-1)?.command || 'Previous work' })),
    canUndo: !!(problem.undoRevisions?.length || problem.undoStates?.length),
    canRedo: !!problem.redoRevisions?.length,
    exportText: request.operation === 'export-problem' ? (() => {
      const group = book.assignments.find(a => a.problems.some(p => p.id === text));
      if (!group) throw new Error('That problem is unavailable.');
      return currentProblemText(selectProblem(book, group.id, text));
    })() : currentProblemText(book),
    libraryText: problemLibraryText(book),
    plot: plot ? { bounds: plot.document.bounds, plots: plot.result.plots, labels: plot.result.labels || [], axes: state.mode !== 'geometry' } : undefined,
    renderWarning, explanation,
  };
}

/** Serializes success or an error; Swift only adopts a successfully decoded result. */
function handle(raw: string) {
  try { return JSON.stringify({ ok: true, value: perform(JSON.parse(raw)) }); }
  catch (error) { return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'The command could not run. Your work is unchanged.' }); }
}
/** Bridges asynchronous native inference; only complete outcomes return a replacement library. */
function handleAgent(raw: string,
  model: (request: string, resolve: (response: string) => void, reject: (error: string) => void) => void,
  complete: (response: string) => void) {
  const run = async () => {
    const request = JSON.parse(raw);
    const book = request.library ? decodeProblemLibrary(request.library) : createProblemLibrary();
    const clarification = request.clarification ? validateClarificationContext(request.clarification) : null;
    const outcome = await runLocalAgent(book, request.text, async (input: LocalModelRequest) => {
      const response = await new Promise<string>((resolve, reject) => model(JSON.stringify(input), resolve, error => reject(new Error(error))));
      if (response.length > 100_000) throw new Error('Local model output is too large.');
      return JSON.parse(response);
    }, clarification);
    const document = perform({ operation: 'open', library: JSON.stringify(outcome.book), text: '', index: 0 });
    document.message = outcome.message;
    document.action = outcome.action ?? (outcome.panel ? outcome.panel.open ? outcome.panel.panel : 'close-help' : undefined);
    document.completion = outcome.completion?.answer;
    if (outcome.action === 'sonify') {
      const state = currentProblem(outcome.book).state;
      document.audio = state.mode === 'statistics' ? state.data
        : curvePoints(outcome.sonifyExpression || numberedGraphs(state)[0].expression, state.graphRange || defaultGraphRange).map(point => point.y);
    }
    return { document, status: outcome.status, clarificationJSON: outcome.clarification ? JSON.stringify(outcome.clarification) : null };
  };
  void run().then(value => complete(JSON.stringify({ ok: true, value })), error => complete(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Local inference failed.' })));
}
(globalThis as unknown as { MathAudioEngine: { handle: typeof handle; handleAgent: typeof handleAgent } }).MathAudioEngine = { handle, handleAgent };
