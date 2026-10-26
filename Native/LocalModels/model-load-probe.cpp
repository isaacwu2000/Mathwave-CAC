#include "mathwave_models.h"
#include <cstdio>
#include <cstring>

// Loads one actual model through the same C interface used by Swift. This isolates
// platform buffer setup from app UI, audio permissions and transcript execution.
int main(int argc, char **argv) {
    if (argc != 3) return 2;
    char *error = nullptr;
    std::printf("Loading actual %s model with GPU requested; platform policy applies.\n", argv[1]); std::fflush(stdout);
    if (std::strcmp(argv[1], "speech") == 0) {
        auto *model = mw_speech_create(argv[2], 4, 1, &error);
        if (!model) { std::fprintf(stderr, "%s\n", error ? error : "Load failed"); mw_string_free(error); return 1; }
        mw_speech_destroy(model);
    } else {
        auto *model = mw_language_create(argv[2], 8192, 4, 1, &error);
        if (!model) { std::fprintf(stderr, "%s\n", error ? error : "Load failed"); mw_string_free(error); return 1; }
        mw_language_destroy(model);
    }
    std::puts("Actual model load/destroy passed.");
}
