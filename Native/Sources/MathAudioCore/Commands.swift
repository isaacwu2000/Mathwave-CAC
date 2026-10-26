import Foundation

public enum WorkbenchCommand: Equatable {
    case read, solve(String?), undo, newSession, help, stop, statistics(String), replace(String, String), expression(String)
    public static func parse(_ raw: String) -> Self {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = text.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".!?"))
        switch lower {
        case "read", "read equation", "read work", "read result": return .read
        case "solve", "solve equation": return .solve(nil)
        case "undo", "undo last change": return .undo
        case "new session", "clear", "clear session": return .newSession
        case "help", "show commands": return .help
        case "stop", "stop reading", "stop speaking": return .stop
        default: break
        }
        if lower.hasPrefix("solve ") { return .solve(String(text.dropFirst(6))) }
        if lower.hasPrefix("statistics ") { return .statistics(String(text.dropFirst(11))) }
        if lower.hasPrefix("stats ") { return .statistics(String(text.dropFirst(6))) }
        if lower.hasPrefix("replace "), let range = lower.range(of: " with ", range: lower.index(lower.startIndex, offsetBy: 8)..<lower.endIndex) {
            let old = String(lower[lower.index(lower.startIndex, offsetBy: 8)..<range.lowerBound])
            let new = String(lower[range.upperBound...])
            if !old.isEmpty && !new.isEmpty { return .replace(old, new) }
        }
        return .expression(text)
    }
}
