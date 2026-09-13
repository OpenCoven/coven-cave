import Foundation

enum DeviceAccessStatus: String, Codable, Sendable {
    case pending, allowed, denied, revoked, expired

    var message: String {
        switch self {
        case .pending: return "Awaiting desktop approval. Open Settings → Phone on your desktop and allow this request."
        case .allowed: return "Desktop access allowed."
        case .denied: return "The desktop denied this request. Request access again to ask for approval."
        case .revoked: return "Desktop access was revoked or is no longer allowed. Request access again on your Tailscale network."
        case .expired: return "This request expired. Request access again and approve it on the desktop within five minutes."
        }
    }
}

struct DeviceAccessDevice: Codable, Equatable, Sendable {
    struct Peer: Codable, Equatable, Sendable {
        let tailnet: String
        let nodeId: String
        let userId: String
        let loginName: String
        let deviceName: String
    }

    let id: String
    var status: DeviceAccessStatus
    let peer: Peer
    let createdAt: Date
    let pairingExpiresAt: Date

    var verificationCode: String { String(id.suffix(8)) }
}

struct DeviceAccessResponse: Decodable {
    let ok: Bool
    let device: DeviceAccessDevice
    let credential: String?

    static func decode(_ data: Data, creating: Bool) throws -> Self {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let milliseconds = try? container.decode(Double.self), milliseconds.isFinite {
                return Date(timeIntervalSince1970: milliseconds / 1000)
            }
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: value) else {
                throw DeviceAccessError.invalidResponse
            }
            return date
        }
        // Never surface decoder diagnostics: a malformed response can contain a secret.
        let result: Self
        do { result = try decoder.decode(Self.self, from: data) }
        catch { throw DeviceAccessError.invalidResponse }
        guard result.ok, UUID(uuidString: result.device.id) != nil else {
            throw DeviceAccessError.invalidResponse
        }
        if creating {
            guard result.device.status == .pending,
                  let credential = result.credential,
                  CaveConnection.isManagedDeviceCredential(credential),
                  credential.split(separator: ".").count == 3,
                  credential.split(separator: ".")[1].lowercased() == result.device.id.lowercased(),
                  result.device.pairingExpiresAt > result.device.createdAt
            else { throw DeviceAccessError.invalidResponse }
        }
        return result
    }
}

enum DeviceAccessError: LocalizedError, Equatable {
    case secureTailnetRequired, legacyDesktop, disabled, invalidResponse, refused(Int), storage

    var errorDescription: String? {
        switch self {
        case .secureTailnetRequired:
            return "Request access requires the desktop's HTTPS Tailscale Serve address."
        case .legacyDesktop:
            return "This desktop does not support access requests. Scan its QR code or paste its invite link instead."
        case .disabled:
            return "Desktop approval isn't enabled. Scan the desktop's legacy QR code or paste its invite link instead."
        case .invalidResponse:
            return "The desktop returned an invalid access response. Retry or update the desktop."
        case .refused(let status):
            return "The desktop refused the access request (HTTP \(status)). Check its Tailscale access settings."
        case .storage:
            return "Couldn't save device access securely. Unlock this iPhone and retry."
        }
    }
}

struct PendingDeviceAccess: Codable, Equatable, Sendable {
    let origin: String
    let credential: String
    var device: DeviceAccessDevice
}

enum DeviceAccessStore {
    static let pendingKey = "cave.device-access.pending"
    static let activeKey = "cave.device-access.active"
    static let installationKey = "cave.device-access.installation-id"

    static func installationID(defaults: UserDefaults = .standard) -> String {
        if let value = defaults.string(forKey: installationKey), UUID(uuidString: value) != nil {
            return value
        }
        let value = UUID().uuidString
        defaults.set(value, forKey: installationKey)
        return value
    }

    static func load() throws -> PendingDeviceAccess? {
        try load(key: pendingKey)
    }

    static func loadActive() throws -> PendingDeviceAccess? {
        try load(key: activeKey)
    }

    private static func load(key: String) throws -> PendingDeviceAccess? {
        guard let value = try KeychainStore.deviceAccessString(forKey: key) else { return nil }
        do { return try JSONDecoder().decode(PendingDeviceAccess.self, from: Data(value.utf8)) }
        catch { throw DeviceAccessError.storage }
    }

    static func save(_ pending: PendingDeviceAccess) throws {
        let data = try JSONEncoder().encode(pending)
        try KeychainStore.setDeviceAccess(String(decoding: data, as: UTF8.self), forKey: pendingKey)
    }

    static func activate(credential: String, baseURL: URL) throws {
        guard let pending = try load(),
              pending.device.status == .allowed,
              pending.credential == credential,
              pending.origin == (try DeviceAccessClient.origin(for: baseURL))
        else { throw DeviceAccessError.invalidResponse }
        let data = try JSONEncoder().encode(pending)
        // Origin and credential are one atomic Keychain item.
        try KeychainStore.setDeviceAccess(String(decoding: data, as: UTF8.self), forKey: activeKey)
    }
}

/// Managed credentials never follow redirects, including same-host port changes.
/// Legacy requests retain their existing URLSession behavior.
final class DeviceAccessRedirectGuard: NSObject, URLSessionTaskDelegate, Sendable {
    static let shared = DeviceAccessRedirectGuard()

    static func permitsRedirect(for original: URLRequest?) -> Bool {
        guard let original else { return false }
        if original.url?.path.hasPrefix("/api/device-access/") == true { return false }
        return original.value(forHTTPHeaderField: "Authorization")?
            .hasPrefix("Bearer cave-device-v1.") != true
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(Self.permitsRedirect(for: task.originalRequest) ? request : nil)
    }
}

struct DeviceAccessClient {
    let baseURL: URL
    var session: URLSession = sharedSession

    private static let sharedSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 15
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    static func origin(for url: URL) throws -> String {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased().hasSuffix(".ts.net") == true,
              url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/",
              let origin = CaveConnection.credentialOrigin(for: url)
        else { throw DeviceAccessError.secureTailnetRequired }
        return origin
    }

    static func isManagedResponse(_ response: HTTPURLResponse) -> Bool {
        response.value(forHTTPHeaderField: "x-coven-device-pairing") == "1"
    }

    /// A managed QR contains only the published origin and /connect, not a
    /// credential. Keep it separate from legacy invite parsing, which drops paths.
    static func handoffOrigin(_ input: String) -> URL? {
        guard var components = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.path == "/connect" || components.path == "/connect/",
              components.query == nil, components.fragment == nil else { return nil }
        components.path = ""
        guard let url = components.url, (try? origin(for: url)) != nil else { return nil }
        return url
    }

    func request(installationID: String, label: String) async throws -> PendingDeviceAccess {
        struct Body: Encodable { let installationId: String; let label: String }
        let origin = try Self.origin(for: baseURL)
        var request = URLRequest(url: baseURL.appendingPathComponent("api/device-access/requests"))
        request.httpMethod = "POST"
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(installationId: installationID, label: label))
        let response = try await send(request, creating: true)
        guard let credential = response.credential else { throw DeviceAccessError.invalidResponse }
        return PendingDeviceAccess(origin: origin, credential: credential, device: response.device)
    }

    func status(_ pending: PendingDeviceAccess) async throws -> DeviceAccessDevice {
        guard try Self.origin(for: baseURL) == pending.origin else {
            throw CaveError.credentialOriginMismatch
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/device-access/status"))
        request.setValue("Bearer \(pending.credential)", forHTTPHeaderField: "Authorization")
        let response = try await send(request, creating: false)
        guard response.device.id == pending.device.id else { throw DeviceAccessError.invalidResponse }
        return response.device
    }

    private func send(_ request: URLRequest, creating: Bool) async throws -> DeviceAccessResponse {
        let (data, response) = try await session.data(for: request, delegate: DeviceAccessRedirectGuard.shared)
        guard let http = response as? HTTPURLResponse else { throw DeviceAccessError.invalidResponse }
        if http.statusCode == 404 { throw DeviceAccessError.legacyDesktop }
        guard http.statusCode == (creating ? 201 : 200) else {
            struct Refusal: Decodable { let ok: Bool; let error: String }
            if creating, http.statusCode >= 400,
               let refusal = try? JSONDecoder().decode(Refusal.self, from: data),
               !refusal.ok, refusal.error == "disabled" {
                throw DeviceAccessError.disabled
            }
            throw DeviceAccessError.refused(http.statusCode)
        }
        return try DeviceAccessResponse.decode(data, creating: creating)
    }
}
