import Foundation

struct LiveBriefService: BriefServing {
    private struct RequestBody: Encodable {
        let question: String
        let audience: String
        let depth: String
    }

    private struct ErrorBody: Decodable {
        let code: String?
    }

    private let endpoint: URL
    private let credentialStore: CredentialStoring
    private let session: URLSession
    private let decoder: StrictBriefDecoder

    init(
        endpoint: URL = URL(string: "https://salem.opencoven.ai/api/brief")!,
        credentialStore: CredentialStoring = KeychainCredentialStore(),
        session: URLSession = .shared,
        decoder: StrictBriefDecoder = StrictBriefDecoder()
    ) {
        self.endpoint = endpoint
        self.credentialStore = credentialStore
        self.session = session
        self.decoder = decoder
    }

    func answer(
        question: String,
        audience: AnswerAudience,
        depth: AnswerDepth
    ) async throws -> BriefResponse {
        guard let token = try credentialStore.readToken(), !token.isEmpty else {
            throw BriefServiceError.unauthorized
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(
            RequestBody(question: question, audience: audience.rawValue, depth: depth.rawValue)
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            switch error.code {
            case .timedOut:
                throw BriefServiceError.timedOut
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
                throw BriefServiceError.offline
            default:
                throw BriefServiceError.serviceUnavailable
            }
        }

        guard let http = response as? HTTPURLResponse else {
            throw BriefServiceError.invalidResponse
        }

        switch http.statusCode {
        case 200:
            do {
                return try decoder.decode(data)
            } catch {
                throw BriefServiceError.invalidResponse
            }
        case 401:
            let code = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.code
            if code == "BRIEF_AUTH_REVOKED" { throw BriefServiceError.revoked }
            throw BriefServiceError.unauthorized
        case 429:
            throw BriefServiceError.rateLimited
        case 502:
            let code = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.code
            if code == "MODEL_UNAVAILABLE" { throw BriefServiceError.modelUnavailable }
            throw BriefServiceError.serviceUnavailable
        case 503:
            throw BriefServiceError.serviceUnavailable
        default:
            throw BriefServiceError.failed
        }
    }
}
