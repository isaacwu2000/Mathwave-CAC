# Persistent guest sign-in — October 20, 2026

Starting revision: 547b895. Cloudflare version: a2d0bfd9-0fed-45de-ab40-2804dffd3bb5.

- [x] Guest sees a Sign in button at the top right even before trial exhaustion.
- [x] Trial countdown remains hidden; exhausted guest retains the sign-in prompt.
- [x] Signed-in accounts hide the guest button and retain allowance in Settings.
- [x] Three focused render tests passed; types, lint, boundaries and production build passed.
- [x] Hosted desktop/narrow-screen screenshots captured; clicking Sign in reached /auth.
- [x] Scoped layout detector: no findings. Synthetic browser evidence, no paid AI calls.

Chrome inspection confirmed Google Auth Platform is not configured yet. OAuth discussion: use Mathwave branding, isaacwu2000@gmail.com support email, external audience and basic identity only. No Google credentials were created or changed in this task.
