import { expect, test } from 'vitest';
import { runMathProgram } from './math-program.ts';
import { validateInterpretation } from './command-interpreter.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { parseMath, evaluateMath } from '../../math/index.ts';

test('legacy saved programs replay through their original namespace', () => {
  const state = { ...initialWorkspace, expression: '2*x+3=11' };
  expect(
    runMathProgram(
      state,
      'notebook.save(math.simplify(math.subtractBothSides(notebook.currentEquation(), 3)));',
    ).state.expression,
  ).toBe('2 * x = 8');
});

test('a program binds immutable equations and saves only its explicit result', () => {
  const state = { ...initialWorkspace, expression: '2*x + 3 = 11' };
  const result = runMathProgram(
    state,
    `
    const original = problem.currentEquation();
    const reduced = math.simplify(math.subtractBothSides(original, 3));
    problem.save(reduced);
    math.read(original);
  `,
  );
  expect(result.state.expression).toBe('2 * x = 8');
  expect(result.message).toContain('3');
  expect(state.expression).toBe('2*x + 3 = 11');
});

test('typed queries preserve equation sides and accessible part navigation', () => {
  const state = { ...initialWorkspace, expression: '2*x+3=11' };
  expect(
    runMathProgram(state, 'math.evaluate(problem.currentEquation(), {x: 4});')
      .message,
  ).toMatch(/left.*11.*right.*11/i);
  expect(
    runMathProgram(state, 'math.read(math.part(problem.currentEquation(), 4));')
      .message,
  ).toBe('2');
  expect(
    runMathProgram(
      state,
      'math.read(math.leftSide(problem.currentEquation()));',
    ).message,
  ).toContain('plus 3');
  const next = runMathProgram(
    state,
    'problem.save(view.nextPart(problem.currentEquation()));',
  );
  expect(next.state.selection).toBe(1);
  expect(
    runMathProgram(
      state,
      'problem.read(geometry.create("circle", {radius:3}));',
    ).message,
  ).toMatch(/circle/i);
  expect(() =>
    runMathProgram(
      state,
      `problem.save(diagram.create(${JSON.stringify(Array.from({ length: 13 }, (_, i) => String(i)))}));`,
    ),
  ).toThrow(/approved/);
  expect(() =>
    runMathProgram(
      state,
      `problem.save(diagram.create(["${'a'.repeat(121)}", "End"]));`,
    ),
  ).toThrow(/approved/);
});

test('history and panels are standalone typed controls, never combined with math saves', () => {
  const history = {
    steps: [{ number: 1, command: 'write x=3' }],
    total: 1,
    undoCount: 1,
    redoCount: 0,
  };
  const interpretation = validateInterpretation(
    {
      status: 'command',
      command: '',
      message: '',
      program: 'history.undo(1);',
    },
    initialWorkspace,
    history,
  );
  expect(interpretation.command).toBe('undo 1');
  expect(
    validateInterpretation(
      {
        status: 'command',
        command: '',
        message: '',
        program: 'view.open("steps");',
      },
      initialWorkspace,
    ).command,
  ).toBe('show steps');
  expect(() =>
    validateInterpretation(
      {
        status: 'command',
        command: '',
        message: '',
        program: 'problem.save(math.equation("x=3")); history.undo(1);',
      },
      initialWorkspace,
      history,
    ),
  ).toThrow(/separately|standalone/i);
  expect(() =>
    validateInterpretation(
      {
        status: 'command',
        command: '',
        message: '',
        program: 'history.undo(2);',
      },
      initialWorkspace,
      history,
    ),
  ).toThrow();
});

test('graphs, shapes and data use typed immutable values', () => {
  const graph = runMathProgram(
    initialWorkspace,
    `const g = graph.plot("x^2"); const t = graph.addTangent(g, 2); problem.save(t); graph.slope(g, 2);`,
  );
  const tangent = parseMath(graph.state.graphExpressions![0]);
  expect(tangent.kind).toBe('equation');
  if (tangent.kind === 'equation') {
    expect(evaluateMath(tangent.right, { x: 0 })).toBe(-4);
    expect(evaluateMath(tangent.right, { x: 2 })).toBe(4);
  }
  expect(graph.message).toContain('4');
  const shape = runMathProgram(
    initialWorkspace,
    `const c = geometry.create("circle", { radius: 3 }); const big = geometry.scale(c, 2); problem.save(big); geometry.measure(big, "diameter");`,
  );
  expect(shape.state.geometry?.dimensions.radius).toBe(6);
  expect(shape.message).toContain('12');
  const data = runMathProgram(
    initialWorkspace,
    `const d = statistics.data([1, 2, 9]); statistics.mean(d);`,
  );
  expect(data.message).toContain('4');
  expect(data.state).toBe(initialWorkspace);
  expect(() =>
    runMathProgram(
      initialWorkspace,
      'problem.save(diagram.create(["Start", "Finish"]));',
    ),
  ).toThrow(/approved/);
  expect(() =>
    runMathProgram(
      initialWorkspace,
      'geometry.measure(graph.plot("x"), "area");',
    ),
  ).toThrow(/geometry/i);
});

test('TypeScript syntax is bounded and never executes host JavaScript', () => {
  for (const source of [
    'let x = 1;',
    'const x = ;',
    'const x = fetch("https://example.com");',
    'while (true) {}',
    'const x = problem["currentEquation"]();',
    'const x = (() => problem.currentEquation())();',
    'import "x";',
    'const x = problem.currentEquation(); x.state = 0;',
    'const x = 1; const x = 2;',
    'const x = 2 ^ 3;',
    'problem.save(problem.currentEquation()); fetch("x");',
  ])
    expect(() => runMathProgram(initialWorkspace, source)).toThrow();
  const result = runMathProgram(
    initialWorkspace,
    `const e = math.equation("x=8"); problem.save(math.divideBothSides(e, 2 ** 2));`,
  );
  expect(result.state.expression).toBe('x / 4 = 8 / 4');
});

test('equation operations preserve domains and part references belong to one value', () => {
  const state = { ...initialWorkspace, expression: '2*x + 3 = 11' };
  expect(
    runMathProgram(
      state,
      `const e = problem.currentEquation(); const p = math.part(e, 4); problem.save(math.replacePart(e, p, "4"));`,
    ).state.expression,
  ).toBe('4 * x + 3 = 11');
  expect(() =>
    runMathProgram(
      state,
      `const e = problem.currentEquation(); const p = math.part(e, 3); const next = math.simplify(e); problem.save(math.replacePart(next, p, "4"));`,
    ),
  ).toThrow(/reference.*different/i);
  expect(() =>
    runMathProgram(
      state,
      `problem.save(math.divideBothSides(problem.currentEquation(), 0));`,
    ),
  ).toThrow(/nonzero/i);
  expect(() =>
    runMathProgram(
      state,
      `problem.save(math.multiplyBothSides(problem.currentEquation(), math.expression("x")));`,
    ),
  ).toThrow(/constant|variable/i);
});

test('writing root equations retains the existing curve independently', () => {
  const graph = { ...initialWorkspace, graph: true, expression: 'x^2+3*x+2' };
  const first = runMathProgram(
    graph,
    'problem.save(math.equation("x=-2"));',
  ).state;
  const second = runMathProgram(
    first,
    'problem.save(math.equation("x=-1"));',
  ).state;
  expect(second.expression).toBe('x = -1');
  expect(second.graph).toBe(true);
  expect(second.retainedGraph?.rows).toEqual([{ expression: 'x^2+3*x+2' }]);
  expect(second.graphScene).toBeUndefined();
});

test('retained curves still support direct replacement, addition, evaluation and hiding', async () => {
  const { runCommand } = await import('../index.ts');
  let state = runCommand({ ...initialWorkspace }, 'graph x^2').state;
  state = runCommand(state, 'write x=4').state;
  state = runCommand(state, 'graph x+1').state;
  expect(state.retainedGraph?.rows.map((r) => r.expression)).toEqual(['x + 1']);
  state = runCommand(state, 'add graph x^2').state;
  expect(state.retainedGraph?.rows).toHaveLength(2);
  const query = runCommand(state, 'evaluate graph 1 at x 2');
  expect(query.message).toContain('3');
  expect(query.state).toEqual(state);
  state = runCommand(state, 'hide graph').state;
  expect(state.graph).toBe(false);
  expect(state.expression).toBe('x = 4');
});

test.each([
  'problem.save(view.pan(graph.current(1), "down"));',
  'problem.save(graph.add(graph.current(1), "x+1"));',
  'problem.save(view.hideGraph(graph.current(1)));',
])('DSL graph edits preserve the independent answer: %s', (program) => {
  const original = {
    ...initialWorkspace,
    expression: 'x = -1',
    graph: true,
    retainedGraph: { rows: [{ expression: 'x^2+3*x+2' }] },
  };
  const result = runMathProgram(original, program);
  expect(result.state.expression).toBe('x = -1');
  expect(result.state.retainedGraph?.rows[0].expression).toBe('x^2+3*x+2');
  expect(result.state.graphScene).toBeUndefined();
});
