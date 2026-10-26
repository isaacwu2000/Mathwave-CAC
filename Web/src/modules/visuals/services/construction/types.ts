export type Point2 = {
  readonly kind: 'point';
  readonly x: number;
  readonly y: number;
};
export type Line2 = {
  readonly kind: 'line';
  readonly a: Point2;
  readonly b: Point2;
};
export type Circle2 = {
  readonly kind: 'circle';
  readonly center: Point2;
  readonly radius: number;
};
export type GeometryValue =
  | Point2
  | Line2
  | Circle2
  | { readonly kind: 'scalar'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'segment'; readonly a: Point2; readonly b: Point2 }
  | { readonly kind: 'ray'; readonly a: Point2; readonly b: Point2 }
  | { readonly kind: 'polygon'; readonly vertices: readonly Point2[] };
export const constructionNames = [
  'sqrt',
  'cbrt',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'abs',
  'exp',
  'ln',
  'point',
  'line',
  'segment',
  'ray',
  'circle',
  'polygon',
  'triangle',
  'midpoint',
  'distance',
  'foot',
  'reflection',
  'parallel',
  'perpendicular',
  'bisector',
  'circumcenter',
  'centroid',
  'orthocenter',
  'incenter',
  'circumcircle',
  'incircle',
  'equal',
  'on',
  'intersection',
] as const;
export type ConstructionName = (typeof constructionNames)[number];
export function isConstructionName(value: string): value is ConstructionName {
  return constructionNames.some((name) => name === value);
}
export const arithmeticOperators = ['+', '-', '*', '/', '^'] as const;
export type ArithmeticOperator = (typeof arithmeticOperators)[number];
export function isArithmeticOperator(
  value: string,
): value is ArithmeticOperator {
  return arithmeticOperators.some((operator) => operator === value);
}
export type Expression =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'reference'; readonly name: string }
  | {
      readonly kind: 'call';
      readonly name: ConstructionName;
      readonly args: readonly Expression[];
    }
  | {
      readonly kind: 'operator';
      readonly op: ArithmeticOperator;
      readonly args: readonly Expression[];
    };
export type Statement = { readonly line: number } & (
  | {
      readonly kind: 'define';
      readonly name: string;
      readonly expression: Expression;
    }
  | { readonly kind: 'draw'; readonly expressions: readonly Expression[] }
  | { readonly kind: 'assert'; readonly expression: Expression }
  | { readonly kind: 'measure'; readonly expression: Expression }
  | {
      readonly kind: 'label';
      readonly expression: Expression;
      readonly text: string;
    }
  | {
      readonly kind: 'angle' | 'rightangle';
      readonly expressions: readonly Expression[];
    }
);
export type GeometryDiagnostic = {
  readonly line: number;
  readonly message: string;
};
