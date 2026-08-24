import XCTest
@testable import CovenCave

final class FamiliarProfilePresentationTests: XCTestCase {
    private func decodedProfile() throws -> FamiliarDashboardProfile {
        let payload = try FamiliarDashboardFixtures.payload()
        return try XCTUnwrap(payload.sections.profile.data)
    }

    private func decodedFamiliar(_ fields: String = "") throws -> Familiar {
        let json = """
        {
          "id": "nova",
          "display_name": "Nova"
          \(fields.isEmpty ? "" : ",\n" + fields)
        }
        """
        return try JSONDecoder().decode(Familiar.self, from: Data(json.utf8))
    }

    func testConfiguredProfileValuesKeepTheirProvenance() throws {
        let profile = try decodedProfile()

        XCTAssertEqual(FamiliarProfilePresentation.value(profile.description), "Keeps the loader honest")
        XCTAssertEqual(FamiliarProfilePresentation.value(profile.familiarType), "engineer")
        XCTAssertEqual(FamiliarProfilePresentation.runtime(profile), "claude-code")
        XCTAssertEqual(FamiliarProfilePresentation.model(profile), "opus")
        XCTAssertEqual(FamiliarProfilePresentation.modelSource(profile), "Familiar default")
        XCTAssertEqual(
            FamiliarProfilePresentation.contract(profile.contract),
            "7 of 9 checks passed")
    }

    func testAbsentOptionalValuesNeverMasqueradeAsZeroOrUnavailable() throws {
        let familiar = try decodedFamiliar()
        let profile = try JSONDecoder().decode(
            FamiliarDashboardProfile.self,
            from: Data("""
            {
              "description": null,
              "familiarType": "   ",
              "runtime": {
                "harness": null,
                "defaultHarness": null,
                "harnessOverride": null,
                "model": null,
                "modelProvenance": "unconfigured"
              },
              "glyph": { "icon": null, "emoji": null, "color": null },
              "configuration": { "note": null, "autoSelfReport": false },
              "contract": null
            }
            """.utf8)
        )

        XCTAssertEqual(FamiliarProfilePresentation.value(profile.description), "Not set")
        XCTAssertEqual(FamiliarProfilePresentation.value(profile.familiarType), "Not set")
        XCTAssertEqual(FamiliarProfilePresentation.runtime(profile), "Not set")
        XCTAssertEqual(FamiliarProfilePresentation.model(profile), "Not set")
        XCTAssertEqual(FamiliarProfilePresentation.modelSource(profile), "Runtime default")
        XCTAssertEqual(FamiliarProfilePresentation.voice(familiar), "Not set")
        XCTAssertEqual(FamiliarProfilePresentation.image(familiar), "Not set")
        XCTAssertEqual(FamiliarProfilePresentation.contract(profile.contract), "Not set")
    }

    func testRosterVoiceAndImageDefaultsDecodeWithoutInventedFallbacks() throws {
        let familiar = try decodedFamiliar("""
          "voiceProvider": "openai",
          "voiceModel": "gpt-realtime",
          "voiceName": "cedar",
          "imageProvider": "openai",
          "imageModel": "gpt-image-1",
          "imageSize": "1536x1024",
          "imageQuality": "high",
          "autoSelfReport": true
        """)

        XCTAssertEqual(
            FamiliarProfilePresentation.voice(familiar),
            "openai · gpt-realtime · cedar")
        XCTAssertEqual(
            FamiliarProfilePresentation.image(familiar),
            "openai · gpt-image-1 · 1536x1024 · high")
        XCTAssertEqual(familiar.autoSelfReport, true)
    }

    func testMemoryDistinguishesUnavailableFromAReadWithNoEntries() throws {
        let payload = try FamiliarDashboardFixtures.payload()
        XCTAssertNotEqual(
            FamiliarProfilePresentation.memory(
                .merged(previous: nil, incoming: payload.sections.overview)),
            "Unavailable")

        let unavailable = FamiliarDashboardClientSection<FamiliarDashboardOverview>(
            presentation: .unavailable,
            serverState: .unavailable,
            generatedAt: FamiliarDashboardFixtures.generatedAt,
            data: nil,
            issues: [FamiliarDashboardIssue(
                source: .memory,
                code: .memoryUnavailable,
                retryable: true)])
        XCTAssertEqual(FamiliarProfilePresentation.memory(unavailable), "Unavailable")

        let emptyPayload = try FamiliarDashboardFixtures.payload(
            overview: FamiliarDashboardFixtures.section(
                state: "empty",
                data: FamiliarDashboardFixtures.emptyOverviewData))
        XCTAssertEqual(
            FamiliarProfilePresentation.memory(
                .merged(previous: nil, incoming: emptyPayload.sections.overview)),
            "No memory yet")
    }
}
