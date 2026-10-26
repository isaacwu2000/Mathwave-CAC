export type HistoryContext = {
  steps: { number: number; command: string }[];
  total: number;
  undoCount: number;
  redoCount: number;
};
