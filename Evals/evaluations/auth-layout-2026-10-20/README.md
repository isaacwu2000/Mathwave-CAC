# Sign-in layout verification — 2026-10-20

## Checklist

- [x] Google sign-in on the left and email/password on the right at desktop width.
- [x] Multicolor Google mark matches the existing LearnUnlock implementation.
- [x] Removed guest-trial continuation from all authentication modes.
- [x] About and Privacy sit outside the form at the bottom right.
- [x] Narrow layout stacks Google before email, preserving DOM and keyboard order.
- [x] Recovery, signup and verification controls remain reachable; mode changes focus the heading.
- [x] Invalid credentials show an inline alert; pending submission disables both authentication actions.
- [x] Account tests: 15 passed, 3 existing integration skips. Typecheck, lint and boundaries passed.
- [x] Layout detector returned no findings. Desktop and narrow screenshots inspected.

## Layout assessment

The heading introduces two distinct authentication groups separated by whitespace and a light rule.
The email field, password field, submission and recovery controls stay together. Google remains one
clear action. Footer links are separate from the task. Generous group spacing contrasts with tighter
field spacing; the dark email button supplies the strongest action weight. At the browser's narrowest
rendered viewport (433 CSS pixels, requested 390), the groups stack and links wrap without horizontal
overflow (scroll width equals viewport width). The footer stays in document flow, so short heights can
scroll. Recovery is a single bounded column; verification instructions wrap without changing field order.

Screenshots: desktop.png and mobile.png. The mobile screenshot predates the final increase of the
email button to 18px text and 56px height; desktop.png includes that refinement.

## Scope and limits

This change preserves existing authentication handlers. It does not reverify actual Google account
linking or email delivery; those external integration checks remain documented in AUTH-SETUP.md.

## Publication

Published and visually verified at https://math-audio.isaacwu2000.workers.dev/auth.
Cloudflare version: 2d59a330-126e-42aa-b837-7816ce5363f6.
Full suite: 514 passed, 5 skipped, with one local-port test blocked by sandbox EPERM.
The affected test file passed separately outside the sandbox (5 tests), resolving that failure.
The final checkout includes the newer vertical-line graphing change from origin/main.
