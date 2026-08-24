import XCTest
@testable import CovenCave

/// How the client decodes the shared Familiar dashboard contract, and in
/// particular the deliberate asymmetry between what it is strict about and
/// what it tolerates.
final class FamiliarDashboardContractTests: XCTestCase {

    private func decode(_ json: String) throws -> FamiliarDashboardPayload {
        try FamiliarDashboardFixtures.decodePayload(json)
    }

    // MARK: - Shape

    func testASuccessfulPayloadDecodesEverySection() throws {
        let payload = try decode(FamiliarDashboardFixtures.successJSON())

        XCTAssertTrue(payload.ok)
        XCTAssertEqual(payload.version, FamiliarDashboardContract.version)
        XCTAssertEqual(payload.familiarId, "nova")
        XCTAssertEqual(payload.identity.displayName, "Nova")
        XCTAssertEqual(payload.identity.role, "Loader keeper")
        XCTAssertNil(payload.identity.pronouns)

        let overview = try XCTUnwrap(payload.sections.overview.data)
        XCTAssertEqual(overview.now, .session(
            id: "s1",
            title: "Refactor the loader",
            updatedAt: "2026-08-23T11:59:00.000Z"))
        XCTAssertEqual(overview.sessions.active.items.first?.status, "running")
        XCTAssertEqual(overview.memory.freshestAt, "2026-08-20T10:00:00.000Z")
        XCTAssertEqual(overview.live.harness, "codex")
        XCTAssertEqual(overview.tasks.items.first?.primaryBlockerId, "dep-1")
        XCTAssertEqual(
            overview.tasks.items.first?.unresolvedDependencies.items.first?.label,
            "Land prerequisite")
        XCTAssertEqual(overview.tasks.items.first?.nextStep?.summary, "Re-run the focused tests")
        XCTAssertEqual(overview.attention.items.first?.kind, "blocked")
        XCTAssertEqual(overview.reminders.items.first?.familiarId, "nova")

        let profile = try XCTUnwrap(payload.sections.profile.data)
        XCTAssertEqual(profile.runtime.model, "opus")
        XCTAssertEqual(profile.runtime.modelProvenance, "familiar")
        XCTAssertNil(profile.runtime.harnessOverride)
        XCTAssertEqual(profile.contract?.propertiesPassed, 7)
        XCTAssertEqual(profile.contract?.violations.items, ["soul: missing purpose"])

        let analytics = try XCTUnwrap(payload.sections.analytics.data)
        XCTAssertEqual(analytics.sampleSize, 12)
        XCTAssertEqual(analytics.reportsTotal, 30)
        XCTAssertNil(
            analytics.averages.memoryRecall,
            "a measurement nobody took is null, never zero")
        XCTAssertEqual(analytics.sessionPulse.active, 1)
    }

    /// `total` is what tells a reader how much they are NOT seeing. A bounded
    /// list rendered without it is a quiet lie about completeness.
    func testABoundedListReportsWhatIsHidden() throws {
        let payload = try decode(FamiliarDashboardFixtures.successJSON())
        let overview = try XCTUnwrap(payload.sections.overview.data)

        XCTAssertTrue(overview.memory.entries.isBounded)
        XCTAssertEqual(overview.memory.entries.items.count, 1)
        XCTAssertEqual(overview.memory.entries.total, 9)
        XCTAssertEqual(overview.memory.entries.hidden, 8)

        XCTAssertFalse(overview.sessions.active.isBounded)
        XCTAssertEqual(overview.sessions.active.hidden, 0)
    }

    // MARK: - Strict where it matters

    /// Section state is the load-bearing field, so an unrecognised value is a
    /// decode failure. Coercing it would be a lie in one direction or the
    /// other: "fresh" hides a failure, "unavailable" invents one.
    func testAnUnrecognisedSectionStateFailsTheDecode() {
        let json = FamiliarDashboardFixtures.successJSON(
            overview: FamiliarDashboardFixtures.section(
                state: "mostly-fine", data: FamiliarDashboardFixtures.overviewData)
        )
        XCTAssertThrowsError(try decode(json))
    }

    func testEveryServerSectionStateDecodes() throws {
        for state in FamiliarDashboardServerSectionState.allCases {
            let data = state == .unavailable ? nil : FamiliarDashboardFixtures.overviewData
            let json = FamiliarDashboardFixtures.successJSON(
                overview: FamiliarDashboardFixtures.section(
                    state: state.rawValue,
                    data: data,
                    issues: state == .unavailable
                        ? [FamiliarDashboardFixtures.issue(
                            source: "sessions", code: "sessions_unavailable", retryable: true)]
                        : []
                )
            )
            let payload = try decode(json)
            XCTAssertEqual(payload.sections.overview.state, state)
        }
    }

    // MARK: - Lenient where it is only diagnostic

    /// Wiring a sixth source into the loader adds an issue code additively. A
    /// phone that discarded a whole dashboard over an unfamiliar diagnostic
    /// string would turn a better desktop into a broken client.
    func testAnUnrecognisedIssueCodeIsKeptRatherThanFatal() throws {
        let json = FamiliarDashboardFixtures.successJSON(
            overview: FamiliarDashboardFixtures.section(
                state: "partial",
                data: FamiliarDashboardFixtures.overviewData,
                issues: [
                    FamiliarDashboardFixtures.issue(
                        source: "calendar", code: "calendar_unavailable", retryable: true)
                ]
            )
        )

        let payload = try decode(json)
        let issue = try XCTUnwrap(payload.sections.overview.issues.first)
        XCTAssertEqual(issue.code.rawValue, "calendar_unavailable")
        XCTAssertEqual(issue.source.rawValue, "calendar")
        XCTAssertTrue(issue.retryable)
        XCTAssertFalse(
            FamiliarDashboardIssueCopy.message(for: issue).isEmpty,
            "an unknown code still has to say something true to the reader")
        XCTAssertFalse(
            FamiliarDashboardIssueCopy.message(for: issue).contains("calendar_unavailable"),
            "a raw machine code must never reach the screen")
    }

    /// `idle` is a positive claim; `unknown` is the absence of one. An
    /// unrecognised kind is the absence of one too, so it must land on
    /// `unknown` — collapsing it to `idle` is exactly the failure-as-absence
    /// lie the contract exists to stop.
    func testAnUnrecognisedNowKindDegradesToUnknownAndNeverToIdle() throws {
        let overviewData = """
        {
          "now": { "kind": "meditating" },
          "presence": null,
          "sessions": {
            "active": { "items": [], "total": 0 },
            "recent": { "items": [], "total": 0 }
          },
          "memory": { "entries": { "items": [], "total": 0 }, "freshestAt": null }
        }
        """
        let json = FamiliarDashboardFixtures.successJSON(
            overview: FamiliarDashboardFixtures.section(state: "fresh", data: overviewData)
        )

        let payload = try decode(json)
        XCTAssertEqual(payload.sections.overview.data?.now, .unknown)
    }

    func testTaskNowPreservesItsImperativeNextStep() throws {
        let overviewData = FamiliarDashboardFixtures.overviewData.replacingOccurrences(
            of: "\"kind\": \"session\",\n        \"id\": \"s1\",\n        \"title\": \"Refactor the loader\",\n        \"updatedAt\": \"2026-08-23T11:59:00.000Z\"",
            with: "\"kind\": \"task\",\n        \"id\": \"task-1\",\n        \"title\": \"Repair the loader\",\n        \"nextStep\": \"Re-run the focused tests\",\n        \"updatedAt\": \"2026-08-23T11:59:00.000Z\""
        )
        let payload = try decode(FamiliarDashboardFixtures.successJSON(
            overview: FamiliarDashboardFixtures.section(state: "fresh", data: overviewData)
        ))
        XCTAssertEqual(
            payload.sections.overview.data?.now,
            .task(
                id: "task-1", title: "Repair the loader",
                nextStep: "Re-run the focused tests",
                updatedAt: "2026-08-23T11:59:00.000Z")
        )
    }

    func testAServerReportedUnknownNowSurvivesDecoding() throws {
        let overviewData = """
        {
          "now": { "kind": "unknown" },
          "presence": null,
          "sessions": {
            "active": { "items": [], "total": 0 },
            "recent": { "items": [], "total": 0 }
          },
          "memory": { "entries": { "items": [], "total": 0 }, "freshestAt": null }
        }
        """
        let json = FamiliarDashboardFixtures.successJSON(
            overview: FamiliarDashboardFixtures.section(
                state: "partial",
                data: overviewData,
                issues: [
                    FamiliarDashboardFixtures.issue(
                        source: "sessions", code: "sessions_unavailable", retryable: true)
                ]
            )
        )

        let payload = try decode(json)
        XCTAssertEqual(payload.sections.overview.data?.now, .unknown)
    }

    // MARK: - The data is believed over the label

    func testEffectiveStateTreatsAnEmptyClaimWithNoDataAsUnavailable() {
        let lying = FamiliarDashboardWireSection<FamiliarDashboardAnalytics>(
            state: .empty, generatedAt: "now", data: nil)
        XCTAssertEqual(lying.effectiveState, .unavailable)

        let honest = FamiliarDashboardWireSection<FamiliarDashboardAnalytics>(
            state: .empty,
            generatedAt: "now",
            data: FamiliarDashboardAnalytics(
                sampleSize: 0,
                reportsTotal: 0,
                windowStart: nil,
                windowEnd: nil,
                averages: .init(
                    overallConfidence: nil, toolReliability: nil,
                    memoryRecall: nil, fileLocatability: nil),
                sessionPulse: .init(active: 0, recent: 0)))
        XCTAssertEqual(honest.effectiveState, .empty)
    }

    // MARK: - Refusals

    func testEveryRefusalCodeMapsToItsOwnError() {
        XCTAssertEqual(
            FamiliarDashboardError.forRefusal(status: 403, code: .invalidFamiliarId),
            .invalidFamiliarId)
        XCTAssertEqual(
            FamiliarDashboardError.forRefusal(status: 404, code: .familiarNotFound),
            .familiarNotFound)
        XCTAssertEqual(
            FamiliarDashboardError.forRefusal(status: 400, code: .unsupportedVersion),
            .unsupportedVersion)
        XCTAssertEqual(
            FamiliarDashboardError.forRefusal(status: 503, code: .dashboardUnavailable),
            .unavailable)
    }

    /// A refusal whose body is missing or unreadable still has to be classified
    /// — a 404 with no envelope is still "this Familiar is gone".
    func testARefusalWithNoCodeFallsBackToItsStatus() {
        XCTAssertEqual(FamiliarDashboardError.forRefusal(status: 404, code: nil), .familiarNotFound)
        XCTAssertEqual(FamiliarDashboardError.forRefusal(status: 403, code: nil), .invalidFamiliarId)
        XCTAssertEqual(FamiliarDashboardError.forRefusal(status: 503, code: nil), .unavailable)
        XCTAssertEqual(
            FamiliarDashboardError.forRefusal(status: 418, code: nil),
            .refused(status: 418, code: nil))
    }

    func testRetryabilityDistinguishesWhatCanChangeFromWhatCannot() {
        XCTAssertFalse(FamiliarDashboardError.familiarNotFound.isRetryable)
        XCTAssertFalse(FamiliarDashboardError.invalidFamiliarId.isRetryable)
        XCTAssertFalse(FamiliarDashboardError.unsupportedVersion.isRetryable)
        XCTAssertFalse(
            FamiliarDashboardError.identityMismatch(requested: "a", received: "b").isRetryable)
        XCTAssertTrue(FamiliarDashboardError.unavailable.isRetryable)
        XCTAssertTrue(FamiliarDashboardError.transport("dropped").isRetryable)
        XCTAssertTrue(FamiliarDashboardError.refused(status: 500, code: nil).isRetryable)
        XCTAssertFalse(FamiliarDashboardError.refused(status: 401, code: nil).isRetryable)
    }

    func testEveryErrorCarriesReadableCopyThatIsNotADiagnostic() {
        let errors: [FamiliarDashboardError] = [
            .notConfigured, .invalidFamiliarId, .familiarNotFound, .unsupportedVersion,
            .unavailable, .refused(status: 500, code: "boom"),
            .identityMismatch(requested: "nova", received: "sage"),
            .decoding("keyNotFound(CodingKeys(stringValue: \"sections\"))"),
            .transport("URLError(.cannotFindHost)"),
        ]
        for error in errors {
            XCTAssertFalse(error.message.isEmpty)
            XCTAssertFalse(
                error.message.contains("URLError"),
                "transport internals must not reach the screen")
            XCTAssertFalse(
                error.message.contains("CodingKeys"),
                "decoder internals must not reach the screen")
        }
    }

    // MARK: - Issue copy

    func testEveryDeclaredIssueCodeHasItsOwnSentence() {
        var seen = Set<String>()
        for code in FamiliarDashboardIssueCode.known {
            let issue = FamiliarDashboardIssue(
                source: .sessions, code: code, retryable: true)
            let message = FamiliarDashboardIssueCopy.message(for: issue)
            XCTAssertFalse(message.isEmpty)
            XCTAssertFalse(
                message.contains(code.rawValue),
                "\(code.rawValue) leaked its machine code into user copy")
            XCTAssertTrue(
                seen.insert(message).inserted,
                "\(code.rawValue) reuses another code's sentence, so the two are indistinguishable")
        }
    }

    func testASummaryNamesTheFirstReasonAndCountsTheRest() {
        let issues = [
            FamiliarDashboardIssue(source: .sessions, code: .sessionsDegraded, retryable: true),
            FamiliarDashboardIssue(source: .memory, code: .memoryUnavailable, retryable: false),
        ]
        let summary = FamiliarDashboardIssueCopy.summary(for: issues)
        XCTAssertEqual(summary, "The session list came back incomplete. (+1 more)")
        XCTAssertNil(FamiliarDashboardIssueCopy.summary(for: []))
        XCTAssertTrue(FamiliarDashboardIssueCopy.anyRetryable(issues))
        XCTAssertFalse(FamiliarDashboardIssueCopy.anyRetryable([issues[1]]))
    }

    // MARK: - Endpoint

    func testTheDashboardPathCarriesTheVersionThisBuildUnderstands() {
        XCTAssertEqual(
            FamiliarDashboardEndpoint.path(encodedFamiliarId: "nova"),
            "api/familiars/nova/dashboard?v=1")
        XCTAssertEqual(FamiliarDashboardContract.version, 1)
    }
}
