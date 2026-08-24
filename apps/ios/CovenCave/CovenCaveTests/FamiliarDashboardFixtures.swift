import Foundation
@testable import CovenCave

/// Wire fixtures for the Familiar dashboard contract.
///
/// Deliberately raw JSON rather than constructed Swift values: the thing under
/// test is what happens to bytes the desktop sends, and a fixture built from
/// the client's own types can only ever agree with the client's own types.
enum FamiliarDashboardFixtures {
    static let generatedAt = "2026-08-23T12:00:00.000Z"

    static let overviewData = """
    {
      "now": {
        "kind": "session",
        "id": "s1",
        "title": "Refactor the loader",
        "updatedAt": "2026-08-23T11:59:00.000Z"
      },
      "presence": "active",
      "live": {
        "harness": "codex",
        "model": "gpt-5.6",
        "activeSessionCount": 1,
        "memoryFreshestAt": "2026-08-20T10:00:00.000Z"
      },
      "tasks": {
        "items": [{
          "id": "task-1",
          "title": "Repair the loader",
          "status": "blocked",
          "priority": "high",
          "projectId": "project-1",
          "sessionId": null,
          "updatedAt": "2026-08-23T11:57:00.000Z",
          "unresolvedDependencies": {
            "items": [{ "id": "dep-1", "kind": "task", "label": "Land prerequisite" }],
            "total": 1
          },
          "primaryBlockerId": "dep-1",
          "nextStep": { "summary": "Re-run the focused tests", "requiresApproval": false }
        }],
        "total": 1
      },
      "sessions": {
        "active": {
          "items": [
            {
              "id": "s1",
              "title": "Refactor the loader",
              "status": "running",
              "updatedAt": "2026-08-23T11:59:00.000Z",
              "generated": false
            }
          ],
          "total": 1
        },
        "recent": { "items": [], "total": 4 }
      },
      "memory": {
        "entries": {
          "items": [
            {
              "id": "m1",
              "title": "Cave ports",
              "updatedAt": "2026-08-20T10:00:00.000Z",
              "verification": "verified"
            }
          ],
          "total": 9
        },
        "freshestAt": "2026-08-20T10:00:00.000Z"
      },
      "attention": {
        "items": [{
          "id": "task:task-1", "source": "task", "kind": "blocked",
          "title": "Repair the loader", "targetId": "task-1"
        }],
        "total": 1
      },
      "reminders": {
        "items": [{
          "id": "reminder-1", "title": "Review the result", "body": null,
          "status": "pending", "fireAt": "2026-08-24T15:00:00.000Z",
          "firedAt": null, "updatedAt": "2026-08-23T12:00:00.000Z",
          "familiarId": "nova"
        }],
        "total": 1
      }
    }
    """

    /// Every list empty and `now` positively idle — what the server sends for a
    /// section it read completely and found nothing in.
    static let emptyOverviewData = """
    {
      "now": { "kind": "idle" },
      "presence": null,
      "sessions": {
        "active": { "items": [], "total": 0 },
        "recent": { "items": [], "total": 0 }
      },
      "memory": {
        "entries": { "items": [], "total": 0 },
        "freshestAt": null
      }
    }
    """

    static let profileData = """
    {
      "description": "Keeps the loader honest",
      "familiarType": "engineer",
      "runtime": {
        "harness": "claude-code",
        "defaultHarness": "claude-code",
        "harnessOverride": null,
        "model": "opus",
        "modelProvenance": "familiar"
      },
      "glyph": { "icon": null, "emoji": "*", "color": "#8899aa" },
      "configuration": { "note": null, "autoSelfReport": true },
      "contract": {
        "propertiesPassed": 7,
        "propertiesTotal": 9,
        "violations": { "items": ["soul: missing purpose"], "total": 1 },
        "warnings": { "items": [], "total": 0 }
      }
    }
    """

    static let analyticsData = """
    {
      "sampleSize": 12,
      "reportsTotal": 30,
      "windowStart": "2026-08-01T00:00:00.000Z",
      "windowEnd": "2026-08-22T00:00:00.000Z",
      "averages": {
        "overallConfidence": 82,
        "toolReliability": 90,
        "memoryRecall": null,
        "fileLocatability": 50
      },
      "sessionPulse": { "active": 1, "recent": 4 },
      "activity": {
        "availability": "available",
        "periodDays": 14,
        "days": [
          { "date": "2026-08-22", "count": 2 },
          { "date": "2026-08-23", "count": 0 }
        ],
        "activeSessions": 1,
        "totalSessions": 4,
        "lastActiveAt": "2026-08-22T12:00:00.000Z"
      },
      "confidence": {
        "state": "measured",
        "band": "high",
        "sampleCount": 12,
        "latestReportAt": "2026-08-22T12:00:00.000Z"
      },
      "signalTrends": {
        "availability": "available",
        "periodDays": 30,
        "sampleCount": 8,
        "metrics": [
          { "key": "confidence", "label": "Confidence", "direction": "improving", "delta": 8 },
          { "key": "memoryRecall", "label": "Memory recall", "direction": "insufficient", "delta": null }
        ]
      },
      "memory": {
        "state": "measured",
        "sampleCount": 6,
        "recall": 75,
        "fileLocatability": 50,
        "latestReportAt": "2026-08-22T12:00:00.000Z"
      },
      "capabilities": {
        "sampleCount": 12,
        "used": { "items": [{ "name": "shell", "count": 8 }], "total": 1 },
        "lacking": { "items": [{ "name": "simulator", "importance": "high" }], "total": 1 },
        "vital": { "items": [{ "name": "memory", "state": "healthy" }], "total": 1 }
      },
      "attention": {
        "sampleCount": 12,
        "contractGaps": 2,
        "persistentBlockers": {
          "items": [{ "id": "b1", "title": "Simulator unavailable", "impact": "Native visual pass blocked" }],
          "total": 1
        }
      }
    }
    """

    static func issue(
        source: String,
        code: String,
        retryable: Bool
    ) -> String {
        "{\"source\":\"\(source)\",\"code\":\"\(code)\",\"retryable\":\(retryable)}"
    }

    static func section(
        state: String,
        data: String?,
        generatedAt: String = FamiliarDashboardFixtures.generatedAt,
        issues: [String] = []
    ) -> String {
        """
        {
          "state": "\(state)",
          "generatedAt": "\(generatedAt)",
          "data": \(data ?? "null"),
          "issues": [\(issues.joined(separator: ","))]
        }
        """
    }

    static func successJSON(
        familiarId: String = "nova",
        version: Int = 1,
        generatedAt: String = FamiliarDashboardFixtures.generatedAt,
        displayName: String = "Nova",
        overview: String? = nil,
        profile: String? = nil,
        analytics: String? = nil
    ) -> String {
        let overviewSection = overview ?? section(state: "fresh", data: overviewData)
        let profileSection = profile ?? section(state: "fresh", data: profileData)
        let analyticsSection = analytics ?? section(state: "fresh", data: analyticsData)
        return """
        {
          "ok": true,
          "version": \(version),
          "familiarId": "\(familiarId)",
          "generatedAt": "\(generatedAt)",
          "identity": {
            "id": "\(familiarId)",
            "displayName": "\(displayName)",
            "role": "Loader keeper",
            "pronouns": null,
            "avatarUrl": null,
            "presence": "active",
            "lastSeen": "2026-08-23T11:58:00.000Z"
          },
          "sections": {
            "overview": \(overviewSection),
            "profile": \(profileSection),
            "analytics": \(analyticsSection)
          }
        }
        """
    }

    static func decodePayload(_ json: String) throws -> FamiliarDashboardPayload {
        try JSONDecoder().decode(FamiliarDashboardPayload.self, from: Data(json.utf8))
    }

    static func payload(
        familiarId: String = "nova",
        version: Int = 1,
        generatedAt: String = FamiliarDashboardFixtures.generatedAt,
        displayName: String = "Nova",
        overview: String? = nil,
        profile: String? = nil,
        analytics: String? = nil
    ) throws -> FamiliarDashboardPayload {
        try decodePayload(
            successJSON(
                familiarId: familiarId,
                version: version,
                generatedAt: generatedAt,
                displayName: displayName,
                overview: overview,
                profile: profile,
                analytics: analytics
            )
        )
    }
}

/// One-shot async latch, matching `ConnectionRefreshCoordinatorTests.Gate`.
/// `wait()` suspends until `open()` fires, or returns immediately if it
/// already has — so a test overlaps two requests by construction rather than
/// by hoping the scheduler cooperates.
actor FamiliarDashboardTestGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func open() {
        opened = true
        for waiter in waiters { waiter.resume() }
        waiters.removeAll()
    }

    func wait() async {
        if opened { return }
        await withCheckedContinuation { waiters.append($0) }
    }
}

/// A dashboard loader that answers from a script instead of a desktop.
///
/// It honours cooperative cancellation, which is what makes the store's
/// cancellation tests real rather than a check that a flag was set.
actor StubDashboardLoader: FamiliarDashboardLoading {
    private var outcomes: [Result<FamiliarDashboardPayload, FamiliarDashboardError>]
    private(set) var requestedIds: [String] = []
    private var startGate: FamiliarDashboardTestGate?
    private var releaseGate: FamiliarDashboardTestGate?

    init(outcomes: [Result<FamiliarDashboardPayload, FamiliarDashboardError>]) {
        self.outcomes = outcomes
    }

    init(payload: FamiliarDashboardPayload) {
        self.outcomes = [.success(payload)]
    }

    var callCount: Int { requestedIds.count }

    /// `start` opens once a request has begun; the request then blocks on
    /// `release` until the test opens it.
    func hold(start: FamiliarDashboardTestGate, release: FamiliarDashboardTestGate) {
        startGate = start
        releaseGate = release
    }

    func familiarDashboard(id: String) async throws -> FamiliarDashboardPayload {
        requestedIds.append(id)
        guard !outcomes.isEmpty else {
            throw FamiliarDashboardError.transport("stub loader has no scripted outcome")
        }
        // The last scripted outcome repeats, so a polling test does not need a
        // fixture per tick.
        let index = min(requestedIds.count - 1, outcomes.count - 1)
        let outcome = outcomes[index]

        await startGate?.open()
        if let releaseGate {
            await releaseGate.wait()
        }
        try Task.checkCancellation()
        return try outcome.get()
    }
}
