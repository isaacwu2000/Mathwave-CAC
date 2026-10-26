import { expect, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  validateInterpretation,
  validateModelInterpretation,
} from '../index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { runCommand } from '../index.ts';
test('provider responses require DSL programs and reject legacy envelope fields', () => {
  const response = {
    status: 'command',
    programs: ['problem.save(math.equation("x=4"));'],
    message: '',
    presentation: null,
  };
  assert.equal(
    validateModelInterpretation(response, initialWorkspace).command,
    'typescript\nproblem.save(math.equation("x=4"));',
  );
  for (const legacy of [
    { command: '' },
    { commands: [] },
    { program: '' },
    { revision: 'text-request' },
  ])
    assert.throws(
      () =>
        validateModelInterpretation(
          { ...response, ...legacy },
          initialWorkspace,
        ),
      /DSL response format/,
    );
});
test('an explanation proposal must save its proposed result when later accepted', () => {
  const response = {
    status: 'explanation',
    programs: [
      'const next = math.subtractBothSides(problem.currentEquation(), 3); problem.read(next);',
    ],
    message: 'Subtracting three gives x=4.',
    presentation: null,
  };
  const state = { ...initialWorkspace, expression: 'x+3=7' };
  assert.throws(
    () => validateModelInterpretation(response, state),
    /proposed action.*save/i,
  );
});
test('AI command output is validated before applying it', () => {
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'find outliers', message: '' },
      initialWorkspace,
    ).command,
    'find outliers',
  );
  for (const command of [
    'clear',
    'new session',
    'export problem',
    'write unknown nonsense',
    'divide both sides by zero',
  ]) {
    assert.throws(() =>
      validateInterpretation(
        { status: 'command', command, message: '' },
        initialWorkspace,
      ),
    );
  }
  assert.throws(() =>
    validateInterpretation({ status: 'command', command: 5 }, initialWorkspace),
  );
  assert.equal(
    validateInterpretation(
      {
        status: 'clarification',
        command: '',
        message: 'Sample or population?',
      },
      initialWorkspace,
    ).status,
    'clarification',
  );
});
test('AI can use graph and geometry tools while invalid dimensions remain blocked', () => {
  const commands = [
    'graph y = x^2',
    'range -5 to 5',
    'zoom in',
    'find roots',
    'circle radius 5',
    'set radius to 7',
    'area',
  ];
  let state = initialWorkspace;
  for (const command of commands) {
    assert.equal(
      validateInterpretation({ status: 'command', command, message: '' }, state)
        .command,
      command,
    );
    state = runCommand(state, command).state;
  }
  assert.throws(() =>
    validateInterpretation(
      { status: 'command', command: 'circle radius -4', message: '' },
      state,
    ),
  );
});

test('graph studio and new geometry actions remain available to validated AI interpretations', () => {
  const graph = runCommand(initialWorkspace, 'graph y=x^2').state;
  for (const command of [
    'add graph y=4',
    'edit graph 1 to y=x',
    'pan graph up',
    'view x -4 to 4 y -6 to 6',
    'evaluate graph 1 at x 3',
  ]) {
    assert.equal(
      validateInterpretation({ status: 'command', command, message: '' }, graph)
        .command,
      command,
    );
  }
  for (const command of [
    'cone radius 3 height 4',
    'parallelogram base 6 height 3',
    'trapezoid a 8 b 4 height 3',
  ]) {
    assert.equal(
      validateInterpretation(
        { status: 'command', command, message: '' },
        initialWorkspace,
      ).command,
      command,
    );
  }
});

test('selected-curve audio, intercepts and fit commands validate without changing the equation', () => {
  const state = runCommand(
    runCommand(initialWorkspace, 'graph y=x^2-4').state,
    'add graph y=x-7',
  ).state;
  for (const command of ['fit graph', 'find roots of graph 2', 'play graph 2'])
    assert.equal(
      validateInterpretation({ status: 'command', command, message: '' }, state)
        .command,
      command,
    );
  assert.throws(
    () =>
      validateInterpretation(
        { status: 'command', command: 'play graph 9', message: '' },
        state,
      ),
    /does not exist/,
  );
});

test('a vague edit may use an explicit assumed target without a confirmation gate', () => {
  const state = runCommand(initialWorkspace, 'write 2*x+3=9').state;
  const result = validateInterpretation(
    {
      status: 'command',
      command: 'replace 3 with 5',
      message: 'I changed the left constant to five.',
    },
    state,
    undefined,
    'change that number to five',
  );
  assert.equal(
    runCommand(state, result.command).state.expression,
    '2 * x + 5 = 9',
  );
});

test('preserves the agent completion decision through a validated multi-step program', () => {
  const result = validateModelInterpretation(
    {
      status: 'command',
      programs: [
        'problem.save(math.equation("x=-2"));',
        'problem.save(math.equation("x=-1"));',
      ],
      message: '',
      presentation: null,
      completion: { answer: 'x=-2 or x=-1' },
    },
    { ...initialWorkspace, expression: 'x^2+3*x+2' },
  );
  expect(result.commands).toHaveLength(2);
  expect(result.completion).toEqual({ answer: 'x=-2 or x=-1' });
});
