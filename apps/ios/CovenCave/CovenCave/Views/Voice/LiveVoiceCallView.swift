import SwiftUI
import UIKit

/// The live voice-call surface. Owns a `LiveVoiceCallModel` and renders from
/// the engine's published `VoiceCallState`: identity, phase, live transcript,
/// mute, and end-call, plus actionable recovery for every terminal/error phase
/// and the on-device fallback offer.
struct LiveVoiceCallView: View {
    @Environment(\.chrome) private var chrome
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    @State private var model: LiveVoiceCallModel

    init(familiar: Familiar, sessionId: String, client: CaveClient?) {
        _model = State(initialValue: LiveVoiceCallModel(
            familiar: familiar, sessionId: sessionId, client: client
        ))
    }

    var body: some View {
        ZStack {
            chrome.bgBase.ignoresSafeArea()
            VStack(spacing: 20) {
                header
                Divider().overlay(chrome.border)
                content
            }
            .padding(20)
        }
        .task { await model.start() }
        .onChange(of: model.state.phase) { _, phase in
            if phase == .ended { dismiss() }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            AvatarView(familiar: model.familiar,
                       url: model.familiar.avatarUrl.flatMap(URL.init(string:)),
                       size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(model.familiar.displayName)
                    .font(.headline)
                    .foregroundStyle(chrome.textPrimary)
                Text(VoiceCallCopy.modeLabel(model.activeMode))
                    .font(.subheadline)
                    .foregroundStyle(chrome.textSecondary)
            }
            Spacer()
            Button {
                Haptics.tap()
                model.end()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(chrome.textSecondary)
                    .frame(width: 36, height: 36)
                    .background(chrome.bgRaised, in: Circle())
            }
            .accessibilityLabel("Close voice call")
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Content routing

    @ViewBuilder private var content: some View {
        switch model.launch {
        case .idle, .minting:
            connecting(VoiceCallCopy.mintingStatus)
        case .unavailable(let copy):
            errorCard(copy)
        case .fallbackOffer(let copy):
            errorCard(copy)
        case .live:
            liveContent
        }
    }

    @ViewBuilder private var liveContent: some View {
        if case .error(let code) = model.state.phase {
            errorCard(VoiceCallCopy.error(for: code, mode: model.activeMode))
        } else {
            VStack(spacing: 20) {
                statusHeader
                transcript
                controls
            }
        }
    }

    // MARK: - Status

    private var statusHeader: some View {
        let copy = VoiceCallCopy.status(for: model.state.phase, mode: model.activeMode)
        return VStack(spacing: 6) {
            HStack(spacing: 8) {
                phaseIndicator
                Text(copy.label)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
            }
            if let detail = copy.detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(chrome.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel([copy.label, copy.detail].compactMap { $0 }.joined(separator: ". "))
    }

    private var phaseIndicator: some View {
        Circle()
            .fill(chrome.accent)
            .frame(width: 10, height: 10)
            .opacity(model.state.isAudioActive ? 1 : 0.4)
            .scaleEffect(pulse ? 1.35 : 1)
            .animation(
                reduceMotion || !model.state.isAudioActive
                    ? nil
                    : .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                value: pulse
            )
            .onAppear { pulse = true }
            .accessibilityHidden(true)
    }

    @State private var pulse = false

    private func connecting(_ copy: VoiceCallStatusCopy) -> some View {
        VStack(spacing: 14) {
            Spacer()
            ProgressView()
                .controlSize(.large)
                .tint(chrome.accent)
            Text(copy.label)
                .font(.title3.weight(.semibold))
                .foregroundStyle(chrome.textPrimary)
            if let detail = copy.detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(chrome.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if model.state.transcript.isEmpty {
                        Text("The conversation will appear here as you talk.")
                            .font(.subheadline)
                            .foregroundStyle(chrome.textMuted)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 24)
                    }
                    ForEach(model.state.transcript) { row in
                        transcriptRow(row).id(row.id)
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: model.state.transcript.last?.id) { _, id in
                guard let id else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                    proxy.scrollTo(id, anchor: .bottom)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func transcriptRow(_ row: VoiceTranscriptRow) -> some View {
        let isUser = row.role == .user
        let speaker = isUser ? "You" : model.familiar.displayName
        return VStack(alignment: isUser ? .trailing : .leading, spacing: 3) {
            Text(speaker.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(chrome.textMuted)
            Text(row.text)
                .font(.body)
                .foregroundStyle(row.isFinal ? chrome.textPrimary : chrome.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isUser ? chrome.accent.opacity(0.16) : chrome.bgRaised,
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(speaker): \(row.text)")
    }

    // MARK: - Controls

    private var controls: some View {
        HStack(spacing: 16) {
            Button {
                Haptics.tap()
                model.toggleMute()
            } label: {
                controlLabel(
                    systemName: model.isMuted ? "mic.slash.fill" : "mic.fill",
                    title: model.isMuted ? "Unmute" : "Mute",
                    tint: model.isMuted ? chrome.textSecondary : chrome.accent,
                    fill: chrome.bgRaised
                )
            }
            .disabled(model.state.phase.isTerminal)
            .accessibilityLabel(model.isMuted ? "Unmute microphone" : "Mute microphone")
            .accessibilityValue(model.isMuted ? "Muted" : "On")

            Button {
                Haptics.tap()
                model.end()
                dismiss()
            } label: {
                controlLabel(
                    systemName: "phone.down.fill",
                    title: "End",
                    tint: .white,
                    fill: .red
                )
            }
            .accessibilityLabel("End call")
        }
        .frame(maxWidth: .infinity)
    }

    private func controlLabel(systemName: String, title: String,
                              tint: Color, fill: Color) -> some View {
        VStack(spacing: 6) {
            Image(systemName: systemName)
                .font(.title2)
                .foregroundStyle(tint)
                .frame(width: 60, height: 60)
                .background(fill, in: Circle())
            Text(title)
                .font(.caption)
                .foregroundStyle(chrome.textSecondary)
        }
    }

    // MARK: - Error / fallback

    private func errorCard(_ copy: VoiceCallErrorCopy) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .foregroundStyle(chrome.accent)
                .accessibilityHidden(true)
            Text(copy.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(chrome.textPrimary)
                .multilineTextAlignment(.center)
            Text(copy.message)
                .font(.subheadline)
                .foregroundStyle(chrome.textSecondary)
                .multilineTextAlignment(.center)
            VStack(spacing: 10) {
                recoveryButton(copy.recovery)
                if copy.offersOnDeviceFallback {
                    Button {
                        Haptics.tap()
                        Task { await model.acceptOnDeviceFallback() }
                    } label: {
                        Text("Call on device instead")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(chrome.accent)
                }
                Button("Close") {
                    model.end()
                    dismiss()
                }
                .foregroundStyle(chrome.textSecondary)
            }
            .padding(.top, 4)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 8)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private func recoveryButton(_ recovery: VoiceCallErrorCopy.Recovery) -> some View {
        switch recovery {
        case .retry:
            Button {
                Haptics.tap()
                Task { await model.retry() }
            } label: {
                Text("Try again").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(chrome.accent)
        case .openSettings:
            Button {
                Haptics.tap()
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            } label: {
                Text("Open Settings").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(chrome.accent)
        case .dismiss:
            EmptyView()
        }
    }
}
