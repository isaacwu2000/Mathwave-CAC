import type { Presentation } from '../../visuals/index.ts';
export type Interpretation = {
  status:
    | 'command'
    | 'reply'
    | 'clarification'
    | 'unsupported'
    | 'explanation'
    | 'correction';
  command: string;
  message: string;
  commands?: string[];
  program?: string;
  programs?: string[];
  presentation?: Presentation;
  completion?: { answer: string } | null;
};
