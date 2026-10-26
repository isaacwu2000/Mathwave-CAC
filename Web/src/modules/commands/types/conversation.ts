import type { Interpretation } from './command-interpreter.ts';
export type ConversationTurn = {
  request: string;
  response: string;
  status: Interpretation['status'];
  commands?: string[];
  stateKey: string;
  revisable?: boolean;
  stepCount?: number;
  undoDepth?: number;
  interaction?: string;
};
