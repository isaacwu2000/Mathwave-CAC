export const speechLanguages = [
  ['en-US', 'English · US'],
  ['en-GB', 'English · UK'],
  ['en-AU', 'English · Australia'],
  ['en-IN', 'English · India'],
] as const;
export type SpeechLanguage = (typeof speechLanguages)[number][0];
export function speechLanguage(value: unknown): SpeechLanguage {
  return speechLanguages.some(([code]) => code === value)
    ? (value as SpeechLanguage)
    : 'en-US';
}
export function recordingLanguage(voice: string): SpeechLanguage {
  return voice === 'Daniel'
    ? 'en-GB'
    : voice === 'Karen'
      ? 'en-AU'
      : voice === 'Rishi'
        ? 'en-IN'
        : 'en-US';
}
