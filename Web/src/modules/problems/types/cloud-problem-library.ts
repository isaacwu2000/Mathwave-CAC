import type { VerifiedCompletion } from './completion.ts';
import type { RequestTiming } from '../../diagnostics/index.ts';
import type {
  panelCommand,
  ClarificationContext,
  Interpretation,
} from '../../commands/index.ts';
import type { Step, ProblemLibrary } from './problem-library.ts';
import type { Workspace } from '../../workspace/state.ts';
export type InterpretationProgress = {
  phase: 'checking' | 'fixing';
  workspace?: Workspace;
  steps?: Step[];
};
export type CloudProblemLibrary = {
  book: ProblemLibrary;
  clarification: ClarificationContext | null;
};
export type CloudOperation =
  | {
      kind: 'graph-question';
      text: string;
      question: string;
      baseRevision: number;
    }
  | {
      kind: 'graph';
      commands: string[];
      text: string;
      baseRevision: number;
      consumeDraft?: boolean;
    }
  | {
      kind: 'command';
      text: string;
      interpret?: boolean;
      consumeDraft?: boolean;
    }
  | { kind: 'revise-step'; step: number; expression: string }
  | { kind: 'branch'; index: number }
  | { kind: 'exploration'; name: string; value: number }
  | { kind: 'dismiss-exploration' }
  | { kind: 'draft'; text: string; problemId: string }
  | { kind: 'select'; assignmentId: string; problemId: string }
  | { kind: 'delete'; assignmentId: string; problemId: string }
  | { kind: 'new'; title?: string; assignmentTitle?: string }
  | { kind: 'import'; notebook: string }
  | { kind: 'recovery'; text: string };
export type CloudOutcome = CloudProblemLibrary & {
  status: Interpretation['status'];
  message: string;
  action?: string;
  panel?: ReturnType<typeof panelCommand>;
  sonifyExpression?: string;
  aiUnavailable?: boolean;
  completion?: VerifiedCompletion;
};
export type Interpreter = (
  text: string,
  library: CloudProblemLibrary,
  timing?: RequestTiming,
  progress?: (value: InterpretationProgress) => void,
) => Promise<Interpretation>;
