import { expect, test } from 'vitest';
import { commandSource } from './command-source.ts';
import { runCommand } from './run-command.ts';
import { initialWorkspace } from '../../workspace/state.ts';

test('saved arithmetic stays relative when an earlier step is removed', () => {
  const source = commandSource('Subtract three from both sides');
  const state = runCommand(initialWorkspace, 'write 2*x+3=11').state;
  expect(runCommand(state, source).state.expression).toBe(
    '2 * x + 3 - 3 = 11 - 3',
  );
  const changed = runCommand(initialWorkspace, 'write x+3=7').state;
  expect(runCommand(changed, source).state.expression).toBe(
    'x + 3 - 3 = 7 - 3',
  );
});

test('compiled part replacements reject a different target after history replay', () => {
  const source = commandSource('replace part 4 matching 2 with 5');
  const state = runCommand(initialWorkspace, 'write 2*x+3=11').state;
  expect(runCommand(state, source).state.expression).toBe('5 * x + 3 = 11');
  const changed = runCommand(initialWorkspace, 'write 4*x+3=11').state;
  expect(() => runCommand(changed, source)).toThrow(/part changed/);
});

test.each([
  'enter x=4',
  'equation x=4',
  'set data 1,2,3',
  'dataset 1,2,3',
  'graph',
  'clear',
  'mean of 1,2,3',
  'equation example',
  'statistics example',
  'can you write x=4 please',
  'right x equals 4',
])('supported input %s remains executable after storage', (input) => {
  const expected = runCommand(initialWorkspace, input).state;
  expect(
    JSON.parse(
      JSON.stringify(
        runCommand(initialWorkspace, commandSource(input, initialWorkspace))
          .state,
      ),
    ),
  ).toEqual(JSON.parse(JSON.stringify(expected)));
});
test('spoken dimension correction and scaling aliases preserve replay', () => {
  const state = runCommand(initialWorkspace, 'circle radius 2').state;
  for (const input of ['said radius 4', 'double shape', 'halve shape'])
    expect(
      JSON.parse(
        JSON.stringify(runCommand(state, commandSource(input, state)).state),
      ),
    ).toEqual(JSON.parse(JSON.stringify(runCommand(state, input).state)));
});
test('spoken graph arguments keep their engine meaning', () => {
  const graph = runCommand(initialWorkspace, 'graph x^2').state;
  for (const command of [
    'add tangent to graph 1 at x two',
    'shift graph 1 right two up three',
  ])
    expect(runCommand(graph, commandSource(command, graph)).state).toEqual(
      runCommand(graph, command).state,
    );
});
