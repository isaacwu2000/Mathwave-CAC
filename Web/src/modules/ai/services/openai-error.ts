/** Return fixed public messages; never forward provider text or credentials. */
export async function openAIErrorMessage(response: Response): Promise<string> {
  let code = '',
    type = '';
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; type?: unknown };
    };
    code = typeof body.error?.code === 'string' ? body.error.code : '';
    type = typeof body.error?.type === 'string' ? body.error.type : '';
  } catch {
    /* Some gateways return non-JSON errors. */
  }
  let message: string;
  if (code === 'credit_balance_exhausted')
    message =
      'OpenAI API credits are exhausted. Add API credits to use AI commands.';
  else if (
    [
      'project_spend_limit_exceeded',
      'organization_spend_limit_exceeded',
      'organization_usage_limit_exceeded',
      'usage_limit_exceeded',
    ].includes(code)
  )
    message =
      'OpenAI API usage or spending limit reached. Check the API account limits.';
  else if (code === 'insufficient_quota' || type === 'insufficient_quota')
    message =
      'OpenAI API quota is unavailable. Check API billing and usage limits.';
  else if (
    ['rate_limit_exceeded', 'slow_down'].includes(code) ||
    type === 'rate_limit_error'
  )
    message =
      'OpenAI is temporarily rate-limiting requests. Wait a moment and try again.';
  else if (response.status === 401)
    message = 'OpenAI authentication failed. Check the configured API key.';
  else if (response.status === 403 || code === 'model_not_found')
    message =
      'OpenAI model or project access is unavailable. Check API permissions.';
  else if (response.status === 429)
    message =
      'OpenAI rejected the request with an unspecified limit. Check API billing or limits.';
  else message = 'OpenAI could not connect. Try again later.';
  return `${message} Your work is saved. Browser voice and local math commands are still available.`;
}
