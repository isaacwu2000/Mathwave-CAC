export type MathNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; op: '+' | '-'; operand: MathNode }
  | {
      kind: 'binary';
      op: '+' | '-' | '*' | '/' | '^';
      left: MathNode;
      right: MathNode;
    }
  | {
      kind: 'call';
      name: 'sqrt' | 'sin' | 'cos' | 'log' | 'ln';
      argument: MathNode;
    }
  | { kind: 'equation'; left: MathNode; right: MathNode };

export type MathPart = {
  id: string;
  label: string;
  spoken: string;
  node: MathNode;
};
