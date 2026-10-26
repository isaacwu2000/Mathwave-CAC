/** Caps main-thread grid work and drops duplicate coordinates below floating-point precision. */
export function gridTicks(min: number, max: number, step: number): number[] {
  if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min)
    return [];
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let index = 0; index < 64; index++) {
    const value = first + index * step;
    if (!Number.isFinite(value) || value > max) break;
    if (value >= min && value !== ticks.at(-1)) ticks.push(value);
  }
  return ticks;
}
