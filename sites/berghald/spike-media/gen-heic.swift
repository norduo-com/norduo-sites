import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
// usage: gen <out> <w> <h> <noise 0..1> <quality> <orientation>
let a = CommandLine.arguments
let out = a[1]; let w = Int(a[2])!; let h = Int(a[3])!
let noise = Double(a[4])!; let q = Double(a[5])!; let orient = Int(a[6])!
let cs = CGColorSpace(name: CGColorSpace.displayP3)!
let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
let grad = CGGradient(colorsSpace: cs, colors: [CGColor(red: 0.2, green: 0.45, blue: 0.25, alpha: 1), CGColor(red: 0.55, green: 0.7, blue: 0.9, alpha: 1)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: .zero, end: CGPoint(x: 0, y: h), options: [])
ctx.setFillColor(CGColor(red: 0.5, green: 0.45, blue: 0.4, alpha: 1))
for i in 0..<40 { let s = Double(i) * 0.025; ctx.fillEllipse(in: CGRect(x: Double(w) * s, y: Double(h) * (0.1 + 0.3 * sin(s * 9)), width: Double(w) / 12, height: Double(h) / 14)) }
// marker in the top-left corner so orientation handling is visible
ctx.setFillColor(CGColor(red: 0.9, green: 0.1, blue: 0.1, alpha: 1))
ctx.fill(CGRect(x: 0, y: h - h / 5, width: w / 5, height: h / 5))
if noise > 0 {
  let data = ctx.data!.assumingMemoryBound(to: UInt8.self); let bpr = ctx.bytesPerRow
  var r: UInt32 = 12345
  for y in 0..<h { for x in 0..<w { for c in 0..<3 {
    r = r &* 1103515245 &+ 12345; let n = Int((r >> 16) & 0xff) - 128
    let p = y * bpr + x * 4 + c; data[p] = UInt8(max(0, min(255, Int(data[p]) + Int(Double(n) * noise))))
  } } }
}
let img = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.heic.identifier as CFString, 1, nil)!
let props: [CFString: Any] = [
  kCGImageDestinationLossyCompressionQuality: q,
  kCGImagePropertyOrientation: orient,
  kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFMake: "Apple", kCGImagePropertyTIFFModel: "iPhone 15 Pro"],
  kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 64.1466, kCGImagePropertyGPSLatitudeRef: "N", kCGImagePropertyGPSLongitude: 21.9426, kCGImagePropertyGPSLongitudeRef: "W"],
]
CGImageDestinationAddImage(dest, img, props as CFDictionary)
CGImageDestinationFinalize(dest)
