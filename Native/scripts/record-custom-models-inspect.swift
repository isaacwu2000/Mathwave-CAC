import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Exports actual video frames and metadata; capturing frames never marks them reviewed.
let arguments = CommandLine.arguments
if arguments.count < 3 {
  fatalError("Usage: swift record-custom-models-inspect.swift VIDEO NEW_OUTPUT_DIRECTORY [SECONDS ...]")
}
let source = URL(fileURLWithPath: arguments[1])
let output = URL(fileURLWithPath: arguments[2], isDirectory: true)
guard !FileManager.default.fileExists(atPath: output.path) else {
  fatalError("Use a new output directory; historical frames are never overwritten.")
}
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let asset = AVURLAsset(url: source)
let duration = try await asset.load(.duration).seconds
let videoTracks = try await asset.loadTracks(withMediaType: .video)
let audioTracks = try await asset.loadTracks(withMediaType: .audio)
guard duration.isFinite, duration > 0, let track = videoTracks.first else {
  fatalError("The recording has no readable video track.")
}
let size = try await track.load(.naturalSize)
let rate = try await track.load(.nominalFrameRate)
let requested: [Double]
if arguments.count > 3 {
  requested = try arguments.dropFirst(3).map {
    guard let seconds = Double($0), seconds.isFinite, seconds >= 0, seconds < duration else {
      throw NSError(domain: "MathwaveRecording", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Frame times must lie inside the video."])
    }
    return seconds
  }
} else {
  requested = [0.02, 0.25, 0.5, 0.75, 0.98].map { min(duration - 0.001, duration * $0) }
}
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
var frames: [[String: Any]] = []
for (index, seconds) in requested.enumerated() {
  let (image, actualTime) = try await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
  let target = output.appendingPathComponent(String(format: "frame-%02d.png", index + 1))
  guard let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Cannot create a video-frame image.")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Cannot save video-frame image.") }
  frames.append(["path": target.path, "requestedSeconds": seconds,
    "actualSeconds": actualTime.seconds, "reviewed": false])
}
let report: [String: Any] = ["video": source.path, "durationSeconds": duration,
  "width": size.width, "height": size.height, "framesPerSecond": rate,
  "audioTrackCount": audioTracks.count, "frames": frames,
  "videoReview": "incomplete: inspect the video and every relevant extracted frame",
  "audioLimit": "Simulator recordings are silent; separately retained readback WAV is actual synthesized output."]
let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
try data.write(to: output.appendingPathComponent("frames.json"), options: .withoutOverwriting)
print("Saved \(frames.count) actual video frames in \(output.path)")
