#ifndef MATHWAVE_MODELS_H
#define MATHWAVE_MODELS_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct mw_speech mw_speech;
typedef struct mw_language mw_language;
/* Every returned string is allocated by this library; release it with mw_string_free.
 * iOS Simulator always uses CPU inference because its Metal model buffers are unsupported.
 * Handles each allow one inference at a time. cancel may run on another thread;
 * destroy must wait until inference returns. No function makes network requests. */
void mw_string_free(char *text);

/* Loads a merged whisper.cpp model. gpu=1 selects local Metal where available.
 * A failure returns NULL and an owned error string. threads must be 1..16. */
mw_speech *mw_speech_create(const char *path, int32_t threads, int32_t gpu, char **error);
void mw_speech_destroy(mw_speech *handle);
void mw_speech_cancel(mw_speech *handle);
/* Transcribes mono float32 audio at exactly 16000 Hz, at most 30 seconds.
 * Returns NULL on invalid input, cancellation or inference failure; never returns
 * partial words after cancellation. The caller owns the sample memory until return. */
char *mw_speech_transcribe(mw_speech *handle, const float *samples, int32_t count, char **error);

/* Loads a merged GGUF model and its bounded token context. No conversation cache
 * is shared between generate calls; each prompt must contain the full context. */
mw_language *mw_language_create(const char *path, int32_t context_tokens, int32_t threads, int32_t gpu, char **error);
void mw_language_destroy(mw_language *handle);
void mw_language_cancel(mw_language *handle);
/* Runs greedy decoding of a complete, already formatted Qwen chat prompt.
 * Preserve training's non-thinking prefix: <|im_start|>assistant\n<think>\n\n</think>\n\n.
 * Special tokens in prompt are parsed; output excludes end-of-generation tokens.
 * Refuses overlong prompts, limits output to 1..2048 tokens, and clears state per call.
 * The caller validates returned JSON/DSL through the existing shared engine. */
char *mw_language_generate(mw_language *handle, const char *prompt, int32_t max_tokens, char **error);
/* Returns the actual tokenizer count, or -1 plus an owned error string. */
int32_t mw_language_token_count(mw_language *handle, const char *prompt, char **error);
#ifdef __cplusplus
}
#endif
#endif
