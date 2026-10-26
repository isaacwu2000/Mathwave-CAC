import CoreGraphics
import CoreText
import Foundation

#if canImport(MathAudioCore)
  import MathAudioCore
#endif

/// Exports selectable, paginated text and a vector drawing of the current graph or geometry.
enum WorkPDF {
  static func make(_ text: String, plot: WorkbenchPlot? = nil) throws -> Data {
    let data = NSMutableData()
    var page = CGRect(x: 0, y: 0, width: 612, height: 792)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
      let context = CGContext(consumer: consumer, mediaBox: &page, nil)
    else {
      throw NSError(
        domain: "MathAudio", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "The PDF could not be created."])
    }
    let font = CTFontCreateWithName("Helvetica" as CFString, 14, nil)
    let content = NSAttributedString(
      string: text.isEmpty && plot == nil ? "No saved steps yet." : text,
      attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(
          gray: 0.1, alpha: 1),
      ])
    let framesetter = CTFramesetterCreateWithAttributedString(content)
    var location = 0
    while location < content.length {
      context.beginPDFPage(nil)
      let path = CGPath(rect: page.insetBy(dx: 48, dy: 48), transform: nil)
      let frame = CTFramesetterCreateFrame(
        framesetter, CFRange(location: location, length: 0), path, nil)
      CTFrameDraw(frame, context)
      let count = CTFrameGetVisibleStringRange(frame).length
      context.endPDFPage()
      guard count > 0 else {
        throw NSError(
          domain: "MathAudio", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "The PDF text could not fit on the page."])
      }
      location += count
    }
    if let plot {
      context.beginPDFPage(nil)
      draw(plot, in: context, rect: CGRect(x: 48, y: 140, width: 516, height: 516))
      context.endPDFPage()
    }
    context.closePDF()
    return data as Data
  }

  /// Uses the same bounds and primitives as the on-screen drawing; output stays vector based.
  private static func draw(_ plot: WorkbenchPlot, in context: CGContext, rect: CGRect) {
    let x = plot.bounds
    let y = x.y ?? PlotRange(min: -10, max: 10)
    func point(_ a: Double, _ b: Double) -> CGPoint {
      CGPoint(
        x: rect.minX + (a - x.min) / (x.max - x.min) * rect.width,
        y: rect.minY + (b - y.min) / (y.max - y.min) * rect.height)
    }
    context.saveGState()
    context.clip(to: rect)
    if plot.axes {
      context.setStrokeColor(CGColor(gray: 0.85, alpha: 1))
      context.setLineWidth(0.5)
      for i in 0...20 {
        let a = x.min + (x.max - x.min) * Double(i) / 20
        let b = y.min + (y.max - y.min) * Double(i) / 20
        context.move(to: point(a, y.min))
        context.addLine(to: point(a, y.max))
        context.move(to: point(x.min, b))
        context.addLine(to: point(x.max, b))
      }
      context.strokePath()
      context.setStrokeColor(CGColor(gray: 0.3, alpha: 1))
      context.setLineWidth(1)
      context.move(to: point(x.min, 0))
      context.addLine(to: point(x.max, 0))
      context.move(to: point(0, y.min))
      context.addLine(to: point(0, y.max))
      context.strokePath()
    }
    for primitive in plot.plots {
      let hex =
        UInt64(primitive.color.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16)
        ?? 0xD32419
      let color = CGColor(
        red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
        blue: Double(hex & 255) / 255, alpha: 1)
      context.setStrokeColor(color)
      context.setFillColor(color)
      context.setLineWidth(2)
      let values = primitive.positions
      if primitive.kind == "point" {
        for i in stride(from: 0, to: max(0, values.count - 2), by: 3) {
          let p = point(values[i], values[i + 1])
          context.fillEllipse(in: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8))
        }
      } else {
        let count = primitive.kind == "surface" ? 9 : 6
        context.setAlpha(count == 9 ? primitive.opacity ?? 0.15 : 1)
        for i in stride(from: 0, to: max(0, values.count - count + 1), by: count) {
          context.move(to: point(values[i], values[i + 1]))
          context.addLine(to: point(values[i + 3], values[i + 4]))
          if count == 9 {
            context.addLine(to: point(values[i + 6], values[i + 7]))
            context.closePath()
            context.fillPath()
          }
        }
        if count == 6 { context.strokePath() }
        context.setAlpha(1)
      }
    }
    for label in plot.labels where label.position.count >= 2 {
      let text = NSAttributedString(
        string: label.text,
        attributes: [
          NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName(
            "Helvetica" as CFString, 12, nil)
        ])
      let p = point(label.position[0], label.position[1])
      context.textPosition = CGPoint(x: p.x + 4, y: p.y + 5)
      CTLineDraw(CTLineCreateWithAttributedString(text), context)
    }
    context.restoreGState()
  }
}
