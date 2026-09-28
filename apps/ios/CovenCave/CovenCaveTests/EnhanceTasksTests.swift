import Foundation
import XCTest
@testable import CovenCave

private final class EnhanceTasksURLProtocol: URLProtocol {
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

final class EnhanceTasksTests: XCTestCase {
    override func tearDown() {
        EnhanceTasksURLProtocol.handler = nil
        super.tearDown()
    }

    private func client() -> CaveClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [EnhanceTasksURLProtocol.self]
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
                headerFields: ["Content-Type": "application/x-ndjson"]
            )
        )
    }

    private func bodyJSON(_ request: URLRequest) throws -> [String: Any] {
        let data = try request.bodyDataForTesting()
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // Every task the run considered is accounted for, and the summary matches
    // the web app's wording (minus its "open Tasks" pointer).
    func testTallyAccountsForEveryTask() {
        var tally = EnhanceTasksTally()
        let events: [EnhanceTasksEvent] = [
            .init(kind: "start", total: 5),
            .init(kind: "progress", cardId: "a", title: "A"),
            .init(kind: "done", cardId: "a", closed: false),
            .init(kind: "done", cardId: "b", closed: true),
            .init(kind: "skip", cardId: "c", reason: "unassigned"),
            .init(kind: "skip", cardId: "d", reason: "harness:openclaw"),
            .init(kind: "orchestration", cardId: "a"),
            .init(kind: "skip", cardId: "e", reason: "error"),
            .init(kind: "complete"),
        ]
        events.forEach { tally.apply($0) }
        XCTAssertEqual(tally.total, 5)
        XCTAssertEqual(tally.updated, 2)
        XCTAssertEqual(tally.closed, 1)
        XCTAssertEqual(tally.unassigned, 1)
        XCTAssertEqual(tally.skipped, 2)
        XCTAssertEqual(tally.reached, 5)
        XCTAssertTrue(tally.completed)
        XCTAssertEqual(tally.summary, "Reviewed 5 open tasks: 2 updated (1 closed), 1 unassigned, 2 skipped.")
    }

    func testSummaryCoversEmptyAndCutShortRuns() {
        var empty = EnhanceTasksTally()
        empty.apply(.init(kind: "start", total: 0))
        XCTAssertEqual(empty.summary, "No open tasks to enhance right now.")

        var cut = EnhanceTasksTally()
        cut.apply(.init(kind: "start", total: 3))
        cut.apply(.init(kind: "done", cardId: "a", closed: false))
        XCTAssertEqual(cut.summary, "Reviewed 3 open tasks: 1 updated, 2 not reached.")

        var one = EnhanceTasksTally()
        one.apply(.init(kind: "start", total: 1))
        one.apply(.init(kind: "done", cardId: "a", closed: true))
        XCTAssertEqual(one.summary, "Reviewed 1 open task: 1 updated (1 closed).")
    }

    // The client posts the all-tasks intent the server gates on, and decodes
    // the NDJSON stream line by line, skipping blank and malformed lines.
    func testEnhanceTasksPostsAllScopeAndDecodesNDJSON() async throws {
        EnhanceTasksURLProtocol.handler = { [self] request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/board/enrich-steps")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-coven-cave-intent"), "board-enrich-steps")
            let body = try bodyJSON(request)
            XCTAssertEqual(body["intent"] as? String, "board-enrich-steps")
            XCTAssertEqual(body["scope"] as? String, "all")
            XCTAssertNil(body["cardIds"], "an all-tasks run must not narrow to named cards")
            let lines = [
                #"{"kind":"start","total":2}"#,
                "",
                #"{"kind":"progress","cardId":"a","title":"A"}"#,
                "not json",
                #"{"kind":"done","cardId":"a","count":3,"closed":true}"#,
                #"{"kind":"skip","cardId":"b","reason":"unassigned"}"#,
                #"{"kind":"complete"}"#,
            ]
            return (try response(for: request), Data((lines.joined(separator: "\n") + "\n").utf8))
        }

        var kinds: [String] = []
        var tally = EnhanceTasksTally()
        for try await event in client().enhanceTasks() {
            kinds.append(event.kind)
            tally.apply(event)
        }
        XCTAssertEqual(kinds, ["start", "progress", "done", "skip", "complete"])
        XCTAssertEqual(tally.updated, 1)
        XCTAssertEqual(tally.closed, 1)
        XCTAssertEqual(tally.unassigned, 1)
        XCTAssertTrue(tally.completed)
    }

    func testEnhanceTasksSurfacesServerRefusal() async throws {
        EnhanceTasksURLProtocol.handler = { [self] request in
            (try response(for: request, status: 403), Data(#"{"ok":false,"error":"missing enrich intent"}"#.utf8))
        }
        do {
            for try await _ in client().enhanceTasks() {}
            XCTFail("a refused sweep must throw")
        } catch CaveError.serverResponse(let status, _, let message) {
            // The refusal surfaces as the server's own error, never as an
            // empty, successful run.
            XCTAssertEqual(status, 403)
            XCTAssertEqual(message, "missing enrich intent")
        }
    }
}
