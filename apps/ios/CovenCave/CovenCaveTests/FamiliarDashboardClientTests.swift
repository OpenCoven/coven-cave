import Foundation
import XCTest
@testable import CovenCave

private final class FamiliarDashboardURLProtocol: URLProtocol {
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

/// `CaveClient.familiarDashboard(id:)` — the request it forms and the way it
/// classifies every answer.
final class FamiliarDashboardClientTests: XCTestCase {
    override func tearDown() {
        FamiliarDashboardURLProtocol.handler = nil
        super.tearDown()
    }

    private func client() -> CaveClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FamiliarDashboardURLProtocol.self]
        return CaveClient(
            connection: CaveConnection(host: "http://cave.test:3000"),
            session: URLSession(configuration: configuration)
        )
    }

    private func respond(
        status: Int,
        body: String
    ) {
        FamiliarDashboardURLProtocol.handler = { request in
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            ))
            return (response, Data(body.utf8))
        }
    }

    private func expectFailure(
        id: String = "nova",
        _ expected: FamiliarDashboardError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await client().familiarDashboard(id: id)
            XCTFail("expected \(expected)", file: file, line: line)
        } catch let error as FamiliarDashboardError {
            XCTAssertEqual(error, expected, file: file, line: line)
        } catch {
            XCTFail("expected a FamiliarDashboardError, got \(error)", file: file, line: line)
        }
    }

    // MARK: - The request

    /// The familiar id is escaped as ONE path segment (a familiar id can carry
    /// a slash), and `?v=1` is sent so a desktop that cannot serve this shape
    /// refuses rather than answering with a different one.
    func testTheRequestEscapesTheIdAndAsksForTheVersionItUnderstands() async throws {
        FamiliarDashboardURLProtocol.handler = { request in
            let url = try XCTUnwrap(request.url)
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            XCTAssertEqual(
                components?.percentEncodedPath,
                "/api/familiars/nova%2Ffamiliar/dashboard")
            XCTAssertEqual(components?.percentEncodedQuery, "v=1")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
            let response = try XCTUnwrap(HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]))
            return (
                response,
                Data(FamiliarDashboardFixtures.successJSON(familiarId: "nova/familiar").utf8)
            )
        }

        let payload = try await client().familiarDashboard(id: "nova/familiar")
        XCTAssertEqual(payload.familiarId, "nova/familiar")
    }

    func testASuccessfulAnswerDecodes() async throws {
        respond(status: 200, body: FamiliarDashboardFixtures.successJSON())

        let payload = try await client().familiarDashboard(id: "nova")

        XCTAssertEqual(payload.version, 1)
        XCTAssertEqual(payload.identity.displayName, "Nova")
        XCTAssertEqual(payload.sections.analytics.data?.sampleSize, 12)
    }

    // MARK: - Refusals

    /// The 403 is a path REFUSAL, not a credential problem. Classifying it as
    /// one would send a person back through Tailscale pairing because a
    /// familiar id had a character the desktop will not put in a path.
    func testAnInvalidIdIsARefusalAndNotAnAuthFailure() async {
        respond(
            status: 403,
            body: #"{"ok":false,"error":"path not allowed","code":"invalid_familiar_id"}"#)
        await expectFailure(.invalidFamiliarId)
    }

    func testAnUnknownFamiliarIsNotFound() async {
        respond(
            status: 404,
            body: #"{"ok":false,"error":"No familiar \"ghost\".","code":"familiar_not_found"}"#)
        await expectFailure(id: "ghost", .familiarNotFound)
    }

    func testARejectedVersionIsReportedAsSuch() async {
        respond(
            status: 400,
            body: #"{"ok":false,"error":"unsupported dashboard version","code":"unsupported_version"}"#)
        await expectFailure(.unsupportedVersion)
    }

    func testAnUnreadableRosterIsUnavailable() async {
        respond(
            status: 503,
            body: #"{"ok":false,"error":"The Familiar dashboard is unavailable.","code":"dashboard_unavailable"}"#)
        await expectFailure(.unavailable)
    }

    /// A refusal body the client cannot read must still be classified. Failing
    /// to parse the envelope is not a reason to forget the status line.
    func testARefusalWithAnUnreadableBodyStillUsesItsStatus() async {
        respond(status: 404, body: "<html>gateway</html>")
        await expectFailure(.familiarNotFound)
    }

    // MARK: - Answers that look successful and are not

    func testATwoHundredThatSaysOkFalseIsNotASuccess() async {
        respond(status: 200, body: #"{"ok":false,"error":"nope","code":"dashboard_unavailable"}"#)
        await expectFailure(.unavailable)
    }

    func testAVersionThisBuildDoesNotUnderstandIsRefused() async {
        respond(status: 200, body: FamiliarDashboardFixtures.successJSON(version: 2))
        await expectFailure(.unsupportedVersion)
    }

    /// A proxy, cache or redirect answering with another Familiar's dashboard
    /// would attribute one Familiar's work to another, with every field
    /// looking perfectly well-formed.
    func testAnAnswerAboutADifferentFamiliarIsRejected() async {
        respond(status: 200, body: FamiliarDashboardFixtures.successJSON(familiarId: "sage"))
        await expectFailure(
            id: "nova", .identityMismatch(requested: "nova", received: "sage"))
    }

    func testAnUnreadableSuccessBodyIsADecodeFailure() async {
        respond(status: 200, body: #"{"ok":true,"version":1}"#)
        do {
            _ = try await client().familiarDashboard(id: "nova")
            XCTFail("expected a decode failure")
        } catch let error as FamiliarDashboardError {
            guard case .decoding = error else {
                return XCTFail("expected .decoding, got \(error)")
            }
        } catch {
            XCTFail("expected a FamiliarDashboardError, got \(error)")
        }
    }

    func testAnUnconfiguredConnectionCannotFormARequest() async {
        let client = CaveClient(connection: CaveConnection(host: ""))
        do {
            _ = try await client.familiarDashboard(id: "nova")
            XCTFail("expected .notConfigured")
        } catch let error as FamiliarDashboardError {
            XCTAssertEqual(error, .notConfigured)
        } catch {
            XCTFail("expected a FamiliarDashboardError, got \(error)")
        }
    }
}
