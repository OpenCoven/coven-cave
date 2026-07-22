import XCTest
@testable import CovenCave

final class CaveHostAdviceTests: XCTestCase {
    // MARK: - Loopback (this phone, not the desktop)

    func testLocalhostIsLoopback() {
        XCTAssertEqual(CaveHostAdvice.evaluate("localhost"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("localhost:3000"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("LOCALHOST"), .loopback)
    }

    func testLoopbackIPv4RangeIsLoopback() {
        XCTAssertEqual(CaveHostAdvice.evaluate("127.0.0.1"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("127.0.0.1:3000"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("127.9.8.7"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("0.0.0.0"), .loopback)
    }

    func testLoopbackIPv6IsLoopback() {
        XCTAssertEqual(CaveHostAdvice.evaluate("::1"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("[::1]"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("[::1]:3000"), .loopback)
    }

    func testLoopbackInsideURLIsLoopback() {
        XCTAssertEqual(CaveHostAdvice.evaluate("http://127.0.0.1:3000"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("https://localhost:3000/path"), .loopback)
        XCTAssertEqual(CaveHostAdvice.evaluate("covencave://localhost:3000"), .loopback)
    }

    // MARK: - LAN addresses (same-Wi-Fi only)

    func testRFC1918AddressesAreLAN() {
        XCTAssertEqual(CaveHostAdvice.evaluate("192.168.1.20"), .lanAddress)
        XCTAssertEqual(CaveHostAdvice.evaluate("192.168.1.20:3000"), .lanAddress)
        XCTAssertEqual(CaveHostAdvice.evaluate("10.0.0.5"), .lanAddress)
        XCTAssertEqual(CaveHostAdvice.evaluate("172.16.0.9"), .lanAddress)
        XCTAssertEqual(CaveHostAdvice.evaluate("172.31.255.1"), .lanAddress)
    }

    func testNon1918RangesAreNotLAN() {
        // 172.32.* is public space, not RFC1918.
        XCTAssertNil(CaveHostAdvice.evaluate("172.32.0.1"))
        XCTAssertNil(CaveHostAdvice.evaluate("11.0.0.1"))
        XCTAssertNil(CaveHostAdvice.evaluate("193.168.1.1"))
    }

    func testTailscaleCGNATRangeIsTheGoodCaseNotLAN() {
        // 100.64.0.0/10 is Tailscale's address space — exactly what we WANT.
        XCTAssertNil(CaveHostAdvice.evaluate("100.101.102.103"))
        XCTAssertNil(CaveHostAdvice.evaluate("100.64.0.1:3000"))
        XCTAssertNil(CaveHostAdvice.evaluate("100.127.255.254"))
    }

    // MARK: - mDNS .local names

    func testDotLocalNamesGetLANFlavoredAdvice() {
        XCTAssertEqual(CaveHostAdvice.evaluate("my-mac.local"), .mdnsLocal)
        XCTAssertEqual(CaveHostAdvice.evaluate("My-Mac.LOCAL:3000"), .mdnsLocal)
    }

    func testTailnetNamesAreClean() {
        XCTAssertNil(CaveHostAdvice.evaluate("my-mac.example.ts.net"))
        XCTAssertNil(CaveHostAdvice.evaluate("https://my-mac.example.ts.net"))
    }

    // MARK: - Stray space (pre-existing hint, now a case)

    func testEmbeddedSpaceIsFlagged() {
        XCTAssertEqual(CaveHostAdvice.evaluate("my mac.ts.net"), .hasSpace)
        XCTAssertEqual(CaveHostAdvice.evaluate("address: 100.1.2.3"), .hasSpace)
    }

    func testSurroundingWhitespaceIsTolerated() {
        XCTAssertNil(CaveHostAdvice.evaluate("  my-mac.ts.net  "))
        XCTAssertEqual(CaveHostAdvice.evaluate("  127.0.0.1  "), .loopback)
    }

    // MARK: - Neutral inputs

    func testEmptyAndCleanInputsGetNoAdvice() {
        XCTAssertNil(CaveHostAdvice.evaluate(""))
        XCTAssertNil(CaveHostAdvice.evaluate("   "))
        XCTAssertNil(CaveHostAdvice.evaluate("example.com"))
    }

    func testBareIPv6IsNotMangledByPortStripping() {
        // A bare IPv6 address has many colons — must not be truncated at the
        // first one and misread.
        XCTAssertNil(CaveHostAdvice.evaluate("fd7a:115c:a1e0::1234"))
    }

    func testMessagesAreNonEmptyAndDistinct() {
        let cases: [CaveHostAdvice] = [.hasSpace, .loopback, .lanAddress, .mdnsLocal]
        let messages = cases.map(\.message)
        XCTAssertEqual(Set(messages).count, cases.count)
        for message in messages {
            XCTAssertFalse(message.isEmpty)
        }
    }

    func testSpaceMessageKeptVerbatim() {
        // The stray-space copy predates CaveHostAdvice — keep it stable.
        XCTAssertEqual(CaveHostAdvice.hasSpace.message, "That has a space — paste just the address.")
    }
}
