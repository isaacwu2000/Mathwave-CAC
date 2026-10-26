#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:$PATH"
TASK_BUNDLE="$TASK_ROOT/Sources/MathAudioCore/Resources/workbench.js"
TASK_TEMP="$TASK_ROOT/.build/engine-$$.js"
mkdir -p "$TASK_ROOT/.build" "$(dirname "$TASK_BUNDLE")"
trap 'rm -f "$TASK_TEMP"' EXIT
cd "$TASK_ROOT/.."
pnpm exec esbuild Native/Engine/workbench.ts --bundle --platform=browser --target=es2022 --format=iife --outfile="$TASK_TEMP"
if ! cmp -s "$TASK_TEMP" "$TASK_BUNDLE"; then
    mv "$TASK_TEMP" "$TASK_BUNDLE"
fi

pnpm exec tsx "$TASK_ROOT/scripts/build-presentation.ts"
