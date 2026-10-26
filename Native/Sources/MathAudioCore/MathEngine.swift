import Foundation

public struct MathResult: Equatable {
    public let answer: String
    public let steps: [String]
    public init(answer: String, steps: [String]) { self.answer = answer; self.steps = steps }
}

public enum MathError: Error, LocalizedError {
    case invalid(String)
    public var errorDescription: String? { if case let .invalid(message) = self { return message }; return nil }
}

public enum MathEngine {
    public static func replacing(in input: String, target: String, replacement: String) throws -> String {
        let source = normalize(input)
        let find = normalize(target).trimmingCharacters(in: .whitespaces)
        let new = normalize(replacement).trimmingCharacters(in: .whitespaces)
        guard !find.isEmpty, !new.isEmpty else { throw MathError.invalid("Name the term to replace and its replacement. Nothing changed.") }
        let pattern = "(?<![0-9.])" + NSRegularExpression.escapedPattern(for: find) + "(?![0-9.])"
        let regex = try NSRegularExpression(pattern: pattern)
        let matches = regex.matches(in: source, range: NSRange(source.startIndex..., in: source))
        guard !matches.isEmpty else { throw MathError.invalid("Could not find \(target) in the current work. Nothing changed.") }
        guard matches.count == 1 else { throw MathError.invalid("Found \(matches.count) matches for \(target). To avoid changing the wrong term, type the full corrected expression. Nothing changed.") }
        guard let range = Range(matches[0].range, in: source) else { throw MathError.invalid("Could not locate that term. Nothing changed.") }
        return source.replacingCharacters(in: range, with: new)
    }

    public static func format(_ value: Double) -> String {
        if !value.isFinite { return "undefined" }
        let v = value == 0 ? 0 : value
        return String(format: "%.10g", locale: Locale(identifier: "en_US_POSIX"), v).lowercased()
    }

    public static func normalize(_ input: String) -> String {
        var s = input.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let substitutions = [
            ("what is ", ""), ("calculate ", ""), ("multiplied by", "*"),
            ("divided by", "/"), ("to the power of", "^"), ("open parenthesis", "("),
            ("close parenthesis", ")"), ("left parenthesis", "("), ("right parenthesis", ")"),
            ("squared", "^2"), ("cubed", "^3"), ("equals", "="), ("equal to", "="),
            ("plus", "+"), ("minus", "-"), ("negative", "-"), ("times", "*"),
            ("×", "*"), ("÷", "/"), ("−", "-"), ("²", "^2"), ("³", "^3"),
            ("zero", "0"), ("one", "1"), ("two", "2"), ("three", "3"), ("four", "4"),
            ("five", "5"), ("six", "6"), ("seven", "7"), ("eight", "8"), ("nine", "9"),
            ("ten", "10"), ("eleven", "11"), ("twelve", "12")
        ]
        for (from, to) in substitutions {
            let pattern = from.first?.isLetter == true ? "\\b" + NSRegularExpression.escapedPattern(for: from) + (from.last?.isLetter == true ? "\\b" : "") : NSRegularExpression.escapedPattern(for: from)
            s = s.replacingOccurrences(of: pattern, with: to, options: .regularExpression)
        }
        return s.trimmingCharacters(in: CharacterSet(charactersIn: " ?"))
    }

    public static func solve(_ input: String) throws -> MathResult {
        let source = normalize(input)
        guard !source.isEmpty else { throw MathError.invalid("Enter an expression first, such as 2 + 3 × 4.") }
        guard source.count <= 500 else { throw MathError.invalid("Please use an expression of 500 characters or fewer.") }
        let sides = source.components(separatedBy: "=")
        guard sides.count <= 2 else { throw MathError.invalid("Use one equals sign per equation.") }
        var leftParser = try Parser(sides[0])
        let left = try leftParser.parse()
        if sides.count == 1 {
            guard left.degree == 0 else { throw MathError.invalid("Add an equals sign to solve for x. For example, x squared - 5x + 6 = 0.") }
            return MathResult(answer: format(left.c[0]), steps: ["Read: \(source)", "Apply parentheses and powers first, then multiplication and division, then addition and subtraction.", "Result: \(format(left.c[0]))."])
        }
        var rightParser = try Parser(sides[1])
        let right = try rightParser.parse()
        let p = left - right
        let a = p.c[2], b = p.c[1], c = p.c[0]
        if p.degree == 0 {
            let truth = c == 0
            return MathResult(answer: truth ? "True for every x" : "No solution", steps: ["Subtract the right side from the left side.", "The equation reduces to \(format(c)) = 0."])
        }
        if p.degree == 1 {
            let x = -c / b
            guard x.isFinite else { throw MathError.invalid("These numbers are too large to calculate reliably.") }
            return MathResult(answer: "x = \(format(x))", steps: ["Collect terms: \(format(b))x + (\(format(c))) = 0.", "Subtract \(format(c)) and divide by \(format(b)).", "x = \(format(x))."])
        }
        let discriminant = b * b - 4 * a * c
        guard discriminant.isFinite else { throw MathError.invalid("These numbers are too large to calculate reliably.") }
        var steps = ["Collect terms: \(format(a))x² + (\(format(b)))x + (\(format(c))) = 0.", "Use x = (−b ± √(b² − 4ac)) ÷ (2a).", "The discriminant is \(format(discriminant))."]
        if discriminant < 0 {
            steps.append("A negative discriminant means there are no real roots.")
            return MathResult(answer: "No real solutions", steps: steps)
        }
        let d = sqrt(max(0, discriminant))
        // This form avoids subtracting nearly equal floating-point numbers.
        let q = -0.5 * (b + (b < 0 ? -d : d))
        let roots = discriminant == 0 ? [-b / (2 * a)] : [q / a, c / q].sorted()
        guard roots.allSatisfy(\.isFinite) else { throw MathError.invalid("These numbers are too large to calculate reliably.") }
        let answer = roots.count == 1 ? "x = \(format(roots[0]))" : "x = \(format(roots[0])) or x = \(format(roots[1]))"
        steps.append(answer + ".")
        return MathResult(answer: answer, steps: steps)
    }

    public static func statistics(_ input: String) throws -> MathResult {
        let chunks = input.replacingOccurrences(of: "comma", with: ",", options: .caseInsensitive).components(separatedBy: CharacterSet(charactersIn: ",;\n"))
        guard chunks.count >= 2 else { throw MathError.invalid("Separate at least two numbers with commas, such as 4, 8, 10, 14.") }
        let values = try chunks.map { chunk -> Double in
            let normalized = normalize(chunk).replacingOccurrences(of: " ", with: "")
            guard let value = Double(normalized), value.isFinite else { throw MathError.invalid("Use a list of finite numbers separated by commas.") }
            return value
        }.sorted()
        guard values.count <= 1000 else { throw MathError.invalid("Use 1,000 numbers or fewer.") }
        let sum = values.reduce(0, +)
        let mean = sum / Double(values.count)
        let median = values.count % 2 == 1 ? values[values.count / 2] : (values[values.count / 2 - 1] / 2 + values[values.count / 2] / 2)
        let range = values.last! - values.first!
        guard [sum, mean, median, range].allSatisfy(\.isFinite) else { throw MathError.invalid("These numbers are too large to calculate reliably.") }
        return MathResult(answer: "Mean \(format(mean)) · Median \(format(median))", steps: ["Count: \(values.count). Sum: \(format(sum)).", "Mean: \(format(sum)) divided by \(values.count) = \(format(mean)).", "Sort the values and find the middle: median = \(format(median)).", "Range: \(format(values.last!)) minus \(format(values.first!)) = \(format(range))."])
    }
}

private struct Polynomial {
    var c: [Double]
    init(_ constant: Double) { c = [constant, 0, 0] }
    init(c: [Double]) { self.c = c }
    var degree: Int { c[2] != 0 ? 2 : c[1] != 0 ? 1 : 0 }
    static func + (l: Self, r: Self) -> Self { Self(c: zip(l.c, r.c).map(+)) }
    static func - (l: Self, r: Self) -> Self { Self(c: zip(l.c, r.c).map(-)) }
    func multiplied(by other: Self) throws -> Self {
        var result = [Double](repeating: 0, count: 5)
        for i in 0...2 { for j in 0...2 { result[i+j] += c[i] * other.c[j] } }
        guard result[3] == 0, result[4] == 0 else { throw MathError.invalid("This workbench supports equations up to x squared.") }
        return Self(c: Array(result.prefix(3)))
    }
}

private enum Token: Equatable { case number(Double), x, plus, minus, multiply, divide, power, left, right, end }

private struct Parser {
    var tokens: [Token] = []
    var index = 0
    init(_ input: String) throws {
        let chars = Array(input)
        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if ch.isWhitespace { i += 1; continue }
            if ch.isNumber || ch == "." {
                let start = i
                while i < chars.count && (chars[i].isNumber || chars[i] == ".") { i += 1 }
                guard let value = Double(String(chars[start..<i])), value.isFinite else { throw MathError.invalid("That number is not valid.") }
                tokens.append(.number(value)); continue
            }
            switch ch {
            case "x": tokens.append(.x)
            case "+": tokens.append(.plus)
            case "-": tokens.append(.minus)
            case "*": tokens.append(.multiply)
            case "/": tokens.append(.divide)
            case "^": tokens.append(.power)
            case "(": tokens.append(.left)
            case ")": tokens.append(.right)
            default: throw MathError.invalid("I could not read ‘\(ch)’. Use numbers, x, parentheses, +, −, ×, ÷, and powers.")
            }
            i += 1
        }
        tokens.append(.end)
    }
    var current: Token { tokens[index] }
    mutating func take() -> Token { defer { index += 1 }; return current }
    mutating func parse() throws -> Polynomial {
        let value = try expression()
        guard current == .end else { throw MathError.invalid("Check the expression for a missing operator or parenthesis.") }
        guard value.c.allSatisfy(\.isFinite) else { throw MathError.invalid("These numbers are too large to calculate reliably.") }
        return value
    }
    mutating func expression() throws -> Polynomial {
        var v = try term()
        while current == .plus || current == .minus { let op = take(); let rhs = try term(); v = op == .plus ? v + rhs : v - rhs }
        return v
    }
    mutating func term() throws -> Polynomial {
        var v = try unary()
        while true {
            if current == .multiply { _ = take(); v = try v.multiplied(by: unary()) }
            else if current == .divide {
                _ = take(); let divisor = try unary()
                guard divisor.degree == 0 else { throw MathError.invalid("Division by an expression containing x is not supported.") }
                guard divisor.c[0] != 0 else { throw MathError.invalid("Division by zero is undefined.") }
                v = Polynomial(c: v.c.map { $0 / divisor.c[0] })
            } else if current == .x || current == .left { v = try v.multiplied(by: unary()) }
            else { break }
        }
        return v
    }
    mutating func unary() throws -> Polynomial {
        if current == .minus { _ = take(); return Polynomial(0) - (try unary()) }
        if current == .plus { _ = take(); return try unary() }
        return try power()
    }
    mutating func power() throws -> Polynomial {
        var v = try atom()
        if current == .power {
            _ = take(); let exponent = try unary()
            guard exponent.degree == 0, exponent.c[0].rounded() == exponent.c[0], (0...12).contains(exponent.c[0]) else { throw MathError.invalid("Use a whole-number power from 0 through 12; equations can contain up to x squared.") }
            let base = v; v = Polynomial(1)
            for _ in 0..<Int(exponent.c[0]) { v = try v.multiplied(by: base) }
        }
        return v
    }
    mutating func atom() throws -> Polynomial {
        switch take() {
        case let .number(v): return Polynomial(v)
        case .x: return Polynomial(c: [0, 1, 0])
        case .left:
            let v = try expression()
            guard current == .right else { throw MathError.invalid("A closing parenthesis is missing.") }
            _ = take(); return v
        default: throw MathError.invalid("An expression is incomplete. Check numbers, operators, and parentheses.")
        }
    }
}
