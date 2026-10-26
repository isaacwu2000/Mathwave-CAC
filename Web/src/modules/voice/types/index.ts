export type LiveContext = {
  owner?: string;
  revision: string;
  workspace: unknown;
  history?: import('../../commands/index.ts').HistoryContext;
  conversation?: import('../../commands/index.ts').ConversationTurn[];
  exploration?: import('../../visuals/index.ts').Exploration;
  clarification?: import('../../commands/index.ts').ClarificationContext;
};

export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
export type VoiceState = 'idle' | 'starting' | 'listening' | 'paused';

export type AudioFrame = {
  samples: Float32Array;
  sampleRate: number;
  at: number;
};
