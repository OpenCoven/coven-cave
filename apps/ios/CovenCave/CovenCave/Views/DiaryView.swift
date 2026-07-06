import SwiftUI
import PencilKit
// Vision's request types predate Sendable; @preconcurrency quiets the strict-
// concurrency warning for the recognize() closure capture.
@preconcurrency import Vision

/// The Diary — an experimental iPad surface styled after Tom Riddle's diary.
///
/// Write a message on the page with Apple Pencil (finger works too, which keeps
/// the page usable in the Simulator). After a pause the handwriting is
/// recognized, the ink "soaks" into the page, and the familiar's reply writes
/// itself out stroke by stroke in a cursive hand — then fades away when you
/// start writing again.
///
/// The reply streams through the same `POST /api/chat/send` SSE bridge as chat,
/// resuming one session per page so follow-up questions keep their context.
/// "New page" (or switching familiar) starts a fresh session.
struct DiaryView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// What the page is doing. The canvas accepts ink in `.idle`; everything
    /// downstream of a pen-lift flows through the remaining phases in order.
    private enum Phase: Equatable {
        case idle            // blank page or finished exchange; ready for ink
        case recognizing     // pen lifted, Vision reading the handwriting
        case replying        // reply streaming + writing itself out
    }

    @State private var phase: Phase = .idle
    @State private var drawing = PKDrawing()
    /// Fades + blurs the written ink as it "soaks" into the page.
    @State private var inkOpacity: Double = 1
    @State private var inkBlur: Double = 0

    /// The reply as revealed so far (grows char by char) and the not-yet-revealed
    /// buffer the stream fills. `streamFinished` lets the reveal loop know the
    /// buffer won't grow anymore.
    @State private var revealedReply = ""
    @State private var pendingReply: [Character] = []
    @State private var streamFinished = false
    @State private var replyIsError = false
    /// Fades the finished reply out when the user starts the next message.
    @State private var replyOpacity: Double = 1

    /// One diary session per familiar+page; nil until the first send answers.
    @State private var sessionId: String?
    @AppStorage("cave.diary.familiar") private var familiarIdRaw = ""
    @State private var hint: String?

    @State private var penLiftTask: Task<Void, Never>?
    @State private var streamTask: Task<Void, Never>?
    @State private var revealTask: Task<Void, Never>?

    /// Dark sepia writing ink — legible on the parchment and high-contrast
    /// enough for Vision's handwriting recognition.
    private static let ink = UIColor(red: 0.16, green: 0.10, blue: 0.05, alpha: 1)

    var body: some View {
        ZStack {
            paper.ignoresSafeArea()

            // The reply writes itself across the upper page; ink lands anywhere.
            VStack(spacing: 0) {
                header
                ZStack(alignment: .topLeading) {
                    DiaryCanvas(drawing: $drawing,
                                ink: Self.ink,
                                onStrokesChanged: strokesChanged)
                        .opacity(inkOpacity)
                        .blur(radius: inkBlur)
                        .accessibilityLabel("Diary page. Write your message here with Apple Pencil.")

                    if !revealedReply.isEmpty {
                        replyText
                            .padding(.horizontal, 36)
                            .padding(.top, 28)
                            .allowsHitTesting(false)
                    }

                    if drawing.strokes.isEmpty && revealedReply.isEmpty && phase == .idle {
                        blankPageHint
                    }

                    if phase == .recognizing {
                        readingIndicator
                    }
                }
            }

            if let hint {
                hintToast(hint)
            }
        }
        .preferredColorScheme(.light) // a diary page is parchment in any theme
        .onDisappear {
            penLiftTask?.cancel()
            streamTask?.cancel()
            revealTask?.cancel()
        }
    }

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: 14) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(uiColor: Self.ink).opacity(0.55))
                    .frame(width: 34, height: 34)
                    .contentShape(Circle())
            }
            .accessibilityLabel("Close the diary")

            Spacer()

            VStack(spacing: 1) {
                Text("The Diary")
                    .font(.system(size: 17, weight: .semibold, design: .serif))
                    .foregroundStyle(Color(uiColor: Self.ink).opacity(0.8))
                Text(currentFamiliar.map { "kept by \($0.displayName)" } ?? "experimental")
                    .font(.system(size: 11, design: .serif).italic())
                    .foregroundStyle(Color(uiColor: Self.ink).opacity(0.45))
            }

            Spacer()

            familiarMenu

            Button {
                newPage()
            } label: {
                Image(systemName: "book.pages")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(uiColor: Self.ink).opacity(0.55))
                    .frame(width: 34, height: 34)
                    .contentShape(Circle())
            }
            .accessibilityLabel("Turn to a new page")
            .disabled(phase != .idle)
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 4)
    }

    private var familiarMenu: some View {
        Menu {
            ForEach(app.familiars) { familiar in
                Button {
                    guard familiar.id != currentFamiliar?.id else { return }
                    familiarIdRaw = familiar.id
                    newPage() // a different spirit answers on a fresh page
                } label: {
                    if familiar.id == currentFamiliar?.id {
                        Label(familiar.displayName, systemImage: "checkmark")
                    } else {
                        Text(familiar.displayName)
                    }
                }
            }
        } label: {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Color(uiColor: Self.ink).opacity(0.55))
                .frame(width: 34, height: 34)
                .contentShape(Circle())
        }
        .accessibilityLabel("Choose who answers the diary")
        .disabled(phase != .idle)
    }

    // MARK: - Page dressing

    /// Aged-parchment page: warm cream with a soft edge vignette.
    private var paper: some View {
        ZStack {
            Color(red: 0.949, green: 0.910, blue: 0.831)
            RadialGradient(
                colors: [.clear, Color(red: 0.72, green: 0.62, blue: 0.46).opacity(0.35)],
                center: .center, startRadius: 240, endRadius: 900
            )
        }
    }

    private var blankPageHint: some View {
        VStack {
            Spacer()
            Text("Write with your pencil… the diary is listening.")
                .font(.system(size: 20, design: .serif).italic())
                .foregroundStyle(Color(uiColor: Self.ink).opacity(0.28))
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
    }

    private var readingIndicator: some View {
        VStack {
            Spacer()
            Text("the ink stirs…")
                .font(.system(size: 15, design: .serif).italic())
                .foregroundStyle(Color(uiColor: Self.ink).opacity(0.4))
                .padding(.bottom, 42)
        }
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
        .accessibilityLabel("Reading your handwriting")
    }

    private var replyText: some View {
        Text(revealedReply)
            .font(.custom("SnellRoundhand-Bold", size: 30))
            .foregroundStyle(Color(uiColor: Self.ink).opacity(replyIsError ? 0.55 : 0.88))
            .lineSpacing(9)
            .opacity(replyOpacity)
            .animation(reduceMotion ? nil : .easeIn(duration: 0.12), value: revealedReply)
            .accessibilityLabel("The diary replies: \(revealedReply)")
    }

    private func hintToast(_ text: String) -> some View {
        VStack {
            Spacer()
            Text(text)
                .font(.system(size: 14, design: .serif).italic())
                .foregroundStyle(Color(uiColor: Self.ink).opacity(0.65))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Color.white.opacity(0.55), in: Capsule())
                .padding(.bottom, 60)
        }
        .transition(.opacity)
        .allowsHitTesting(false)
    }

    // MARK: - Flow

    private var currentFamiliar: Familiar? {
        app.familiars.first { $0.id == familiarIdRaw } ?? app.familiars.first
    }

    /// Pen activity: fade out a finished reply (the page clears itself for the
    /// next exchange) and (re)arm the pen-lift timer that triggers recognition.
    private func strokesChanged() {
        guard phase == .idle else { return }
        hint = nil
        if !revealedReply.isEmpty && replyOpacity == 1 {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 1.1)) { replyOpacity = 0 }
        }
        penLiftTask?.cancel()
        guard !drawing.strokes.isEmpty else { return }
        penLiftTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled, phase == .idle, !drawing.strokes.isEmpty else { return }
            await submit()
        }
    }

    /// Pen-lift pause elapsed: recognize the ink, soak it into the page, and
    /// stream the reply.
    @MainActor
    private func submit() async {
        guard let client = app.client, let familiar = currentFamiliar else {
            showHint("The diary is not connected.")
            return
        }
        phase = .recognizing

        let text: String
        do {
            text = try await DiaryHandwriting.recognize(drawing)
        } catch {
            phase = .idle
            showHint("The diary squints… it can't quite read that.")
            return
        }
        guard !text.isEmpty else {
            phase = .idle
            showHint("The diary can't read that — try writing a little larger.")
            return
        }

        // The ink soaks into the page, Riddle-style.
        clearReply()
        Haptics.tap(.soft)
        if reduceMotion {
            drawing = PKDrawing()
        } else {
            withAnimation(.easeIn(duration: 0.9)) {
                inkOpacity = 0
                inkBlur = 6
            }
            try? await Task.sleep(for: .milliseconds(950))
            drawing = PKDrawing()
            inkOpacity = 1
            inkBlur = 0
        }

        phase = .replying
        stream(prompt: text, familiar: familiar, client: client)
    }

    /// First turn on a page carries a light framing so replies stay short and
    /// diary-like; follow-ups send the recognized text alone (the session keeps
    /// the framing).
    private func prompt(for text: String) -> String {
        guard sessionId == nil else { return text }
        return """
        You are the spirit answering inside an enchanted diary. Reply in 1–3 short \
        sentences of plain prose — no markdown, no code, no lists. Someone has just \
        written on your page: \(text)
        """
    }

    private func stream(prompt text: String, familiar: Familiar, client: CaveClient) {
        streamFinished = false
        replyIsError = false
        let body = CaveClient.SendBody(familiarId: familiar.id,
                                       prompt: prompt(for: text),
                                       sessionId: sessionId,
                                       attachments: nil)
        streamTask = Task { @MainActor in
            do {
                for try await event in client.sendStream(body) {
                    if Task.isCancelled { return }
                    switch event {
                    case .session(let sid):
                        if !sid.isEmpty { sessionId = sid }
                    case .assistantChunk(let chunk):
                        pendingReply.append(contentsOf: chunk)
                        startRevealLoop()
                    case .done(let isError, let sid):
                        if let sid, !sid.isEmpty { sessionId = sid }
                        if isError { replyIsError = true }
                    case .error(let message):
                        replyIsError = true
                        if pendingReply.isEmpty && revealedReply.isEmpty {
                            pendingReply.append(contentsOf: "The ink swirls, but nothing answers. (\(message))")
                            startRevealLoop()
                        }
                    default:
                        break
                    }
                }
            } catch {
                replyIsError = true
                if pendingReply.isEmpty && revealedReply.isEmpty {
                    pendingReply.append(contentsOf: "The ink swirls, but nothing answers.")
                    startRevealLoop()
                }
            }
            streamFinished = true
            if revealTask == nil { phase = .idle } // nothing left to write out
        }
    }

    /// Writes the buffered reply out one character at a time — the quill. An
    /// uneven cadence (with a breath after sentences) reads as handwriting
    /// rather than a teleprinter. Under Reduce Motion the reveal runs near-
    /// instant so the text simply appears.
    private func startRevealLoop() {
        guard revealTask == nil else { return }
        if revealedReply.isEmpty { Haptics.tap(.soft) }
        replyOpacity = 1
        revealTask = Task { @MainActor in
            while !Task.isCancelled {
                if pendingReply.isEmpty {
                    if streamFinished { break }
                    try? await Task.sleep(for: .milliseconds(70))
                    continue
                }
                let ch = pendingReply.removeFirst()
                revealedReply.append(ch)
                if reduceMotion { continue }
                let pause: Int
                switch ch {
                case ".", "!", "?": pause = Int.random(in: 260...400)
                case ",", ";", "—": pause = Int.random(in: 140...220)
                case " ":           pause = Int.random(in: 40...90)
                default:            pause = Int.random(in: 28...58)
                }
                try? await Task.sleep(for: .milliseconds(pause))
            }
            revealTask = nil
            if streamFinished { phase = .idle }
        }
    }

    private func clearReply() {
        revealTask?.cancel()
        revealTask = nil
        revealedReply = ""
        pendingReply = []
        replyOpacity = 1
        replyIsError = false
    }

    /// Fresh page: clears the ink, the reply, and the session.
    private func newPage() {
        penLiftTask?.cancel()
        streamTask?.cancel()
        clearReply()
        drawing = PKDrawing()
        inkOpacity = 1
        inkBlur = 0
        sessionId = nil
        phase = .idle
        hint = nil
    }

    private func showHint(_ text: String) {
        withAnimation { hint = text }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(4))
            withAnimation { if hint == text { hint = nil } }
        }
    }
}

// MARK: - Pencil canvas

/// PencilKit canvas bridged into SwiftUI. `.anyInput` keeps the page usable
/// with a finger (and in the Simulator); on iPad the Pencil is the natural
/// instrument. The canvas is forced light so PencilKit doesn't invert the
/// sepia ink in dark mode.
private struct DiaryCanvas: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    let ink: UIColor
    let onStrokesChanged: () -> Void

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.overrideUserInterfaceStyle = .light
        canvas.drawingPolicy = .anyInput
        canvas.tool = PKInkingTool(.pen, color: ink, width: 3.4)
        canvas.delegate = context.coordinator
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        // Push model → view only on real divergence (clearing the page); the
        // delegate handles view → model, and an unconditional write here would
        // re-enter the delegate for every stroke.
        if canvas.drawing != drawing {
            context.coordinator.squelch = true
            canvas.drawing = drawing
            context.coordinator.squelch = false
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: DiaryCanvas
        /// True while updateUIView writes the drawing (programmatic changes
        /// must not re-arm the pen-lift timer).
        var squelch = false

        init(_ parent: DiaryCanvas) { self.parent = parent }

        func canvasViewDrawingDidChange(_ canvas: PKCanvasView) {
            guard !squelch else { return }
            parent.drawing = canvas.drawing
            parent.onStrokesChanged()
        }
    }
}

// MARK: - Handwriting recognition

enum DiaryHandwriting {
    /// Read handwriting from a PencilKit drawing via Vision. The strokes are
    /// composited onto white first — Vision needs the contrast, and a
    /// transparent-background render can rasterize unpredictably.
    static func recognize(_ drawing: PKDrawing) async throws -> String {
        guard !drawing.strokes.isEmpty else { return "" }
        let bounds = drawing.bounds.insetBy(dx: -24, dy: -24)
        let scale: CGFloat = 2
        let strokes = drawing.image(from: bounds, scale: scale)

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1 // the stroke image is already scaled; render 1:1
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        let composited = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            strokes.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let cgImage = composited.cgImage else { return "" }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let observations = request.results as? [VNRecognizedTextObservation] ?? []
                let text = observations
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                continuation.resume(returning: text)
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true

            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try VNImageRequestHandler(cgImage: cgImage).perform([request])
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}
