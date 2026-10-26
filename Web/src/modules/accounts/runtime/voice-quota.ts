import { DurableObject } from 'cloudflare:workers';
import { reserveAi, quotaStore, type QuotaAccess } from './quota.ts';
import { accountDatabase } from '../repo/database.ts';
import { accountConfig } from './config.ts';
import { quotaPeriod } from '../services/quota.ts';

type VoiceRecord = {
  access: QuotaAccess;
  started: number;
  providerId?: string;
  grants: { id: string; milliseconds: number }[];
  seconds: number;
  resetsAt: number;
  closing?: boolean;
  closed?: boolean;
};

/**
 * Controls a paid voice session independently of the browser.
 * Provider events supply cumulative usage. Durable alarms renew short time
 * reservations and close the provider when no allowance remains. Audio and
 * transcripts received on the control connection are never persisted.
 */
export class VoiceQuota extends DurableObject {
  private socket?: WebSocket;
  private record?: VoiceRecord;

  /** Starts one protected provider connection or requests closure; duplicate starts are rejected. */
  async fetch(request: Request) {
    return this.ctx.blockConcurrencyWhile(() => this.handleRequest(request));
  }

  /** Serializes startup with stop requests so deletion can find and close a starting actor. */
  private async handleRequest(request: Request) {
    if (new URL(request.url).pathname === '/stop') {
      await this.restore();
      await this.close();
      return Response.json({ stopped: true });
    }
    if (await this.ctx.storage.get('voice'))
      return Response.json(
        { error: 'This voice connection already started.' },
        { status: 409 },
      );
    const { access, providerBody } = (await request.json()) as {
      access: QuotaAccess;
      providerBody: unknown;
    };
    let grant;
    try {
      grant = await reserveAi(access, 20000, 'voice');
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }
    this.record = {
      access,
      started: Date.now(),
      grants: [grant],
      seconds: 0,
      resetsAt: Date.parse(quotaPeriod(new Date()).resetsAt),
    };
    await this.save();
    await accountDatabase()`INSERT INTO mathwave_voice_sessions(id, owner_id, actor_id) VALUES (${this.ctx.id.toString()}, ${access.owner}, ${this.ctx.id.toString()}) ON CONFLICT DO NOTHING`;
    await this.ctx.storage.setAlarm(Date.now() + 10000);
    try {
      const config = accountConfig();
      const response = await fetch('https://api.openai.com/v1/live/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerBody),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        await this.finish(0, { status: response.status });
        return Response.json(
          { error: 'GPT Live could not connect.' },
          { status: 502 },
        );
      }
      const answer = (await response.json()) as {
        session?: { id?: string };
        transport?: { sdp?: string };
      };
      if (!answer.session?.id || !answer.transport?.sdp)
        throw new Error('Missing voice connection.');
      this.record.providerId = answer.session.id;
      await this.save();
      await this.attach();
      return Response.json({
        sdp: answer.transport.sdp,
        sessionId: answer.session.id,
      });
    } catch {
      await this.close();
      return Response.json(
        {
          error:
            'Voice could not start with quota protection. Your work is preserved.',
        },
        { status: 503 },
      );
    }
  }

  /** Reloads persisted grants after eviction and reconnects monitoring before more paid time. */
  private async restore() {
    this.record ??= await this.ctx.storage.get<VoiceRecord>('voice');
    if (this.record?.providerId && !this.record.closed && !this.socket)
      await this.attach();
  }

  /** Opens a trusted provider control socket; failure keeps reservations held for retry. */
  private async attach() {
    const record = this.record!;
    const response = await fetch(
      `https://api.openai.com/v1/live/sessions/${encodeURIComponent(record.providerId!)}/attach`,
      {
        headers: {
          Upgrade: 'websocket',
          Authorization: `Bearer ${accountConfig().OPENAI_API_KEY}`,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.webSocket)
      throw new Error('Voice usage monitor is unavailable.');
    const socket = response.webSocket;
    socket.accept();
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.ctx.waitUntil(this.event(event.data));
    });
    socket.addEventListener('close', () => {
      this.socket = undefined;
      if (!this.record?.closed)
        this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 1000));
    });
    socket.addEventListener('error', () => {
      this.socket = undefined;
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 1000));
    });
  }

  /** Persists usage and finalization only; reflected audio and transcripts are discarded. */
  private async event(raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || !this.record || this.record.closed) return;
    const event = JSON.parse(raw) as {
      type?: string;
      usage?: { seconds?: number };
      reason?: string;
    };
    if (
      typeof event.usage?.seconds === 'number' &&
      Number.isFinite(event.usage.seconds)
    ) {
      this.record.seconds = Math.max(this.record.seconds, event.usage.seconds);
      await quotaStore.progress(
        this.record.grants[0].id,
        this.record.seconds * 1000,
      );
      await this.save();
    }
    if (event.type === 'session.closed')
      await this.finish(this.record.seconds * 1000, {
        sessionId: this.record.providerId,
        seconds: this.record.seconds,
        reason: event.reason,
        confirmed: true,
      });
  }

  /** Renews reserved time or closes the provider; persisted deadlines survive eviction. */
  async alarm() {
    try {
      await this.restore();
      if (!this.record || this.record.closed) return;
      if (Date.now() >= this.record.resetsAt) {
        await this.close();
        return;
      }
      if (this.record.closing) {
        this.socket?.send(JSON.stringify({ type: 'session.close' }));
        await this.ctx.storage.setAlarm(Date.now() + 5000);
        return;
      }
      const elapsed = Date.now() - this.record.started;
      const reserved = this.record.grants.reduce(
        (sum, grant) => sum + grant.milliseconds,
        0,
      );
      const needed = Math.max(0, elapsed + 20000 - reserved);
      let extended = false;
      if (needed) {
        try {
          const grant = await reserveAi(this.record.access, needed, 'voice');
          this.record.grants.push(grant);
          await this.save();
          extended = true;
        } catch (error) {
          if (
            !(error instanceof Response) ||
            ![401, 429].includes(error.status)
          )
            throw error;
          if (error.status === 401) {
            await this.close();
            return;
          }
        }
      }
      const total = this.record.grants.reduce(
        (sum, grant) => sum + grant.milliseconds,
        0,
      );
      if (!extended && elapsed >= total) await this.close();
      else
        await this.ctx.storage.setAlarm(
          Math.min(
            Date.now() + 10000,
            this.record.started + total,
            this.record.resetsAt,
          ),
        );
    } catch {
      // Lost monitoring or database access must not leave paid voice running freely.
      await this.close();
    }
  }

  /** Requests provider closure and schedules retries until final usage is confirmed. */
  private async close() {
    if (!this.record || this.record.closed) return;
    if (!this.record.providerId) {
      await this.finish(Date.now() - this.record.started, {
        confirmed: false,
        reason: 'startup_unconfirmed',
      });
      return;
    }
    this.record.closing = true;
    await this.save();
    if (this.socket)
      this.socket.send(JSON.stringify({ type: 'session.close' }));
    // Retry attachment and closure after eviction or an upstream interruption.
    await this.ctx.storage.setAlarm(Date.now() + 5000);
  }

  /** Settles grants idempotently and releases monitoring only after provider finalization. */
  private async finish(milliseconds: number, usage: unknown) {
    if (!this.record || this.record.closed) return;
    let remaining = Math.max(0, milliseconds);
    for (let index = 0; index < this.record.grants.length; index++) {
      const grant = this.record.grants[index];
      const used =
        index === this.record.grants.length - 1
          ? remaining
          : Math.min(grant.milliseconds, remaining);
      await quotaStore.settle(grant.id, used, index === 0 ? usage : null);
      remaining -= used;
    }
    this.record.closed = true;
    await this.save();
    await this.ctx.storage.deleteAlarm();
    this.socket?.close();
    this.socket = undefined;
    await accountDatabase()`DELETE FROM mathwave_voice_sessions WHERE id = ${this.ctx.id.toString()}`;
  }

  private save() {
    return this.ctx.storage.put('voice', this.record);
  }
}
