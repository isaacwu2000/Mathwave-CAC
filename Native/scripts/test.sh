#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$TASK_ROOT/LocalModels/build-runtime.sh" macos
bash "$TASK_ROOT/scripts/build-engine.sh"
cd "$TASK_ROOT"
export CLANG_MODULE_CACHE_PATH="$TASK_ROOT/.build/ModuleCache"
export SWIFTPM_MODULECACHE_OVERRIDE="$TASK_ROOT/.build/ModuleCache"
swift test --jobs 2 --disable-sandbox --cache-path "$TASK_ROOT/.build/cache"
