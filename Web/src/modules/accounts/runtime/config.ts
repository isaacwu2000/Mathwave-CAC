import { env } from 'cloudflare:workers';

export function accountConfig() {
  return env as unknown as {
    DATABASE_URL?: string;
    NEON_AUTH_BASE_URL?: string;
    NEON_AUTH_COOKIE_SECRET?: string;
    MATHWAVE_DEVELOPMENT_USER_ID?: string;
    GUEST_IP_MONTHLY_HOURS?: string;
    CLOUD_TEST_MODE?: string;
    CLOUD_TEST_PROBLEM_OWNER?: string;
    CLOUD_TEST_NOTEBOOK_OWNER?: string;
    OPENAI_API_KEY?: string;
    VOICE_QUOTA?: DurableObjectNamespace;
  };
}
