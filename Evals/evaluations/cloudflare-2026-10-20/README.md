# Cloudflare deployment — October 20, 2026

Origin: https://math-audio.isaacwu2000.workers.dev
Worker version: 78a7b534-9e4e-4515-959e-86404cf6dddc
Starting source revision: 0bd322b, with the lazy auth SDK import fix committed alongside this report.

- [x] Confirm authorized Cloudflare account and no existing Workers to overwrite.
- [x] Build/deploy with six required settings, VoiceQuota SQLite binding/migration, and five-minute cleanup cron.
- [x] Register and confirm the exact HTTPS origin in Neon Auth.
- [x] Verify seven hosted synthetic HTTP journeys without paid AI calls (http.json).
- [x] Browser guest entry, ordinary email/password dev login, private Settings and ten-hour allowance; hosted screenshot saved here.
- [x] Fix initial HTML 500: Neon browser SDK generates randomness at module load, forbidden by Workers. Dynamic import only in browser effects/actions avoids loading it during SSR. Regression test went red before fix, then green.
- [x] 509 deterministic tests passed; types, lint, boundaries and build passed. Five opt-in DB tests skipped in this run; database behavior exercised by hosted HTTP journey.
- [ ] Production Google credentials/linking and real email delivery.
- [ ] Provider 30-day session settings and actual paid voice exhaustion cutoff.

Email ownership flags and reset tokens were seeded only for this run’s disposable synthetic identity. The identity was deleted successfully. This proves application gating/reset/deletion, not inbox delivery. Browser checks used the same dev identity/database as local. No real-student usability claim.
