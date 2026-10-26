/** Stop controls remain immediate even when the network is slow. Problem
 * management is handled directly because the AI tool cannot manage problems. */
export function shouldInterpretWithAI(text: string): boolean {
  const command = text
    .trim()
    .replace(/^please\s+/i, '')
    .replace(/[.!?]+$/, '');
  return !/^(?:stop|stop listening|stop reading|mute|unmute|never mind|cancel (?:the )?(?:question|clarification)|new (?:session|problem|assignment)(?: .*)?|clear workspace|export(?: .*)?|print|save pdf|rename (?:problem|assignment)(?: .*)?|open (?:problem|assignment)(?: .*)?|read (?:my )?(?:work|steps))$/i.test(
    command,
  );
}
