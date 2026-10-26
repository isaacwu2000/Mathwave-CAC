import type { Workspace } from '../../workspace/state.ts';
export type CommandResult = {
  state: Workspace;
  message: string;
  changed?: boolean;
  written?: boolean;
  programSaved?: boolean;
  storedCommand?: string;
  sonifyExpression?: string;
  action?:
    | 'repeat'
    | 'undo'
    | 'help'
    | 'close-help'
    | 'mute'
    | 'unmute'
    | 'stop'
    | 'listen-stop'
    | 'sonify'
    | 'slower'
    | 'faster'
    | 'focus';
};
