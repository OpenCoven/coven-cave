import Foundation
import XCTest
@testable import CovenCave

final class ConnectionDiagnosisTests: XCTestCase {
    // MARK: - URLError classification

    func testOfflineCodesClassifyAsOffline() {
        XCTAssertEqual(ProbeFailure(classifying: URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(ProbeFailure(classifying: URLError(.dataNotAllowed)), .offline)
    }

    func testDNSCodesClassifyAsDNSFailure() {
        XCTAssertEqual(ProbeFailure(classifying: URLError(.cannotFindHost)), .dnsFailure)
        XCTAssertEqual(ProbeFailure(classifying: URLError(.dnsLookupFailed)), .dnsFailure)
    }

    func testTimeoutClassifies() {
        XCTAssertEqual(ProbeFailure(classifying: URLError(.timedOut)), .timeout)
    }

    func testRefusedCodesClassify() {
        XCTAssertEqual(ProbeFailure(classifying: URLError(.cannotConnectToHost)), .refused)
        XCTAssertEqual(ProbeFailure(classifying: URLError(.networkConnectionLost)), .refused)
    }

    func testTLSCodesClassify() {
        XCTAssertEqual(ProbeFailure(classifying: URLError(.secureConnectionFailed)), .tlsFailure)
        XCTAssertEqual(ProbeFailure(classifying: URLError(.serverCertificateUntrusted)), .tlsFailure)
    }

    func testUnknownErrorsFallBackToTransport() {
        XCTAssertEqual(ProbeFailure(classifying: URLError(.badURL)), .transport)
        struct Weird: Error {}
        XCTAssertEqual(ProbeFailure(classifying: Weird()), .transport)
    }

    // MARK: - Adjudication ranking (max = strongest diagnosis)

    func testStrongerSignalsOutrankWeaker() {
        // "Something answered but wasn't Cave" beats "connection refused"
        // beats "DNS failure" beats "timeout" beats raw transport.
        XCTAssertEqual(max(ProbeFailure.timeout, .refused), .refused)
        XCTAssertEqual(max(ProbeFailure.dnsFailure, .wrongServer), .wrongServer)
        XCTAssertEqual(max(ProbeFailure.transport, .timeout), .timeout)
        XCTAssertEqual(max(ProbeFailure.tlsFailure, .dnsFailure), .tlsFailure)
    }

    func testOfflineOutranksEverything() {
        for other: ProbeFailure in [.transport, .timeout, .dnsFailure, .tlsFailure, .refused, .wrongServer] {
            XCTAssertEqual(max(ProbeFailure.offline, other), .offline)
        }
    }

    // MARK: - Diagnosis copy

    func testNilFailureKeepsTheGenericCopyVerbatim() {
        let generic = ConnectionDiagnosis.diagnosis(for: nil)
        XCTAssertEqual(generic, .generic)
        XCTAssertEqual(generic.title, "Tailscale disconnected?")
        XCTAssertEqual(generic.message, "Couldn’t reach the desktop. Is it on the tailnet and running?")
    }

    func testEveryFailureGetsDistinctActionableCopy() {
        let failures: [ProbeFailure] = [.transport, .timeout, .dnsFailure, .tlsFailure, .refused, .wrongServer, .offline]
        let diagnoses = failures.map { ConnectionDiagnosis.diagnosis(for: $0) }
        XCTAssertEqual(Set(diagnoses.map(\.title)).count, failures.count, "every failure class tells its own story")
        for diagnosis in diagnoses {
            XCTAssertFalse(diagnosis.title.isEmpty)
            XCTAssertFalse(diagnosis.message.isEmpty)
            XCTAssertFalse(diagnosis.guidance.isEmpty)
            XCTAssertFalse(diagnosis.systemImage.isEmpty)
        }
    }

    func testKeyDiagnosesNameTheirCause() {
        XCTAssertTrue(ConnectionDiagnosis.diagnosis(for: .offline).title.localizedCaseInsensitiveContains("offline"))
        XCTAssertTrue(ConnectionDiagnosis.diagnosis(for: .dnsFailure).message.localizedCaseInsensitiveContains("magicdns"))
        XCTAssertTrue(ConnectionDiagnosis.diagnosis(for: .refused).message.localizedCaseInsensitiveContains("port"))
        XCTAssertTrue(ConnectionDiagnosis.diagnosis(for: .wrongServer).message.localizedCaseInsensitiveContains("isn’t the Cave"))
    }

    func testPreviewLinesAreDistinctAndNonEmpty() {
        let failures: [ProbeFailure] = [.transport, .timeout, .dnsFailure, .tlsFailure, .refused, .wrongServer, .offline]
        let lines = failures.map(\.previewLine)
        XCTAssertEqual(Set(lines).count, failures.count)
        for line in lines {
            XCTAssertFalse(line.isEmpty)
        }
    }
}
