#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_DEVICE="${1:?Pass the simulator UUID from xcrun simctl list devices available}"
TASK_RUN="$(date -u +%Y%m%dT%H%M%SZ)"
bash "$TASK_ROOT/scripts/build-engine.sh"
xcodebuild -project "$TASK_ROOT/Mathwave.xcodeproj" -scheme Mathwave \
    -sdk iphonesimulator -destination "platform=iOS Simulator,id=$TASK_DEVICE" \
    -derivedDataPath "$TASK_ROOT/build/xcode" \
    -resultBundlePath "$TASK_ROOT/build/ui-tests-$TASK_RUN.xcresult" \
    test -collect-test-diagnostics never -jobs 2 -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES
