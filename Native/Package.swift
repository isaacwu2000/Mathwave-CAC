// swift-tools-version: 5.9
import PackageDescription
import Foundation

let runtimeLibrary = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("work/mathwave-local-runtime/build-macos").path

let package = Package(
    name: "MathAudio",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "MathAudio", targets: ["MathAudioApp"])],
    targets: [
        .systemLibrary(name: "CustomModelBridge", path: "LocalModels"),
        .target(name: "MathAudioCore", resources: [.copy("Resources/workbench.js")]),
        .executableTarget(name: "MathAudioApp", dependencies: ["MathAudioCore", "CustomModelBridge"], resources: [.copy("Resources/Presentation")], linkerSettings: [.unsafeFlags(["-L", runtimeLibrary]), .linkedLibrary("c++"), .linkedLibrary("sqlite3"), .linkedFramework("Metal"), .linkedFramework("MetalKit"), .linkedFramework("Accelerate")]),
        .testTarget(name: "MathAudioCoreTests", dependencies: ["MathAudioCore", "MathAudioApp"])
    ]
)
