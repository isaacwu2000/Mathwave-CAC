import { test } from 'vitest';
import assert from 'node:assert/strict';
import { initialWorkspace } from '../../workspace/state.ts';
import { runCommand } from '../../commands/index.ts';

test('Chrome write/right homophone is repaired only for complete math equations', () => {
  assert.deepEqual(
    runCommand(initialWorkspace, 'right 2x + 3 = 11'),
    runCommand(initialWorkspace, 'write 2x + 3 = 11'),
  );
  assert.deepEqual(
    runCommand(initialWorkspace, 'right two x plus three equals eleven'),
    runCommand(initialWorkspace, 'write two x plus three equals eleven'),
  );
  assert.equal(
    runCommand(
      initialWorkspace,
      'draw a right triangle with legs three and four',
    ).state.geometry?.shape,
    'right triangle',
  );
  assert.throws(() => runCommand(initialWorkspace, 'right my homework'));
  assert.throws(() => runCommand(initialWorkspace, 'right side equals eleven'));
});

test('unambiguous triangle side lists survive missing ASR punctuation', () => {
  assert.deepEqual(
    runCommand(initialWorkspace, 'triangle with sides 3 4 5').state.geometry,
    { shape: 'triangle', dimensions: { a: 3, b: 4, c: 5 } },
  );
  assert.throws(() => runCommand(initialWorkspace, 'triangle with sides 3 4'));
  assert.throws(() =>
    runCommand(initialWorkspace, 'triangle with sides 1 2 9'),
  );
  assert.throws(() =>
    runCommand(initialWorkspace, 'triangle with sides 3 4 5 6'),
  );
});

test('rectangle width homophone keeps explicit dimensions and preserves missing-height clarification', () => {
  assert.deepEqual(
    runCommand(initialWorkspace, 'create a rectangle with with 6 and height 4')
      .state.geometry,
    { shape: 'rectangle', dimensions: { width: 6, height: 4 } },
  );
  assert.throws(
    () => runCommand(initialWorkspace, 'create a rectangle with with 6'),
    /height/,
  );
  assert.throws(() =>
    runCommand(
      initialWorkspace,
      'create a rectangle with with unknown and height 4',
    ),
  );
});

test('explicit numeric lists survive missing speech punctuation without splitting numeric expressions', () => {
  assert.match(
    runCommand(initialWorkspace, 'find the median of 2 4 8 10').message,
    /median: 6/i,
  );
  assert.deepEqual(
    runCommand(initialWorkspace, 'data -2 4.5 8 10').state.data,
    [-2, 4.5, 8, 10],
  );
  assert.deepEqual(
    runCommand(initialWorkspace, 'data 1/2, 2+3, 6').state.data,
    [0.5, 5, 6],
  );
  assert.throws(() =>
    runCommand(initialWorkspace, 'find median of two for eight ten'),
  );
});

test('set/said repair needs an existing shape and an explicit dimension and value', () => {
  const circle = runCommand(initialWorkspace, 'circle radius 5').state;
  assert.equal(
    runCommand(circle, 'said the radius to 7').state.geometry!.dimensions
      .radius,
    7,
  );
  assert.throws(() => runCommand(initialWorkspace, 'said the radius to 7'));
  assert.throws(() => runCommand(circle, 'said the radius to weather'));
  assert.throws(() => runCommand(circle, 'said the width to 7'), /no width/);
});
