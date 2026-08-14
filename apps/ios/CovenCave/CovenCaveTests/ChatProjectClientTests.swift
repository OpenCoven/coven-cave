import Foundation
import XCTest
@testable import CovenCave

private final class ChatProjectURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let handler = try XCTUnwrap(Self.handler)
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

final class ChatProjectClientTests: XCTestCase {
    override func tearDown() {
        ChatProjectURLProtocol.handler = nil
        super.tearDown()
    }

    func testProjectRequestUsesInjectedSessionAndRetriesTransientFailure() async throws {
        var attempts = 0
        ChatProjectURLProtocol.handler = { request in
            attempts += 1
            XCTAssertEqual(request.url?.path, "/api/projects")
            XCTAssertEqual(
                URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "familiarId" })?.value,
                "nyx"
            )
            if attempts == 1 {
                throw URLError(.networkConnectionLost)
            }
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )
            )
            return (
                response,
                Data(
                    """
                    {
                      "ok": true,
                      "projects": [{
                        "id": "cave",
                        "name": "Coven Cave",
                        "root": "/repos/cave",
                        "access": "write"
                      }]
                    }
                    """.utf8
                )
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ChatProjectURLProtocol.self]
        let client = CaveClient(
            connection: CaveConnection(host: "http://cave.test:3000"),
            session: URLSession(configuration: configuration)
        )

        let projects = try await client.projects(familiarId: "nyx")

        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(projects.map(\.id), ["cave"])
        XCTAssertEqual(projects.first?.access, .write)
    }
}
