import SwiftUI

struct QuickAnswerView: View {
    @ObservedObject var model: QuickAnswerViewModel
    @FocusState private var questionFocused: Bool
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if model.showingPitches {
                pitchLibrary
            } else {
                askSurface
            }
        }
        .frame(width: 480, minHeight: 310)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear { questionFocused = true }
        .onExitCommand { dismiss() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("Salem Quick Answer")
                    .font(.headline)
                Text(model.showingPitches ? "Reference pitches — not live status" : "Ask about OpenCoven")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(model.showingPitches ? "Ask" : "Pitches") {
                model.showingPitches.toggle()
                if !model.showingPitches { questionFocused = true }
            }
            .buttonStyle(.borderless)
            .accessibilityHint("Switches between live-answer fixtures and offline reference pitches")
        }
        .padding(16)
    }

    private var askSurface: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                TextField("Ask about OpenCoven…", text: $model.question)
                    .textFieldStyle(.roundedBorder)
                    .focused($questionFocused)
                    .onSubmit { model.submit() }
                    .accessibilityLabel("OpenCoven question")

                Button("Ask") { model.submit() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canSubmit)
                    .keyboardShortcut(.return, modifiers: [.command])
            }

            HStack(spacing: 12) {
                Picker("Audience", selection: $model.audience) {
                    ForEach(AnswerAudience.allCases) { audience in
                        Text(audience.label).tag(audience)
                    }
                }
                .labelsHidden()
                .accessibilityLabel("Audience")

                Picker("Depth", selection: $model.depth) {
                    ForEach(AnswerDepth.allCases) { depth in
                        Text(depth.label).tag(depth)
                    }
                }
                .labelsHidden()
                .accessibilityLabel("Answer depth")

                Spacer()

                if case .querying = model.state {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Getting answer")
                }
            }

            stateContent
        }
        .padding(16)
    }

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .idle:
            helper("Ask a question. Fixture commands: fixture:stale, fixture:offline, fixture:unauthorized, fixture:rate.")
        case .querying:
            helper("Checking the available OpenCoven evidence…")
        case .answered(let brief):
            answerCard(brief, notice: nil)
        case .lowConfidence(let brief):
            answerCard(brief, notice: "Low confidence — verify before saying this as a current fact.")
        case .stale(let brief):
            answerCard(brief, notice: "Stale knowledge — don't use this as current release-status authority.")
        case .offline:
            failureState("Salem is offline.", detail: "Use Pitches for versioned reference language.")
        case .unauthorized:
            failureState("Quick Answer isn't authorized.", detail: "The live client credential will be added in the next integration slice.")
        case .rateLimited:
            failureState("Too many requests.", detail: "Use a reference pitch or try again after the rate-limit window resets.")
        case .failed(let message):
            failureState(message, detail: "No answer was substituted for the failed request.")
        }
    }

    private func answerCard(_ brief: BriefResponse, notice: String?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let notice {
                Label(notice, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(notice)
            }

            Text("SAY THIS")
                .font(.caption2.weight(.semibold))
                .tracking(0.8)
                .foregroundStyle(.secondary)
            Text(brief.answer.sayThis)
                .font(.body)
                .textSelection(.enabled)

            HStack(spacing: 8) {
                statusPill(brief.classification.claimStatus.label)
                statusPill("Confidence: \(brief.classification.confidence.label)")
                if brief.knowledge.freshness != .unknown {
                    statusPill("Knowledge: \(brief.knowledge.freshness.rawValue.capitalized)")
                }
            }

            if let followUp = brief.answer.followUp {
                DisclosureGroup("More detail") {
                    Text(followUp)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
            }

            HStack(spacing: 14) {
                if !brief.answer.caveats.isEmpty {
                    Button("Caveats") { model.showingCaveats.toggle() }
                        .buttonStyle(.link)
                }
                if !brief.evidence.isEmpty {
                    Button("Evidence") { model.showingEvidence.toggle() }
                        .buttonStyle(.link)
                }
                Spacer()
                Button("Clear") {
                    model.reset()
                    questionFocused = true
                }
                .buttonStyle(.link)
            }

            if model.showingCaveats {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(brief.answer.caveats, id: \.self) { caveat in
                        Text("• \(caveat)").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }

            if model.showingEvidence {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(brief.evidence) { evidence in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(evidence.title).font(.caption.weight(.semibold))
                            Text(evidence.sourceAuthority.replacingOccurrences(of: "_", with: " "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var pitchLibrary: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Reference version \(PitchLibrary.version)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("Not live implementation status")
                        .font(.caption.weight(.semibold))
                }
                ForEach(PitchLibrary.cards) { pitch in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(pitch.title).font(.caption.weight(.semibold))
                        Text(pitch.text).font(.callout).textSelection(.enabled)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
                    )
                }
            }
            .padding(16)
        }
        .frame(maxHeight: 520)
    }

    private func statusPill(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color(nsColor: .quaternaryLabelColor).opacity(0.12))
            .clipShape(Capsule())
    }

    private func helper(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(text)
    }

    private func failureState(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(title, systemImage: "exclamationmark.circle")
                .font(.callout.weight(.semibold))
            Text(detail).font(.caption).foregroundStyle(.secondary)
            Button("Open reference pitches") { model.showingPitches = true }
                .buttonStyle(.link)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}
