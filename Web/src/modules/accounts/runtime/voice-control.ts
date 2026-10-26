import { accountDatabase } from '../repo/database.ts';
import { accountConfig } from './config.ts';

/** Stops the owner's active provider sessions on reset/deletion; browser state cannot bypass it. */
export async function stopAccountVoices(owner: string) {
  const voices =
    await accountDatabase()`SELECT actor_id FROM mathwave_voice_sessions WHERE owner_id = ${owner}`;
  const namespace = accountConfig().VOICE_QUOTA;
  if (namespace)
    await Promise.all(
      voices
        .filter((voice) => voice.actor_id)
        .map((voice) =>
          namespace
            .get(namespace.idFromString(voice.actor_id))
            .fetch('https://voice.internal/stop'),
        ),
    );
}
