import type { CloudProblemLibrary } from './cloud-problem-library.ts';
export type GraphBuildOutput =
  | { command: string }
  | { status: 'clarification' | 'unsupported'; message: string };
export type GraphGenerator = (
  text: string,
  saved: CloudProblemLibrary,
  signal: AbortSignal,
) => AsyncIterable<GraphBuildOutput>;
