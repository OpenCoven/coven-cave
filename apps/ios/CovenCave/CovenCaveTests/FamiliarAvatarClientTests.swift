import Foundation
import XCTest
@testable import CovenCave

private final class FamiliarAvatarURLProtocol: URLProtocol {
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

final class FamiliarAvatarClientTests: XCTestCase {
    override func tearDown() {
        FamiliarAvatarURLProtocol.handler = nil
        super.tearDown()
    }

    private func client() -> CaveClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FamiliarAvatarURLProtocol.self]
        return CaveClient(
            connection: CaveConnection(host: "http://cave.test:3000"),
            session: URLSession(configuration: configuration)
        )
    }

    func testUploadSendsRawImageAndReturnsRevisionedURL() async throws {
        let image = Data([0x89, 0x50, 0x4e, 0x47])
        FamiliarAvatarURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/familiars/nova/avatar")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "image/png")
            XCTAssertEqual(request.httpBody, image)
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            ))
            return (response, Data("""
            {
              "ok": true,
              "avatarUrl": "/api/familiars/nova/avatar?v=42&format=png",
              "revision": 42
            }
            """.utf8))
        }

        let mutation = try await client().uploadFamiliarAvatar(
            id: "nova",
            imageData: image,
            contentType: "image/png"
        )

        XCTAssertEqual(mutation.avatarUrl, "/api/familiars/nova/avatar?v=42&format=png")
        XCTAssertEqual(mutation.revision, 42)
    }

    func testDeleteUsesIdempotentAvatarContract() async throws {
        FamiliarAvatarURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/familiars/nova/avatar")
            XCTAssertEqual(request.httpMethod, "DELETE")
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            ))
            return (response, Data("""
            {"ok":true,"avatarUrl":null,"revision":null,"removed":false}
            """.utf8))
        }

        let mutation = try await client().deleteFamiliarAvatar(id: "nova")

        XCTAssertNil(mutation.avatarUrl)
        XCTAssertNil(mutation.revision)
        XCTAssertEqual(mutation.removed, false)
    }

    func testMutationSurfacesDesktopError() async {
        FamiliarAvatarURLProtocol.handler = { request in
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 409,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            ))
            return (response, Data("""
            {"ok":false,"error":"Could not save avatar: unsafe workspace avatar path."}
            """.utf8))
        }

        do {
            _ = try await client().uploadFamiliarAvatar(
                id: "nova",
                imageData: Data([0x01]),
                contentType: "image/png"
            )
            XCTFail("Expected the desktop mutation error")
        } catch {
            XCTAssertTrue(String(describing: error).contains("unsafe workspace avatar path"))
        }
    }

    @MainActor
    func testAppModelAppliesRevisionURLImmediately() {
        let app = AppModel()
        app.familiars = [
            Familiar(
                id: "nova",
                displayName: "Nova",
                role: nil,
                description: nil,
                pronouns: nil,
                color: nil,
                status: nil,
                harness: nil,
                model: nil,
                icon: nil,
                avatarUrl: nil
            )
        ]

        app.applyFamiliarAvatarMutation(
            id: "nova",
            avatarUrl: "/api/familiars/nova/avatar?v=42&format=png"
        )

        XCTAssertEqual(
            app.familiars.first?.avatarUrl,
            "/api/familiars/nova/avatar?v=42&format=png"
        )
    }
}
