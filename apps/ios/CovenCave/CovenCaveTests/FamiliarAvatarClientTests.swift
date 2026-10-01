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

private extension URLRequest {
    func capturedBody() throws -> Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }

        stream.open()
        defer { stream.close() }
        var body = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 {
                throw stream.streamError ?? URLError(.cannotDecodeRawData)
            }
            if count == 0 { break }
            body.append(contentsOf: buffer.prefix(count))
        }
        return body
    }
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
            XCTAssertEqual(
                URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.percentEncodedPath,
                "/api/familiars/nova%2Ffamiliar/avatar"
            )
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "image/png")
            XCTAssertNil(request.value(forHTTPHeaderField: "Idempotency-Key"))
            XCTAssertEqual(try request.capturedBody(), image)
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
            id: "nova/familiar",
            imageData: image,
            contentType: "image/png"
        )

        XCTAssertEqual(mutation.avatarUrl, "/api/familiars/nova/avatar?v=42&format=png")
        XCTAssertEqual(mutation.revision, 42)
    }

    func testDeleteUsesIdempotentAvatarContract() async throws {
        FamiliarAvatarURLProtocol.handler = { request in
            XCTAssertEqual(
                URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.percentEncodedPath,
                "/api/familiars/nova%2Ffamiliar/avatar"
            )
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

        let mutation = try await client().deleteFamiliarAvatar(id: "nova/familiar")

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

    // MARK: - Avatar image source and credential boundary (#5714)

    private static let caveHost = "https://cave.example.test"
    private static let fakeCredential = "device-credential"

    private func familiar(avatarUrl: String?) -> Familiar {
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
            avatarUrl: avatarUrl
        )
    }

    private func avatarClient(host: String = caveHost) -> CaveClient {
        CaveClient(connection: CaveConnection(host: host))
    }

    /// The loader's real request for a source: what actually goes on the wire.
    private func wireRequest(for source: CaveImageSource?) throws -> URLRequest {
        try XCTUnwrap(DefaultCaveImageDataLoader.request(for: try XCTUnwrap(source)))
    }

    func testRelativeSameOriginAvatarRequestCarriesTheCredential() throws {
        var lookups: [URL] = []
        let source = avatarClient().familiarAvatarSource(
            for: familiar(avatarUrl: "/api/familiars/nova/avatar?v=42&format=png"),
            credential: { url in
                lookups.append(url)
                return "device-credential"
            }
        )

        let expected = try XCTUnwrap(URL(string: "https://cave.example.test/api/familiars/nova/avatar?v=42&format=png"))
        XCTAssertEqual(source, .authenticatedRemoteURL(expected, bearerToken: "device-credential"))
        XCTAssertEqual(lookups, [expected], "the credential is resolved for the Cave host's own route")

        let request = try wireRequest(for: source)
        XCTAssertEqual(request.url, expected)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(Self.fakeCredential)")
        XCTAssertNil(
            URLComponents(url: expected, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name.localizedCaseInsensitiveContains("token") },
            "the credential travels only in the header, never the URL"
        )
    }

    func testAbsoluteSameOriginAvatarWithDefaultPortCarriesTheCredential() throws {
        let source = avatarClient().familiarAvatarSource(
            for: familiar(avatarUrl: "https://CAVE.example.test:443/api/familiars/nova/avatar"),
            credential: { _ in "device-credential" }
        )

        let request = try wireRequest(for: source)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(Self.fakeCredential)")
    }

    func testForeignAbsoluteAvatarNeverReceivesTheCredential() throws {
        let foreign = [
            "https://cdn.example.org/nova.png",
            // Same host, different port or scheme, is a different origin.
            "https://cave.example.test:8443/api/familiars/nova/avatar",
            "http://cave.example.test/api/familiars/nova/avatar",
            // Lookalike hosts.
            "https://cave.example.test.evil.example/api/familiars/nova/avatar",
            "https://evil.example/cave.example.test/api/familiars/nova/avatar",
            // Protocol-relative paths resolve to another host.
            "//evil.example/api/familiars/nova/avatar",
        ]

        for avatarUrl in foreign {
            let source = avatarClient().familiarAvatarSource(
                for: familiar(avatarUrl: avatarUrl),
                credential: { url in
                    XCTFail("credential looked up for foreign avatar \(url)")
                    return "device-credential"
                }
            )

            guard case .remoteURL = try XCTUnwrap(source, avatarUrl) else {
                XCTFail("\(avatarUrl) must load unauthenticated, got \(String(describing: source))")
                continue
            }
            let request = try wireRequest(for: source)
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"), avatarUrl)
            XCTAssertNil(request.allHTTPHeaderFields?["Authorization"], avatarUrl)
        }
    }

    func testSameOriginAvatarWithoutCredentialLoadsUnauthenticated() throws {
        let source = avatarClient().familiarAvatarSource(
            for: familiar(avatarUrl: "/api/familiars/nova/avatar"),
            credential: { _ in nil }
        )

        let request = try wireRequest(for: source)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }

    func testUnavailableCredentialFallsBackToInitials() {
        let source = avatarClient().familiarAvatarSource(
            for: familiar(avatarUrl: "/api/familiars/nova/avatar"),
            credential: { _ in throw CaveError.credentialOriginMismatch }
        )

        XCTAssertNil(source, "a credential failure shows initials, not an unauthenticated retry")
    }

    func testMissingAvatarHasNoSource() {
        let source = avatarClient().familiarAvatarSource(
            for: familiar(avatarUrl: nil),
            credential: { _ in
                XCTFail("no avatar means no credential lookup")
                return nil
            }
        )

        XCTAssertNil(source)
    }

    // MARK: - Credential snapshot (one Keychain read per credential, not per row)

    func testSnapshotReadsTheCredentialOncePerOriginUntilAKeychainWrite() throws {
        var generation: UInt64 = 7
        var reads = 0
        let cache = CredentialSnapshotCache(
            currentGeneration: { generation },
            resolve: { _ in
                reads += 1
                return "credential-\(reads)"
            }
        )
        let avatar = try XCTUnwrap(URL(string: "https://cave.example.test/api/familiars/nova/avatar"))
        let other = try XCTUnwrap(URL(string: "https://cave.example.test/api/familiars/vale/avatar?v=2"))

        for _ in 0..<50 {
            XCTAssertEqual(try cache.credential(for: avatar), "credential-1")
            XCTAssertEqual(try cache.credential(for: other), "credential-1", "same origin shares one snapshot")
        }
        XCTAssertEqual(reads, 1)

        // Re-pairing (any Keychain write) is seen on the next lookup.
        generation += 1
        XCTAssertEqual(try cache.credential(for: avatar), "credential-2")
        XCTAssertEqual(reads, 2)
    }

    func testSnapshotKeysByOriginAndScheme() throws {
        var resolved: [URL] = []
        let cache = CredentialSnapshotCache(
            currentGeneration: { 0 },
            resolve: { url in
                resolved.append(url)
                return url.absoluteString
            }
        )
        let cave = try XCTUnwrap(URL(string: "https://cave.example.test/a"))
        let otherPort = try XCTUnwrap(URL(string: "https://cave.example.test:8443/a"))
        let loopback = try XCTUnwrap(URL(string: "http://127.0.0.1:3000/a"))

        XCTAssertEqual(try cache.credential(for: cave), cave.absoluteString)
        XCTAssertEqual(try cache.credential(for: otherPort), otherPort.absoluteString)
        XCTAssertEqual(try cache.credential(for: loopback), loopback.absoluteString)
        XCTAssertEqual(resolved, [cave, otherPort, loopback])
    }

    func testSnapshotDoesNotPinMissingOrFailedCredentials() throws {
        var outcome: Result<String?, Error> = .success(nil)
        var reads = 0
        let cache = CredentialSnapshotCache(
            currentGeneration: { 0 },
            resolve: { _ in
                reads += 1
                return try outcome.get()
            }
        )
        let avatar = try XCTUnwrap(URL(string: "https://cave.example.test/api/familiars/nova/avatar"))

        XCTAssertNil(try cache.credential(for: avatar))
        outcome = .failure(CaveError.credentialOriginMismatch)
        XCTAssertThrowsError(try cache.credential(for: avatar))
        outcome = .success("paired")
        XCTAssertEqual(try cache.credential(for: avatar), "paired")
        XCTAssertEqual(try cache.credential(for: avatar), "paired")
        XCTAssertEqual(reads, 3)
    }

    func testSnapshotDropsAValueWrittenDuringTheRead() throws {
        var generation: UInt64 = 0
        var reads = 0
        let cache = CredentialSnapshotCache(
            currentGeneration: { generation },
            resolve: { _ in
                reads += 1
                if reads == 1 { generation += 1 }  // re-paired mid-read
                return "credential-\(reads)"
            }
        )
        let avatar = try XCTUnwrap(URL(string: "https://cave.example.test/api/familiars/nova/avatar"))

        XCTAssertEqual(try cache.credential(for: avatar), "credential-1")
        XCTAssertEqual(try cache.credential(for: avatar), "credential-2", "a racing write is never memoized")
        XCTAssertEqual(try cache.credential(for: avatar), "credential-2")
        XCTAssertEqual(reads, 2)
    }

    func testKeychainWritesAdvanceTheSnapshotGeneration() {
        // Removing an absent item touches no real credential but is still a write.
        let key = "test.familiar-avatar.generation.\(UUID().uuidString)"
        let before = KeychainStore.writeGeneration
        KeychainStore.remove(key)
        let afterFirst = KeychainStore.writeGeneration
        KeychainStore.remove(key)

        XCTAssertGreaterThan(afterFirst, before)
        XCTAssertGreaterThan(KeychainStore.writeGeneration, afterFirst)
    }
}
