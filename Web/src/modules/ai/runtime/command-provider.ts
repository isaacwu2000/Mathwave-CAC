import { env } from 'cloudflare:workers';
import { COMMAND_PROFILES } from '../config/openai-config.ts';

/** Selects a server-configured command model; credentials never enter browser state or eval reports. */
export function commandProvider() {
  const config = env as unknown as {
    OPENAI_API_KEY?: string;
    OPENROUTER_API_KEY?: string;
    MATH_AUDIO_COMMAND_PROFILE?: string;
  };
  const profile = config.MATH_AUDIO_COMMAND_PROFILE || 'luna-default';
  if (!Object.hasOwn(COMMAND_PROFILES, profile))
    throw new Error('Unknown command model profile.');
  const settings = COMMAND_PROFILES[profile as keyof typeof COMMAND_PROFILES];
  if (profile === 'luna-default') {
    if (!config.OPENAI_API_KEY)
      throw new Error('AI interpretation is unavailable.');
    return {
      profile,
      ...settings,
      key: config.OPENAI_API_KEY,
      url: 'https://api.openai.com/v1/responses',
    };
  }
  if (!config.OPENROUTER_API_KEY)
    throw new Error('OpenRouter interpretation is unavailable.');
  return {
    profile,
    ...settings,
    key: config.OPENROUTER_API_KEY,
    url: 'https://openrouter.ai/api/v1/responses',
  };
}
