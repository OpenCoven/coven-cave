import Foundation
import WebRTC

enum OpenAIRealtimeTransportError: LocalizedError {
    case missingGrant
    case invalidConnectionURL
    case signalingFailed(Int)
    case emptyAnswer

    var errorDescription: String? {
        switch self {
        case .missingGrant: "realtime_grant_missing"
        case .invalidConnectionURL: "realtime_connection_url_invalid"
        case .signalingFailed(let status): "realtime_signaling_failed_\(status)"
        case .emptyAnswer: "realtime_empty_sdp_answer"
        }
    }
}

/// Native OpenAI Realtime WebRTC transport. Signaling uses the provider URL
/// and short-lived client secret returned by Cave's `/api/voice/session`; this
/// class has no knowledge of, or path to, the desktop vault credential.
@MainActor
final class OpenAIRealtimeTransport: NSObject, VoiceCallTransport {
    var onEvent: (@MainActor (VoiceCallEvent) -> Void)?

    private let factory = RTCPeerConnectionFactory()
    private let urlSession: URLSession
    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    private var localAudioSource: RTCAudioSource?
    private var localAudioTrack: RTCAudioTrack?
    private var decoder = OpenAIRealtimeEventDecoder()
    private var stopped = false

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
        super.init()
    }

    func start(with context: VoiceCallTransportContext) async throws {
        guard !stopped else { return }
        guard let grant = context.grant, grant.provider == "openai" else {
            throw OpenAIRealtimeTransportError.missingGrant
        }
        guard let endpoint = grant.connection.url, let url = URL(string: endpoint) else {
            throw OpenAIRealtimeTransportError.invalidConnectionURL
        }

        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil,
                                              optionalConstraints: ["DtlsSrtpKeyAgreement": "true"])
        guard let connection = factory.peerConnection(with: configuration, constraints: constraints, delegate: self) else {
            throw OpenAIRealtimeTransportError.emptyAnswer
        }
        peerConnection = connection

        let source = factory.audioSource(with: constraints)
        localAudioSource = source
        let audioTrack = factory.audioTrack(with: source, trackId: "coven-microphone")
        localAudioTrack = audioTrack
        _ = connection.add(audioTrack, streamIds: ["coven-voice"])

        let channel = connection.dataChannel(forLabel: "oai-events", configuration: RTCDataChannelConfiguration())
        channel?.delegate = self
        dataChannel = channel

        let offer = try await createOffer(connection: connection, constraints: constraints)
        try await setLocalDescription(offer, on: connection)
        let answerSDP = try await sendOffer(offer.sdp, to: url, clientSecret: grant.clientSecret)
        guard !answerSDP.isEmpty else { throw OpenAIRealtimeTransportError.emptyAnswer }
        try await setRemoteDescription(RTCSessionDescription(type: .answer, sdp: answerSDP), on: connection)
        guard !stopped else { return }
        onEvent?(.connected)
    }

    func setMuted(_ muted: Bool) {
        localAudioTrack?.isEnabled = !muted
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        dataChannel?.delegate = nil
        dataChannel?.close()
        dataChannel = nil
        localAudioTrack?.isEnabled = false
        localAudioTrack = nil
        localAudioSource = nil
        peerConnection?.close()
        peerConnection = nil
    }

    private func createOffer(connection: RTCPeerConnection, constraints: RTCMediaConstraints) async throws -> RTCSessionDescription {
        try await withCheckedThrowingContinuation { continuation in
            connection.offer(for: constraints) { description, error in
                if let error { continuation.resume(throwing: error) }
                else if let description { continuation.resume(returning: description) }
                else { continuation.resume(throwing: OpenAIRealtimeTransportError.emptyAnswer) }
            }
        }
    }

    private func setLocalDescription(_ description: RTCSessionDescription, on connection: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { continuation in
            connection.setLocalDescription(description) { error in
                error.map { continuation.resume(throwing: $0) } ?? continuation.resume()
            }
        }
    }

    private func setRemoteDescription(_ description: RTCSessionDescription, on connection: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { continuation in
            connection.setRemoteDescription(description) { error in
                error.map { continuation.resume(throwing: $0) } ?? continuation.resume()
            }
        }
    }

    private func sendOffer(_ sdp: String, to url: URL, clientSecret: String) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = Data(sdp.utf8)
        request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        request.setValue("application/sdp", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(clientSecret)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw OpenAIRealtimeTransportError.signalingFailed((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return String(decoding: data, as: UTF8.self)
    }
}

extension OpenAIRealtimeTransport: RTCPeerConnectionDelegate {
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        guard newState == .failed || newState == .closed else { return }
        Task { @MainActor [weak self] in self?.onEvent?(.failed("realtime_ice_\(newState.rawValue)")) }
    }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        Task { @MainActor [weak self] in
            guard let self, !self.stopped else { return }
            dataChannel.delegate = self
        }
    }
}

extension OpenAIRealtimeTransport: RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {}

    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard !buffer.isBinary else { return }
        Task { @MainActor [weak self] in
            guard let self, !self.stopped else { return }
            do {
                if let event = try self.decoder.decode(data: buffer.data) { self.onEvent?(event) }
            } catch {
                self.onEvent?(.failed("realtime_event_decode_failed"))
            }
        }
    }
}
