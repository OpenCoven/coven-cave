import XCTest
@testable import CovenCave

/// The arithmetic fast path must never disagree with the formatters it
/// shortcuts: every value it accepts has to match `ISO8601DateFormatter`, and
/// everything else has to fall through to them (#5600).
final class CaveISOParsingTests: XCTestCase {
    private func formatterDate(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return fractional.date(from: iso) ?? plain.date(from: iso)
    }

    func testFastPathMatchesTheFormattersAcrossDatesZonesAndFractions() {
        let stamps = [
            "1970-01-01T00:00:00Z", "1969-12-31T23:59:59Z", "2000-02-29T12:00:00Z",
            "2024-02-29T23:59:59Z", "2026-12-31T23:59:59Z", "2026-01-01T00:00:00Z",
            "1900-03-01T00:00:00Z", "2100-02-28T08:30:15Z",
            "2026-09-26T10:39:02.123Z", "2026-09-26T10:39:02.000Z", "2026-09-26T10:39:02.999Z",
            "2026-09-26T10:39:02+05:30", "2026-09-26T10:39:02-08:00", "2026-09-26T10:39:02.250+00:00",
            "2026-03-08T02:30:00-05:00", "2026-11-01T01:30:00-04:00",
        ]
        for stamp in stamps {
            let fast = caveParseCanonicalISO(stamp)
            XCTAssertNotNil(fast, stamp)
            XCTAssertEqual(fast, formatterDate(stamp), stamp)
        }
    }

    func testFastPathMatchesEveryDayOfALeapAndACommonYear() {
        for year in [2023, 2024] {
            var components = DateComponents(year: year, month: 1, day: 1, hour: 7, minute: 5, second: 9)
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC")!
            while let date = calendar.date(from: components), calendar.component(.year, from: date) == year {
                let stamp = String(
                    format: "%04d-%02d-%02dT07:05:09Z",
                    year, calendar.component(.month, from: date), calendar.component(.day, from: date)
                )
                XCTAssertEqual(caveParseCanonicalISO(stamp), date, stamp)
                components.day! += 1
            }
        }
    }

    func testNonCanonicalShapesFallThroughToTheFormatters() {
        // Nil from the fast path means "not mine", never "invalid": the
        // formatters still decide these.
        for stamp in [
            "2026-09-26T10:39:02.123456Z", "2026-09-26T10:39:02.1Z", "2026-09-26T10:39:02",
            "2026-09-26 10:39:02Z", "2026-09-26T10:39:60Z", "2026-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z", "2026-09-31T00:00:00Z", "2026-09-26T24:00:00Z",
            "2026-09-26T10:39:02z", "2026-09-26T10:39:02+0530", "x026-09-26T10:39:02Z",
            "2026-09-26T10:39:02Zjunk", "0001-01-01T00:00:00Z", "1582-10-04T00:00:00Z", "",
        ] {
            XCTAssertNil(caveParseCanonicalISO(stamp), stamp)
            XCTAssertEqual(caveParseISO(stamp), stamp.isEmpty ? nil : formatterDate(stamp), stamp)
        }
    }

    func testCaveParseISOKeepsItsNilContract() {
        XCTAssertNil(caveParseISO(nil))
        XCTAssertNil(caveParseISO(""))
        XCTAssertNil(caveParseISO("not a date"))
        XCTAssertEqual(caveParseISO("2026-09-12T10:00:00Z"), Date(timeIntervalSince1970: 1_789_207_200))
    }
}
