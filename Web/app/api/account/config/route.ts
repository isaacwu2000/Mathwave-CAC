import { accountConfig } from '../../../../src/modules/accounts/server.ts';
export function GET() {
  return Response.json(
    { configured: Boolean(accountConfig().NEON_AUTH_BASE_URL) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
