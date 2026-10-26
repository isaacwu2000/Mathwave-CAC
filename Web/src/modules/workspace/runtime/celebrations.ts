type CelebrationStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const celebrationsPreference = 'mathwave-celebrations-enabled';

/** Claims one celebration per confirmed result in this browser before any animation begins. Storage failure stays quiet. */
export function claimCelebration(
  storage: CelebrationStorage,
  problemId: string,
  revision: number,
): boolean {
  try {
    const key = `mathwave-celebrated:${problemId}:${revision}`;
    if (storage.getItem(key)) return false;
    storage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}
