import Foundation
import Testing

@testable import MathAudioApp

struct SpeechFailureTests {
  @Test func unavailableSimulatorModelIsNotReportedAsAStoppedRecording() {
    let error = NSError(
      domain: "kLSRErrorDomain", code: 300,
      userInfo: [
        NSLocalizedDescriptionKey: "Failed to create recognizer from=/private/model/mini.json"
      ])
    let message = SpeechFailureDescription.message(error, simulator: true)
    #expect(message.contains("simulator"))
    #expect(message.contains("English speech model"))
    #expect(!message.contains("/private/"))
  }

  @Test func aWrappedModelFailureKeepsItsActionableCause() {
    let underlying = NSError(domain: "kLSRErrorDomain", code: 300)
    let error = NSError(
      domain: "kAFAssistantErrorDomain", code: 1101,
      userInfo: [NSUnderlyingErrorKey: underlying])
    #expect(
      SpeechFailureDescription.message(error, simulator: true).contains("English speech model"))
    #expect(!SpeechFailureDescription.message(error, simulator: false).contains("simulator"))
  }
}
