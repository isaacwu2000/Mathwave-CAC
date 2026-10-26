#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK_CACHE="$TASK_ROOT/work/mathwave-local-runtime"
TASK_KIND="${1:-macos}"
TASK_CMAKE="${CMAKE:-$TASK_ROOT/work/mathwave-runpod-sdk-env/bin/cmake}"
if [[ ! -x "$TASK_CMAKE" ]]; then TASK_CMAKE="$(command -v cmake)"; fi
TASK_LLAMA=7894e8b92481a8bb8ffe94f73b656ffe0dd01e10
TASK_WHISPER=231638a0717b7822784297e5980965ffcec05810
mkdir -p "$TASK_CACHE"
# Fetch only the exact official revisions, never an unpinned moving branch.
for TASK_NAME in llama.cpp whisper.cpp; do
    if [[ "$TASK_NAME" == llama.cpp ]]; then TASK_REF="$TASK_LLAMA"; else TASK_REF="$TASK_WHISPER"; fi
    if [[ ! -d "$TASK_CACHE/$TASK_NAME/.git" ]]; then
        git init -q "$TASK_CACHE/$TASK_NAME"
        git -C "$TASK_CACHE/$TASK_NAME" remote add origin "https://github.com/ggml-org/$TASK_NAME.git"
        git -C "$TASK_CACHE/$TASK_NAME" fetch --depth 1 origin "$TASK_REF"
        git -C "$TASK_CACHE/$TASK_NAME" checkout --detach "$TASK_REF"
    fi
    if [[ "$(git -C "$TASK_CACHE/$TASK_NAME" rev-parse HEAD)" != "$TASK_REF" ]] || [[ -n "$(git -C "$TASK_CACHE/$TASK_NAME" status --porcelain)" ]]; then
        printf 'Runtime source differs from its pin: %s\n' "$TASK_NAME" >&2; exit 1
    fi
done
TASK_BUILD="$TASK_CACHE/build-$TASK_KIND"
TASK_ARGS=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 -DMATHWAVE_SOURCE_CACHE="$TASK_CACHE")
case "$TASK_KIND" in
    macos) TASK_ARGS+=(-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0) ;;
    simulator) TASK_ARGS+=(-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0) ;;
    device) TASK_ARGS+=(-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphoneos -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0) ;;
    *) printf 'Usage: bash Native/LocalModels/build-runtime.sh [macos|simulator|device]\n' >&2; exit 1 ;;
esac
"$TASK_CMAKE" -S "$TASK_ROOT/Native/LocalModels" -B "$TASK_BUILD" "${TASK_ARGS[@]}"
"$TASK_CMAKE" --build "$TASK_BUILD" --target mathwave_models --parallel 2
TASK_LIBS=()
while IFS= read -r TASK_FILE; do TASK_LIBS+=("$TASK_FILE"); done < <(find "$TASK_BUILD" -type f -name '*.a' ! -name 'libmathwave-local-models.a' | sort)
xcrun libtool -static -o "$TASK_BUILD/libmathwave-local-models.a" "${TASK_LIBS[@]}"
printf 'Static runtime: %s\n' "$TASK_BUILD/libmathwave-local-models.a"
printf 'Link frameworks: Foundation Metal MetalKit Accelerate; C++ runtime: -lc++\n'
