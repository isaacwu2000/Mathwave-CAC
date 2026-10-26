import { verifiedCompletion } from './completion.ts';
import {
  explanationRequest,
  directMathCommand,
  panelCommand,
  previewGraphCommands,
  resolveClarification,
  resolveConversation,
  runCommand,
  storeCommandGroup,
  validateInterpretation,
} from '../../commands/index.ts';
import { ClarificationError } from '../../math/index.ts';
import type {
  CloudProblemLibrary,
  CloudOperation,
  CloudOutcome,
  Interpreter,
} from '../types/cloud-problem-library.ts';
import {
  adjustExplanation,
  correctConversation,
  presentExplanation,
  rememberConversation,
} from './conversation.ts';
import { applyHistoryCommand, historyContext } from './history-commands.ts';
import { applyMathPlan, splitMathPlan } from './math-plan.ts';
import {
  contentChanged,
  currentProblem,
  decodeProblemLibrary,
  deleteProblem,
  mergeProblemLibrary,
  recordStep,
  switchBranch,
  saveDraft,
  selectProblem,
  startProblem,
  updateProblem,
} from './problem-library.ts';
export type {
  CloudProblemLibrary,
  CloudOperation,
  CloudOutcome,
  Interpreter,
} from '../types/cloud-problem-library.ts';

/** Runs only against the server's saved problem. No caller-supplied workspace is executed. */
export async function applyCloudOperation(
  saved: CloudProblemLibrary,
  operation: CloudOperation,
  interpret?: Interpreter,
): Promise<CloudOutcome> {
  let book = saved.book;
  let assistantMessage = '';
  let rememberedCommands: string[] | undefined;
  let completionDecision: { answer: string } | null | undefined;
  // Only newly executed math can complete an objective; history navigation cannot.
  let completionEligible = false;
  const done = (
    message = '',
    extras: Partial<CloudOutcome> = {},
  ): CloudOutcome => {
    const status = extras.status ?? 'command';
    const combined =
      status === 'command' && assistantMessage
        ? `${assistantMessage} ${message}`.trim()
        : message;
    if (operation.kind === 'command')
      book = rememberConversation(
        saved.book,
        book,
        operation.text,
        combined,
        status,
        rememberedCommands,
      );
    const completion =
      completionEligible &&
      operation.kind === 'command' &&
      ['command', 'reply', 'explanation'].includes(status)
        ? verifiedCompletion(
            currentProblem(saved.book),
            currentProblem(book),
            rememberedCommands ?? [],
            completionDecision,
          )
        : null;
    return {
      book,
      clarification: null,
      status,
      message: combined,
      ...extras,
      ...(completion ? { completion } : {}),
    };
  };
  if (operation.kind === 'branch') {
    book = switchBranch(book, operation.index);
    return done('Opened the other branch.');
  }
  if (operation.kind === 'revise-step') {
    const revised = applyHistoryCommand(
      book,
      `revise step ${operation.step} to ${operation.expression}`,
    );
    if (!revised) throw new Error('Invalid step revision.');
    book = revised.book;
    return done(revised.message);
  }
  if (operation.kind === 'graph') {
    const result = previewGraphCommands(
      currentProblem(book).state,
      operation.commands,
    );
    book = recordStep(
      book,
      result.state,
      storeCommandGroup(operation.commands),
      operation.text,
    );
    book = saveDraft(book, operation.consumeDraft ? '' : saved.book.draft);
    rememberedCommands = operation.commands;
    book = rememberConversation(
      saved.book,
      book,
      operation.text,
      result.message,
      'command',
      operation.commands,
    );
    return done(result.message);
  }
  if (operation.kind === 'graph-question') {
    book = rememberConversation(
      saved.book,
      book,
      operation.text,
      operation.question,
      'clarification',
    );
    return done(operation.question, {
      status: 'clarification',
      clarification: { request: operation.text, question: operation.question },
    });
  }
  if (operation.kind === 'exploration') {
    book = adjustExplanation(book, operation.name, operation.value);
    return done();
  }
  if (operation.kind === 'dismiss-exploration') {
    book = presentExplanation(book, { action: 'hide' });
    return done();
  }
  if (operation.kind === 'draft') {
    if (operation.problemId !== book.problemId)
      throw new Error(
        'The active problem changed. Your draft has not been saved.',
      );
    book = saveDraft(book, operation.text);
    return done('', { clarification: saved.clarification });
  }
  if (operation.kind === 'delete') {
    const activeDeleted = book.problemId === operation.problemId;
    book = deleteProblem(book, operation.assignmentId, operation.problemId);
    return done('Problem deleted.', {
      clarification: activeDeleted ? null : saved.clarification,
    });
  }
  if (operation.kind === 'select') {
    book = selectProblem(book, operation.assignmentId, operation.problemId);
    return done();
  }
  if (operation.kind === 'new') {
    book = startProblem(book, operation.title, operation.assignmentTitle);
    return done('Started a new problem.');
  }
  if (operation.kind === 'import') {
    book = mergeProblemLibrary(book, decodeProblemLibrary(operation.notebook));
    return done('Backup imported as additional assignments.');
  }
  if (operation.kind === 'recovery') {
    book = saveDraft(
      updateProblem(book, (p) => ({ ...p, recovery: undefined })),
      operation.text,
    );
    return done();
  }
  const request = operation.text.trim();
  if (
    saved.clarification &&
    /^(?:never mind|cancel (?:the )?(?:question|clarification))$/i.test(request)
  )
    return done('Question cancelled.');
  let text =
    resolveClarification(saved.clarification ?? undefined, request) ?? request;
  const command = text.replace(/^please\s+/i, '').replace(/[.?]+$/, '');
  const consume = () => {
    if (operation.consumeDraft) book = saveDraft(book, '');
  };
  if (
    /^(new session|new problem|clear workspace|new assignment)$/i.test(command)
  ) {
    consume();
    book = startProblem(
      book,
      undefined,
      /^new assignment$/i.test(command)
        ? `Assignment ${book.assignments.length + 1}`
        : undefined,
    );
    return done('Started new work.');
  }
  const named = command.match(
    /^new (problem|assignment)(?: (?:called|named))?\s+(.+)$/i,
  );
  if (named) {
    if (named[2].length > 200)
      throw new Error('Keep names under 200 characters.');
    consume();
    book = startProblem(
      book,
      named[1].toLowerCase() === 'problem' ? named[2] : undefined,
      named[1].toLowerCase() === 'assignment' ? named[2] : undefined,
    );
    return done('Started new work.');
  }
  const rename = command.match(/^rename (problem|assignment)(?: to)? (.+)$/i);
  if (rename) {
    if (rename[2].length > 200)
      throw new Error('Keep names under 200 characters.');
    consume();
    book =
      rename[1].toLowerCase() === 'problem'
        ? updateProblem(book, (p) => ({ ...p, title: rename[2] }))
        : {
            ...book,
            assignments: book.assignments.map((a) =>
              a.id === book.assignmentId ? { ...a, title: rename[2] } : a,
            ),
          };
    return done(`Renamed ${rename[1]}.`);
  }
  const open = command.match(/^open (problem|assignment) (.+)$/i);
  if (open) {
    const items =
      open[1].toLowerCase() === 'problem'
        ? book.assignments.find((a) => a.id === book.assignmentId)!.problems
        : book.assignments;
    const label = open[2].toLowerCase();
    const number =
      Number(label) ||
      [
        'one',
        'two',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
        'ten',
      ].indexOf(label) + 1;
    const matches = number
      ? [items[number - 1]].filter(Boolean)
      : items.filter((item) => item.title.toLowerCase() === label);
    if (matches.length !== 1)
      return done('Which one? Use a unique name or its number.', {
        status: 'clarification',
        clarification: {
          request,
          question: 'Which one? Use a unique name or its number.',
        },
      });
    consume();
    const item = matches[0];
    book =
      open[1].toLowerCase() === 'problem'
        ? selectProblem(book, book.assignmentId, item.id)
        : selectProblem(
            book,
            item.id,
            book.assignments.find((a) => a.id === item.id)!.problems[0].id,
          );
    return done('Opened saved work.');
  }
  let aiUnavailable = false;
  try {
    const confirmation = saved.clarification
      ? null
      : resolveConversation(
          request,
          currentProblem(book).conversation || [],
          currentProblem(book).state,
        );
    const direct =
      !saved.clarification && !confirmation
        ? directMathCommand(request, currentProblem(book).state)
        : null;
    // Assess final-looking answers across subjects, including transforms that isolate h or another variable.
    const candidate = direct
      ? runCommand(currentProblem(book).state, direct).state.expression
      : '';
    // A plotted y=f(x) still depends on x; it is not an isolated final answer.
    const functionGraph =
      /^graph\b|^plot\b/i.test(direct ?? '') ||
      (currentProblem(book).state.graph &&
        /^y\s*=/i.test(candidate) &&
        /\bx\b/.test(candidate));
    const assessAnswer =
      !functionGraph &&
      operation.interpret &&
      interpret &&
      direct &&
      currentProblem(book).steps.length > 0 &&
      !/^read\b/i.test(direct) &&
      (/^[a-z]\s*=|=\s*[a-z]$/i.test(candidate) || !/[a-z]/i.test(candidate));
    if (direct && !assessAnswer) text = direct;
    if (
      confirmation ||
      (operation.interpret && interpret && (!direct || assessAnswer))
    ) {
      try {
        const prediction = validateInterpretation(
          confirmation ?? (await interpret!(request, saved)),
          currentProblem(book).state,
          historyContext(book),
          saved.clarification && !explanationRequest(request)
            ? undefined
            : request,
        );
        rememberedCommands = prediction.commands;
        completionDecision = prediction.completion;
        book = presentExplanation(book, prediction.presentation);
        if (prediction.status === 'correction') {
          const correction = correctConversation(
            book,
            prediction.commands || [],
            request,
          );
          book = correction.book;
          consume();
          return {
            book,
            clarification: null,
            status: 'correction',
            message: correction.message,
            ...(prediction.completion
              ? {
                  completion: verifiedCompletion(
                    currentProblem(saved.book),
                    currentProblem(book),
                    prediction.commands || [],
                    prediction.completion,
                  )!,
                }
              : {}),
          };
        }
        if (prediction.status !== 'command') {
          completionEligible =
            !!prediction.completion && !prediction.commands?.length;
          consume();
          return done(prediction.message, {
            status: prediction.status,
            clarification:
              prediction.status === 'clarification'
                ? {
                    request: saved.clarification?.request ?? request,
                    question: prediction.message,
                  }
                : null,
          });
        }
        assistantMessage = prediction.message;
        text = prediction.commands?.length
          ? storeCommandGroup(prediction.commands)
          : prediction.command;
      } catch {
        aiUnavailable = true;
      }
    }
    rememberedCommands ??= splitMathPlan(text) ?? [text];
    const panel = panelCommand(text);
    if (panel) {
      consume();
      return done(`${panel.open ? 'Opened' : 'Closed'} ${panel.panel}.`, {
        panel,
        aiUnavailable,
      });
    }
    if (
      /^(export|export work|export problem|export notebook|print|save pdf|export pdf)$/i.test(
        text,
      )
    ) {
      consume();
      return done('', { action: /pdf|print/i.test(text) ? 'print' : 'export' });
    }
    if (/^(read work|read my work|read steps)$/i.test(text))
      return done(
        currentProblem(book)
          .steps.map(
            (s, i) => `Step ${i + 1}. ${s.displayCommand || s.command}`,
          )
          .join('\n') || 'No steps yet.',
        { action: 'read' },
      );
    const plan = splitMathPlan(text);
    if (plan) {
      const result = applyMathPlan(book, plan);
      completionEligible = true;
      book = saveDraft(
        result.book,
        operation.consumeDraft ? '' : saved.book.draft,
      );
      return done(result.message, { aiUnavailable });
    }
    const history = applyHistoryCommand(book, text);
    if (history) {
      book = history.book;
      consume();
      return done(history.message, { aiUnavailable });
    }
    const previous = currentProblem(book).state;
    const result = runCommand(previous, text);
    completionEligible = true;
    book =
      result.written || contentChanged(previous, result.state)
        ? recordStep(book, result.state, result.storedCommand || text, request)
        : updateProblem(book, (p) => ({ ...p, state: result.state }));
    book = saveDraft(book, operation.consumeDraft ? '' : saved.book.draft);
    return done(result.message, {
      action: result.action,
      sonifyExpression: result.sonifyExpression,
      aiUnavailable,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Could not understand that request.';
    const clarification = error instanceof ClarificationError;
    return {
      book: saved.book,
      clarification: clarification
        ? {
            request: saved.clarification?.request ?? request,
            question: message,
          }
        : saved.clarification,
      status: clarification ? 'clarification' : 'unsupported',
      message,
      aiUnavailable,
    };
  }
}
