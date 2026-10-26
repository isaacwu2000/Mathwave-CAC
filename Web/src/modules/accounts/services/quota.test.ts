import { describe, expect, test } from 'vitest';
import {
  quotaPeriod,
  allowanceMilliseconds,
  formatAllowance,
} from './quota.ts';

describe('student AI allowances', () => {
  test('resets at New York midnight, including daylight saving changes', () => {
    expect(quotaPeriod(new Date('2026-11-01T03:59:59Z'))).toEqual({
      key: '2026-10',
      resetsAt: '2026-11-01T04:00:00.000Z',
    });
    expect(quotaPeriod(new Date('2026-11-01T04:00:00Z'))).toEqual({
      key: '2026-11',
      resetsAt: '2026-12-01T05:00:00.000Z',
    });
  });
  test('grants one three-minute guest trial and monthly student and development hours', () => {
    expect(allowanceMilliseconds('guest')).toBe(180000);
    expect(allowanceMilliseconds('student')).toBe(18000000);
    expect(allowanceMilliseconds('development')).toBe(36000000);
    expect(allowanceMilliseconds('ip')).toBe(3600000000);
    expect(formatAllowance(179000)).toBe('2 min 59 sec');
    expect(formatAllowance(18000000)).toBe('5 hr 0 min');
  });
});
