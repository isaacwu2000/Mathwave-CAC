# Vertical-line graph correction — October 20, 2026

## Checklist

- [x] Inspect the user's local browser work and read saved conversation without changing it.
- [x] Reproduce the failure through the live graph-build endpoint.
- [x] Add a failing context-selection regression, then fix it.
- [x] Verify vertical rendering coordinates and contextual graph requests.
- [x] Integrate newer main `66cd1d0` and run complete verification.
- [x] Apply main's existing account migration to the development database; confirm the original saved revision is unchanged.
- [x] Commit and push the verified fix to main.

The saved equation was `x = 4`. No graph request was present in its saved
conversation, so this does not identify the exact microphone transcript.
The live read-only request `graph x equals 4` reproduced an unsupported response:
“The graph tool cannot draw the vertical line x = 4.” See [before.ndjson](before.ndjson).

The deterministic graph engine already supported vertical lines. The local
instruction selector omitted relation capabilities for that phrasing and for
references to the current equation. It now supplies them for x-equality/line
requests and contextual graph requests, while preserving ordinary algebra and
explicit-function prompt selection. Instructions explain the fixed x coordinate
and prohibit replacing the relation with a horizontal or residual function.

[after-explicit.ndjson](after-explicit.ndjson) records the corrected live request.
[after-contextual.ndjson](after-contextual.ndjson) records `graph it` against the
same saved `x = 4` equation after integrating main. Both produced a validated
`graph.plot("x=4")` preview and ready event. These requests do not save changes;
the user's original work remained at revision 8.

The regression checks natural phrasing and the current-equation reference.
A separate public command/rendering check asserts every rendered x coordinate is
4 and the y coordinates span the viewport from -10 to 10, preserving the source
workspace. Complete verification passed 512 tests with five skipped, type
checking, lint, boundary checks and the production build. The initial integrated
test run lacked main's newly pinned auth dependency; a frozen Bun install fixed
that environment issue before the passing run.

Browser inspection used the existing native Chrome session before the user asked
to use the extension. No extension connection was available afterward, so no
further browser tab switching or visual acceptance is claimed. Provider checks
were background HTTP calls; rendering verification was deterministic. Physical
microphone transcription and real-student usability remain unverified here.
