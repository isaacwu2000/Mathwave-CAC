import { expect, it, vi } from 'vitest';

it('can load auth UI on a Worker without startup random-number generation', async () => {
  const random = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    throw new Error('Worker startup cannot generate random values.');
  });
  try {
    await expect(import('./client.ts')).resolves.toBeDefined();
    expect(random).not.toHaveBeenCalled();
  } finally {
    random.mockRestore();
  }
});
