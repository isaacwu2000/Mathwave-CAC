import { evaluateMath, parseMath } from './math-engine.ts';
export function displayNumber(n: number) {
  return Number(n.toPrecision(6)).toString();
}
export function parseData(text: string): number[] {
  const numericList =
    /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s+[+-]?(?:\d+(?:\.\d*)?|\.\d+))+\s*$/.test(
      text,
    );
  const pieces = (numericList ? text.trim().replace(/\s+/g, ',') : text)
    .replace(/\bcomma\b/gi, ',')
    .split(/[,;]/)
    .map((p) => p.trim());
  if (pieces.length < 2 || pieces.length > 100)
    throw new Error(
      'Enter 2 to 100 values, separated by commas. For example: data 4, 5, 5, 6, 7, 8, 22.',
    );
  return pieces.map((p) => {
    const n = evaluateMath(parseMath(p));
    if (!Number.isFinite(n) || Math.abs(n) > 1e12)
      throw new Error(
        'Use finite values between minus one trillion and one trillion.',
      );
    return n;
  });
}
export function statistics(data: number[]) {
  const sorted = [...data].sort((a, b) => a - b);
  const median = (d: number[]) =>
    d.length % 2
      ? d[(d.length - 1) / 2]
      : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  const med = median(sorted),
    mid = Math.floor(sorted.length / 2),
    q1 = median(sorted.slice(0, mid)),
    q3 = median(sorted.slice(Math.ceil(sorted.length / 2)));
  const low = q1 - 1.5 * (q3 - q1),
    high = q3 + 1.5 * (q3 - q1);
  const outliers = data
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v < low || v > high);
  const sum = data.reduce((a, b) => a + b, 0);
  const mean = sum / data.length;
  const squared = data.reduce((a, b) => a + (b - mean) ** 2, 0);
  const frequencies = new Map<number, number>();
  sorted.forEach((v) => frequencies.set(v, (frequencies.get(v) ?? 0) + 1));
  const most = Math.max(...frequencies.values());
  return {
    mean,
    sum,
    count: data.length,
    range: sorted[sorted.length - 1] - sorted[0],
    modes:
      most > 1
        ? [...frequencies].filter(([, n]) => n === most).map(([v]) => v)
        : [],
    populationVariance: squared / data.length,
    sampleVariance: squared / (data.length - 1),
    median: med,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1,
    q3,
    low,
    high,
    outliers,
  };
}
export function describeData(data: number[]) {
  const s = statistics(data);
  return `${data.length} observations, in input order. Mean ${displayNumber(s.mean)}. Median ${displayNumber(s.median)}. Range ${displayNumber(s.min)} to ${displayNumber(s.max)}. ${s.outliers.length ? `Potential outliers: ${s.outliers.map((o) => `${displayNumber(o.v)} at observation ${o.i + 1}`).join(', ')}.` : 'No potential outliers by this rule.'} Outliers use the 1.5 times interquartile range rule, with the median excluded from each half. A flagged value is not necessarily an error. This is a descriptive summary; it does not establish a trend or cause.`;
}
