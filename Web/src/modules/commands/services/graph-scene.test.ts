import { expect, test } from 'vitest';
import { runMathProgram } from './math-program.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { runCommand } from './run-command.ts';
import { graphSceneRenderData } from '../../visuals/index.ts';

test('graphing a solved x equation draws a vertical line without changing the source work', () => {
  const original = { ...initialWorkspace, expression: 'x = 4' };
  const plotted = runMathProgram(original, 'problem.save(graph.plot("x=4"));');
  expect(original.expression).toBe('x = 4');
  expect(original.graph).toBe(false);
  expect(plotted.state.graph).toBe(true);
  const rendered = graphSceneRenderData(
    plotted.state.graphScene!,
    { min: -10, max: 10 },
    { min: -10, max: 10 },
  ).result.plots[0].positions;
  expect(rendered.length).toBeGreaterThan(6);
  const heights: number[] = [];
  for (let i = 0; i < rendered.length; i += 3) {
    expect(rendered[i]).toBe(4);
    heights.push(rendered[i + 1]);
  }
  expect(Math.min(...heights)).toBe(-10);
  expect(Math.max(...heights)).toBe(10);
});

test('legacy equation operations never expose the scene storage placeholder', () => {
  const scene = runMathProgram(
    initialWorkspace,
    'problem.save(graph.scene(["x^2+y^2=4"]));',
  ).state;
  for (const command of [
    'simplify',
    'subtract 3 from both sides',
    'evaluate at x 2',
    'roots',
    'replace 0 with 2',
  ])
    expect(() => runCommand(scene, command)).toThrow(
      /graph|equation|relation/i,
    );
});

test('equations with y on both sides use the implicit graph path', () => {
  const result = runMathProgram(
    initialWorkspace,
    'problem.save(graph.plot("y=x+y"));',
  );
  expect(result.state.graphScene?.rows[0].expression).toBe('y=x+y');
});

test('named graph rows and definitions save atomically and can be selected by name', () => {
  const first = runMathProgram(
    initialWorkspace,
    'const g=graph.scene(["a=2","f(x)=a*x^2","x^2+y^2=4"]); problem.save(graph.name(graph.select(g,3),"Circle"));',
  );
  expect(first.state.graphScene?.rows[2].name).toBe('Circle');
  const changed = runMathProgram(
    first.state,
    'problem.save(graph.edit(graph.current("Circle"),"x^2+y^2=9"));',
  );
  expect(changed.state.graphScene?.rows[2].expression).toBe('x^2+y^2=9');
  expect(first.state.graphScene?.rows[2].expression).toBe('x^2+y^2=4');
  expect(() =>
    runMathProgram(
      first.state,
      'problem.save(graph.edit(graph.current(1),"a=missing"));',
    ),
  ).toThrow(/Undefined/);
});
