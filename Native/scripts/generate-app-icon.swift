import AppKit

// Reuse Pico's approved silhouette; iOS supplies the outer icon mask.
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let output = root.appendingPathComponent("Assets.xcassets/AppIcon.appiconset")
let context = CGContext(
  data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
  bytesPerRow: 4096, space: CGColorSpaceCreateDeviceRGB(),
  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 1, green: 0.976, blue: 0.957, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.translateBy(x: 0, y: 1024)
context.scaleBy(x: 1, y: -1)
context.translateBy(x: 152, y: 104)
context.scaleBy(x: 6, y: 6)
let shape = CGMutablePath()
shape.move(to: CGPoint(x: 48, y: 17))
shape.addCurve(
  to: CGPoint(x: 72, y: 17), control1: CGPoint(x: 54, y: 5), control2: CGPoint(x: 65, y: 5))
shape.addLine(to: CGPoint(x: 110, y: 92))
shape.addCurve(
  to: CGPoint(x: 94, y: 119), control1: CGPoint(x: 119, y: 110), control2: CGPoint(x: 111, y: 119))
shape.addLine(to: CGPoint(x: 26, y: 119))
shape.addCurve(
  to: CGPoint(x: 10, y: 92), control1: CGPoint(x: 8, y: 119), control2: CGPoint(x: 1, y: 110))
shape.closeSubpath()
context.saveGState()
context.setShadow(
  offset: CGSize(width: 0, height: 3), blur: 5,
  color: CGColor(red: 0.45, green: 0.23, blue: 0.12, alpha: 0.16))
context.addPath(shape)
context.setFillColor(CGColor(red: 0.975, green: 0.788, blue: 0.659, alpha: 1))
context.fillPath()
context.restoreGState()
context.addPath(shape)
context.clip()
let colors = [
  CGColor(red: 0.977, green: 0.788, blue: 0.659, alpha: 1),
  CGColor(red: 0.918, green: 0.663, blue: 0.502, alpha: 1),
]
let gradient = CGGradient(
  colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray,
  locations: [0, 1])!
context.drawLinearGradient(
  gradient, start: CGPoint(x: 42, y: 8), end: CGPoint(x: 85, y: 120),
  options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
context.resetClip()
context.setFillColor(CGColor(red: 0.161, green: 0.153, blue: 0.145, alpha: 1))
for x in [43.0, 77.0] {
  context.fillEllipse(in: CGRect(x: x - 8, y: 62, width: 16, height: 16))
}
let png = NSBitmapImageRep(cgImage: context.makeImage()!).representation(
  using: .png, properties: [:])!
try png.write(to: output.appendingPathComponent("AppIcon.png"))

let mac = CGContext(
  data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
  bytesPerRow: 4096, space: CGColorSpaceCreateDeviceRGB(),
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
mac.addPath(
  CGPath(
    roundedRect: CGRect(x: 80, y: 80, width: 864, height: 864),
    cornerWidth: 194, cornerHeight: 194, transform: nil))
mac.clip()
mac.draw(context.makeImage()!, in: CGRect(x: 80, y: 80, width: 864, height: 864))
let macOutput = root.appendingPathComponent("Assets")
try FileManager.default.createDirectory(at: macOutput, withIntermediateDirectories: true)
try NSBitmapImageRep(cgImage: mac.makeImage()!).representation(using: .png, properties: [:])!
  .write(to: macOutput.appendingPathComponent("Mathwave-mac.png"))
