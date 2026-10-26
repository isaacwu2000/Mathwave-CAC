import type { ConversationTurn } from '../../commands/index.ts';
import type { Exploration } from '../../visuals/index.ts';
import type { Workspace } from '../../workspace/state.ts';
export type Step = {
  command: string;
  displayCommand?: string;
  state: Workspace;
  at: string;
};
export type WorkSnapshot = {
  state: Workspace;
  steps: Step[];
  undoStates: Workspace[];
};
export type Problem = {
  id: string;
  title: string;
  draft?: string;
  recovery?: string;
  conversation?: ConversationTurn[];
  conversationArchive?: ConversationTurn[];
  exploration?: Exploration;
  undoStates?: Workspace[];
  initialState?: Workspace;
  undoRevisions?: WorkSnapshot[];
  redoRevisions?: WorkSnapshot[];
  state: Workspace;
  steps: Step[];
};
export type Assignment = { id: string; title: string; problems: Problem[] };
export type ProblemLibrary = {
  version: 2;
  assignments: Assignment[];
  assignmentId: string;
  problemId: string;
  draft: string;
};
