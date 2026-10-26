# Workspace UI refinements — 22 October 2026

Starting revision: `9a37e34`. Local Vinext app at `http://localhost:5179`, with an isolated guest problem library. Synthetic triangle and equation/graph states were submitted through the ordinary problem API with interpretation disabled, then inspected in the actual application. No paid provider evaluation was run.

## Completed checklist

- [x] App background `#FFF9F5`; graph and geometry canvas white.
- [x] Pico + Mathwave branding on the signed-out home and top-right sign-in screen.
- [x] Personal/settings entry hidden for guests; workspace Sign in button removed.
- [x] Audio group centered across the top, over full-screen geometry; shapes placed lower.
- [x] Arrow shaft ends before a separately sized arrowhead on desktop/mobile.
- [x] Welcome examples moved toward the bottom.
- [x] Visible Undo buttons and redundant statistics/diagram headings removed. Geometry/construction use their drawing-only mode, omitting titles, captions, dimension summaries and editing controls.
- [x] Non-scientific graph labels have transparent backgrounds; side lengths, point names and axes remain visible.
- [x] About route and navigation link removed; Privacy retained.
- [x] Microphone transcript uses one line and follows its right edge.
- [x] Pico replies wrap below a fixed control row. Before/after long reply, microphone/arrow/Pico positions remained unchanged.
- [x] Five seconds without microphone signal or new transcript shows `[No audio]`; a new transcript clears it.
- [x] Equation scrollbars hidden while scrolling remains available; equation-row hover fill removed.
- [x] Numerical coefficients join variable factors (`5x`, `5x²`); numeric and variable-to-variable multiplication retain the dot.

## Visual review

Visually inspected the rendered welcome, sign-in, triangle and graph on desktop and mobile. Desktop screenshot surface was 1422×800; mobile override requested 390×844 (the browser's existing zoom produced approximately 433×938 CSS pixels). Screenshots in this directory are evidence of the inspected states, not merely unreviewed captures.

- `welcome-*`: cream surfaces, lower examples, compact branding, no account or sign-in controls.
- `auth-*`: top-right branding, existing sign-in form, Privacy only.
- `triangle-*`: right triangle with legs 3 and 4, hypotenuse 5 and right-angle marker; no extra surrounding labels/controls, no white label backing.
- `equation-desktop.png`: `x² + 5x = 0`, no scrollbars. Computed styles confirmed scrollbar-width none and no equation hover-background rule.
- `graph-*`: upward parabola `y=x²`, vertex at the origin and values consistent with (±2,4); desktop split and mobile stacked graph remain functional.
- `no-audio.png`: real AudioPanel component in a temporary local fixture, microphone state simulated. Silence note visually reviewed after five seconds. Long transcript measured 26px tall, nowrap, scroll width 867px, visible width 458px, scrollLeft about 409px. Control coordinates stayed unchanged with a multiline reply. Fixture removed afterward.

An HMR hook-state error occurred while concurrent source edits were arriving; a full reload cleared it. The final graph was reviewed after that reload. This is local UI evidence, not live-microphone, production, or real-student usability evidence. No progressive graph-generation evaluation suite was run.

## Checks

Focused tests cover math formatting, auth, audio panel, geometry and equation carousel. Typecheck, module boundaries, production build, owned-file lint and all 15 focused tests passed. Whole-repository lint initially failed on concurrent account usage-limit dialog and use-workspace effect changes. The owning chat was notified; a fresh `bun run lint` passed on 23 October 2026 at revision `b5a1b6a`. The first owned AudioPanel effect lint error was corrected before publication. Concurrent Native, speech-training, account-usage and microphone-diagnostic changes are outside this task and must remain untouched.

## Resume note

Requested UI implementation is saved in this task commit. Concurrent account, voice and training work is preserved unstaged. Full repository lint was rerun successfully on 23 October 2026; no verification blocker remains for this UI task. Local review server uses port 5179 and can be restarted with `bun run dev --port 5179`. The temporary UI fixture was deleted; the route list from the production build contains neither About nor the fixture. No deployment or live physical microphone acceptance was performed.
