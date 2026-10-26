import type { Workspace } from '../types/index.ts';
export const initialWorkspace: Workspace = {
  mode: 'equation',
  expression: 'x^2 + 2*x - 3 = 0',
  data: [4, 5, 5, 6, 7, 8, 22],
  selection: 0,
  graph: false,
};
