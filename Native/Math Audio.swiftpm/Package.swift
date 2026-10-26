// swift-tools-version: 5.9
// For the 2026 tooling baseline, open with Swift Playground 4.6+ or Xcode 26+.
import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Math Audio",
    platforms: [.iOS("16.0")],
    products: [
        .iOSApplication(
            name: "Math Audio",
            targets: ["AppModule"],
            bundleIdentifier: "org.example.mathaudio.playground",
            displayVersion: "1.0.0",
            bundleVersion: "1",
            appIcon: .asset("AppIcon"),
            accentColor: .presetColor(.red),
            supportedDeviceFamilies: [.pad, .phone],
            supportedInterfaceOrientations: [.portrait, .landscapeLeft, .landscapeRight, .portraitUpsideDown(.when(deviceFamilies: [.pad]))],
            capabilities: [
                .microphone(purposeString: "Transcribe a math command only when you choose Voice input. Processing stays on your device."),
                .speechRecognition(purposeString: "Recognize English math commands using on-device speech recognition only. There is no online fallback.")
            ]
        )
    ],
    targets: [.executableTarget(name: "AppModule", path: ".", resources: [.process("Assets.xcassets"), .copy("Resources/workbench.js"), .copy("Resources/Presentation")], linkerSettings: [.linkedLibrary("sqlite3")])]
)
