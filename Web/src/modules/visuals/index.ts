export {
  shapeDimensions,
  type Shape,
  type Geometry,
  dimensionsFor,
  validateGeometry,
  geometryMeasures,
  describeGeometry,
  measureGeometry,
  geometryNumber,
  parseGeometry,
  scaleGeometry,
  classifyTriangle,
} from './services/geometry.ts';
export {
  type GraphRange,
  defaultGraphRange,
  validateGraphRange,
  graphFunction,
  curvePoints,
  graphSegments,
  graphTraceX,
  type GraphKeyPoint,
  graphKeyPoints,
  graphRoots,
  fitGraphY,
  describeGraph,
  validateGraphExpressions,
  graphTicks,
  shiftGraphRange,
  graphIntersections,
  graphValueTable,
  graphAverageRate,
  graphSecant,
  shiftGraph,
  numberedGraphs,
  graphTangent,
  transformGraph,
  graphIntegral,
  graphAreaBetween,
  type GraphTrace,
  validateGraphTrace,
  includeGraphValue,
} from './services/graph.ts';

export {
  triangleDiagram,
  validateTriangleOverlay,
  type TriangleOverlay,
} from './services/triangle-diagram.ts';
export {
  validateGraphComparison,
  fitGraphComparison,
  type GraphComparison,
  graphNormal,
  graphDerivative,
} from './services/graph.ts';
export { circularSegmentArea } from './services/geometry.ts';
export { graphRenderData } from './services/renderer-adapter.ts';
export { geometryRenderData } from './services/geometry-renderer.ts';
export { graphSceneRenderData } from './services/graph-scene-renderer.ts';
export { constructionRenderData } from './services/construction-renderer.ts';
export {
  validateExploration,
  validatePresentation,
  explorationView,
  setExplorationValue,
  type Exploration,
  type Presentation,
} from './services/exploration.ts';
export {
  validateConstruction,
  describeConstruction,
  describeConstructionValue,
  editConstruction,
} from './services/construction.ts';
export {
  compileGraphScene,
  describeGraphScene,
  type GraphScene,
  type GraphSceneRow,
} from './services/graph-scene.ts';
