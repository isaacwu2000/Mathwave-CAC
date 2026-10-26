#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$TASK_ROOT/scripts/prepare-custom-models.sh" macos
bash "$TASK_ROOT/scripts/build-engine.sh"
cd "$TASK_ROOT"
export CLANG_MODULE_CACHE_PATH="$TASK_ROOT/.build/ModuleCache"
export SWIFTPM_MODULECACHE_OVERRIDE="$TASK_ROOT/.build/ModuleCache"
swift build -c release --jobs 2 --disable-sandbox --cache-path "$TASK_ROOT/.build/cache"
TASK_BIN_DIR="$(swift build -c release --jobs 2 --disable-sandbox --cache-path "$TASK_ROOT/.build/cache" --show-bin-path)"
TASK_APP="$TASK_ROOT/dist/Math Audio.app"
mkdir -p "$TASK_APP/Contents/MacOS" "$TASK_APP/Contents/Resources"
find "$TASK_BIN_DIR" -maxdepth 1 -type d -name "*.bundle" -exec cp -R {} "$TASK_APP/Contents/Resources/" \;
mkdir -p "$TASK_APP/Contents/Resources/Models"
cp -cR "$TASK_ROOT/Models/." "$TASK_APP/Contents/Resources/Models/"
cp "$TASK_BIN_DIR/MathAudio" "$TASK_APP/Contents/MacOS/MathAudio"
cat > "$TASK_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Math Audio</string>
<key>CFBundleDisplayName</key><string>Math Audio</string>
<key>CFBundleExecutable</key><string>MathAudio</string>
<key>CFBundleIdentifier</key><string>org.example.mathaudio</string>
<key>CFBundleIconFile</key><string>Mathwave.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>3</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Math Audio uses your microphone only when you choose Voice input, to transcribe a math command on your device.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Math Audio transcribes English math commands using on-device speech recognition only. There is no online fallback.</string>
<key>NSHumanReadableCopyright</key><string>Math Audio prototype</string>
</dict></plist>
PLIST
TASK_ICONSET="$TASK_ROOT/build/Mathwave.iconset"
mkdir -p "$TASK_ICONSET"
for TASK_SIZE in 16 32 128 256 512; do
    sips -z "$TASK_SIZE" "$TASK_SIZE" "$TASK_ROOT/Assets/Mathwave-mac.png" --out "$TASK_ICONSET/icon_$TASK_SIZE"x"$TASK_SIZE.png" > /dev/null
    TASK_DOUBLE=$((TASK_SIZE * 2))
    sips -z "$TASK_DOUBLE" "$TASK_DOUBLE" "$TASK_ROOT/Assets/Mathwave-mac.png" --out "$TASK_ICONSET/icon_$TASK_SIZE"x"$TASK_SIZE@2x.png" > /dev/null
done
iconutil -c icns "$TASK_ICONSET" -o "$TASK_APP/Contents/Resources/Mathwave.icns"
codesign --force --sign - "$TASK_APP"
codesign --verify --strict "$TASK_APP"
printf 'Built %s\n' "$TASK_APP"
