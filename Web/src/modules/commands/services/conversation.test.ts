import { test, expect } from 'vitest';
import {
  validateInterpretation,
  resolveConversation,
  conversationContext,
  workspaceKey,
} from '../index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
test('explanations remain read-only and okay do that accepts only a current validated suggestion', () => {
  const state = { ...initialWorkspace, expression: '2*x+3=11' };
  const response = validateInterpretation(
    {
      status: 'explanation',
      command: '',
      message:
        'Subtracting three cancels the added three while keeping both sides equal.',
      commands: ['subtract 3 from both sides', 'simplify'],
    },
    state,
  );
  expect(response.status).toBe('explanation');
  const turns = [
    {
      request: 'Why subtract three?',
      response: response.message,
      status: 'explanation' as const,
      commands: response.commands,
      stateKey: workspaceKey(state),
    },
  ];
  expect(resolveConversation('okay do that', turns, state)?.commands).toEqual([
    'subtract 3 from both sides',
    'simplify',
  ]);
  expect(() =>
    resolveConversation('do that', turns, { ...state, expression: 'x=9' }),
  ).toThrow(/changed/);
  expect(() =>
    validateInterpretation(
      {
        status: 'explanation',
        command: 'subtract 3 from both sides',
        message: 'Because...',
        commands: [],
      },
      state,
    ),
  ).toThrow();
  expect(() =>
    validateInterpretation(
      { status: 'command', command: 'subtract 3 from both sides', message: '' },
      state,
      undefined,
      'Why would I subtract three?',
    ),
  ).toThrow(/explanation/i);
});

test('explanation suggestions cannot smuggle history controls or edits in the answer field', () => {
  expect(() =>
    validateInterpretation(
      {
        status: 'explanation',
        command: '',
        message: 'Try undo.',
        commands: ['undo'],
      },
      initialWorkspace,
    ),
  ).toThrow();
  expect(() =>
    validateInterpretation(
      {
        status: 'correction',
        command: '',
        message: '',
        commands: ['write x=3'],
      },
      initialWorkspace,
      undefined,
      'Why is x three?',
    ),
  ).toThrow(/explanation/);
  expect(
    resolveConversation(
      'yes, subtract two from both sides',
      [],
      initialWorkspace,
    ),
  ).toBeNull();
});

test('correction semantics are deferred until the problem restores the original workspace', () => {
  const state = {
    ...initialWorkspace,
    expression: 'y=x',
    graph: true,
    graphExpressions: ['y=x^2'],
  };
  expect(
    validateInterpretation(
      {
        status: 'correction',
        command: '',
        message: '',
        commands: ['remove graph 3'],
      },
      state,
      undefined,
      'No, I meant graph three',
    ).status,
  ).toBe('correction');
});

test('natural replies need no math action and can offer an action without applying it', () => {
  const state = { ...initialWorkspace, expression: 'x+4=9' };
  const reply = validateInterpretation(
    {
      status: 'reply',
      command: '',
      message: 'We can leave it here and come back later.',
      commands: [],
    },
    state,
    undefined,
    'I need a break',
  );
  expect(reply.status).toBe('reply');
  const suggestion = validateInterpretation(
    {
      status: 'reply',
      command: '',
      message: 'Try taking four off both sides.',
      commands: ['subtract 4 from both sides', 'simplify'],
    },
    state,
  );
  expect(
    resolveConversation(
      'sure',
      [
        {
          request: 'What next?',
          response: suggestion.message,
          status: 'reply',
          commands: suggestion.commands,
          stateKey: workspaceKey(state),
        },
      ],
      state,
    )?.commands,
  ).toEqual(suggestion.commands);
  expect(state.expression).toBe('x+4=9');
});

test('actions can carry a natural response while their plan is still validated', () => {
  const result = validateInterpretation(
    {
      status: 'command',
      command: '',
      message: 'I’ll remove the four from both sides.',
      commands: ['subtract 4 from both sides', 'simplify'],
    },
    { ...initialWorkspace, expression: 'x+4=9' },
  );
  expect(result.message).toBe('I’ll remove the four from both sides.');
  expect(() =>
    validateInterpretation(
      { ...result, commands: ['divide both sides by 0'] },
      initialWorkspace,
    ),
  ).toThrow();
});

test('acknowledgements and accepting a verbal demonstration offer remain conversational', () => {
  const turns = [
    {
      request: 'I am confused',
      response: 'Would an adjustable example help?',
      status: 'reply' as const,
      stateKey: workspaceKey(initialWorkspace),
    },
  ];
  expect(resolveConversation('okay', turns, initialWorkspace)).toBeNull();
  expect(
    resolveConversation('okay do that', turns, initialWorkspace),
  ).toBeNull();
});

test('retrieval restores relevant older math context without sending every archived turn', () => {
  const turn = (request: string, response: string) => ({
    request,
    response,
    status: 'reply' as const,
    stateKey: workspaceKey(initialWorkspace),
  });
  const archive = [
    turn(
      'The triangle has sides five, twelve and thirteen.',
      'The right angle is opposite thirteen.',
    ),
    ...Array.from({ length: 25 }, (_, i) =>
      turn(`Explain equation detail ${i}.`, 'Keep equality.'),
    ),
  ];
  const recent = Array.from({ length: 12 }, (_, i) =>
    turn(`Read current expression ${i}.`, 'Current expression.'),
  );
  const context = conversationContext(
    'Back to that triangle: what were its sides?',
    recent,
    archive,
  );
  expect(
    context.earlier.some((t) =>
      t.request.includes('five, twelve and thirteen'),
    ),
  ).toBe(true);
  expect(context.recent).toHaveLength(6);
  expect(context.earlier.length).toBeLessThanOrEqual(4);
  expect(JSON.stringify(context).length).toBeLessThan(
    JSON.stringify({ recent, archive }).length,
  );
});

test('the older applied operation survives the retrieval size budget', () => {
  const operation = {
    request: 'subtract three from both sides',
    response: 'a'.repeat(1000),
    status: 'command' as const,
    stateKey: workspaceKey(initialWorkspace),
    revisable: true,
  };
  const archive = [
    operation,
    ...Array.from({ length: 3 }, () => ({
      request: 'triangle '.repeat(200),
      response: 'b'.repeat(1000),
      status: 'reply' as const,
      stateKey: workspaceKey(initialWorkspace),
    })),
  ];
  const context = conversationContext('triangle', [], archive);
  expect(context.earlier).toContain(operation);
  expect(JSON.stringify(context.earlier).length).toBeLessThanOrEqual(6000);
});

test('a large archived action retains its original wording without oversized command detail', () => {
  const operation = {
    request: 'Draw the six curves I described.',
    response: 'Saved six curves.',
    commands: Array.from({ length: 6 }, () => 'x'.repeat(1200)),
    status: 'command' as const,
    stateKey: workspaceKey(initialWorkspace),
    revisable: true,
  };
  const context = conversationContext(
    'Actually, use four curves instead.',
    [],
    [operation],
  );
  expect(context.earlier[0]?.request).toBe(operation.request);
  expect(JSON.stringify(context.earlier).length).toBeLessThanOrEqual(6000);
  expect(operation.commands).toHaveLength(6);
});

test('escaped characters cannot exceed the serialized retrieval budget', () => {
  const operation = {
    request: 'subtract five\n'.repeat(140),
    response: '\u0000'.repeat(1000),
    status: 'command' as const,
    stateKey: workspaceKey(initialWorkspace),
    revisable: true,
  };
  const context = conversationContext(
    'actually subtract seven',
    [],
    [operation],
  );
  expect(context.earlier[0]?.request).toContain('subtract five');
  expect(JSON.stringify(context.earlier).length).toBeLessThanOrEqual(6000);
  expect(operation.response).toHaveLength(1000);
});
