# Google OAuth configuration — October 20, 2026

- [x] Create Mathwave consent branding with isaacwu2000@gmail.com support/contact and external audience.
- [x] Accept Google API Services User Data Policy after the owner's explicit confirmation.
- [x] Create Web client Mathwave Web after explicit credential-creation approval.
- [x] Configure hosted app, localhost:5173 and localhost:5179 origins; Neon callback.
- [x] Store client credentials in Neon; confirm provider type standard. Temporary secret export removed; secret excluded from Git/public app.
- [x] Publish owner-approved privacy notice and app information; register their URLs in Google.
- [x] Publish app; browser confirms In production and External. Screenshot: audience-production.png.
- [x] HTTP authorization redirect reaches accounts.google.com with the expected Mathwave client, exact Neon callback, and only email profile openid scopes. No signed-in Google data was accessed by this check.
- [ ] Complete Google login/linking with an owner Google account. Configuration evidence is not a full login acceptance claim.

Google project: mathwave-auth-20261019. Neon project cold-fog-40535699, branch br-frosty-haze-b88xbyra. Hosted app https://math-audio.isaacwu2000.workers.dev.
Public pages: /about and /privacy, both HTTP 200 without authentication. Cloudflare version 4bd6125c-bc72-4ae5-ae1a-87328605fa88. No paid AI calls.
