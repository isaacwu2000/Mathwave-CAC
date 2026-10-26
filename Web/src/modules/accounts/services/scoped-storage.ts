/** Keeps recovery drafts and pending writes private to the server-issued owner. */
export function scopedStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  owner: string,
) {
  const prefix = `mathwave:${owner}:`;
  return {
    getItem: (key: string) => storage.getItem(prefix + key),
    setItem: (key: string, value: string) =>
      storage.setItem(prefix + key, value),
    removeItem: (key: string) => storage.removeItem(prefix + key),
  };
}
