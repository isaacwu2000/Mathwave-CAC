import { AuthPage } from '../../src/modules/accounts/ui.ts';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <AuthPage
      initialMode={query.mode === 'forgot' ? 'forgot' : 'signin'}
      resetToken={typeof query.token === 'string' ? query.token : ''}
      oauthError={Boolean(query.error)}
    />
  );
}
