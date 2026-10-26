export type CaseFamily = { id: string; category: string };
export type SelectionOptions = {
  cases?: string[];
  categories?: string[];
  sample?: number;
  seed?: string;
};

/**
 * Selects whole case families after intersecting ID and category filters.
 * Samples without replacement, balancing categories before taking a second case
 * from any category. Small categories exhaust before larger ones fill the rest.
 * The same seed and catalog reproduce the order; invalid or empty selections fail.
 */
export function selectCases<T extends CaseFamily>(
  catalog: readonly T[],
  options: SelectionOptions,
): T[] {
  if (new Set(catalog.map((c) => c.id)).size !== catalog.length)
    throw new Error('Duplicate case family IDs.');
  for (const [values, allowed, label] of [
    [options.cases, catalog.map((c) => c.id), 'cases'],
    [options.categories, catalog.map((c) => c.category), 'categories'],
  ] as const) {
    if (
      values &&
      (!values.length ||
        new Set(values).size !== values.length ||
        values.some((v) => !allowed.includes(v)))
    )
      throw new Error(`Unknown or duplicate ${label}.`);
  }
  const eligible = catalog.filter(
    (c) =>
      (!options.cases || options.cases.includes(c.id)) &&
      (!options.categories || options.categories.includes(c.category)),
  );
  if (!eligible.length) throw new Error('No eligible case families.');
  if (options.sample === undefined) return eligible;
  const categories = [...new Set(eligible.map((c) => c.category))].sort();
  if (
    !Number.isInteger(options.sample) ||
    options.sample < categories.length ||
    options.sample > eligible.length
  )
    throw new Error(
      `Sample must cover each category: use ${categories.length}–${eligible.length} families.`,
    );
  if (!options.seed) throw new Error('Sampling requires a nonempty seed.');
  // A seeded integer generator makes sampling independent of system randomness.
  let state = 2166136261;
  for (const char of options.seed)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <U>(values: U[]) => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  const buckets = shuffle(categories).map((category) =>
    shuffle(
      eligible
        .filter((c) => c.category === category)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );
  const selected: T[] = [];
  while (selected.length < options.sample)
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next) selected.push(next);
      if (selected.length === options.sample) break;
    }
  return selected;
}
