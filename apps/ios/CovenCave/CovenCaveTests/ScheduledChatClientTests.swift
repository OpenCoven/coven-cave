import Foundation
import XCTest
@testable import CovenCave

private final class ScheduledChatURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
final class ScheduledChatClientTests: XCTestCase {
    override func tearDown() { ScheduledChatURLProtocol.handler = nil; super.tearDown() }
    func testScheduleUsesStableIDAndPreservesSendContext() async throws {
        let message = CaveClient.SendBody(familiarId: "sage", prompt: "Tomorrow", sessionId: "chat-1", projectRoot: "/project", modelOverride: "model-a", modelOverrideScope: .nextMessage)
        let request = CaveClient.ScheduledReplyRequest(id: "stable-id", sendAt: "2026-10-13T15:00:00Z", message: message)
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        XCTAssertEqual(encoded["id"] as? String, "stable-id")
        let body = try XCTUnwrap(encoded["message"] as? [String: Any])
        XCTAssertEqual(body["sessionId"] as? String, "chat-1")
        XCTAssertEqual(body["modelOverride"] as? String, "model-a")
        ScheduledChatURLProtocol.handler = { req in
            XCTAssertEqual(req.url?.path, "/api/chat/scheduled")
            XCTAssertEqual(req.httpMethod, "POST")
            return (try XCTUnwrap(HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data("{\"ok\":true,\"item\":{\"status\":\"scheduled\"}}".utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ScheduledChatURLProtocol.self]
        let client = CaveClient(connection: CaveConnection(host: "http://cave.test:3000"), session: URLSession(configuration: configuration))
        try await client.scheduleReply(request)
    }
    func testCancelledReceiptIsNotReportedAsScheduled() async throws {
        ScheduledChatURLProtocol.handler = { req in
            return (try XCTUnwrap(HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)),
                Data("{\"ok\":true,\"item\":{\"status\":\"cancelled\"}}".utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ScheduledChatURLProtocol.self]
        let client = CaveClient(connection: CaveConnection(host: "http://cave.test:3000"), session: URLSession(configuration: configuration))
        do {
            try await client.scheduleReply(.init(id: "cancelled", sendAt: "2026-10-13T15:00:00Z", message: .init(familiarId: "sage", prompt: "Later", sessionId: "chat-1")))
            XCTFail("A cancelled receipt must not clear the draft")
        } catch { XCTAssertTrue(error.localizedDescription.contains("cancelled")) }
    }
    func testCancelSurfacesAlreadyStartedConflict() async throws {
        ScheduledChatURLProtocol.handler = { req in
            XCTAssertEqual(req.httpMethod, "DELETE")
            XCTAssertTrue(req.url!.absoluteString.contains("sessionId=chat-1"))
            return (try XCTUnwrap(HTTPURLResponse(url: req.url!, statusCode: 409, httpVersion: nil, headerFields: nil)), Data("{\"ok\":false,\"error\":\"Delivery has already started\"}".utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ScheduledChatURLProtocol.self]
        let client = CaveClient(connection: CaveConnection(host: "http://cave.test:3000"), session: URLSession(configuration: configuration))
        do { try await client.cancelScheduledReply(id: "stable-id", sessionId: "chat-1"); XCTFail("Conflict was ignored") }
        catch { XCTAssertTrue(error.localizedDescription.contains("Delivery has already started")) }
    }
}
