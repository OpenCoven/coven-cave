import XCTest
@testable import SalemQuickAnswer

private struct StubCredentialStore: CredentialStoring {
    let token: String?
    func readToken() throws -> String? { token }
    func saveToken(_ token: String) throws {}
    func deleteToken() throws {}
}

private final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.badServerResponse) }
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

final class LiveBriefServiceTests: XCTestCase {
    private var session: URLSession!

    override func setUp() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        session = URLSession(configuration: configuration)
        StubURLProtocol.handler = nil
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        StubURLProtocol.handler = nil
    }

    private func service(token: String? = "salem-quick-answer-test-token-0001") -> LiveBriefService {
        LiveBriefService(
            endpoint: URL(string: "https://salem.example.test/api/brief")!,
            credentialStore: StubCredentialStore(token: token),
            session: session
        )
    }

    private func response(status: Int, body: [String: Any]) throws -> (HTTPURLResponse, Data) {
        let http = HTTPURLResponse(
            url: URL(string: "https://salem.example.test/api/brief")!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (http, try JSONSerialization.data(withJSONObject: body, options: []))
    }

    private func validBrief() -> [String: Any] {
        [
            "schemaVersion": "opencoven.salem-brief/v1",
            "queryId": "test-query",
            "question": "What is OpenCoven?",
            "answer": [
                "sayThis": "A grounded answer.",
                "followUp": NSNull(),
                "caveats": [],
            ],
            "classification": [
                "claimStatus": "specified",
                "confidence": "high",
                "safeToGeneralize": false,
            ],
            "evidence": [[
                "id": "evidence-1",
                "title": "Docs",
                "url": "https://docs.opencoven.ai/reference",
                "summary": "Canonical docs evidence.",
                "sourceAuthority": "canonical_docs",
                "lifecycle": "current",
                "repository": NSNull(),
                "path": NSNull(),
                "revision": NSNull(),
                "sourceHash": NSNull(),
            ]],
            "knowledge": [
                "sourceRevision": NSNull(),
                "sourceHash": NSNull(),
                "indexedAt": NSNull(),
                "checkedAt": NSNull(),
                "freshness": "unknown",
            ],
        ]
    }

    func testAuthorizedRequestCarriesOnlyScopedBearerAndDecodes() async throws {
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Authorization"),
                "Bearer salem-quick-answer-test-token-0001"
            )
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            return try self.response(status: 200, body: self.validBrief())
        }

        let answer = try await service().answer(
            question: "What is OpenCoven?",
            audience: .anyone,
            depth: .conversation
        )
        XCTAssertEqual(answer.schemaVersion, "opencoven.salem-brief/v1")
        XCTAssertEqual(answer.classification.claimStatus, .specified)
    }

    func testMissingCredentialFailsBeforeNetwork() async {
        StubURLProtocol.handler = { _ in
            XCTFail("Network must not run without a credential")
            return try self.response(status: 500, body: [:])
        }
        do {
            _ = try await service(token: nil).answer(
                question: "Question", audience: .anyone, depth: .quick
            )
            XCTFail("Expected unauthorized")
        } catch BriefServiceError.unauthorized {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRevokedAndRateLimitedAreDistinct() async throws {
        StubURLProtocol.handler = { _ in
            try self.response(status: 401, body: ["code": "BRIEF_AUTH_REVOKED"])
        }
        do {
            _ = try await service().answer(question: "Question", audience: .anyone, depth: .quick)
            XCTFail("Expected revoked")
        } catch BriefServiceError.revoked {}

        StubURLProtocol.handler = { _ in
            try self.response(status: 429, body: ["code": "BRIEF_RATE_LIMITED"])
        }
        do {
            _ = try await service().answer(question: "Question", audience: .anyone, depth: .quick)
            XCTFail("Expected rate limit")
        } catch BriefServiceError.rateLimited {}
    }

    func testMalformedOrFutureSchemaIsWithheld() async throws {
        var future = validBrief()
        future["schemaVersion"] = "opencoven.salem-brief/v2"
        StubURLProtocol.handler = { _ in try self.response(status: 200, body: future) }

        do {
            _ = try await service().answer(question: "Question", audience: .anyone, depth: .quick)
            XCTFail("Expected invalid response")
        } catch BriefServiceError.invalidResponse {}
    }
}
