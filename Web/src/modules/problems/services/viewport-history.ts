import { workspaceKey } from '../../commands/index.ts';
import type { ProblemLibrary, WorkSnapshot } from '../types/problem-library.ts';
import {
  blankWorkspace,
  contentChanged,
  isUnchangedGraphWrite,
} from './problem-library.ts';

function sameWork(a: WorkSnapshot, b: WorkSnapshot) {
  return (
    !contentChanged(a.state, b.state) &&
    JSON.stringify(a.steps) === JSON.stringify(b.steps)
  );
}

/** Keep the latest camera position for each real revision, excluding a trailing no-op. */
function cleanJournal(revisions: WorkSnapshot[], current: WorkSnapshot) {
  const kept: WorkSnapshot[] = [];
  for (const revision of revisions) {
    if (kept.length && sameWork(kept[kept.length - 1], revision)) kept.pop();
    kept.push(revision);
  }
  if (kept.length && sameWork(kept[kept.length - 1], current)) kept.pop();
  return kept;
}

/** Removes camera-only and unchanged graph rows while retaining ranges and recoverable math. */
export function normalizeViewportHistory(book: ProblemLibrary): ProblemLibrary {
  return {
    ...book,
    assignments: book.assignments.map((assignment) => ({
      ...assignment,
      problems: assignment.problems.map((problem) => {
        const clean = (snapshot: WorkSnapshot): WorkSnapshot => {
          const kept = snapshot.steps
            .map((step, index) => ({ step, index }))
            .filter(
              ({ step, index }) =>
                // Old repeated writes must not remain as duplicate math rows.
                !(
                  index &&
                  isUnchangedGraphWrite(
                    snapshot.steps[index - 1].state,
                    step.state,
                    step.command,
                  )
                ) &&
                (!(
                  /^view x /i.test(step.command) ||
                  /\bview\.range\(/.test(step.command)
                ) ||
                  contentChanged(
                    index
                      ? snapshot.steps[index - 1].state
                      : problem.initialState || blankWorkspace(),
                    step.state,
                  )),
            );
          if (kept.length === snapshot.steps.length) return snapshot;
          return {
            ...snapshot,
            steps: kept.map(({ step }) => step),
            undoStates: kept
              .map(({ index }) =>
                index
                  ? snapshot.steps[index - 1].state
                  : problem.initialState || blankWorkspace(),
              )
              .slice(-50),
          };
        };
        const original: WorkSnapshot = {
          state: problem.state,
          steps: problem.steps,
          undoStates: problem.undoStates || [],
        };
        const current = clean(original);
        const undo = problem.undoRevisions?.map(clean);
        const redo = problem.redoRevisions?.map(clean);
        const changed =
          current !== original ||
          undo?.some((revision, i) => revision !== problem.undoRevisions![i]) ||
          redo?.some((revision, i) => revision !== problem.redoRevisions![i]);
        if (!changed) return problem;
        const candidates = [
          original,
          ...(problem.undoRevisions || []),
          ...(problem.redoRevisions || []),
        ];
        const remapTurn = (
          turn: import('../../commands/index.ts').ConversationTurn,
        ) => {
          const target = candidates.find(
            (candidate) =>
              candidate.steps.length === turn.stepCount &&
              workspaceKey(candidate.state) === turn.stateKey,
          );
          if (!target) return turn;
          const depth =
            turn.undoDepth && target === original && undo
              ? cleanJournal(undo.slice(-turn.undoDepth), current).length
              : turn.undoDepth;
          return {
            ...turn,
            stepCount: clean(target).steps.length,
            undoDepth: depth || turn.undoDepth,
          };
        };
        return {
          ...problem,
          ...current,
          undoRevisions: undo && cleanJournal(undo, current),
          redoRevisions: redo && cleanJournal(redo, current),
          conversation: problem.conversation?.map(remapTurn),
          conversationArchive: problem.conversationArchive?.map(remapTurn),
        };
      }),
    })),
  };
}
