import { RequestTiming } from '../../diagnostics/index.ts';
import { env } from 'cloudflare:workers';
import { currentProblem, historyContext } from '../../problems/index.ts';
import { database, problemLibraryStore } from '../../problems/server.ts';
import {
  accountIdentity,
  accountConfig,
  quotaAccess,
} from '../../accounts/server.ts';
import { LIVE_MODEL, voiceInstructions } from '../config/openai-config.ts';
import { openAIErrorMessage } from '../services/openai-error.ts';
const reply = (body: object, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: Request) {
  try {
    await accountIdentity(request);
    return reply({
      configured: Boolean(
        (env as unknown as { OPENAI_API_KEY?: string }).OPENAI_API_KEY,
      ),
    });
  } catch (error) {
    return error instanceof Response
      ? error
      : reply({ error: 'Voice setup is unavailable.' }, 503);
  }
}
export async function POST(request: Request) {
  const timing = new RequestTiming();
  const respond = async () => {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return reply({ error: 'Request origin is not allowed.' }, 403);
    let owner: string | undefined, lease: string | undefined;
    try {
      const identity = await accountIdentity(request);
      owner = identity.owner;
      const key = (env as unknown as { OPENAI_API_KEY?: string })
        .OPENAI_API_KEY;
      if (!key)
        return reply(
          { error: 'GPT Live is not configured. You can keep typing.' },
          503,
        );
      const raw = await request.text();
      if (raw.length > 65536)
        return reply({ error: 'Voice request is too large.' }, 413);
      const body = JSON.parse(raw) as { sdp?: unknown; revision?: unknown };
      if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=0'))
        return reply({ error: 'Invalid voice connection offer.' }, 400);
      const saved = await timing.measure('load', () =>
        problemLibraryStore.load(owner!),
      );
      if (body.revision !== String(saved.revision))
        return reply(
          {
            error:
              'Your problem changed. Restart listening to use its latest state.',
          },
          409,
        );
      lease = crypto.randomUUID();
      const acquired =
        await database()`INSERT INTO math_audio_voice_negotiations(owner_id, lease_id, expires_at)
      VALUES (${owner}, ${lease}, now() + interval '30 seconds') ON CONFLICT(owner_id) DO UPDATE
      SET lease_id = excluded.lease_id, expires_at = excluded.expires_at
      WHERE math_audio_voice_negotiations.expires_at < now() RETURNING lease_id`;
      if (!acquired.length) {
        lease = undefined;
        return reply(
          { error: 'A voice connection is already starting for your account.' },
          429,
        );
      }
      const providerBody = {
        session: {
          model: LIVE_MODEL,
          instructions: voiceInstructions,
          delegation: { type: 'client' },
          store: false,
          client: {
            data_channel: {
              allowed_client_events: [
                'session.close',
                'session.instructions.append',
                'session.thinking.append',
                'session.commentary.append',
              ],
            },
          },
          input: [
            {
              type: 'message',
              role: 'developer',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    problem: currentProblem(saved.book).state,
                    history: historyContext(saved.book),
                    conversation: currentProblem(saved.book).conversation || [],
                    exploration: currentProblem(saved.book).exploration,
                    clarification: saved.clarification,
                    revision: saved.revision,
                  }),
                },
              ],
            },
          ],
        },
        transport: { type: 'webrtc', sdp: body.sdp },
      };
      const namespace = accountConfig().VOICE_QUOTA;
      const access = await quotaAccess(identity, request);
      if (namespace && access) {
        const actorId = namespace.newUniqueId();
        const monitored = await namespace
          .get(actorId)
          .fetch('https://voice.internal/start', {
            method: 'POST',
            body: JSON.stringify({ access, providerBody }),
          });
        const answer = (await monitored.json()) as { sessionId?: string };
        return reply(answer, monitored.status);
      }
      // Explicit loopback evaluation mode is the only unmetered provider transport.
      if (
        accountConfig().CLOUD_TEST_MODE !== 'true' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(
          new URL(request.url).hostname,
        )
      )
        return reply(
          { error: 'Voice quota protection is not configured.' },
          503,
        );
      const response = await timing.measure('live_provider_headers', () =>
        fetch('https://api.openai.com/v1/live/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(providerBody),
          signal: AbortSignal.timeout(15000),
        }),
      );
      if (!response.ok)
        return reply({ error: await openAIErrorMessage(response) }, 502);
      const answer = (await response.json()) as {
        transport?: { sdp?: string };
        session?: { id?: string };
      };
      if (!answer.transport?.sdp) throw new Error('Missing answer.');
      return reply({
        sdp: answer.transport.sdp,
        sessionId: answer.session?.id,
      });
    } catch (error) {
      return error instanceof Response
        ? error
        : reply(
            { error: 'GPT Live could not connect. Your problem is preserved.' },
            502,
          );
    } finally {
      if (owner && lease)
        await database()`UPDATE math_audio_voice_negotiations SET expires_at = now() WHERE owner_id = ${owner} AND lease_id = ${lease}`.catch(
          () => {},
        );
    }
  };
  const response = await respond();
  response.headers.set('Server-Timing', timing.header());
  return response;
}
