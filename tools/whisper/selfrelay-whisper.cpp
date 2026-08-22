#include "whisper.h"
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <algorithm>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
whisper_context * g_ctx = nullptr;

bool init_model(const std::string & path) {
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
    whisper_context_params cparams = whisper_context_default_params();
    g_ctx = whisper_init_from_file_with_params(path.c_str(), cparams);
    return g_ctx != nullptr;
}

std::string transcribe(emscripten::val input, const std::string & language, int threads) {
    if (!g_ctx) throw std::runtime_error("model_not_initialized");
    const unsigned length = input["length"].as<unsigned>();
    if (length == 0) return "";
    std::vector<float> pcm(length);
    emscripten::val view = emscripten::val(emscripten::typed_memory_view(length, pcm.data()));
    view.call<void>("set", input);

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = false;
    params.no_context = true;
    params.single_segment = false;
    params.suppress_blank = true;
    params.suppress_nst = true;
    params.n_threads = std::max(1, std::min(threads, 4));
    params.language = language.empty() ? "es" : language.c_str();

    const int rc = whisper_full(g_ctx, params, pcm.data(), static_cast<int>(pcm.size()));
    if (rc != 0) throw std::runtime_error("whisper_full_failed");

    std::string result;
    const int segments = whisper_full_n_segments(g_ctx);
    for (int i = 0; i < segments; ++i) {
        const char * text = whisper_full_get_segment_text(g_ctx, i);
        if (!text) continue;
        if (!result.empty()) result.push_back(' ');
        result += text;
    }
    return result;
}

void release_model() {
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
}
}

EMSCRIPTEN_BINDINGS(selfrelay_whisper) {
    emscripten::function("initModel", &init_model);
    emscripten::function("transcribe", &transcribe);
    emscripten::function("releaseModel", &release_model);
}
