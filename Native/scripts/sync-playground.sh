#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_PLAYGROUND="$TASK_ROOT/Math Audio.swiftpm"
bash "$TASK_ROOT/scripts/build-engine.sh"
for TASK_SOURCE in "$TASK_ROOT"/Sources/MathAudioCore/*.swift "$TASK_ROOT"/Sources/MathAudioApp/*.swift; do
    cp "$TASK_SOURCE" "$TASK_PLAYGROUND/"
done
mkdir -p "$TASK_PLAYGROUND/Resources"
cp "$TASK_ROOT/Sources/MathAudioCore/Resources/workbench.js" "$TASK_PLAYGROUND/Resources/workbench.js"
mkdir -p "$TASK_PLAYGROUND/Resources/Presentation"
cp -R "$TASK_ROOT/Sources/MathAudioApp/Resources/Presentation/." "$TASK_PLAYGROUND/Resources/Presentation/"
printf 'Updated %s\n' "$TASK_PLAYGROUND"

mkdir -p "$TASK_PLAYGROUND/Assets.xcassets"
cp -R "$TASK_ROOT/Assets.xcassets/." "$TASK_PLAYGROUND/Assets.xcassets/"
