import UIKit

extension UIImage {
    /// Downscale so the longest side is at most `maxDimension`, preserving the
    /// aspect ratio — keeps attachment payloads under the server's image cap.
    func resizedForUpload(maxDimension: CGFloat = 1280) -> UIImage {
        let maxSide = max(size.width, size.height)
        guard maxSide > maxDimension, maxSide > 0 else { return self }
        let scale = maxDimension / maxSide
        let newSize = CGSize(width: (size.width * scale).rounded(),
                             height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }

    /// Decode a `data:image/...;base64,...` URL into a `UIImage`.
    static func fromDataUrl(_ dataUrl: String) -> UIImage? {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let base64 = String(dataUrl[dataUrl.index(after: comma)...])
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}
