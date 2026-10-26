import SwiftUI
#if canImport(MathAudioCore)
import MathAudioCore
#endif

/// Draws the web engine's sampled primitives. Axes and curves share one coordinate transform.
struct NativePlotView: View {
    let plot: WorkbenchPlot
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        Canvas { context, size in
            let bounds = plot.bounds
            let y = bounds.y ?? PlotRange(min: -10, max: 10)
            let inset = 24.0
            let availableWidth = max(1, size.width - 2 * inset), availableHeight = max(1, size.height - 2 * inset)
            let width = plot.axes ? availableWidth : min(availableWidth, availableHeight)
            let height = plot.axes ? availableHeight : width
            let left = (size.width - width) / 2, top = (size.height - height) / 2
            func point(_ x: Double, _ value: Double) -> CGPoint {
                CGPoint(x: left + (x - bounds.min) / (bounds.max - bounds.min) * width,
                        y: top + (y.max - value) / (y.max - y.min) * height)
            }
            context.clip(to: Path(CGRect(x: left, y: top, width: width, height: height)))
            if plot.axes {
                // Grid spacing follows the current bounds without an unbounded number of lines.
                var grid = Path()
                for i in 0...20 {
                    let x = bounds.min + (bounds.max - bounds.min) * Double(i) / 20
                    let value = y.min + (y.max - y.min) * Double(i) / 20
                    grid.move(to: point(x, y.min)); grid.addLine(to: point(x, y.max))
                    grid.move(to: point(bounds.min, value)); grid.addLine(to: point(bounds.max, value))
                }
                context.stroke(grid, with: .color(.secondary.opacity(0.12)), lineWidth: 0.5)
                var axes = Path()
                axes.move(to: point(bounds.min, 0)); axes.addLine(to: point(bounds.max, 0))
                axes.move(to: point(0, y.min)); axes.addLine(to: point(0, y.max))
                context.stroke(axes, with: .color(.secondary.opacity(0.6)), lineWidth: 1)
            }
            for primitive in plot.plots {
                let values = primitive.positions
                let color = Color(hex: primitive.color)
                if primitive.kind == "point" {
                    for i in stride(from: 0, to: values.count - 2, by: 3) {
                        let p = point(values[i], values[i + 1])
                        context.fill(Path(ellipseIn: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8)), with: .color(color))
                    }
                } else {
                    let count = primitive.kind == "surface" ? 9 : 6
                    var path = Path()
                    for i in stride(from: 0, to: max(0, values.count - count + 1), by: count) {
                        path.move(to: point(values[i], values[i + 1]))
                        path.addLine(to: point(values[i + 3], values[i + 4]))
                        if count == 9 { path.addLine(to: point(values[i + 6], values[i + 7])); path.closeSubpath() }
                    }
                    if count == 9 { context.fill(path, with: .color(color.opacity(primitive.opacity ?? 0.15))) }
                    else { context.stroke(path, with: .color(color), lineWidth: 2) }
                }
            }
            for label in plot.labels where label.position.count >= 2 {
                context.draw(Text(label.text).font(.caption).foregroundColor(.primary), at: point(label.position[0], label.position[1]), anchor: .bottomLeading)
            }
        }
        .background(colorScheme == .dark ? Color(red: 0.12, green: 0.10, blue: 0.09) : Color(red: 1, green: 0.976, blue: 0.961))
        .accessibilityElement(children: .ignore)
    }
}

private extension Color {
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0xD32419
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}

struct DataValuesView: View {
    let values: [Double]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Observations").font(.headline)
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                HStack {
                    Text("\(index + 1)").foregroundStyle(.secondary).frame(minWidth: 30, alignment: .leading)
                    Text(value.formatted()).textSelection(.enabled)
                    GeometryReader { proxy in
                        let maximum = values.map { abs($0) }.max() ?? 1
                        Rectangle().fill(.tint.opacity(0.35))
                            .frame(width: maximum == 0 ? 0 : max(1, proxy.size.width * abs(value) / maximum), height: 12)
                    }.frame(height: 12)
                }.accessibilityElement(children: .ignore).accessibilityLabel("Observation \(index + 1): \(value.formatted())")
            }
        }
    }
}
