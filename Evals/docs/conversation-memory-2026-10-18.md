# Conversation memory and voice reliability checks

These are synthetic development checks, not student usability evidence.

## Live text results

- `conversation-memory-0af61f5a-9d2a-4cc6-a967-f6e6d66f4caf.json`: 8/8 algebra checks.
  A fresh question about removing an added five produced a read-only suggestion.
  “Okay, go ahead” applied it. After 18 readbacks, a correction to subtract seven
  replaced the original operation rather than subtracting again. Reloaded work
  simplified to `3*x-2=13`. An ambiguous request asked for clarification.
- `conversation-memory-990b720a-3c30-4cba-87c5-48abb4329b15.json`: 3/3 geometry checks.
  The model retained a spoken 5–12–13 triangle description, respected “no drawing
  yet,” and identified thirteen as its hypotenuse after a different equation
  and 18 readbacks.

These runs used the live text interpreter and real deterministic problem operations
in memory. Explanations preserved mathematical state and saved step counts. Clear
read/simplify requests took about 1 ms locally in the algebra run with no interpreter
request; model-dependent turns took about 3.6–7.0 seconds. These timings cover this
small local sample, excluding database writes, rendering, and audio. They are not
a comparable before/after speed benchmark.

Earlier reports are retained: `bbe80ee6` and `3d6b2cc7` used an invalid evaluation
clarification format and did not reach the model. `3f6946e7` passed both natural
geometry turns but incorrectly graded equation whitespace as a failure. The grader
now ignores whitespace while retaining the exact equation expectation. Older report
fields named `modelCalls` counted interpreter endpoint requests, not model attempts.

## Voice and browser boundaries

Mocked transport tests reproduce transcript/delegation events arriving in either
order, late delegation after successful fallback, and an early delegation during
more than six seconds of continuing speech. They verify one execution, the correct
result association, and no false unsupported reply.

The isolated browser opened the current app and reached “Cloud problem could not
be loaded.” This local setup has no `DATABASE_URL`, so a real saved-work/live voice
browser journey remains unverified. The recorded-check page also had no available
samples. Neither this text lane nor mocked audio establishes physical microphone,
GPT Live audio, or real-student reliability. Historical questions still delegate
to the backend; the live session's initial context contains only recent turns.
