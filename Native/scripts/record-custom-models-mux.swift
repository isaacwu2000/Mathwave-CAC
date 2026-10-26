import AVFoundation
import CryptoKit
import Foundation

/// Hashes original evidence without loading a whole recording into memory.
func digest(_ url: URL) throws -> String {
  let file = try FileHandle(forReadingFrom: url)
  defer { try? file.close() }
  var hash = SHA256()
  while let data = try file.read(upToCount: 4 * 1024 * 1024), !data.isEmpty { hash.update(data: data) }
  return hash.finalize().map { String(format: "%02x", $0) }.joined()
}

let args = CommandLine.arguments
if args.count != 6 {
  fatalError("Usage: swift record-custom-models-mux.swift REPORT_JSON ORIGINAL_VIDEO SOURCE_WAV READBACK_WAV NEW_OUTPUT_MP4")
}
let reportURL = URL(fileURLWithPath: args[1])
let videoURL = URL(fileURLWithPath: args[2])
let sourceURL = URL(fileURLWithPath: args[3])
let readbackURL = URL(fileURLWithPath: args[4])
let output = URL(fileURLWithPath: args[5])
let metadataURL = output.appendingPathExtension("json")
guard !FileManager.default.fileExists(atPath: output.path),
  !FileManager.default.fileExists(atPath: metadataURL.path)
else { fatalError("Use new output paths; original and historical evidence is never overwritten.") }
let value = try JSONSerialization.jsonObject(with: Data(contentsOf: reportURL))
guard let report = value as? [String: Any],
  let start = report["recordingStartedObservedUnix"] as? Double, start.isFinite,
  let events = report["events"] as? [[String: Any]]
else { fatalError("The recording report has no observed start time or actual event timeline.") }
let liveMicrophone = report["inputSource"] as? String == "microphone"
let expectedSource = liveMicrophone ? "microphone" : "recorded-fixture"

/// Resolves an actual event time; audio labels never imply physical-microphone capture.
func eventOffset(_ name: String) throws -> Double {
  guard let event = events.first(where: { $0["event"] as? String == name }),
    let stamp = (event["timestampUnix"] ?? event["atUnix"]) as? Double,
    stamp.isFinite, stamp >= start
  else {
    throw NSError(domain: "MathwaveRecording", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Missing or invalid event time: \(name)"])
  }
  if name == "customRecordingStarted", event["source"] as? String != expectedSource {
    throw NSError(domain: "MathwaveRecording", code: 2,
      userInfo: [NSLocalizedDescriptionKey: "The source track must match the report's explicit input lane."])
  }
  return stamp - start
}
guard let trace = report["traceVerification"] as? [String: Any], trace["pass"] as? Bool == true,
  let inputHash = report[liveMicrophone ? "capturedInputSha256" : "fixtureSha256"] as? String,
  try digest(sourceURL) == inputHash,
  let capturedReadback = report["readbackFile"] as? String,
  URL(fileURLWithPath: capturedReadback).standardizedFileURL.resolvingSymlinksInPath()
    == readbackURL.standardizedFileURL.resolvingSymlinksInPath()
else { fatalError("Require a completed native inference trace and its exact recorded input/readback files.") }
let inputOffset = try eventOffset("customRecordingStarted")
let readbackOffset = try eventOffset("readbackstarted")
let original = AVURLAsset(url: videoURL)
let duration = try await original.load(.duration)
let videoTracks = try await original.loadTracks(withMediaType: .video)
let originalAudioTracks = try await original.loadTracks(withMediaType: .audio)
guard duration.seconds.isFinite, duration.seconds > 0, let videoTrack = videoTracks.first,
  originalAudioTracks.isEmpty
else { fatalError("Select the original silent screen recording with a valid video track.") }
let composition = AVMutableComposition()
guard let composedVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
  fatalError("Cannot create the video composition.")
}
try composedVideo.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: videoTrack, at: .zero)
composedVideo.preferredTransform = try await videoTrack.load(.preferredTransform)
var tracks: [[String: Any]] = []
for (label, audioURL, offset) in [
  (liveMicrophone ? "Actual simulator microphone capture — synthetic speaker playback, not iPhone hardware" : "Recorded input fixture — not a physical microphone", sourceURL, inputOffset),
  ("Actual app-synthesized readback — not captured system audio", readbackURL, readbackOffset),
] {
  let audio = AVURLAsset(url: audioURL)
  let length = try await audio.load(.duration)
  let audioTracks = try await audio.loadTracks(withMediaType: .audio)
  guard length.seconds.isFinite, length.seconds > 0, offset + length.seconds <= duration.seconds + 0.05,
    let track = audioTracks.first,
    let destination = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
  else { fatalError("The audio is invalid or extends beyond the video. Retain this attempt and record a longer video.") }
  try destination.insertTimeRange(CMTimeRange(start: .zero, duration: length), of: track,
    at: CMTime(seconds: offset, preferredTimescale: 600))
  tracks.append(["label": label, "source": audioURL.path, "sha256": try digest(audioURL),
    "offsetSeconds": offset, "durationSeconds": length.seconds])
}
let explanation = (liveMicrophone
  ? "Actual live simulator microphone capture of synthetic speech played through host speakers; not physical iPhone hardware or a human speaker. "
  : "Recorded input fixture processed by native custom models; not physical microphone capture. ")
  + "Readback is actual separately synthesized app output, not captured system audio. Audio is overlaid at recorded event times with approximate video alignment; this is not a live-streaming or latency demonstration. Original silent video and audio files are preserved."
let description = AVMutableMetadataItem()
description.identifier = .commonIdentifierDescription
description.value = explanation as NSString
guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
  fatalError("Cannot create the audiovisual export.")
}
export.metadata = [description]
try await export.export(to: output, as: .mp4)
let metadata: [String: Any] = [
  "video": output.path, "originalVideo": videoURL.path,
  "originalVideoSha256": try digest(videoURL), "report": reportURL.path,
  "reportSha256": try digest(reportURL), "durationSeconds": duration.seconds,
  "recordingStartedObservedUnix": start, "tracks": tracks,
  "label": explanation, "originalEvidencePreserved": true,
  "traceVerification": report["traceVerification"] ?? NSNull(),
  "videoReview": "incomplete: inspect the combined video and listen to both audio tracks",
]
let bytes = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
try bytes.write(to: metadataURL, options: .withoutOverwriting)
print("Saved explicitly labeled \(expectedSource)/readback video: \(output.path)")
