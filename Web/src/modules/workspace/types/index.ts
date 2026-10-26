import type {
  Geometry,
  GraphScene,
  GraphTrace,
  GraphRange,
  GraphComparison,
  TriangleOverlay,
} from '../../visuals/index.ts';
export type Mode = 'equation' | 'statistics' | 'geometry';
export type Workspace = {
  mode: Mode;
  expression: string;
  data: number[];
  selection: number;
  graph: boolean;
  graphRange?: GraphRange;
  graphYRange?: GraphRange;
  graphExpressions?: string[];
  graphScene?: GraphScene;
  retainedGraph?: GraphScene;
  graphTrace?: GraphTrace;
  graphComparison?: GraphComparison;
  geometry?: Geometry;
  construction?: string;
  geometryOverlay?: TriangleOverlay;
};
