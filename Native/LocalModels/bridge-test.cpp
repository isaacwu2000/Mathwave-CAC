#include "mathwave_models.h"
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <mutex>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <thread>
#include <vector>

// Exercises the public C boundary. Optional real models use local files only;
// their text output is evidence for engine validation, not an accuracy assertion.
int main(int argc, char **argv) {
    char *error = nullptr;
    assert(mw_language_create(nullptr, 8192, 2, 0, &error) == nullptr && error);
    mw_string_free(error); error = nullptr;
    assert(mw_speech_create(nullptr, 2, 0, &error) == nullptr && error);
    mw_string_free(error); error = nullptr;
    assert(mw_language_generate(nullptr, "test", 1, &error) == nullptr && error);
    mw_string_free(error); error = nullptr;
    assert(mw_speech_transcribe(nullptr, nullptr, 0, &error) == nullptr && error);
    mw_string_free(error); error = nullptr;
    assert(mw_language_token_count(nullptr, "test", &error) == -1 && error);
    mw_string_free(error); error = nullptr;
    mw_language_destroy(nullptr); mw_speech_destroy(nullptr);
    mw_language_cancel(nullptr); mw_speech_cancel(nullptr); mw_string_free(nullptr);
    std::cout << "Public invalid-input checks passed.\n";
    if (argc >= 3) {
        std::ifstream prompt_file(argv[2]);
        const std::string prompt((std::istreambuf_iterator<char>(prompt_file)), std::istreambuf_iterator<char>());
        assert(!prompt.empty());
        const int gpu = std::getenv("MATHWAVE_PROBE_CPU") ? 0 : 1;
        auto *model = mw_language_create(argv[1], 8192, 4, gpu, &error);
        if (!model) { std::cerr << (error ? error : "Model load failed") << '\n'; mw_string_free(error); return 1; }
        const auto start = std::chrono::steady_clock::now();
        std::cout << "Prompt tokens: " << mw_language_token_count(model, prompt.c_str(), &error) << '\n';
        std::mutex timer_mutex;
        std::condition_variable timer_cv;
        bool finished = false;
        std::thread deadline([&] {
            std::unique_lock<std::mutex> lock(timer_mutex);
            if (!timer_cv.wait_for(lock, std::chrono::seconds(38), [&] { return finished; })) mw_language_cancel(model);
        });
        char *text = mw_language_generate(model, prompt.c_str(), 512, &error);
        { std::lock_guard<std::mutex> lock(timer_mutex); finished = true; }
        timer_cv.notify_one(); deadline.join();
        if (!text) { std::cerr << (error ? error : "Generation failed") << '\n'; mw_string_free(error); mw_language_destroy(model); return 1; }
        std::cout << "Generation: " << text << "\nGeneration seconds: " << std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count() << '\n';
        mw_string_free(text);
        char *cancelled_text = nullptr;
        char *cancelled_error = nullptr;
        std::thread pending([&] { cancelled_text = mw_language_generate(model, prompt.c_str(), 512, &cancelled_error); });
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        mw_language_cancel(model);
        pending.join();
        assert(cancelled_text == nullptr && cancelled_error != nullptr);
        mw_string_free(cancelled_error);
        std::cout << "Language cancellation discarded partial output.\n";
        mw_language_destroy(model);
    }
    if (argc >= 5) {
        std::ifstream audio_file(argv[4], std::ios::binary | std::ios::ate);
        const size_t bytes = static_cast<size_t>(audio_file.tellg());
        assert(bytes > 0 && bytes % sizeof(float) == 0);
        std::vector<float> samples(bytes/sizeof(float));
        audio_file.seekg(0); audio_file.read(reinterpret_cast<char *>(samples.data()), bytes);
        auto *model = mw_speech_create(argv[3], 4, 1, &error);
        if (!model) { std::cerr << (error ? error : "Speech load failed") << '\n'; mw_string_free(error); return 1; }
        const auto start = std::chrono::steady_clock::now();
        char *text = mw_speech_transcribe(model, samples.data(), static_cast<int32_t>(samples.size()), &error);
        if (!text) { std::cerr << (error ? error : "Transcription failed") << '\n'; mw_string_free(error); mw_speech_destroy(model); return 1; }
        std::cout << "Transcript: " << text << "\nTranscription seconds: " << std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count() << '\n';
        mw_string_free(text); mw_speech_destroy(model);
    }
}
