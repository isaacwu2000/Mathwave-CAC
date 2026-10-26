#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_KIND="${1:-simulator}"
case "$TASK_KIND" in
    simulator) TASK_SDK=iphonesimulator; TASK_TARGET=arm64-apple-ios16.0-simulator ;;
    device) TASK_SDK=iphoneos; TASK_TARGET=arm64-apple-ios16.0 ;;
    *) printf 'Usage: bash Native/scripts/build-ios.sh [simulator|device]\n' >&2; exit 1 ;;
esac
bash "$TASK_ROOT/scripts/prepare-custom-models.sh" "$TASK_KIND"
bash "$TASK_ROOT/scripts/sync-playground.sh"
TASK_APP="$TASK_ROOT/build/ios-$TASK_KIND/Mathwave.app"
mkdir -p "$TASK_APP" "$TASK_ROOT/.build/ios-modules"
TASK_SDK_PATH="$(xcrun --sdk "$TASK_SDK" --show-sdk-path)"
xcrun --sdk "$TASK_SDK" swiftc -parse-as-library -D MATHWAVE_CUSTOM_MODELS \
    -import-objc-header "$TASK_ROOT/LocalModels/mathwave_models.h" -swift-version 5 -O -Xfrontend -disable-sandbox \
    -sdk "$TASK_SDK_PATH" -target "$TASK_TARGET" \
    -module-cache-path "$TASK_ROOT/.build/ios-modules" \
    "$TASK_ROOT"/Sources/MathAudioCore/*.swift "$TASK_ROOT"/Sources/MathAudioApp/*.swift \
    -Xlinker -force_load -Xlinker "$TASK_ROOT/../work/mathwave-local-runtime/build-$TASK_KIND/libmathwave-local-models.a" \
    -lc++ -lsqlite3 -framework Foundation -framework Metal -framework MetalKit -framework Accelerate \
    -o "$TASK_APP/Mathwave"
mkdir -p "$TASK_APP/Models"
cp -cR "$TASK_ROOT/Models/." "$TASK_APP/Models/"
cp "$TASK_ROOT/Sources/MathAudioCore/Resources/workbench.js" "$TASK_APP/workbench.js"
mkdir -p "$TASK_APP/Presentation"
cp -R "$TASK_ROOT/Sources/MathAudioApp/Resources/Presentation/." "$TASK_APP/Presentation/"
cat > "$TASK_APP/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Mathwave</string>
<key>CFBundleDisplayName</key><string>Mathwave</string>
<key>CFBundleExecutable</key><string>Mathwave</string>
<key>CFBundleIdentifier</key><string>org.example.mathaudio.playground</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.1.0</string>
<key>CFBundleVersion</key><string>3</string>
<key>MinimumOSVersion</key><string>16.0</string>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
<key>UILaunchScreen</key><dict/>
<key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>
<key>UISupportedInterfaceOrientations~ipad</key><array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationPortraitUpsideDown</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>
<key>NSMicrophoneUsageDescription</key><string>Record a math command only when you choose Voice input. Processing stays on this device.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Recognize English math commands on this device with no online fallback.</string>
</dict></plist>
PLIST
if [[ "$TASK_KIND" == simulator ]]; then
    /usr/libexec/PlistBuddy -c 'Add :CFBundleSupportedPlatforms array' "$TASK_APP/Info.plist"
    /usr/libexec/PlistBuddy -c 'Add :CFBundleSupportedPlatforms:0 string iPhoneSimulator' "$TASK_APP/Info.plist"
else
    /usr/libexec/PlistBuddy -c 'Add :CFBundleSupportedPlatforms array' "$TASK_APP/Info.plist"
    /usr/libexec/PlistBuddy -c 'Add :CFBundleSupportedPlatforms:0 string iPhoneOS' "$TASK_APP/Info.plist"
fi
xcrun actool "$TASK_ROOT/Assets.xcassets" --compile "$TASK_APP" \
    --platform "$TASK_SDK" --minimum-deployment-target 16.0 --app-icon AppIcon \
    --target-device iphone --target-device ipad \
    --output-partial-info-plist "$TASK_ROOT/build/ios-$TASK_KIND/icon-info.plist" > "$TASK_ROOT/build/ios-$TASK_KIND/icon-build.log"
/usr/libexec/PlistBuddy -c "Merge $TASK_ROOT/build/ios-$TASK_KIND/icon-info.plist" "$TASK_APP/Info.plist"
codesign --force --sign - "$TASK_APP"
codesign --verify --strict "$TASK_APP"
printf 'Built %s\n' "$TASK_APP"
if [[ "$TASK_KIND" == device ]]; then
    printf 'Device compilation passed. Installation on hardware requires your development signing identity and provisioning profile.\n'
fi
