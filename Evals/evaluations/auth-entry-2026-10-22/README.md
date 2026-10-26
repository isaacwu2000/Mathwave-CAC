# Sign-in entry verification — October 22, 2026

## Task checklist

- [x] Inspect checkout, concurrent changes, auth implementation, and provider SDK.
- [x] Remove the desktop/mobile divider and standalone confirmation link.
- [x] Start verification automatically after signup or an unverified sign-in.
- [x] Preserve the code screen as a retry location when delivery fails.
- [x] Send Google through the dedicated callback and require a real session.
- [x] Run focused regression tests and the complete Web verification command.
- [x] Verify final deployed email entry and ordinary password sign-in visually.
- [x] Prepare only this task's changes for commit and push.
- [ ] Complete owner Google authentication. Blocked: Google sign-in in the
  signed-in Chrome setup window renders blank. The separate app browser reaches
  Google's real email/password prompt, where owner credentials are required.
- [ ] Verify real inbox delivery. No inbox delivery is established by mocks.

## Evidence limits

This is a focused auth browser smoke check, not a mathematical evaluation or
student usability study. No mathematical rendering or model behavior changed.
Native and unrelated prompt changes in the shared checkout are excluded.

The complete Web check passed: 606 tests, 5 skipped; boundary, type, lint, and
production-build checks passed. The revised thrown-error regression reproduces
the SDK's real failure shape. An earlier browser check caught the difference
between returned errors and the SDK's thrown normalized errors; that is fixed.

## Visual review

Screenshots were inspected, including labels, spacing, button availability, and
error/recovery text. The browser's viewport override is affected by its zoom;
observed CSS viewports were 984 × 615 desktop and 300 × 649 mobile. Evidence JPEG
dimensions can differ slightly from the viewport during panel resizing.

- `signin-desktop.jpg`: two-column form, no center divider or confirmation link.
- `signin-mobile.jpg`: stacked form, both remaining account links usable,
  no horizontal divider.
- `google-empty-session.jpg`: real anonymous `/auth/callback` stays on a visible
  failure instead of navigating to a guest workspace. Loading state also reviewed.
- `google-provider.jpg`: the real Google sign-in page is reached through the
  configured client, requesting only email/profile/openid. It displays `neon.tech`
  in the provider prompt; branding/domain work and the owner journey remain open.
- `automatic-verification.jpg`: mocked raw HTTP 403 `EMAIL_NOT_VERIFIED`, passed
  through the real SDK, automatically requests an OTP and opens code entry after
  a mocked successful delivery. Pending and completed states inspected on mobile.
- `verification-retry.jpg`: mocked resend failure leaves the form and retry
  button available. Mobile failure state inspected.
- `signup-delivery-failure.jpg`: mocked successful signup followed by mocked
  OTP HTTP 500 stays on confirmation with an enabled Send verification code
  button. Desktop pending and failed states inspected; no real account created.
- `email-signed-in.jpg`: real existing synthetic account signs in and its
  identity and saved problems appear in settings. Signed out afterward.

Final Cloudflare deployment: `84d1d019-9125-4663-b56c-31c9c6497e68`.
Both `mathwave.app/auth` and the original workers.dev entry return HTTP 200.
All interception rules and the temporary viewport override were cleared.

The outgoing Google request was inspected through browser interception and then
continued to the live provider. Its success callback is
`https://mathwave.app/auth/callback`; its failure callback is
`https://mathwave.app/auth?error=google`. No authorization codes, cookies,
passwords, OAuth state values, or client secrets are saved in this evidence.
