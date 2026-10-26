import { neon } from '@neondatabase/serverless';
import { expect, test, vi } from 'vitest';
import { createProblemLibraryStore } from '../../problems/server.ts';
import { createProblemLibrary, currentProblem } from '../../problems/index.ts';
import { createGuestTransfer } from './transfer.ts';
import { createDeletionCleanup } from './deletion.ts';

vi.mock('cloudflare:workers', () => ({ env: {} }));
const url = process.env.MATH_AUDIO_TEST_DATABASE_URL;

test.skipIf(!url)(
  'guest transfer retries a competing source save and imports it only once',
  async () => {
    const sql = neon(url!);
    const store = createProblemLibraryStore(() => sql, createProblemLibrary);
    const guest = `guest:${crypto.randomUUID()}`,
      owner = `user:${crypto.randomUUID()}`;
    await sql`INSERT INTO mathwave_guests(owner_id, claimed_by) VALUES (${guest}, ${owner})`;
    const initial = await store.load(guest);
    let raced = false;
    const connect = () =>
      new Proxy(sql, {
        get(target, key) {
          if (key === 'transaction')
            return async (...args: Parameters<typeof sql.transaction>) => {
              if (!raced) {
                raced = true;
                const next = structuredClone(initial.book);
                next.assignments[0].problems[0].title =
                  'Saved in the other tab';
                next.draft = 'unfinished guest input';
                await sql`UPDATE math_audio_notebooks SET notebook = ${JSON.stringify(next)}::jsonb, revision = revision + 1 WHERE owner_id = ${guest}`;
              }
              return target.transaction(...args);
            };
          return Reflect.get(target, key);
        },
      });
    const transfer = createGuestTransfer(connect, store);
    await transfer(guest, owner);
    const saved = await store.load(owner);
    expect(currentProblem(saved.book).title).toBe('Saved in the other tab');
    expect(saved.book.draft).toBe('unfinished guest input');
    await transfer(guest, owner);
    expect((await store.load(owner)).book.assignments).toHaveLength(2);
    await sql`DELETE FROM math_audio_requests WHERE owner_id IN (${owner}, ${guest})`;
    await sql`DELETE FROM math_audio_notebooks WHERE owner_id IN (${owner}, ${guest})`;
    await sql`DELETE FROM mathwave_guests WHERE owner_id = ${guest}`;
  },
);

test.skipIf(!url)(
  'application cleanup can retry after provider deletion without a login session',
  async () => {
    const sql = neon(url!);
    const owner = `user:${crypto.randomUUID()}`;
    const store = createProblemLibraryStore(() => sql, createProblemLibrary);
    await store.load(owner);
    await sql`INSERT INTO mathwave_deleted_accounts(owner_id) VALUES (${owner})`;
    let fail = true;
    const connect = () =>
      new Proxy(sql, {
        get(target, key) {
          if (key === 'transaction')
            return (...args: Parameters<typeof sql.transaction>) => {
              if (fail) {
                fail = false;
                return Promise.reject(
                  new Error('Synthetic interrupted cleanup'),
                );
              }
              return target.transaction(...args);
            };
          return Reflect.get(target, key);
        },
      });
    const cleanup = createDeletionCleanup(connect);
    await expect(cleanup()).rejects.toThrow('Synthetic interrupted cleanup');
    expect(await cleanup()).toBe(1);
    expect(await cleanup()).toBe(0);
    await expect(store.load(owner)).rejects.toThrow(
      'This account was deleted.',
    );
    await sql`DELETE FROM mathwave_deleted_accounts WHERE owner_id = ${owner}`;
  },
);
