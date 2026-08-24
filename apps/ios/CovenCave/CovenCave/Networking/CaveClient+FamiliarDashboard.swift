import Foundation

/// The one call the Familiar hub needs.
///
/// A protocol rather than a concrete `CaveClient` so `FamiliarDashboardStore`
/// — where the refresh, dedup and cancellation rules live — is testable
/// without a desktop, a simulator, or a URL protocol stub. `CaveClient`
/// conforms with the method below.
protocol FamiliarDashboardLoading: Sendable {
    func familiarDashboard(id: String) async throws -> FamiliarDashboardPayload
}

extension CaveClient: FamiliarDashboardLoading {
    /// `GET /api/familiars/<id>/dashboard?v=1`
    ///
    /// Every refusal is translated into a `FamiliarDashboardError` rather than
    /// a `CaveError`. That is deliberate: this route answers **403** for an id
    /// that fails the slug guard, and `CaveError.isAuthFailure` reads an
    /// unlabelled 403 as a credential problem — so reusing `CaveError` here
    /// would push a user back through Tailscale pairing because a familiar id
    /// had a character the server will not interpolate into a path.
    func familiarDashboard(id: String) async throws -> FamiliarDashboardPayload {
        let urlRequest: URLRequest
        do {
            let encoded = try Self.encodedPathSegment(id)
            // `pathIsPercentEncoded` is what stops the escape being applied
            // twice. Without it `request(_:)` reaches for
            // `appendingPathComponent`, which escapes the `%` of the segment we
            // just built — so a familiar id carrying a slash goes out as
            // `nova%252Ffamiliar`, and the desktop reads that as the literal
            // id `nova%2Ffamiliar` rather than `nova/familiar`. The avatar
            // routes on this client already pass the flag; this one did not.
            urlRequest = try request(
                FamiliarDashboardEndpoint.path(encodedFamiliarId: encoded),
                pathIsPercentEncoded: true
            )
        } catch CaveError.notConfigured {
            throw FamiliarDashboardError.notConfigured
        } catch {
            throw FamiliarDashboardError.transport(String(describing: error))
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.data(for: urlRequest)
        } catch {
            throw FamiliarDashboardError.transport(String(describing: error))
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            // The refusal envelope is `{ ok:false, error, code }`. The `code`
            // is what this client switches on; `error` is prose meant for a
            // human reading desktop logs and is deliberately never rendered.
            let failure = try? JSONDecoder().decode(FamiliarDashboardFailurePayload.self, from: data)
            throw FamiliarDashboardError.forRefusal(status: status, code: failure?.code)
        }

        // A 200 whose envelope says `ok:false` is not a success, whatever the
        // status line claims — and it is read BEFORE the success decode
        // because a refusal body carries none of the success fields. Decoding
        // it as a success reports a missing-key decode error and throws away
        // the refusal the body is plainly stating, which is a worse answer in
        // both directions: the caller cannot retry (`.decoding` is not
        // retryable, `.unavailable` is) and the hub blames the client's parser
        // for a desktop that said, in as many words, that it could not build
        // the dashboard.
        if let refusal = try? JSONDecoder().decode(
            FamiliarDashboardFailurePayload.self, from: data
        ), !refusal.ok {
            let classified = FamiliarDashboardError.forRefusal(status: status, code: refusal.code)
            // A 2xx carries no usable status fallback, so an unrecognised code
            // still means the dashboard did not come back.
            if case .refused = classified { throw FamiliarDashboardError.unavailable }
            throw classified
        }

        let payload: FamiliarDashboardPayload
        do {
            payload = try JSONDecoder().decode(FamiliarDashboardPayload.self, from: data)
        } catch {
            throw FamiliarDashboardError.decoding(String(describing: error))
        }

        // Backstop for a body that decodes as the success shape but whose
        // envelope still says `ok:false` — unreachable while the refusal
        // decode above succeeds, and cheap enough to keep as the invariant.
        guard payload.ok else { throw FamiliarDashboardError.unavailable }

        // The request carried `?v=1`, so a well-behaved desktop either answers
        // version 1 or refuses with 400. A different version arriving anyway
        // means one side is not the build it claims to be; rendering it would
        // be reading a shape this client does not understand.
        guard payload.version == FamiliarDashboardContract.version else {
            throw FamiliarDashboardError.unsupportedVersion
        }

        // Guards against a proxy, a cache, or a redirect answering with some
        // other familiar's dashboard. Writing that into the requesting
        // familiar's cache would attribute one Familiar's work to another —
        // silently, and with every field looking perfectly well-formed.
        guard payload.familiarId == id else {
            throw FamiliarDashboardError.identityMismatch(
                requested: id, received: payload.familiarId)
        }

        return payload
    }
}
