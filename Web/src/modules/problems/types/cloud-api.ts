import type {
  CloudProblemLibrary,
  CloudOutcome,
} from './cloud-problem-library.ts';
export type CloudSnapshot = CloudProblemLibrary & { revision: number };
export type CloudResponse = CloudOutcome & { revision: number };
export type Receipt = { request: string; result: CloudResponse };
export type ProblemLibraryStore = {
  load(owner: string): Promise<CloudSnapshot>;
  receipt(owner: string, id: string): Promise<Receipt | null>;
  commit(
    owner: string,
    id: string,
    revision: number,
    outcome: CloudOutcome,
    request: string,
  ): Promise<boolean>;
};
