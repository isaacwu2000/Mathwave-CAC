import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  curvePoints,
  graphRoots,
  graphSegments,
  graphFunction,
  graphKeyPoints,
} from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { validateInterpretation } from '../../commands/index.ts';
import { normalizeGraphReferences } from '../../commands/index.ts';
import { parseHistoryCommand } from '../../commands/index.ts';
test('spoken curve numbers work locally and leave math operands intact', () => {
  let state = runCommand(initialWorkspace, 'graph y=x^2').state;
  state = runCommand(state, 'add graph y=x+2').state;
  assert.match(
    runCommand(state, 'read key points of graph two').message,
    /Graph 2/,
  );
  assert.match(
    runCommand(state, 'evaluate graph two at x three').message,
    /x = 3, y = 5/,
  );
  assert.match(
    runCommand(state, 'find intersections of graphs one and two').message,
    /\(-1, 1\); \(2, 4\)/,
  );
  assert.equal(
    runCommand(state, 'hear graph two').sonifyExpression,
    state.graphExpressions![0],
  );
  assert.equal(
    runCommand(state, 'edit graph two to y=x+one').state.graphExpressions![0],
    'y = x + 1',
  );
  assert.equal(
    runCommand(state, 'cancel graph two').state.graphExpressions!.length,
    0,
  );
  assert.equal(
    parseHistoryCommand('cancel graph two', {
      steps: [{ number: 1, command: 'add graph y=x+2' }],
      total: 1,
      undoCount: 1,
      redoCount: 0,
    }),
    null,
  );
  assert.throws(
    () => runCommand(state, 'read key points of graph nine'),
    /does not exist/,
  );
  assert.equal(
    normalizeGraphReferences('write graph two plus one'),
    'write graph two plus one',
  );
  assert.equal(
    normalizeGraphReferences('edit graph two to y=x+two'),
    'edit graph 2 to y=x+two',
  );
  assert.equal(
    normalizeGraphReferences('evaluate graph for at x three'),
    'evaluate graph for at x three',
  );
});
test('key points include analytic vertices and intercepts without inventing nonquadratic extrema', () => {
  assert.deepEqual(graphKeyPoints('y=(x-0.371)^2+3'), [
    { name: 'y-intercept', x: 0, y: 3.137641 },
    { name: 'minimum vertex', x: 0.371, y: 3 },
  ]);
  const maximum = graphKeyPoints('y=-2*(x+4)^2+10');
  assert.deepEqual(maximum.at(-1), { name: 'maximum vertex', x: -4, y: 10 });
  assert.equal(maximum.filter((p) => p.name === 'x-intercept').length, 2);
  assert.deepEqual(graphKeyPoints('y=2*x+6'), [
    { name: 'x-intercept', x: -3, y: 0 },
    { name: 'y-intercept', x: 0, y: 6 },
  ]);
  assert.deepEqual(graphKeyPoints('y=1/x'), []);
  assert.ok(
    graphKeyPoints('y=sin(x)').every((p) => !p.name.includes('vertex')),
  );
  const outside = graphKeyPoints('y=(x-20)^2+1', { min: 1, max: 2 });
  assert.deepEqual(outside, [
    { name: 'y-intercept', x: 0, y: 401 },
    { name: 'minimum vertex', x: 20, y: 1 },
  ]);
});
test('key point queries select the requested curve and preserve work', () => {
  const state = {
    ...runCommand(initialWorkspace, 'graph y=x').state,
    graphExpressions: ['y=(x-3)^2+2'],
  };
  const query = 'find key points of graph 2';
  assert.equal(
    validateInterpretation(
      { status: 'command', command: query, message: '' },
      state,
    ).status,
    'command',
  );
  const response = runCommand(state, query);
  assert.match(response.message, /Graph 2.*minimum vertex: \(3, 2\)/);
  assert.deepEqual(response.state, state);
  assert.equal(response.changed, false);
  assert.throws(
    () => runCommand(state, 'find key points of graph 3'),
    /does not exist/,
  );
});
test('intersection commands can target any distinct pair without changing work', () => {
  let state = runCommand(initialWorkspace, 'graph y=x^2').state;
  state = runCommand(state, 'add graph y=8').state;
  state = runCommand(state, 'add graph y=x+2').state;
  const response = runCommand(state, 'find intersections of graphs 1 and 3');
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'find intersections of graphs 1 and 3',
        message: '',
      },
      state,
    ).status,
    'command',
  );
  assert.match(response.message, /graphs 1 and 3: \(-1, 1\); \(2, 4\)/);
  assert.equal(response.changed, false);
  assert.deepEqual(response.state, state);
  assert.match(
    runCommand(state, 'read intersections between curve 3 and curve 2').message,
    /\(6, 8\)/,
  );
  assert.match(
    runCommand(state, 'find intersections').message,
    /graphs 1 and 2/,
  );
  assert.throws(
    () => runCommand(state, 'find intersections of graphs 1 and 1'),
    /different/,
  );
  assert.throws(
    () => runCommand(state, 'find intersections of graphs 0 and 2'),
    /does not exist/,
  );
  assert.throws(
    () => runCommand(state, 'find intersections of graphs 1 and 9'),
    /does not exist/,
  );
});
test('explicit y equations plot functions, other equations plot residuals', () => {
  assert.equal(graphFunction('y=x^2').value(3), 9);
  assert.equal(graphFunction('x^2=y').value(-3), 9);
  assert.equal(graphFunction('x^2=4').value(3), 5);
  assert.throws(() => graphFunction('x+y=3'), /expression in x/);
});
test('ranges, zoom, and evaluations preserve the equation', () => {
  const s = runCommand(initialWorkspace, 'graph y = x squared').state;
  const r = runCommand(s, 'range -4 to 6').state;
  assert.deepEqual(r.graphRange, { min: -4, max: 6 });
  assert.deepEqual(runCommand(r, 'zoom in').state.graphRange, {
    min: -1.5,
    max: 3.5,
  });
  assert.match(runCommand(r, 'evaluate at x three').message, /y = 9/);
  assert.equal(curvePoints(r.expression, r.graphRange)[200].x, 6);
  assert.throws(() => runCommand(r, 'range 5 to -5'));
});
test('roots find crossings without claiming poles are roots', () => {
  const roots = graphRoots('x^2-2');
  assert.equal(roots.length, 2);
  assert.ok(Math.abs(roots[1] - Math.sqrt(2)) < 1e-6);
  assert.deepEqual(graphRoots('1/(x-0.035)'), []);
  const points = graphSegments('1/(x-0.035)');
  assert.ok(points.some((p) => p.x > 0 && p.x < 0.11 && p.breakBefore));
  assert.equal(graphFunction('sqrt(x)').value(-1), null);
});
test('an all-zero sample does not produce hundreds of isolated intercepts', () => {
  const state = runCommand(initialWorkspace, 'graph y = 0').state;
  assert.match(
    runCommand(state, 'find roots').message,
    /not a set of isolated intercepts/,
  );
});
test('point evaluation remains accurate when the plotted y is beyond the display limit', () => {
  assert.equal(graphFunction('x^4').value(1000), 1e12);
  assert.equal(curvePoints('x^4', { min: 999, max: 1001 })[100].y, null);
  const state = runCommand(initialWorkspace, 'write y=x^4').state;
  assert.match(
    runCommand(state, 'evaluate at x 1000').message,
    /y = 1000000000000/,
  );
});
test('spoken and hyphenated x-intercept requests are understood', () => {
  const state = runCommand(initialWorkspace, 'graph y=x^2-4').state;
  for (const command of [
    'Find the X-intercepts.',
    'read the x intercepts',
    'find roots',
  ])
    assert.match(runCommand(state, command).message, /-2, 2/);
});

test('multiple graph expressions can be added, edited, removed, and traced without losing the primary equation', () => {
  const primary = runCommand(initialWorkspace, 'graph y=x^2').state;
  const added = runCommand(primary, 'add graph y=2*x+3');
  assert.equal(added.written, true);
  assert.equal(added.state.expression, primary.expression);
  assert.deepEqual(added.state.graphExpressions, ['y = 2 * x + 3']);
  assert.match(
    runCommand(added.state, 'evaluate graph 2 at x three').message,
    /y = 9/,
  );
  const edited = runCommand(added.state, 'edit graph 2 to y=4').state;
  assert.deepEqual(edited.graphExpressions, ['y = 4']);
  assert.match(
    runCommand(edited, 'find intersections').message,
    /\(-2, 4\); \(2, 4\)/,
  );
  assert.equal(runCommand(edited, 'remove graph 1').state.expression, 'y = 4');
  assert.throws(() => runCommand(primary, 'remove graph 1'), /Keep one/);
  assert.throws(
    () => runCommand(primary, 'edit graph 9 to y=3'),
    /does not exist/,
  );
  assert.throws(() => runCommand(primary, 'add graph z=2'), /expression in x/);
  assert.throws(() => runCommand(primary, 'find intersections'), /second/);
  const full = { ...primary, graphExpressions: Array(7).fill('y=x') };
  assert.throws(() => runCommand(full, 'add graph y=3'), /eight/);
});
test('graph viewport and two-axis zoom remain finite and preserve curve content', () => {
  const primary = runCommand(initialWorkspace, 'graph y=x^2').state;
  const state = runCommand(primary, 'view x -4 to 8 y -6 to 10').state;
  assert.deepEqual(state.graphYRange, { min: -6, max: 10 });
  const zoom = runCommand(state, 'zoom in').state;
  assert.deepEqual(zoom.graphRange, { min: -1, max: 5 });
  assert.deepEqual(zoom.graphYRange, { min: -2, max: 6 });
  assert.deepEqual(runCommand(state, 'pan graph up').state.graphYRange, {
    min: -2,
    max: 14,
  });
  assert.deepEqual(runCommand(state, 'pan graph left').state.graphRange, {
    min: -7,
    max: 5,
  });
  assert.deepEqual(runCommand(zoom, 'reset graph').state.graphYRange, {
    min: -10,
    max: 10,
  });
  assert.equal(zoom.expression, primary.expression);
  assert.throws(() => runCommand(state, 'view x 4 to 4 y -2 to 2'));
  assert.throws(() => runCommand(state, 'view x -4 to 4 y 2 to -2'));
  assert.throws(() => runCommand(state, 'view x -4 to 4 y -1e9 to 1e9'));
});

test('multiple graph content and viewport survive problem reload, targeted cancel and undo', async () => {
  const {
    createProblemLibrary,
    currentProblem,
    recordStep,
    decodeProblemLibrary,
    problemLibraryText,
    undoStep,
    cancelStep,
    updateProblem,
  } = await import('../../problems/index.ts');
  let book = createProblemLibrary();
  for (const command of [
    'graph y=x^2',
    'add graph y=4',
    'edit graph 2 to y=9',
  ]) {
    const result = runCommand(currentProblem(book).state, command);
    book = recordStep(book, result.state, command);
  }
  assert.match(problemLibraryText(book), /y = x\^2 ; y = 9/);
  const view = runCommand(
    currentProblem(book).state,
    'view x -4 to 4 y -2 to 12',
  ).state;
  book = updateProblem(book, (p) => ({ ...p, state: view }));
  const restored = decodeProblemLibrary(JSON.stringify(book));
  assert.deepEqual(currentProblem(restored).state.graphYRange, {
    min: -2,
    max: 12,
  });
  assert.deepEqual(currentProblem(undoStep(restored)).state.graphExpressions, [
    'y = 4',
  ]);
  assert.deepEqual(currentProblem(cancelStep(book, 3)).state.graphExpressions, [
    'y = 4',
  ]);
  const invalid = JSON.parse(JSON.stringify(book));
  invalid.assignments[0].problems[0].state.graphExpressions = ['y=z'];
  assert.throws(
    () => decodeProblemLibrary(JSON.stringify(invalid)),
    /expression in x/,
  );
});
test('tick spacing stays bounded across zoom levels and intersections reject coincident sampled curves', async () => {
  const { graphTicks, graphIntersections } = await import('../index.ts');
  for (const range of [
    { min: -10, max: 10 },
    { min: 0.000001, max: 0.000005 },
    { min: 99999, max: 100001 },
  ]) {
    const ticks = graphTicks(range);
    assert.ok(ticks.length > 1 && ticks.length < 20);
    assert.ok(ticks.every((v) => v >= range.min && v <= range.max));
  }
  assert.throws(() => graphIntersections('y=x', 'y=x'), /coincide/);
  assert.deepEqual(graphIntersections('y=1/(x-0.035)', 'y=0'), []);
});

test('linear and quadratic intercepts catch between-sample tangencies and small-scaled functions', () => {
  assert.deepEqual(graphRoots('y=(x-0.371)^2'), [0.371]);
  assert.deepEqual(graphRoots('y=(x-0.371)^2+0.000001'), []);
  const roots = graphRoots('y=0.000000000001*(x-0.035)');
  assert.equal(roots.length, 1);
  assert.ok(Math.abs(roots[0] - 0.035) < 1e-12);
  assert.deepEqual(graphRoots('y=x^2+1'), []);
  assert.deepEqual(graphRoots('y=x^2-1', { min: 0, max: 2 }), [1]);
  assert.equal(graphRoots('y=sin(x)-0.1').length, 7);
  assert.deepEqual(graphRoots('y=1/(x-0.035)'), []);
});
test('tangent curve intersections use the same improved root calculation', async () => {
  const { graphIntersections } = await import('../index.ts');
  const points = graphIntersections('y=(x-0.371)^2+3', 'y=3');
  assert.equal(points.length, 1);
  assert.ok(Math.abs(points[0].x - 0.371) < 1e-8);
  assert.ok(Math.abs(points[0].y - 3) < 1e-8);
});
test('fit curves includes all sampled values, supports constants, and preserves expressions', () => {
  let state = runCommand(initialWorkspace, 'graph y=x^2+50').state;
  state = runCommand(state, 'add graph y=-20').state;
  const fitted = runCommand(state, 'fit graph').state;
  assert.ok(fitted.graphYRange!.min < -20);
  assert.ok(fitted.graphYRange!.max > 150);
  assert.equal(fitted.expression, state.expression);
  assert.deepEqual(fitted.graphExpressions, state.graphExpressions);
  assert.ok(
    runCommand(runCommand(initialWorkspace, 'graph y=8').state, 'fit graph')
      .state.graphYRange!.min < 8,
  );
  assert.throws(
    () =>
      runCommand(
        {
          ...state,
          expression: 'y=sqrt(x)',
          graphExpressions: [],
          graphRange: { min: -10, max: -1 },
        },
        'fit graph',
      ),
    /No finite/,
  );
});
test('numbered intercepts and sonification read the requested curve without editing work', () => {
  const state = runCommand(
    runCommand(initialWorkspace, 'graph y=x^2-4').state,
    'add graph y=x-7',
  ).state;
  const roots = runCommand(state, 'find roots of graph 2');
  assert.match(roots.message, /Graph 2.*7/);
  assert.equal(roots.state, state);
  const audio = runCommand(state, 'play graph 2');
  assert.equal(audio.action, 'sonify');
  assert.equal(audio.sonifyExpression, state.graphExpressions![0]);
  assert.equal(audio.state, state);
  assert.throws(() => runCommand(state, 'play graph 9'), /does not exist/);
  assert.throws(
    () => runCommand(state, 'find roots of graph 9'),
    /does not exist/,
  );
});
