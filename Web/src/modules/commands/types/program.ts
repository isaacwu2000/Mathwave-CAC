import type { MathNode } from '../../math/index.ts';
import type { Workspace } from '../../workspace/state.ts';

export type MathValue = { kind: 'math'; state: Workspace; node: MathNode };
export type PartReference = { kind: 'part'; owner: MathValue; number: number };
export type SceneValue = {
  kind: 'graph' | 'geometry' | 'statistics';
  state: Workspace;
  number: number;
};
export type ProgramValue =
  | number
  | string
  | MathValue
  | PartReference
  | SceneValue
  | ProgramValue[]
  | { [key: string]: ProgramValue }
  | undefined;
