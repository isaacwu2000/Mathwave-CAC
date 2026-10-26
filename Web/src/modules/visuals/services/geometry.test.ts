import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseGeometry, geometryMeasures } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  decodeProblemLibrary,
  problemLibraryText,
  cancelStep,
} from '../../problems/index.ts';
import { resolveClarification } from '../../commands/index.ts';
test('spoken multi-dimension edits validate the final shape and undo together', () => {
  let book = createProblemLibrary();
  for (const command of [
    'triangle a 3 b 4 c 5',
    'set a to 100 and b to 100 and c to 100',
  ]) {
    const result = runCommand(currentProblem(book).state, command);
    book = recordStep(book, result.state, command);
  }
  assert.deepEqual(currentProblem(book).state.geometry!.dimensions, {
    a: 100,
    b: 100,
    c: 100,
  });
  assert.deepEqual(currentProblem(undoStep(book)).state.geometry!.dimensions, {
    a: 3,
    b: 4,
    c: 5,
  });
  const state = currentProblem(book).state;
  const before = JSON.stringify(state);
  assert.throws(
    () => runCommand(state, 'set a to 1 and b to 2 and c to 9'),
    /cannot form/,
  );
  assert.throws(
    () => runCommand(state, 'set a to 8 and a to 9'),
    /What number should the a/,
  );
  assert.throws(
    () => runCommand(state, 'set a to 8 and radius to 9'),
    /no radius/,
  );
  assert.equal(JSON.stringify(state), before);
  // Replaying later edits after canceling the earlier edit must still be atomic.
  assert.deepEqual(
    currentProblem(cancelStep(book, 2)).state.geometry!.dimensions,
    { a: 3, b: 4, c: 5 },
  );
});
test('partial multi-dimension edits preserve other dimensions and mathematical operands', () => {
  const state = runCommand(initialWorkspace, 'cone radius 3 height 4').state;
  assert.deepEqual(
    runCommand(
      state,
      'change radius to two plus three and change the height to six',
    ).state.geometry!.dimensions,
    { radius: 5, height: 6 },
  );
  assert.deepEqual(
    runCommand(state, 'said radius to 7').state.geometry!.dimensions,
    { radius: 7, height: 4 },
  );
  assert.deepEqual(
    runCommand(state, 'set height 9').state.geometry!.dimensions,
    { radius: 3, height: 9 },
  );
  const rectangle = runCommand(
    initialWorkspace,
    'rectangle width 3 height 4',
  ).state;
  assert.deepEqual(
    runCommand(rectangle, 'set width to 8, height to 9').state.geometry!
      .dimensions,
    { width: 8, height: 9 },
  );
});
test('spoken dimensions create shapes and calculations retain formulas and units', () => {
  const g = parseGeometry('create a circle with radius five')!;
  assert.equal(g.dimensions.radius, 5);
  assert.equal(geometryMeasures(g).area.value, 25 * Math.PI);
  const r = runCommand(initialWorkspace, 'rectangle width six and height four');
  assert.equal(r.state.mode, 'geometry');
  assert.match(runCommand(r.state, 'find area').message, /24 square units/);
  assert.match(runCommand(r.state, 'perimeter').message, /20 units/);
  assert.equal(
    runCommand(r.state, 'set width to eight').state.geometry!.dimensions.width,
    8,
  );
});
test('triangle measurements respect triangle inequality and perpendicular legs', () => {
  const right = geometryMeasures(
    parseGeometry('right triangle leg a three leg b four')!,
  );
  assert.equal(right.hypotenuse.value, 5);
  assert.equal(right.area.value, 6);
  const t = geometryMeasures(parseGeometry('triangle a 3 b 4 c 5')!);
  assert.equal(t.area.value, 6);
  assert.ok(Math.abs(t['angle c'].value - 90) < 1e-10);
  assert.throws(() => parseGeometry('triangle a 1 b 2 c 4'), /cannot form/);
  assert.throws(() => parseGeometry('circle radius minus two'), /positive/);
  assert.throws(() => parseGeometry('rectangle width 5'), /height/);
  assert.throws(
    () =>
      runCommand(
        runCommand(initialWorkspace, 'square side 3').state,
        'set radius to 2',
      ),
    /no radius/,
  );
});
test('solid geometry provides volume and surface area', () => {
  assert.equal(
    geometryMeasures(parseGeometry('cylinder radius 2 height 5')!).volume.value,
    20 * Math.PI,
  );
  assert.equal(
    geometryMeasures(parseGeometry('sphere radius 3')!).volume.value,
    36 * Math.PI,
  );
});
test('geometry steps survive export, reload, targeted cancellation and undo', () => {
  let b = createProblemLibrary();
  for (const command of [
    'rectangle width 6 height 4',
    'set width to 8',
    'set height to 5',
  ]) {
    const result = runCommand(currentProblem(b).state, command);
    b = recordStep(b, result.state, command);
  }
  const decoded = decodeProblemLibrary(JSON.stringify(b));
  assert.deepEqual(
    currentProblem(decoded).state.geometry,
    currentProblem(b).state.geometry,
  );
  assert.match(problemLibraryText(decoded), /width 8, height 5/);
  const canceled = cancelStep(b, 2);
  assert.deepEqual(currentProblem(canceled).state.geometry!.dimensions, {
    width: 6,
    height: 5,
  });
  assert.deepEqual(
    currentProblem(undoStep(canceled)).state.geometry!.dimensions,
    { width: 8, height: 5 },
  );
  const bad = JSON.parse(JSON.stringify(b));
  bad.assignments[0].problems[0].state.geometry.dimensions.width = -2;
  assert.throws(() => decodeProblemLibrary(JSON.stringify(bad)), /positive/);
});
test('missing dimension follow-up works locally without guessing', () => {
  const cmd = resolveClarification(
    {
      request: 'rectangle width six',
      question: 'What is the rectangle height?',
    },
    'four',
  );
  assert.equal(cmd, 'rectangle width six height four');
  assert.equal(
    runCommand(initialWorkspace, cmd!).state.geometry!.dimensions.height,
    4,
  );
});
test('base-height triangle calculates only what the given dimensions determine', () => {
  const state = runCommand(
    initialWorkspace,
    'triangle base ten height six',
  ).state;
  assert.match(runCommand(state, 'area').message, /30 square units/);
  assert.throws(() => runCommand(state, 'perimeter'), /unavailable/);
  assert.match(
    runCommand(runCommand(state, 'set base to eight').state, 'area').message,
    /24 square units/,
  );
  assert.throws(
    () => parseGeometry('triangle base 5 height 3 a 4'),
    /once each/,
  );
});
test('empty dimensions ask one question at a time and accept labeled numeric answers', () => {
  assert.throws(() => parseGeometry('triangle'), /What is the triangle a/);
  const cmd = resolveClarification(
    { request: 'circle radius', question: 'What is the circle radius?' },
    'radius seven',
  );
  assert.equal(cmd, 'circle radius seven');
  assert.equal(
    runCommand(initialWorkspace, cmd!).state.geometry!.dimensions.radius,
    7,
  );
  assert.equal(
    resolveClarification(
      { request: 'circle radius', question: 'What is the circle radius?' },
      'undo',
    ),
    null,
  );
});
test('recorded speech phrasing supports legs, sides, articles and inline measures', () => {
  assert.equal(
    runCommand(initialWorkspace, 'Draw a right triangle with legs 3 and 4.')
      .state.geometry!.dimensions.b,
    4,
  );
  assert.equal(
    runCommand(initialWorkspace, 'Triangle with sides 3, 4, 5.').state.geometry!
      .dimensions.c,
    5,
  );
  assert.equal(
    runCommand(initialWorkspace, 'Draw a circle with a radius of 5.').state
      .geometry!.dimensions.radius,
    5,
  );
  const inline = runCommand(
    initialWorkspace,
    'Find the area of a triangle with base 10 and height 6.',
  );
  assert.equal(inline.written, true);
  assert.match(inline.message, /30 square units/);
  const right = runCommand(initialWorkspace, 'right triangle a 3 b 4').state;
  assert.match(
    runCommand(right, 'Find the High Potter News.').message,
    /hypotenuse: 5/,
  );
  const triangle = runCommand(initialWorkspace, 'triangle a 3 b 4 c 5').state;
  assert.match(runCommand(triangle, 'Find Angles See').message, /angle c: 90/);
  const cylinder = runCommand(
    initialWorkspace,
    'cylinder radius 2 height 5',
  ).state;
  assert.match(
    runCommand(cylinder, 'Find its volume.').message,
    /62.8319 cubic units/,
  );
  assert.throws(() =>
    runCommand(initialWorkspace, 'Find the High Potter News.'),
  );
});
test('uncertain spoken numbers clarify without changing dimensions', () => {
  const state = runCommand(
    initialWorkspace,
    'rectangle width 6 height 4',
  ).state;
  assert.throws(
    () => runCommand(state, 'change width to age'),
    /What number should the width change to/,
  );
  assert.equal(state.geometry!.dimensions.width, 6);
  const question = {
    request: 'Rectangle width six.',
    question: 'What is the rectangle height?',
  };
  assert.equal(
    resolveClarification(question, 'four'),
    'Rectangle width six height four',
  );
  assert.equal(resolveClarification(question, 'full'), 'Rectangle width six');
  assert.equal(resolveClarification(question, 'undo'), null);
  const edit = {
    request: 'Change the width to age.',
    question: 'What number should the width change to?',
  };
  assert.equal(resolveClarification(edit, 'eight'), 'set width to eight');
  assert.equal(resolveClarification(edit, 'undo'), null);
});
test('an inline measurement clarification retains the requested calculation', () => {
  const question = {
    request: 'Find the area of a rectangle with width six.',
    question: 'What is the rectangle height?',
  };
  const reply = resolveClarification(question, 'four');
  assert.equal(
    reply,
    'Find the area of a rectangle with width six height four',
  );
  const result = runCommand(initialWorkspace, reply!);
  assert.equal(result.state.mode, 'geometry');
  assert.match(result.message, /24 square units/);
});
test('natural clarification sentences work and unrelated commands still execute separately', () => {
  const edit = {
    request: 'Change the width to age.',
    question: 'What number should the width change to?',
  };
  assert.equal(
    resolveClarification(edit, 'The width should be eight.'),
    'set width to eight',
  );
  const create = {
    request: 'Rectangle width six.',
    question: 'What is the rectangle height?',
  };
  assert.equal(
    resolveClarification(create, 'The height is four.'),
    'Rectangle width six height four',
  );
  assert.equal(
    resolveClarification(create, 'Hide for.'),
    'Rectangle width six',
  );
  assert.equal(resolveClarification(create, 'hide graph'), null);
  assert.equal(resolveClarification(create, 'graph y = x squared'), null);
});

test('new geometry calculates only measures determined by the given dimensions', () => {
  const cone = parseGeometry('create a cone with radius 3 and height 4')!;
  assert.equal(geometryMeasures(cone)['slant height'].value, 5);
  assert.equal(geometryMeasures(cone).volume.value, 12 * Math.PI);
  assert.equal(geometryMeasures(cone)['surface area'].value, 24 * Math.PI);
  const parallelogram = runCommand(
    initialWorkspace,
    'parallelogram base 10 height 6',
  ).state;
  assert.match(runCommand(parallelogram, 'area').message, /60 square units/);
  assert.throws(() => runCommand(parallelogram, 'perimeter'), /unavailable/);
  const trapezoid = runCommand(
    initialWorkspace,
    'trapezoid base a 8 base b 4 height 3',
  ).state;
  assert.match(runCommand(trapezoid, 'area').message, /18 square units/);
  assert.match(
    runCommand(runCommand(trapezoid, 'set a to 10').state, 'area').message,
    /21 square units/,
  );
  assert.throws(() => parseGeometry('cone radius 3'), /height/);
  assert.throws(() => parseGeometry('trapezoid a -2 b 4 height 3'), /positive/);
  const pending = {
    request: 'parallelogram base 10',
    question: 'What is the parallelogram height?',
  };
  assert.equal(
    resolveClarification(pending, 'height six'),
    'parallelogram base 10 height six',
  );
});

test('complete dimension changes are atomic, reject invalid triangles, and undo as one edit', () => {
  let book = createProblemLibrary();
  for (const command of [
    'triangle a 3 b 4 c 5',
    'triangle a 100 b 100 c 100',
  ]) {
    const result = runCommand(currentProblem(book).state, command);
    book = recordStep(book, result.state, command);
  }
  const before = JSON.stringify(book);
  assert.throws(
    () => runCommand(currentProblem(book).state, 'triangle a 1 b 2 c 9'),
    /cannot form/,
  );
  assert.equal(JSON.stringify(book), before);
  assert.deepEqual(currentProblem(undoStep(book)).state.geometry!.dimensions, {
    a: 3,
    b: 4,
    c: 5,
  });
  assert.deepEqual(
    currentProblem(decodeProblemLibrary(JSON.stringify(book))).state.geometry!
      .dimensions,
    { a: 100, b: 100, c: 100 },
  );
});
