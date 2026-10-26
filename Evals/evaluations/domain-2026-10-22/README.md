# mathwave.app production domain smoke checks

Date: October 22, 2026. Origin: https://mathwave.app.
This connects the existing deployed Cloudflare Worker; it does not deploy the
newer local application code. The task started at `87cf572`; the production
route configuration was verified while the checkout was at `efdd954`.

## Configuration verified

- Vercel remains the registrar; public nameservers are
  `felicity.ns.cloudflare.com` and `gloria.ns.cloudflare.com`.
- Cloudflare zone `a905ebc8e13a3450fe2e4f4182dba370` is active on the free plan.
- Worker route `mathwave.app/*` targets `math-audio`. The existing proxied DNS
  records were retained; no DNS records were deleted.
- HTTPS serves the application with status 200; `/about` and `/privacy` return 200.
- Neon Auth trusts the new HTTPS origin in addition to the original workers.dev
  origin. Google sign-in starts successfully and reaches the configured Google
  client via Neon's existing callback. Tokens and cookies were not recorded.
- `Web/vite.config.ts` includes the production route, confirmed in generated
  `Web/dist/server/wrangler.json` after the build.

## Actual browser review

Reviewed at 1280 × 720 in an independent browser session:

1. Public guest workspace renders its microphone control, example commands,
   mascot and sign-in link.
2. Ordinary email/password sign-in with the existing synthetic account finishes
   at the workspace. Settings shows that account and its monthly allowance.
3. Created a separate synthetic problem through the public application API and
   saved `graph y=x^2` without an AI call. After a browser reload, the graph
   renders an upward parabola with vertex at `(0, 0)` beside the equation
   `y = x²`. The problem is marked Saved.
4. Signed out through the app and verified the public guest workspace returns.

Evidence: `http.json`, `google-redirect.json`, `graph-desktop.png`,
`account-desktop.png`, and `home-desktop.png`. The account screenshot was also
opened and visually inspected. The previous synthetic account selection was
restored; previous work was preserved. The separate smoke problem remains saved.
This was a focused check of the domain, authentication and persistence, not a
progressive graph-generation evaluation or a responsive-design change.

## Project verification

`bun run verify` passed: boundaries, 601 tests passed (5 skipped), TypeScript,
lint and production build. Existing chunk-size and Node deprecation warnings
were emitted. Agent guidance link validation passed (143 links).

## Remaining checks

- Google Console branding/origin edits remain pending: its signed-in native
  browser page repeatedly stayed blank. The new app-origin redirect was accepted
  by Neon and the current Google configuration without these edits.
- Full owner Google login/linking, live microphone and spoken playback were not
  performed. No paid provider request was made.
- Real inbox delivery and dyslexic-student usability remain outside these checks.
