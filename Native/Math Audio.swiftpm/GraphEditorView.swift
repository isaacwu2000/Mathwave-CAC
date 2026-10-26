import SwiftUI

/// Keeps unfinished expression edits local until the student explicitly saves them.
struct GraphEditorView: View {
    @ObservedObject var model: WorkbenchModel
    let rows: [String]
    @State private var drafts: [String] = []
    @State private var newCurve = ""
    @State private var traceX = "0"
    @State private var graphNumber = 1
    @State private var previousRows: [String] = []
    var body: some View {
        DisclosureGroup("Edit and explore graphs") {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(drafts.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Graph \(index + 1)", text: $drafts[index]).textFieldStyle(.roundedBorder)
                            .accessibilityLabel("Graph \(index + 1) expression")
                        HStack {
                            Button("Save graph \(index + 1)") { model.perform("command", text: "edit graph \(index + 1) to \(drafts[index])") }
                            Button("Remove") { model.perform("command", text: "remove graph \(index + 1)") }
                                .accessibilityLabel("Remove graph \(index + 1)")
                        }.buttonStyle(.bordered).controlSize(.large)
                    }
                }
                TextField("New graph expression", text: $newCurve).textFieldStyle(.roundedBorder)
                Button("Add graph") {
                    model.perform("command", text: "add graph \(newCurve)")
                    if model.document?.graphRows.count != rows.count { newCurve = "" }
                }.buttonStyle(.bordered).controlSize(.large).disabled(newCurve.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Picker("Trace curve", selection: $graphNumber) {
                    ForEach(1...max(1, rows.count), id: \.self) { number in Text("Graph \(number)").tag(number) }
                }
                TextField("Jump to x", text: $traceX).textFieldStyle(.roundedBorder)
                Button("Trace point") { model.perform("command", text: "trace graph \(graphNumber) at x \(traceX)") }
                    .buttonStyle(.bordered).controlSize(.large)
                ViewThatFits(in: .horizontal) {
                    HStack { panControls }
                    VStack(alignment: .leading) { panControls }
                }
            }.padding(.top, 12)
        }
        .onAppear { drafts = rows; previousRows = rows }
        .onChange(of: rows) { values in
            // Preserve edits to unchanged rows when another curve is saved or removed.
            var used = Set<Int>()
            drafts = values.enumerated().map { index, value in
                if values.count == previousRows.count {
                    return previousRows[index] == value ? drafts[index] : value
                }
                if let old = previousRows.indices.first(where: { !used.contains($0) && previousRows[$0] == value }) {
                    used.insert(old)
                    return drafts.indices.contains(old) ? drafts[old] : value
                }
                return value
            }
            previousRows = values
            graphNumber = min(graphNumber, max(1, values.count))
        }
    }
    @ViewBuilder private var panControls: some View {
        Button("Pan left") { model.perform("command", text: "pan left") }
        Button("Pan right") { model.perform("command", text: "pan right") }
        Button("Pan up") { model.perform("command", text: "pan up") }
        Button("Pan down") { model.perform("command", text: "pan down") }
    }
}
