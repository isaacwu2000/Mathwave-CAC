export {
  displayNumber,
  parseData,
  statistics,
  describeData,
} from './services/statistics.ts';
export { ClarificationError } from './services/clarification.ts';
export {
  type MathNode,
  type MathPart,
  parseMath,
  formatMath,
  speakMath,
  evaluateMath,
  getParts,
  replaceMath,
  replacePartMath,
  solveMath,
} from './services/math-engine.ts';
export { isSimplificationCommand, simplifyMath } from './services/simplify.ts';

export { applyBothSidesMath } from './services/equation-operation.ts';

export {
  verifyLinearCompletion,
  hasInexactCompletionLiteral,
} from './services/completion.ts';
