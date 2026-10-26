import Testing
@testable import MathAudioCore

struct MathEngineTests {
    @Test func testArithmeticPrecedenceAndParentheses() throws {
        #expect(try MathEngine.solve("2 + 3 * 4").answer == "14")
        #expect(try MathEngine.solve("(2 + 3) * 4").answer == "20")
        #expect(try MathEngine.solve("-2^2").answer == "-4")
        #expect(try MathEngine.solve("2^3^2").answer == "512")
        #expect(try MathEngine.solve("1.5 / 0.5").answer == "3")
    }
    @Test func testSpokenMath() throws {
        #expect(try MathEngine.solve("What is two plus three times four?").answer == "14")
        #expect(try MathEngine.solve("negative three plus twelve").answer == "9")
        #expect(try MathEngine.solve("x squared minus five x plus six equals zero").answer == "x = 2 or x = 3")
    }
    @Test func testLinearAndQuadraticEquations() throws {
        #expect(try MathEngine.solve("2x + 3 = 11").answer == "x = 4")
        #expect(try MathEngine.solve("x² − 5x + 6 = 0").answer == "x = 2 or x = 3")
        #expect(try MathEngine.solve("(x+1)(x-1) = 0").answer == "x = -1 or x = 1")
        #expect(try MathEngine.solve("x^2 = 0").answer == "x = 0")
        #expect(try MathEngine.solve("x^2 + 1 = 0").answer == "No real solutions")
        #expect(try MathEngine.solve("2x + 1 = 2x + 1").answer == "True for every x")
        #expect(try MathEngine.solve("2x + 1 = 2x + 2").answer == "No solution")
        #expect(try MathEngine.solve("x^2 = 0.00000000000001").answer == "x = -1e-07 or x = 1e-07")
        #expect(try MathEngine.solve("0.0000000000001x = 1").answer == "x = 1e+13")
    }
    @Test func testRejectsInvalidAndUnsupportedInput() {
        for expression in ["", "3/0", "x^3 = 0", "1/(x+1)=0", "(2+3", "2+", "2 3", "1e9", "sqrt(4)", "2=2=2", "x+1", "2^-1", "1..2"] {
            #expect(throws: (any Error).self) { try MathEngine.solve(expression) }
        }
        let overflow = "0." + String(repeating: "0", count: 309) + "1x = 1"
        #expect(throws: (any Error).self) { try MathEngine.solve(overflow) }
    }
    @Test func testStatistics() throws {
        #expect(try MathEngine.statistics("4, 8, 10, 14").answer == "Mean 9 · Median 9")
        #expect(try MathEngine.statistics("one comma three comma eight").answer == "Mean 4 · Median 3")
        #expect(try MathEngine.statistics("-2, -2, 4").answer == "Mean 0 · Median -2")
        #expect(throws: (any Error).self) { try MathEngine.statistics("1, nope, 2") }
        #expect(throws: (any Error).self) { try MathEngine.statistics("1") }
        #expect(throws: (any Error).self) { try MathEngine.statistics("1, inf") }
    }
    @Test func testCommands() {
        #expect(WorkbenchCommand.parse("Read equation.") == .read)
        #expect(WorkbenchCommand.parse("solve 2 + 2") == .solve("2 + 2"))
        #expect(WorkbenchCommand.parse("replace six with eight") == .replace("six", "eight"))
        #expect(WorkbenchCommand.parse("undo") == .undo)
        #expect(WorkbenchCommand.parse("new session") == .newSession)
        #expect(WorkbenchCommand.parse("statistics 1, 2") == .statistics("1, 2"))
    }
    @Test func testReplacementRejectsAmbiguousTargets() throws {
        #expect(try MathEngine.replacing(in: "x² - 5x + 6 = 0", target: "six", replacement: "eight") == "x^2 - 5x + 8 = 0")
        #expect(try MathEngine.replacing(in: "16 + 6", target: "6", replacement: "8") == "16 + 8")
        #expect(throws: (any Error).self) { try MathEngine.replacing(in: "x² + 6x + 6 = 0", target: "six", replacement: "eight") }
        #expect(throws: (any Error).self) { try MathEngine.replacing(in: "x + x = 2", target: "x", replacement: "3") }
        #expect(throws: (any Error).self) { try MathEngine.replacing(in: "16 + 1", target: "6", replacement: "8") }
    }
}
