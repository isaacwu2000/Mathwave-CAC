import { graphSceneLanguageFor } from '../../commands/index.ts';
import { mathContext, constructionLanguageFor } from '../../commands/index.ts';
import type { CloudOutcome } from '../../problems/index.ts';
import { currentProblem, historyContext } from '../../problems/index.ts';
import {
  graphInterpretationInstructions,
  graphBuildOutputInstructions,
} from '../config/interpretation.ts';
import { commandProvider } from './command-provider.ts';
import { graphStreamOutput } from '../services/graph-stream.ts';
import {
  reserveAi,
  quotaStore,
  type QuotaAccess,
} from '../../accounts/server.ts';

/**
 * - Sends the student's request and saved problem context to Luna.
 * - Yields complete commands; this function never changes saved work.
 * - Stops on provider failure or cancellation. The command engine checks each result.
 */
export async function* streamGraphCommands(
  text: string,
  saved: Pick<CloudOutcome, 'book' | 'clarification'>,
  signal: AbortSignal,
  quota?: QuotaAccess,
) {
  const grant = quota ? await reserveAi(quota, 15000, 'graph') : undefined;
  const started = Date.now();
  const usage: unknown[] = [];
  if (grant)
    signal = AbortSignal.any([signal, AbortSignal.timeout(grant.milliseconds)]);
  try {
    const provider = commandProvider();
    const state = currentProblem(saved.book).state;
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.key}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: provider.model,
        reasoning: provider.reasoning,
        store: false,
        stream: true,
        max_output_tokens: 800,
        instructions:
          graphInterpretationInstructions +
          constructionLanguageFor(text, state) +
          graphSceneLanguageFor(text, state) +
          graphBuildOutputInstructions,
        input: JSON.stringify({
          request: text,
          workspace: state,
          mathContext: mathContext(state),
          history: historyContext(saved.book),
          clarification: saved.clarification,
        }),
      }),
    });
    yield* graphStreamOutput(response, signal, (value) => usage.push(value));
  } finally {
    if (grant) await quotaStore.settle(grant.id, Date.now() - started, usage);
  }
}
