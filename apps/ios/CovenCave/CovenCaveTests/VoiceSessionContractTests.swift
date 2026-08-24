import Foundation
import XCTest
@testable import CovenCave

private final class VoiceSessionURLProtocol: URLProtocol {
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

final class VoiceSessionContractTests: XCTestCase {
    override func tearDown() {
        VoiceSessionURLProtocol.handler = nil
        super.tearDown()
    }

    private func client(
        status: Int,
        body: String,
        contentType: String? = "application/json",
        expectedPath: String = "/api/voice/session",
        expectedMethod: String = "POST",
        assertRequest: ((URLRequest) throws -> Void)? = nil
    ) -> CaveClient {
        VoiceSessionURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, expectedPath)
            XCTAssertEqual(request.httpMethod, expectedMethod)
            try assertRequest?(request)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: status,
                    httpVersion: nil,
                    headerFields: contentType.map { ["Content-Type": $0] }
                )
            )
            return (response, Data(body.utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VoiceSessionURLProtocol.self]
        return CaveClient(
            connection: CaveConnection(host: "http://cave.test:3000"),
            session: URLSession(configuration: configuration)
        )
    }

    func testFamiliarDecodesOptionalVoiceConfiguration() throws {
        let configured = try JSONDecoder().decode(
            Familiar.self,
            from: """
            {
              "id": "milo",
              "display_name": "Milo",
              "voiceProvider": "openai",
              "voiceModel": "gpt-realtime",
              "voiceName": "alloy"
            }
            """.data(using: .utf8)!
        )

        XCTAssertEqual(configured.voiceProvider, "openai")
        XCTAssertEqual(configured.voiceModel, "gpt-realtime")
        XCTAssertEqual(configured.voiceName, "alloy")

        let legacy = try JSONDecoder().decode(
            Familiar.self,
            from: #"{"id":"milo","display_name":"Milo"}"#.data(using: .utf8)!
        )

        XCTAssertNil(legacy.voiceProvider)
        XCTAssertNil(legacy.voiceModel)
        XCTAssertNil(legacy.voiceName)
    }

    func testVoiceSessionRequestAndResponseMatchDesktopContract() throws {
        let request = CaveClient.VoiceSessionRequest(familiarId: "milo", sessionId: "sess-42")
        let requestData = try JSONEncoder().encode(request)
        let requestJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(with: requestData) as? [String: String]
        )

        XCTAssertEqual(requestJSON, ["familiarId": "milo", "sessionId": "sess-42"])

        let response = try JSONDecoder().decode(
            CaveClient.VoiceSessionResponse.self,
            from: """
            {
              "ok": true,
              "callId": "01JVOICECALL00000000000000",
              "grant": {
                "provider": "openai",
                "clientSecret": "ek_short_lived",
                "expiresAt": "2026-07-29T18:00:00Z",
                "connection": {
                  "kind": "openai-realtime",
                  "url": "https://api.openai.com/v1/realtime/calls",
                  "model": "gpt-realtime",
                  "voice": "alloy"
                }
              }
            }
            """.data(using: .utf8)!
        )

        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.callId, "01JVOICECALL00000000000000")
        XCTAssertEqual(response.grant?.provider, "openai")
        XCTAssertEqual(response.grant?.clientSecret, "ek_short_lived")
        XCTAssertEqual(response.grant?.connection.kind, "openai-realtime")
        XCTAssertEqual(response.grant?.connection.model, "gpt-realtime")
    }

    func testVoiceSessionResponsePreservesLocalLoopConnectionContext() throws {
        let response = try JSONDecoder().decode(
            CaveClient.VoiceSessionResponse.self,
            from: """
            {
              "ok": true,
              "callId": "01JLOCALLOOP00000000000000",
              "grant": {
                "provider": "local",
                "clientSecret": "local",
                "expiresAt": "2026-07-29T18:00:00Z",
                "connection": {
                  "kind": "local-loop",
                  "model": "llama3.2",
                  "voice": "",
                  "instructions": "Be practical and kind.",
                  "conversationSeed": [
                    { "role": "user", "content": "Review this branch." },
                    { "role": "assistant", "content": "I will inspect the diff." }
                  ]
                }
              }
            }
            """.data(using: .utf8)!
        )

        XCTAssertEqual(response.grant?.connection.instructions, "Be practical and kind.")
        XCTAssertEqual(response.grant?.connection.conversationSeed?.map(\.role), ["user", "assistant"])
        XCTAssertEqual(response.grant?.connection.conversationSeed?.map(\.content), [
            "Review this branch.", "I will inspect the diff.",
        ])
    }

    func testMintVoiceSessionRetainsJSONRouteError() async {
        let client = client(
            status: 400,
            body: #"{"ok":false,"error":"voice_not_configured","hint":"Choose a voice provider."}"#
        )

        do {
            _ = try await client.mintVoiceSession(familiarId: "milo", sessionId: "sess-42")
            XCTFail("expected voice session request to fail")
        } catch let CaveError.transport(message) {
            XCTAssertEqual(message, "voice_not_configured: Choose a voice provider.")
        } catch {
            XCTFail("expected actionable transport error, got \(error)")
        }
    }

    func testMintVoiceSessionUsesBadResponseForNonJSONFailure() async {
        let client = client(status: 502, body: "upstream unavailable", contentType: "text/plain")

        do {
            _ = try await client.mintVoiceSession(familiarId: "milo", sessionId: "sess-42")
            XCTFail("expected voice session request to fail")
        } catch let CaveError.badResponse(status) {
            XCTAssertEqual(status, 502)
        } catch {
            XCTFail("expected bad response error, got \(error)")
        }
    }

    func testStartVoiceConversationUsesProjectRootContract() async throws {
        let client = client(
            status: 200,
            body: #"{"ok":true,"sessionId":"sess-voice"}"#,
            expectedPath: "/api/chat/conversation"
        ) { request in
            let data = try request.bodyDataForTesting()
            let json = try XCTUnwrap(
                JSONSerialization.jsonObject(with: data) as? [String: String]
            )
            XCTAssertEqual(json, [
                "familiarId": "milo",
                "projectRoot": "/repos/cave",
            ])
        }

        let sessionId = try await client.startVoiceConversation(
            familiarId: "milo",
            projectRoot: "/repos/cave"
        )

        XCTAssertEqual(sessionId, "sess-voice")
    }

    func testDiscardVoiceConversationIfEmptyUsesDeleteIfEmptyContract() async throws {
        let client = client(
            status: 200,
            body: #"{"ok":true,"deleted":true}"#,
            expectedPath: "/api/chat/conversation/sess-voice",
            expectedMethod: "DELETE"
        ) { request in
            XCTAssertEqual(request.url?.query, "ifEmpty=1")
        }

        let deleted = try await client.discardVoiceConversationIfEmpty(sessionId: "sess-voice")

        XCTAssertTrue(deleted)
    }

    func testDiscardVoiceConversationIfEmptyPreservesDeletedFalse() async throws {
        let client = client(
            status: 200,
            body: #"{"ok":true,"deleted":false}"#,
            expectedPath: "/api/chat/conversation/sess-voice",
            expectedMethod: "DELETE"
        ) { request in
            XCTAssertEqual(request.url?.query, "ifEmpty=1")
        }

        let deleted = try await client.discardVoiceConversationIfEmpty(sessionId: "sess-voice")

        XCTAssertFalse(deleted)
    }

    func testStartVoiceConversationPreservesProjectSelectionFailures() async {
        let client = client(
            status: 403,
            body: """
            {
              "ok": false,
              "error": "project_access_denied",
              "code": "project_access_denied",
              "message": "Choose a project this familiar can access before starting a voice call."
            }
            """,
            expectedPath: "/api/chat/conversation"
        )

        do {
            _ = try await client.startVoiceConversation(
                familiarId: "milo",
                projectRoot: "/repos/cave"
            )
            XCTFail("expected voice conversation start to fail")
        } catch let CaveError.serverResponse(status, code, message) {
            XCTAssertEqual(status, 403)
            XCTAssertEqual(code, "project_access_denied")
            XCTAssertEqual(
                message,
                "Choose a project this familiar can access before starting a voice call."
            )
        } catch {
            XCTFail("expected structured server response, got \(error)")
        }
    }
}
