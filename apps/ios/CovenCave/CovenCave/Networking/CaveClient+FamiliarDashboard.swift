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
            urlRequest = try request(FamiliarDashboardEndpoint.path(encodedFamiliarId: encoded))
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

        let payload: FamiliarDashboardPayload
        do {
            payload = try JSONDecoder().decode(FamiliarDashboardPayload.self, from: data)
        } catch {
            throw FamiliarDashboardError.decoding(String(describing: error))
        }

        // A 200 whose envelope says `ok:false` is not a success, whatever the
        // status line claims.
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
