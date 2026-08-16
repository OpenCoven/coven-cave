import Foundation
import XCTest
@testable import CovenCave

private final class CaveClientRetryURLProtocol: URLProtocol {
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

private final class CaveClientHangingURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {}
    override func stopLoading() {}
}

final class CaveClientRetryTests: XCTestCase {
    override func tearDown() {
        CaveClientRetryURLProtocol.handler = nil
        super.tearDown()
    }

    private func client() -> CaveClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CaveClientRetryURLProtocol.self]
        return CaveClient(
            connection: CaveConnection(host: "http://cave.test:3000"),
            session: URLSession(configuration: configuration)
        )
    }

    private func response(for request: URLRequest, status: Int = 200) throws -> HTTPURLResponse {
        try XCTUnwrap(
            HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: status,
                httpVersion: nil,
                headerFields: nil
            )
        )
    }

    func testDeleteRetriesTransientFailureAndAcceptsAlreadyDeletedResource() async throws {
        var attempts = 0
        CaveClientRetryURLProtocol.handler = { [self] request in
            attempts += 1
            XCTAssertEqual(request.httpMethod, "DELETE")
            if attempts == 1 {
                throw URLError(.networkConnectionLost)
            }
            return (try response(for: request, status: 404), Data())
        }

        try await client().deleteTask(cardId: "task-42")

        XCTAssertEqual(attempts, 2)
    }

    func testPatchRetriesTransientFailure() async throws {
        var attempts = 0
        CaveClientRetryURLProtocol.handler = { [self] request in
            attempts += 1
            if attempts == 1 {
                throw URLError(.notConnectedToInternet)
            }
            return (try response(for: request), Data())
        }
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://cave.test:3000/api/board/task-42")))
        request.httpMethod = "PATCH"

        _ = try await client().data(for: request, retryingIdempotentMutation: true)

        XCTAssertEqual(attempts, 2)
    }

    func testPostWithoutIdempotencyKeyDoesNotRetry() async throws {
        var attempts = 0
        CaveClientRetryURLProtocol.handler = { _ in
            attempts += 1
            throw URLError(.networkConnectionLost)
        }
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://cave.test:3000/api/inbox")))
        request.httpMethod = "POST"

        do {
            _ = try await client().data(for: request)
            XCTFail("Expected the transport error to propagate")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .networkConnectionLost)
        }

        XCTAssertEqual(attempts, 1)
    }

    func testMutationWithoutExplicitOptInDoesNotRetry() async throws {
        var attempts = 0
        CaveClientRetryURLProtocol.handler = { _ in
            attempts += 1
            throw URLError(.networkConnectionLost)
        }
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://cave.test:3000/api/example")))
        request.httpMethod = "PATCH"

        do {
            _ = try await client().data(for: request)
            XCTFail("Expected the transport error to propagate")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .networkConnectionLost)
        }

        XCTAssertEqual(attempts, 1)
    }

    func testIdempotencyKeyAllowsPostRetry() async throws {
        var attempts = 0
        CaveClientRetryURLProtocol.handler = { [self] request in
            attempts += 1
            if attempts == 1 {
                throw URLError(.timedOut)
            }
            return (try response(for: request), Data())
        }
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://cave.test:3000/api/example")))
        request.httpMethod = "POST"
        request.setValue("stable-operation-42", forHTTPHeaderField: "Idempotency-Key")

        _ = try await client().data(for: request)

        XCTAssertEqual(attempts, 2)
    }

    func testIdempotentMutationRetriesAreBounded() async throws {
        var attempts = 0
        CaveClientRetryURLProtocol.handler = { _ in
            attempts += 1
            throw URLError(.cannotConnectToHost)
        }
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://cave.test:3000/api/board/task-42")))
        request.httpMethod = "DELETE"

        do {
            _ = try await client().data(for: request, retryingIdempotentMutation: true)
            XCTFail("Expected the transport error to propagate")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .cannotConnectToHost)
        }

        XCTAssertEqual(attempts, 4)
    }

    func testNonTransientMutationFailureDoesNotRetry() async throws {
        var attempts = 0
        CaveClientRetryURLProtocol.handler = { _ in
            attempts += 1
            throw URLError(.badURL)
        }
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://cave.test:3000/api/board/task-42")))
        request.httpMethod = "PATCH"

        do {
            _ = try await client().data(for: request, retryingIdempotentMutation: true)
            XCTFail("Expected the transport error to propagate")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .badURL)
        }

        XCTAssertEqual(attempts, 1)
    }

    func testMutationRetryBudgetMatchesTheExistingRequestTimeout() {
        XCTAssertEqual(CaveClient.defaultIdempotentMutationRetryBudget, .seconds(20))
    }

    func testMutationRetryBudgetCancelsARequestThatNeverCompletes() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CaveClientHangingURLProtocol.self]
        let client = CaveClient(
            connection: CaveConnection(host: "http://cave.test:3000"),
            session: URLSession(configuration: configuration),
            idempotentMutationRetryBudget: .milliseconds(100)
        )
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://cave.test:3000/api/board/task-42")))
        request.httpMethod = "DELETE"
        let clock = ContinuousClock()
        let startedAt = clock.now

        do {
            _ = try await client.data(for: request, retryingIdempotentMutation: true)
            XCTFail("Expected the request budget to expire")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .timedOut)
        }

        XCTAssertLessThan(startedAt.duration(to: clock.now), .seconds(1))
    }
}
