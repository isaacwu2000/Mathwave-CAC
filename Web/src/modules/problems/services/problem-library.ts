import {
  runCommand,
  commandSource,
  storeCommandGroup,
  storedCommands,
  validateConversation,
  validateConversationArchive,
} from '../../commands/index.ts';
import { parseMath } from '../../math/index.ts';
import {
  describeGeometry,
  validateExploration,
  validateGeometry,
  validateGraphComparison,
  compileGraphScene,
  describeGraphScene,
  validateConstruction,
  describeConstruction,
  validateGraphExpressions,
  validateGraphRange,
  validateGraphTrace,
  validateTriangleOverlay,
} from '../../visuals/index.ts';
import { initialWorkspace, type Workspace } from '../../workspace/state.ts';
import type {
  ProblemLibrary,
  Problem,
  Step,
  WorkSnapshot,
} from '../types/problem-library.ts';
export type {
  Assignment,
  ProblemLibrary,
  Problem,
  Step,
  WorkSnapshot,
} from '../types/problem-library.ts';
export { STORAGE_KEY } from '../config/storage.ts';

export function blankWorkspace(): Workspace {
  return {
    ...initialWorkspace,
    expression: '0',
    data: [0, 0],
  };
}
export function createProblem(title = 'Problem 1'): Problem {
  return { id: crypto.randomUUID(), title, state: blankWorkspace(), steps: [] };
}
export function createProblemLibrary(): ProblemLibrary {
  const problem = createProblem();
  const assignment = {
    id: crypto.randomUUID(),
    title: 'My homework',
    problems: [problem],
  };
  return {
    version: 2,
    assignments: [assignment],
    assignmentId: assignment.id,
    problemId: problem.id,
    draft: '',
  };
}
export function currentProblem(book: ProblemLibrary): Problem {
  const problem = book.assignments
    .find((a) => a.id === book.assignmentId)
    ?.problems.find((p) => p.id === book.problemId);
  if (!problem) throw new Error('The saved problem could not be found.');
  return problem;
}
export function saveDraft(book: ProblemLibrary, draft: string): ProblemLibrary {
  return updateProblem({ ...book, draft }, (p) => ({ ...p, draft }));
}

export function selectProblem(
  book: ProblemLibrary,
  assignmentId: string,
  problemId: string,
): ProblemLibrary {
  const next = { ...saveDraft(book, book.draft), assignmentId, problemId };
  return { ...next, draft: currentProblem(next).draft || '' };
}

/**
 * Deletes only the named problem, retaining other work and drafts.
 * - An active deletion selects a remaining problem; the last deletion starts a blank one.
 * - Empty assignment groups are removed. Already-deleted IDs leave the book unchanged.
 */
export function deleteProblem(
  book: ProblemLibrary,
  assignmentId: string,
  problemId: string,
): ProblemLibrary {
  const assignment = book.assignments.find((a) => a.id === assignmentId);
  const index = assignment?.problems.findIndex((p) => p.id === problemId) ?? -1;
  if (!assignment || index < 0) return book;
  const saved = saveDraft(book, book.draft);
  const assignments = saved.assignments
    .map((a) =>
      a.id === assignmentId
        ? { ...a, problems: a.problems.filter((p) => p.id !== problemId) }
        : a,
    )
    .filter((a) => a.problems.length > 0);
  if (!assignments.length) {
    const blank = createProblemLibrary();
    return updateProblem(blank, (p) => ({ ...p, title: 'New problem' }));
  }
  if (book.problemId !== problemId) return { ...saved, assignments };
  const nextAssignment =
    assignments.find((a) => a.id === assignmentId) || assignments[0];
  const nextProblem =
    nextAssignment.problems[
      Math.min(index, nextAssignment.problems.length - 1)
    ];
  return {
    ...saved,
    assignments,
    assignmentId: nextAssignment.id,
    problemId: nextProblem.id,
    draft: nextProblem.draft || '',
  };
}

export function startProblem(
  book: ProblemLibrary,
  title?: string,
  assignmentTitle?: string,
): ProblemLibrary {
  const saved = saveDraft(book, book.draft);
  const assignment = saved.assignments.find(
    (a) => a.id === saved.assignmentId,
  )!;
  const problem = createProblem(
    title || `Problem ${assignmentTitle ? 1 : assignment.problems.length + 1}`,
  );
  if (assignmentTitle) {
    const nextAssignment = {
      id: crypto.randomUUID(),
      title: assignmentTitle,
      problems: [problem],
    };
    return {
      ...saved,
      assignments: [...saved.assignments, nextAssignment],
      assignmentId: nextAssignment.id,
      problemId: problem.id,
      draft: '',
    };
  }
  return {
    ...saved,
    assignments: saved.assignments.map((a) =>
      a.id === saved.assignmentId
        ? { ...a, problems: [...a.problems, problem] }
        : a,
    ),
    problemId: problem.id,
    draft: '',
  };
}
/** Identical graph writes add no work; a changed graph or an explicit algebra write still does. */
export function isUnchangedGraphWrite(
  previous: Workspace,
  state: Workspace,
  command: string,
): boolean {
  return (
    JSON.stringify(previous) === JSON.stringify(state) &&
    storedCommands(command).every(
      (part) =>
        /^(?:graph\b|(?:add|edit|remove|delete) (?:graph|curve)\b)/i.test(
          part,
        ) ||
        (part.startsWith('typescript\n') &&
          /\bgraph\./.test(part) &&
          !/\b(?:math|stats|geometry)\./.test(part)),
    )
  );
}
export function recordStep(
  book: ProblemLibrary,
  state: Workspace,
  command: string,
  displayCommand?: string,
): ProblemLibrary {
  const previous = currentProblem(book);
  let before = previous.state;
  const source = storeCommandGroup(
    storedCommands(command).map((part) => {
      const source = commandSource(part, before);
      before = runCommand(before, source).state;
      return source;
    }),
  );
  displayCommand ||= command;
  command = source;
  // Graph requests can be replayed by voice or autosave. An unchanged graph
  // must not add a row or consume undo; explicit algebra writes remain distinct.
  if (
    previous.steps.length &&
    isUnchangedGraphWrite(previous.state, state, command)
  )
    return saveDraft(book, '');
  return {
    ...book,
    draft: '',
    assignments: book.assignments.map((a) =>
      a.id !== book.assignmentId
        ? a
        : {
            ...a,
            problems: a.problems.map((p) =>
              p.id !== book.problemId
                ? p
                : {
                    ...p,
                    initialState:
                      p.initialState ||
                      (p.steps.length
                        ? p.undoStates?.length === p.steps.length
                          ? p.undoStates[0]
                          : blankWorkspace()
                        : p.state) ||
                      blankWorkspace(),
                    undoRevisions: [...revisionHistory(p), snapshot(p)].slice(
                      -50,
                    ),
                    redoRevisions: [],
                    state,
                    draft: '',
                    undoStates: [...(p.undoStates || []), p.state].slice(-50),
                    steps: [
                      ...p.steps,
                      {
                        command,
                        ...(displayCommand && displayCommand !== command
                          ? { displayCommand }
                          : {}),
                        state,
                        at: new Date().toISOString(),
                      },
                    ],
                  },
            ),
          },
    ),
  };
}
/** Save each mathematical step, with one recoverable change for the entire request. */
export function recordPlan(
  book: ProblemLibrary,
  changes: { state: Workspace; command: string; displayCommand?: string }[],
  finalState: Workspace,
): ProblemLibrary {
  const original = currentProblem(book);
  let next = book;
  for (const change of changes)
    next = recordStep(
      next,
      change.state,
      change.command,
      change.displayCommand,
    );
  return updateProblem(next, (p) => ({
    ...p,
    state: finalState,
    undoRevisions: changes.length
      ? [...revisionHistory(original), snapshot(original)].slice(-50)
      : p.undoRevisions,
  }));
}
export function updateProblem(
  book: ProblemLibrary,
  update: (p: Problem) => Problem,
): ProblemLibrary {
  return {
    ...book,
    assignments: book.assignments.map((a) =>
      a.id !== book.assignmentId
        ? a
        : {
            ...a,
            problems: a.problems.map((p) =>
              p.id === book.problemId ? update(p) : p,
            ),
          },
    ),
  };
}
function snapshot(p: Problem): WorkSnapshot {
  return { state: p.state, steps: p.steps, undoStates: p.undoStates || [] };
}
function revisionHistory(p: Problem): WorkSnapshot[] {
  if (p.undoRevisions) return p.undoRevisions;
  const states = p.undoStates || [];
  return states.map((state, i) => {
    const count = Math.max(0, p.steps.length - states.length + i);
    return {
      state,
      steps: p.steps.slice(0, count),
      undoStates: states.slice(0, i),
    };
  });
}
/** Recover divergent work from the existing, bounded revision journal. */
export function otherBranches(problem: Problem): WorkSnapshot[] {
  const current = problem.steps;
  const candidates = [
    ...(problem.undoRevisions || []),
    ...(problem.redoRevisions || []),
  ];
  const same = (a: Step, b: Step) =>
    a.at === b.at &&
    a.command === b.command &&
    JSON.stringify(a.state) === JSON.stringify(b.state);
  const prefix = (a: Step[], b: Step[]) =>
    a.length <= b.length && a.every((step, i) => same(step, b[i]));
  return candidates.filter(
    (candidate, index) =>
      candidate.steps.length > 0 &&
      !prefix(candidate.steps, current) &&
      !candidates.some(
        (other, j) =>
          j !== index &&
          prefix(candidate.steps, other.steps) &&
          (candidate.steps.length < other.steps.length || j > index),
      ),
  );
}
export function switchBranch(
  book: ProblemLibrary,
  index: number,
): ProblemLibrary {
  const problem = currentProblem(book);
  const branch = otherBranches(problem)[index];
  if (!Number.isInteger(index) || !branch)
    throw new Error('That branch is no longer available.');
  return updateProblem(book, (p) => ({
    ...p,
    ...branch,
    undoRevisions: [...revisionHistory(p), snapshot(p)].slice(-50),
    redoRevisions: [],
  }));
}
export function undoStep(book: ProblemLibrary): ProblemLibrary {
  const p = currentProblem(book),
    history = revisionHistory(p),
    previous = history.at(-1);
  if (!previous) return book;
  return updateProblem(book, (problem) => ({
    ...problem,
    ...previous,
    undoRevisions: history.slice(0, -1),
    redoRevisions: [...(p.redoRevisions || []), snapshot(p)].slice(-50),
  }));
}
export function redoStep(book: ProblemLibrary): ProblemLibrary {
  const p = currentProblem(book),
    next = p.redoRevisions?.at(-1);
  if (!next) return book;
  return updateProblem(book, (problem) => ({
    ...problem,
    ...next,
    undoRevisions: [...revisionHistory(p), snapshot(p)].slice(-50),
    redoRevisions: p.redoRevisions!.slice(0, -1),
  }));
}
function changeHistory(
  book: ProblemLibrary,
  steps: Step[],
  state: Workspace,
): ProblemLibrary {
  return updateProblem(book, (p) => ({
    ...p,
    state,
    steps,
    undoStates: steps
      .map((_, i) =>
        i ? steps[i - 1].state : p.initialState || blankWorkspace(),
      )
      .slice(-50),
    undoRevisions: [...revisionHistory(p), snapshot(p)].slice(-50),
    redoRevisions: [],
  }));
}
export function restoreStep(
  book: ProblemLibrary,
  number: number,
): ProblemLibrary {
  const p = currentProblem(book);
  if (!Number.isInteger(number) || number < 0 || number > p.steps.length)
    throw new Error('That step does not exist.');
  if (number === p.steps.length) return book;
  return changeHistory(
    book,
    p.steps.slice(0, number),
    number ? p.steps[number - 1].state : p.initialState || blankWorkspace(),
  );
}
export function cancelStep(
  book: ProblemLibrary,
  number: number,
): ProblemLibrary {
  const p = currentProblem(book);
  if (!Number.isInteger(number) || number < 1 || number > p.steps.length)
    throw new Error('That step does not exist.');
  const steps = p.steps.slice(0, number - 1);
  let state = steps.at(-1)?.state || p.initialState || blankWorkspace();
  for (const step of p.steps.slice(number)) {
    // Streamed graph builds are stored as one step; replay each validated operation.
    const commands = storedCommands(step.command);
    let result = runCommand(state, commands[0]);
    for (const command of commands.slice(1))
      result = runCommand(result.state, command);
    if (
      result.action === 'undo' ||
      (!result.written &&
        !result.programSaved &&
        !contentChanged(state, result.state) &&
        !/^view x /i.test(step.command))
    )
      throw new Error('A later step cannot be recalculated.');
    state = result.state;
    steps.push({ ...step, state });
  }
  return changeHistory(book, steps, state);
}
export function contentChanged(a: Workspace, b: Workspace): boolean {
  return (
    a.expression !== b.expression ||
    a.construction !== b.construction ||
    JSON.stringify(a.graphScene) !== JSON.stringify(b.graphScene) ||
    JSON.stringify(a.retainedGraph) !== JSON.stringify(b.retainedGraph) ||
    JSON.stringify(a.graphExpressions || []) !==
      JSON.stringify(b.graphExpressions || []) ||
    JSON.stringify(a.data) !== JSON.stringify(b.data) ||
    JSON.stringify(a.geometry) !== JSON.stringify(b.geometry)
  );
}
export function mergeProblemLibrary(
  book: ProblemLibrary,
  imported: ProblemLibrary,
): ProblemLibrary {
  const assignments = imported.assignments.map((a) => ({
    ...a,
    id: crypto.randomUUID(),
    problems: a.problems.map((p) => ({ ...p, id: crypto.randomUUID() })),
  }));
  return { ...book, assignments: [...book.assignments, ...assignments] };
}
function validWorkspace(s: Workspace) {
  if (
    !s ||
    !['equation', 'statistics', 'geometry'].includes(s.mode) ||
    typeof s.expression !== 'string' ||
    !Number.isInteger(s.selection) ||
    s.selection < 0 ||
    typeof s.graph !== 'boolean'
  )
    throw new Error('Invalid workspace.');
  if (s.graphScene !== undefined) compileGraphScene(s.graphScene);
  if (s.retainedGraph !== undefined) compileGraphScene(s.retainedGraph);
  if (s.geometry !== undefined) validateGeometry(s.geometry);
  if (s.geometryOverlay !== undefined)
    validateTriangleOverlay(s.geometryOverlay);
  if (s.construction !== undefined) validateConstruction(s.construction);
  if (s.geometry && s.construction)
    throw new Error('Use a shape or a named construction, not both.');
  if (s.mode === 'geometry' && !s.geometry && !s.construction)
    throw new Error('Missing geometry.');
  parseMath(s.expression);
  if (s.graphTrace !== undefined) validateGraphTrace(s.graphTrace);
  if (s.graphComparison !== undefined)
    validateGraphComparison(s.graphComparison);
  if (s.graphRange !== undefined) validateGraphRange(s.graphRange);
  if (s.graphYRange !== undefined) validateGraphRange(s.graphYRange);
  if (s.graphExpressions !== undefined)
    validateGraphExpressions(s.graphExpressions);
  if (
    !Array.isArray(s.data) ||
    s.data.length < 2 ||
    s.data.length > 100 ||
    !s.data.every(
      (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12,
    )
  )
    throw new Error('Invalid data.');
}
export function decodeProblemLibrary(raw: string): ProblemLibrary {
  if (raw.length > 10_000_000)
    throw new Error('The backup is too large (maximum 10 MB).');
  const b = JSON.parse(raw) as Omit<ProblemLibrary, 'version'> & {
    version: number;
  };
  if (
    !b ||
    ![1, 2].includes(b.version) ||
    !Array.isArray(b.assignments) ||
    !b.assignments.length ||
    typeof b.draft !== 'string' ||
    b.draft.length > 4000
  )
    throw new Error('Invalid problem.');
  const ids = new Set<string>();
  for (const a of b.assignments) {
    if (
      !a ||
      typeof a.id !== 'string' ||
      ids.has(a.id) ||
      typeof a.title !== 'string' ||
      a.title.length > 200 ||
      !Array.isArray(a.problems) ||
      !a.problems.length
    )
      throw new Error('Invalid assignment.');
    ids.add(a.id);
    for (const p of a.problems) {
      if (
        !p ||
        typeof p.id !== 'string' ||
        ids.has(p.id) ||
        typeof p.title !== 'string' ||
        p.title.length > 200 ||
        !Array.isArray(p.steps)
      )
        throw new Error('Invalid problem.');
      if (p.conversation !== undefined) validateConversation(p.conversation);
      if (p.conversationArchive !== undefined)
        validateConversationArchive(p.conversationArchive);
      if (p.exploration !== undefined)
        p.exploration = validateExploration(p.exploration);
      if (
        p.draft !== undefined &&
        (typeof p.draft !== 'string' || p.draft.length > 4000)
      )
        throw new Error('Invalid draft.');
      if (
        p.recovery !== undefined &&
        (typeof p.recovery !== 'string' || p.recovery.length > 4000)
      )
        throw new Error('Invalid speech recovery.');
      if (p.undoStates !== undefined) {
        if (!Array.isArray(p.undoStates) || p.undoStates.length > 50)
          throw new Error('Invalid undo history.');
        p.undoStates.forEach(validWorkspace);
      }
      if (p.initialState !== undefined) validWorkspace(p.initialState);
      for (const revisions of [p.undoRevisions, p.redoRevisions]) {
        if (revisions === undefined) continue;
        if (!Array.isArray(revisions) || revisions.length > 50)
          throw new Error('Invalid recovery history.');
        for (const revision of revisions) {
          validWorkspace(revision.state);
          if (
            !Array.isArray(revision.undoStates) ||
            revision.undoStates.length > 50 ||
            !Array.isArray(revision.steps)
          )
            throw new Error('Invalid recovery snapshot.');
          revision.undoStates.forEach(validWorkspace);
          for (const step of revision.steps) {
            if (
              !step ||
              typeof step.command !== 'string' ||
              step.command.length > 4000 ||
              (step.displayCommand !== undefined &&
                (typeof step.displayCommand !== 'string' ||
                  step.displayCommand.length > 4000)) ||
              typeof step.at !== 'string'
            )
              throw new Error('Invalid recovery step.');
            validWorkspace(step.state);
          }
        }
      }
      ids.add(p.id);
      validWorkspace(p.state);
      for (const step of p.steps) {
        if (
          !step ||
          typeof step.command !== 'string' ||
          step.command.length > 4000 ||
          (step.displayCommand !== undefined &&
            (typeof step.displayCommand !== 'string' ||
              step.displayCommand.length > 4000)) ||
          typeof step.at !== 'string'
        )
          throw new Error('Invalid step.');
        validWorkspace(step.state);
      }
    }
  }
  const result = { ...b, version: 2 as const };
  currentProblem(result);
  if (b.version === 1) {
    // Old problems recorded view changes and undo as steps. Replay that log
    // before extracting only actual work, preserving older saved problems.
    for (const a of result.assignments)
      for (const p of a.problems) {
        const active: Step[] = [];
        for (const step of p.steps) {
          if (step.command === 'Undo last change') active.pop();
          else active.push(step);
        }
        let previous = blankWorkspace();
        p.steps = active.filter((step) => {
          const changed = contentChanged(previous, step.state);
          previous = step.state;
          return changed;
        });
        p.undoStates = p.steps
          .map((_, i) => (i === 0 ? blankWorkspace() : p.steps[i - 1].state))
          .slice(-50);
      }
  }
  return result;
}
export function problemLibraryText(book: ProblemLibrary): string {
  return book.assignments
    .map(
      (a) =>
        `${a.title}\n${'='.repeat(30)}\n\n${a.problems.map((p) => `${p.title}\n${p.steps.length ? p.steps.map((s, i) => `${i + 1}. ${s.state.mode === 'equation' && s.state.graphScene ? describeGraphScene(s.state.graphScene) : s.state.mode === 'equation' ? [s.state.expression, ...(s.state.graphExpressions || [])].join(' ; ') : s.state.mode === 'statistics' ? s.state.data.join(', ') : s.state.mode === 'geometry' && s.state.construction ? describeConstruction(s.state.construction) : s.state.mode === 'geometry' && s.state.geometry ? describeGeometry(s.state.geometry) : ''}\n   ${s.displayCommand || s.command}`).join('\n') : 'No steps yet.'}${p.draft ? `\nUnsubmitted draft: ${p.draft}` : ''}${p.recovery ? `\nUnrecognized speech: ${p.recovery}` : ''}`).join('\n\n')}`,
    )
    .join('\n\n');
}

export function currentProblemText(book: ProblemLibrary): string {
  const assignment = book.assignments.find((a) => a.id === book.assignmentId)!;
  const problem = { ...currentProblem(book), draft: book.draft };
  return problemLibraryText({
    ...book,
    assignments: [{ ...assignment, problems: [problem] }],
  });
}
