# Settings toggles and account checks — 2026-10-20

Starting revision: 31a1bd0. Initial checkout clean. Scoped files: globals.css and
account-controls.tsx; concurrent native work preserved.

## Checklist

- [x] Reproduce checked thumb overflowing the track on the deployed app.
- [x] Fix the competing CSS translate and transform rules at the Settings override.
- [x] Check both switches with pointer and keyboard input in local preview.
- [x] Measure checked and unchecked thumb bounds: contained, approximately 3px edge inset.
- [x] Inspect desktop and mobile Settings with the existing visual system.
- [x] Verify Sign out is present under Settings → Account for a signed-in account.
- [x] Add action-specific pending text: Signing out… and Connecting….
- [x] Live hosted email/password sign-in succeeds with the ordinary synthetic agent account.
- [x] Signed-in Settings shows account identity and ten-hour allowance.
- [x] Live hosted sign-out returns to guest workspace and restores Sign in.
- [x] Reload in local preview retains authentication and celebration preference.
- [x] Account tests: 15 passed, 3 integration tests skipped; types, lint, boundaries and build pass.
- [x] Layout detector: no findings.

## Evidence and limits

The faulty thumb had both translate(calc(100% - 2px)) and transform(translateX(16px)).
The Settings selector now overrides the component translate utility, leaving one movement.
Checked inset: left ~19px/right ~3px. Unchecked inset: left ~3px/right ~19px.
Screenshots show desktop and narrow Settings. Requested narrow viewport was 390×844;
the browser rendered at its 433 CSS pixel minimum. No paid AI calls were requested.

Spoken-response preference remains session-scoped, as before; celebrations persist.
No passwords, reset tokens or session cookies were recorded. No accounts or saved problems
were deleted. Google owner consent, real inbox delivery, account deletion and exports were
not exercised in this check; existing auth setup documentation retains those limitations.

## Production correction

The first deployment exposed a production CSS optimization difference: `translate: none`
was dropped from the optimized CSS, so the original utility still moved the thumb. The
shared Switch now uses `transform` for its checked/unchecked positions as well, leaving
one property for both component defaults and Settings overrides. The ineffective
`translate: none` override was removed. Google sign-in also reached Google's login
screen through the live button; owner login and consent were not completed.

Final Cloudflare version: 1dbaea66-1c2b-4806-9024-cf9625cb2468.
Live post-deployment bounds check passed for both checked switches, with computed translate
`none`. settings-published.png records the corrected public Settings page. The local sign-out
pending state displayed Signing out… and disabled both account actions before returning to guest.
