import { expect, test } from 'vitest';
import { runMathProgram } from './math-program.ts';
import { initialWorkspace } from '../../workspace/state.ts';

export const triangleSource =
  'A=point(0,3)\nB=point(0,0)\nC=point(4,0)\nD=foot(A,line(B,C))\nassert perpendicular(line(A,D),line(B,C))\nassert on(C,line(B,point(1,0)))\ndraw triangle(A,B,C),segment(A,D)\nmeasure segment(A,C)';

test('a named construction saves one validated scene and reads a computed distance', () => {
  const result = runMathProgram(
    initialWorkspace,
    `const g=geometry.construct(${JSON.stringify(triangleSource)}); geometry.inspect(g,"D"); problem.save(g);`,
  );
  expect(result.state.construction).toBe(triangleSource);
  expect(result.state.mode).toBe('geometry');
  expect(result.message).toContain('D: point (0, 0)');
  expect(result.saved).toBe(true);
  expect(initialWorkspace.construction).toBeUndefined();
});

test('editing a named point recalculates dependencies and rejects a false relationship atomically', () => {
  const first = runMathProgram(
    initialWorkspace,
    `problem.save(geometry.construct(${JSON.stringify(triangleSource)}));`,
  );
  const edited = runMathProgram(
    first.state,
    'const g=geometry.editObject(geometry.current(),"C","point(8,0)"); geometry.inspect(g,"C"); problem.save(g);',
  );
  expect(edited.message).toContain('C: point (8, 0)');
  expect(first.state.construction).toBe(triangleSource);
  expect(() =>
    runMathProgram(
      first.state,
      'problem.save(geometry.editObject(geometry.current(),"C","point(4,1)"));',
    ),
  ).toThrow(/Assertion/);
});

test('complete multi-line extensions preserve formulas and point edits update dependent centers', () => {
  const initial = runMathProgram(
    initialWorkspace,
    'problem.save(geometry.construct("A=point(0,0)\\nB=point(4,0)\\nC=point(0,3)\\ndraw triangle(A,B,C)"));',
  );
  const extended = runMathProgram(
    initial.state,
    'problem.save(geometry.extend(geometry.current(),"M=midpoint(A,B)\\nI=incenter(A,B,C)\\ndraw M,incircle(A,B,C)"));',
  );
  const edited = runMathProgram(
    extended.state,
    'const g=geometry.editObject(geometry.current(),"B","point(8,0)"); geometry.inspect(g,"M"); problem.save(g);',
  );
  expect(edited.message).toContain('M: point (4, 0)');
  expect(edited.state.construction).toContain('M=midpoint(A,B)');
  expect(extended.state.construction).toContain('B=point(4,0)');
  expect(() =>
    runMathProgram(
      extended.state,
      'problem.save(geometry.extend(geometry.current(),"Q=midpoint(A,Z)\\ndraw Q"));',
    ),
  ).toThrow(/Undefined/);
});
