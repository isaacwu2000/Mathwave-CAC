import { expect, test } from 'vitest';
import { migrateDslHistory } from './dsl-history.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
} from '../../src/modules/problems/index.ts';
import { runCommand } from '../../src/modules/commands/index.ts';

test('history migration converts current and recovery steps without changing their mathematics', () => {
  let book = createProblemLibrary();
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, 'write x+3=7').state,
    'write x+3=7',
  );
  const problem = currentProblem(book);
  problem.steps[0].command = 'write x+3=7';
  const state = JSON.stringify(problem.state);
  const migrated = migrateDslHistory(book);
  expect(currentProblem(migrated).steps[0].command).toBe(
    'typescript\nproblem.save(math.expression("x + 3 = 7"));',
  );
  expect(JSON.stringify(currentProblem(migrated).state)).toBe(state);
  expect(currentProblem(undoStep(migrated)).steps).toHaveLength(0);
  expect(migrateDslHistory(migrated)).toEqual(migrated);
  expect(currentProblem(book).steps[0].command).toBe('write x+3=7');
});

test('migration covers recovery branches, archived proposals and applied conversation evidence', () => {
  const step = {
    command: 'write x=4',
    state: currentProblem(createProblemLibrary()).state,
    at: '2026-10-22T00:00:00Z',
  };
  const document = {
    undoRevisions: [{ steps: [step] }],
    redoRevisions: [{ steps: [step] }],
    conversationArchive: [
      {
        request: 'Write four',
        stateKey: 'unchanged',
        status: 'explanation',
        commands: ['write x=4'],
      },
      {
        request: 'Did it',
        stateKey: 'unchanged',
        status: 'command',
        commands: ['write x=4'],
        revisable: true,
        undoDepth: 1,
      },
    ],
  };
  const migrated = migrateDslHistory(document);
  expect(migrated.undoRevisions[0].steps[0].command).toBe(
    'typescript\nproblem.save(math.expression("x = 4"));',
  );
  expect(migrated.redoRevisions).toEqual(migrated.undoRevisions);
  expect(migrated.conversationArchive[0].commands).toEqual([
    'typescript\nproblem.save(math.expression("x = 4"));',
  ]);
  expect(migrated.conversationArchive[1]).toEqual({
    request: 'Did it',
    stateKey: 'unchanged',
    status: 'command',
    revisable: true,
    undoDepth: 1,
  });
});

test('retired flowchart proposals cannot be migrated into executable commands', () => {
  const state = {
    ...currentProblem(createProblemLibrary()).state,
    mode: 'diagram' as const,
    diagram: ['Start', 'End'],
  };
  const document = {
    state,
    conversation: [
      {
        request: 'Replace the end',
        stateKey: 'same',
        status: 'explanation',
        commands: ['replace End with Finish'],
      },
    ],
  };
  const before = structuredClone(document);
  expect(() => migrateDslHistory(document)).toThrow();
  expect(document).toEqual(before);
});
