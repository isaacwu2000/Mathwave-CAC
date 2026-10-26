import type { AllowanceKind } from '../types/index.ts';

export function allowanceMilliseconds(kind: AllowanceKind) {
  return {
    guest: 180000,
    student: 18000000,
    development: 36000000,
    ip: 3600000000,
  }[kind];
}

/** Returns the current New York calendar month and next local midnight reset. */
export function quotaPeriod(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')!.value);
  const month = Number(parts.find((part) => part.type === 'month')!.value);
  const next = new Date(Date.UTC(year, month, 1));
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  })
    .formatToParts(next)
    .find((part) => part.type === 'timeZoneName')!.value;
  const hours = Number(offset.match(/GMT([+-]\d+)/)?.[1] ?? 0);
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    resetsAt: new Date(next.getTime() - hours * 3600000).toISOString(),
  };
}

export function formatAllowance(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)} hr ${Math.floor((seconds % 3600) / 60)} min`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}
