#include "mathwave_models.h"
#include "llama.h"
#include "whisper.h"
#if defined(__APPLE__)
#include <TargetConditionals.h>
#endif
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

struct mw_speech {
    whisper_context *context = nullptr;
    int32_t threads = 1;
    std::atomic<bool> cancelled{false};
    std::mutex inference;
    ~mw_speech() { if (context) whisper_free(context); }
};
struct mw_language {
    llama_model *model = nullptr;
    llama_context *context = nullptr;
    int32_t limit = 0;
    std::atomic<bool> cancelled{false};
    std::mutex inference;
    ~mw_language() { if (context) llama_free(context); if (model) llama_model_free(model); }
};

// Simulator Metal can execute simple shaders but lacks the model kernels and
// shared-buffer behavior used here. Keep both engines on its optimized CPU path.
static bool use_gpu(int32_t requested) {
#if TARGET_OS_SIMULATOR
    (void) requested;
    return false;
#else
    return requested != 0;
#endif
}

// The C boundary never transfers C++ exceptions or runtime-owned string pointers.
static char *copy_string(const std::string &text) {
    char *result = static_cast<char *>(std::malloc(text.size() + 1));
    if (result) std::memcpy(result, text.c_str(), text.size() + 1);
    return result;
}
static void set_error(char **error, const char *text) {
    if (error) *error = copy_string(text);
}
static bool abort_inference(void *value) {
    return static_cast<std::atomic<bool> *>(value)->load();
}
static std::vector<llama_token> tokenize(mw_language *handle, const char *prompt) {
    const auto *vocab = llama_model_get_vocab(handle->model);
    const size_t bytes = std::strlen(prompt);
    if (bytes > 1024 * 1024) throw std::runtime_error("Prompt exceeds one MiB.");
    int32_t size = llama_tokenize(vocab, prompt, static_cast<int32_t>(bytes), nullptr, 0, true, true);
    if (size >= 0) throw std::runtime_error("Prompt contains no tokens.");
    std::vector<llama_token> tokens(static_cast<size_t>(-size));
    const int32_t actual = llama_tokenize(vocab, prompt, static_cast<int32_t>(bytes), tokens.data(), static_cast<int32_t>(tokens.size()), true, true);
    if (actual <= 0) throw std::runtime_error("Could not tokenize prompt.");
    tokens.resize(actual);
    return tokens;
}

// Stop at a complete JSON container, matching the training decoder. The existing
// shared command validator still checks actual JSON syntax and mathematical safety.
static bool complete_json(const std::string &text) {
    std::vector<char> nesting;
    bool quoted = false, escaped = false, started = false;
    for (char ch : text) {
        if (!started) {
            if (ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') continue;
            if (ch != '{' && ch != '[') return false;
            started = true;
        }
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch == '\\') escaped = true;
            else if (ch == '"') quoted = false;
            continue;
        }
        if (ch == '"') quoted = true;
        else if (ch == '{' || ch == '[') nesting.push_back(ch);
        else if (ch == '}' || ch == ']') {
            if (nesting.empty() || (ch == '}' && nesting.back() != '{') || (ch == ']' && nesting.back() != '[')) return false;
            nesting.pop_back();
            if (nesting.empty()) return true;
        }
    }
    return false;
}

extern "C" {
void mw_string_free(char *text) { std::free(text); }
mw_speech *mw_speech_create(const char *path, int32_t threads, int32_t gpu, char **error) {
    if (error) *error = nullptr;
    if (!path || !*path || threads < 1 || threads > 16) { set_error(error, "Invalid speech model path or thread count."); return nullptr; }
    try {
        auto handle = std::make_unique<mw_speech>();
        auto config = whisper_context_default_params();
        config.use_gpu = use_gpu(gpu);
        handle->context = whisper_init_from_file_with_params(path, config);
        if (!handle->context) { set_error(error, "Could not load the local speech model."); return nullptr; }
        handle->threads = threads;
        return handle.release();
    } catch (const std::exception &failure) { set_error(error, failure.what()); return nullptr; }
}
void mw_speech_destroy(mw_speech *handle) { delete handle; }
void mw_speech_cancel(mw_speech *handle) { if (handle) handle->cancelled.store(true); }
char *mw_speech_transcribe(mw_speech *handle, const float *samples, int32_t count, char **error) {
    if (error) *error = nullptr;
    if (!handle || !samples || count < 1600 || count > 30 * 16000) { set_error(error, "Use 0.1 to 30 seconds of mono 16000 Hz audio."); return nullptr; }
    std::unique_lock<std::mutex> lock(handle->inference, std::try_to_lock);
    if (!lock.owns_lock()) { set_error(error, "Speech recognition is already running."); return nullptr; }
    for (int32_t i = 0; i < count; ++i) if (!std::isfinite(samples[i])) { set_error(error, "Audio contains invalid samples."); return nullptr; }
    handle->cancelled.store(false);
    try {
        auto config = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        config.n_threads = handle->threads;
        config.language = "en";
        config.translate = false;
        config.no_context = true;
        config.no_timestamps = true;
        config.single_segment = true;
        config.print_special = config.print_progress = config.print_realtime = config.print_timestamps = false;
        config.greedy.best_of = 1;
        config.temperature = 0;
        config.temperature_inc = 0;
        config.abort_callback = abort_inference;
        config.abort_callback_user_data = &handle->cancelled;
        const int result = whisper_full(handle->context, config, samples, count);
        if (handle->cancelled.load()) { set_error(error, "Speech recognition cancelled."); return nullptr; }
        if (result != 0) { set_error(error, "Local speech recognition failed."); return nullptr; }
        std::string text;
        for (int32_t i = 0; i < whisper_full_n_segments(handle->context); ++i) text += whisper_full_get_segment_text(handle->context, i);
        return copy_string(text);
    } catch (const std::exception &failure) { set_error(error, failure.what()); return nullptr; }
}
mw_language *mw_language_create(const char *path, int32_t context_tokens, int32_t threads, int32_t gpu, char **error) {
    if (error) *error = nullptr;
    if (!path || !*path || context_tokens < 512 || context_tokens > 32768 || threads < 1 || threads > 16) { set_error(error, "Invalid language model path, context or thread count."); return nullptr; }
    try {
        static std::once_flag initialized;
        std::call_once(initialized, [] { llama_backend_init(); });
        auto handle = std::make_unique<mw_language>();
        auto model_config = llama_model_default_params();
        model_config.n_gpu_layers = use_gpu(gpu) ? 99 : 0;
        handle->model = llama_model_load_from_file(path, model_config);
        if (!handle->model) { set_error(error, "Could not load the local language model."); return nullptr; }
        auto context_config = llama_context_default_params();
        context_config.n_ctx = static_cast<uint32_t>(context_tokens);
        context_config.n_batch = 512;
        context_config.n_ubatch = 128;
#if TARGET_OS_SIMULATOR
        // Larger simulator CPU batches avoid repeated weight conversion and let
        // Accelerate process more prompt tokens in each matrix multiplication.
        context_config.n_ubatch = 512;
        context_config.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
#endif
        context_config.n_threads = context_config.n_threads_batch = threads;
        context_config.abort_callback = abort_inference;
        context_config.abort_callback_data = &handle->cancelled;
        handle->context = llama_init_from_model(handle->model, context_config);
        if (!handle->context) { set_error(error, "Could not create the local language context."); return nullptr; }
        handle->limit = static_cast<int32_t>(llama_n_ctx(handle->context));
        return handle.release();
    } catch (const std::exception &failure) { set_error(error, failure.what()); return nullptr; }
}
void mw_language_destroy(mw_language *handle) { delete handle; }
void mw_language_cancel(mw_language *handle) { if (handle) handle->cancelled.store(true); }
int32_t mw_language_token_count(mw_language *handle, const char *prompt, char **error) {
    if (error) *error = nullptr;
    if (!handle || !prompt) { set_error(error, "Missing language model or prompt."); return -1; }
    try { return static_cast<int32_t>(tokenize(handle, prompt).size()); }
    catch (const std::exception &failure) { set_error(error, failure.what()); return -1; }
}
char *mw_language_generate(mw_language *handle, const char *prompt, int32_t max_tokens, char **error) {
    if (error) *error = nullptr;
    if (!handle || !prompt || max_tokens < 1 || max_tokens > 2048) { set_error(error, "Invalid language model, prompt or output limit."); return nullptr; }
    std::unique_lock<std::mutex> lock(handle->inference, std::try_to_lock);
    if (!lock.owns_lock()) { set_error(error, "Language inference is already running."); return nullptr; }
    handle->cancelled.store(false);
    try {
        auto tokens = tokenize(handle, prompt);
        if (tokens.size() + max_tokens > static_cast<size_t>(handle->limit)) { set_error(error, "The conversation exceeds the local model context."); return nullptr; }
        // Clearing state prevents any previous student's request leaking into this turn.
        llama_memory_clear(llama_get_memory(handle->context), true);
        const auto *vocab = llama_model_get_vocab(handle->model);
        for (size_t offset = 0; offset < tokens.size(); offset += 512) {
            if (handle->cancelled.load()) { set_error(error, "Language inference cancelled."); return nullptr; }
            const int32_t count = static_cast<int32_t>(std::min<size_t>(512, tokens.size() - offset));
            auto batch = llama_batch_get_one(tokens.data() + offset, count);
            if (llama_decode(handle->context, batch) != 0) { set_error(error, handle->cancelled.load() ? "Language inference cancelled." : "Prompt evaluation failed."); return nullptr; }
        }
        auto *sampler = llama_sampler_init_greedy();
        std::string text;
        bool failed = false;
        for (int32_t i = 0; i < max_tokens; ++i) {
            if (handle->cancelled.load()) { failed = true; break; }
            llama_token token = llama_sampler_sample(sampler, handle->context, -1);
            if (llama_vocab_is_eog(vocab, token)) break;
            char piece[512];
            int32_t size = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, false);
            if (size < 0) { set_error(error, "Generated token exceeds the text buffer."); failed = true; break; }
            text.append(piece, static_cast<size_t>(size));
            if (complete_json(text)) break;
            auto batch = llama_batch_get_one(&token, 1);
            if (llama_decode(handle->context, batch) != 0) { failed = true; break; }
        }
        llama_sampler_free(sampler);
        if (failed || handle->cancelled.load()) { if (!error || !*error) set_error(error, handle->cancelled.load() ? "Language inference cancelled." : "Local language inference failed."); return nullptr; }
        return copy_string(text);
    } catch (const std::exception &failure) { set_error(error, failure.what()); return nullptr; }
}
}
