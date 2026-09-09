import Foundation

struct PitchCard: Identifiable, Equatable {
    let id: String
    let title: String
    let text: String
}

enum PitchLibrary {
    static let version = "2026-09-08"

    static let cards: [PitchCard] = [
        .init(id: "general-10", title: "10 seconds", text: "OpenCoven is building a personal AI assistant you can keep as your devices and AI tools change."),
        .init(id: "general-30", title: "30 seconds", text: "OpenCoven is about having a personal AI assistant you don't have to start over with. We're building it so the things you choose to save—your preferences, ongoing work, and the limits you set—can stay with your assistant as you change devices or AI systems. We call that assistant a familiar. AI that can stay."),
        .init(id: "general-60", title: "60 seconds", text: "OpenCoven is about having a personal AI assistant you don't have to start over with. If you've already taught an AI how you like to work, what you've decided, and what matters to you, changing the technology underneath shouldn't force you to rebuild everything from zero. We call your ongoing assistant a familiar. The goal is to carry forward its identity, the information you choose to save, and the limits you set across supported environments. AI that can stay."),
        .init(id: "developer", title: "Developer", text: "OpenCoven treats the familiar as the durable identity rather than the model or runtime. Identity, continuity, authorization, orchestration, and execution stay distinct, so portability doesn't silently grant new authority."),
        .init(id: "security", title: "Security", text: "OpenCoven separates what an assistant knows from what it's allowed to do. Memory or context can't grant itself protected authority; those boundaries stay explicit and separately governed."),
        .init(id: "partner", title: "Partner / investor", text: "OpenCoven is building the identity and continuity layer for personal AI assistants that can persist beyond any single model or provider, while keeping human-defined authority boundaries explicit."),
        .init(id: "creator", title: "Creator", text: "If you've spent months building context around a book, codebase, design practice, or research project, changing AI tools shouldn't mean rebuilding that working relationship from scratch."),
        .init(id: "familiar", title: "What is a familiar?", text: "A familiar is OpenCoven's name for an ongoing personal AI assistant—AI software whose identity and selected continuity can persist across supported environments."),
        .init(id: "memory", title: "Is this just memory?", text: "Memory is part of it, but OpenCoven is also about which assistant you're continuing with and what it's allowed to do. Remembering information is not the same as preserving identity or granting permission."),
        .init(id: "everywhere", title: "Does it work everywhere?", text: "I wouldn't claim universal compatibility today. Portability is a core goal, but each runtime, model, and integration still has to be implemented and verified."),
        .init(id: "personhood", title: "Is a familiar alive?", text: "Familiar is our name for an ongoing AI assistant. It's AI software, not a claim of consciousness, personhood, or legal agency."),
        .init(id: "why", title: "Why OpenCoven?", text: "Because the effort you put into an AI assistant shouldn't belong permanently to one model, app, device, or provider. Keep the assistant; change the tools; keep the limits clear.")
    ]
}
