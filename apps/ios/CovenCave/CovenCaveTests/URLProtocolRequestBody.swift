import Foundation
import XCTest

extension URLRequest {
    /// The request body as a `URLProtocol` stub actually receives it.
    ///
    /// `URLSession` does not hand a `URLProtocol` the `httpBody` the caller
    /// set: by the time the protocol sees the request the body has been turned
    /// into an `httpBodyStream`, and `httpBody` reads back as `nil`. A stub
    /// that asserts on `request.httpBody` therefore fails for *every* request
    /// that has a body — never because the body is wrong, always because it is
    /// being read from the wrong property.
    ///
    /// That is not a hypothetical: the first execution of this suite
    /// (`cave-vz17i`) reported `XCTUnwrap failed: expected non-nil value of
    /// type "Data"` from both `CaveClientRetryTests` and
    /// `VoiceSessionContractTests`, and in both cases the client was sending
    /// exactly the body the test wanted to check.
    ///
    /// `httpBody` is still preferred when present, so this reads correctly
    /// from a request that has not been through a session.
    func bodyDataForTesting(
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> Data {
        if let httpBody { return httpBody }

        let stream = try XCTUnwrap(
            httpBodyStream,
            "the request carried neither an httpBody nor an httpBodyStream",
            file: file,
            line: line
        )
        stream.open()
        defer { stream.close() }

        var data = Data()
        let capacity = 4096
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: capacity)
            if read < 0 {
                throw stream.streamError ?? URLError(.cannotParseResponse)
            }
            if read == 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
