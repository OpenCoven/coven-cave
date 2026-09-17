import Foundation
import Observation

/// Per-Familiar dashboard state for the native hub: what is on screen, what is
/// in flight, and what the last answer was.
///
/// ## Why it is keyed by Familiar and why that does not leak
///
/// A single "current dashboard" field looks simpler until a switch happens
/// mid-request: the previous Familiar's answer lands, writes into the one
/// field, and the hub attributes one Familiar's sessions to another. Every
/// write here names the Familiar it belongs to, so a late answer can only ever
/// land in its own cell — and on a switch that cell is not on screen.
///
/// Keying by id is a dictionary, and a dictionary that only grows is a leak, so
/// three things bound it:
///
/// - a **capacity** with LRU eviction, never evicting the Familiar on screen
///   nor one with a request in flight;
/// - a **reset on endpoint change** — a snapshot assembled by one Cave must
///   never render under a different pairing, which is a correctness rule before
///   it is a memory one;
/// - **nothing is persisted.** `cave-9rwd.2` explicitly keeps dashboards in
///   memory only, so a cold launch starts honest.
///
/// ## Cancellation, deduplication, and answers that arrive too late
///
/// Three separate mechanisms, because they defend against different things:
///
/// - **Dedup (single flight).** One request per Familiar at a time. The 30s
///   tick and a pull-to-refresh that overlap it produce ONE request; the second
///   caller awaits the first's task instead of launching its own.
/// - **Cancellation.** Switching Familiar cancels every other Familiar's
///   in-flight request. A cancelled request is not evidence about the desktop,
///   so it records no error and marks nothing stale.
/// - **Relevance (nonce + epoch).** Cancellation is a request, not a guarantee
///   — a response can already be decoded when the cancel lands. So before any
///   answer is written the store re-checks that it is still the answer that was
///   asked for: same nonce, same epoch. A superseded answer is dropped.
@MainActor
@Observable
final class FamiliarDashboardStore {
    /// How many Familiars' dashboards are kept. A Coven roster is small; this
    /// bounds a browse through every Familiar without evicting anything a
    /// person is likely to flip back to.
    static let defaultCapacity = 8

    private(set) var entries: [String: FamiliarDashboardEntry] = [:]
    /// The Familiar the hub is showing. Never evicted, never cancelled.
    private(set) var activeFamiliarId: String?

    private struct InFlightRequest {
        let nonce: UInt64
        let task: Task<Void, Never>
    }

    private let capacity: Int
    private let now: () -> Date
    private var inFlight: [String: InFlightRequest] = [:]
    /// Least-recently-touched first.
    private var accessOrder: [String] = []
    /// Bumped by `reset()`. An answer launched under an older epoch belongs to
    /// a pairing that no longer applies and is discarded rather than merged.
    private var epoch: UInt64 = 0
    private var nextNonce: UInt64 = 0
    private var endpointKey: String?

    init(capacity: Int = FamiliarDashboardStore.defaultCapacity, now: @escaping () -> Date = Date.init) {
        self.capacity = capacity
        self.now = now
    }

    // MARK: - Reading

    func entry(for familiarId: String) -> FamiliarDashboardEntry {
        entries[familiarId] ?? FamiliarDashboardEntry()
    }

    func snapshot(for familiarId: String) -> FamiliarDashboardSnapshot? {
        entries[familiarId]?.snapshot
    }

    #if DEBUG
    func seedPreview(_ snapshot: FamiliarDashboardSnapshot) {
        entries[snapshot.familiarId] = FamiliarDashboardEntry(
            phase: .ready,
            snapshot: snapshot,
            error: nil,
            lastLoadedAt: now(),
            lastAttemptedAt: nil
        )
        touch(snapshot.familiarId)
        evictIfNeeded()
    }
    #endif

    /// Test/inspection seam: how many Familiars are currently cached.
    var cachedFamiliarCount: Int { entries.count }

    var hasRequestInFlight: Bool { !inFlight.isEmpty }

    func hasRequestInFlight(for familiarId: String) -> Bool {
        inFlight[familiarId] != nil
    }

    // MARK: - Lifecycle

    /// Bind the store to a desktop endpoint. Any change drops everything.
    ///
    /// This is not tidiness. Two Caves can hold Familiars with the same id, so
    /// keeping a snapshot across a re-pair would render one desktop's sessions,
    /// contract findings and memory under another desktop's Familiar — with
    /// every field looking perfectly well-formed.
    func setEndpointKey(_ key: String?) {
        guard key != endpointKey else { return }
        endpointKey = key
        reset()
    }

    /// Make `familiarId` the Familiar on screen.
    ///
    /// Cancels every OTHER Familiar's in-flight request: after a switch that
    /// answer cannot be shown, and finishing it spends the phone's radio on a
    /// screen nobody is looking at.
    func activate(familiarId: String) {
        activeFamiliarId = familiarId
        for (id, request) in inFlight where id != familiarId {
            request.task.cancel()
            inFlight[id] = nil
            settlePhaseAfterCancellation(id)
        }
        if entries[familiarId] == nil {
            entries[familiarId] = FamiliarDashboardEntry()
        }
        touch(familiarId)
        evictIfNeeded()
    }

    func cancelAll() {
        for (id, request) in inFlight {
            request.task.cancel()
            inFlight[id] = nil
            settlePhaseAfterCancellation(id)
        }
    }

    /// Drop every cached dashboard and invalidate every request in flight.
    func reset() {
        epoch &+= 1
        cancelAll()
        entries.removeAll()
        accessOrder.removeAll()
        activeFamiliarId = nil
    }

    // MARK: - Refreshing

    /// Load or refresh one Familiar's dashboard.
    ///
    /// Returns `true` when this call launched the request and `false` when it
    /// joined one already in flight — which is what makes an overlapping timer
    /// tick and pull-to-refresh cost one round trip rather than two. Both
    /// callers await the same answer either way.
    @discardableResult
    func refresh(
        familiarId: String,
        using loader: any FamiliarDashboardLoading
    ) async -> Bool {
        if let existing = inFlight[familiarId] {
            await existing.task.value
            return false
        }

        nextNonce &+= 1
        let nonce = nextNonce
        let launchEpoch = epoch

        var entry = entries[familiarId] ?? FamiliarDashboardEntry()
        // A refresh over existing content is NOT a first load: the hub keeps
        // rendering the snapshot instead of replacing it with a skeleton.
        entry.phase = entry.snapshot == nil ? .loading : .refreshing
        entry.lastAttemptedAt = now()
        entries[familiarId] = entry
        touch(familiarId)

        let task = Task { [weak self] in
            guard let self else { return }
            await self.perform(
                familiarId: familiarId, nonce: nonce, launchEpoch: launchEpoch, loader: loader)
        }
        inFlight[familiarId] = InFlightRequest(nonce: nonce, task: task)
        // Registered BEFORE the sweep, so the entry this request is about to
        // fill cannot be the one evicted to make room for it. (The task body
        // cannot have run yet: it is MainActor-isolated and this method has not
        // suspended.)
        evictIfNeeded()
        await task.value
        return true
    }

    private func perform(
        familiarId: String,
        nonce: UInt64,
        launchEpoch: UInt64,
        loader: any FamiliarDashboardLoading
    ) async {
        let outcome: Result<FamiliarDashboardPayload, FamiliarDashboardError>
        do {
            outcome = .success(try await loader.familiarDashboard(id: familiarId))
        } catch let error as FamiliarDashboardError {
            outcome = .failure(error)
        } catch is CancellationError {
            outcome = .failure(.transport("cancelled"))
        } catch {
            outcome = .failure(.transport(String(describing: error)))
        }

        // Release our own slot, and only our own: a cancel-and-relaunch while
        // we were suspended must not blow away the successor's registration.
        if inFlight[familiarId]?.nonce == nonce {
            inFlight[familiarId] = nil
        }

        // A cancelled request says nothing about the desktop. It must not
        // record an error and must not mark a single section stale — doing so
        // would tell a person their data is out of date because they switched
        // tabs.
        if Task.isCancelled {
            settlePhaseAfterCancellation(familiarId)
            return
        }
        // Launched against a pairing that has since been replaced.
        guard launchEpoch == epoch else { return }
        // A successor is already in flight for this Familiar; let it settle.
        guard inFlight[familiarId] == nil else { return }

        apply(outcome, familiarId: familiarId)
    }

    private func apply(
        _ outcome: Result<FamiliarDashboardPayload, FamiliarDashboardError>,
        familiarId: String
    ) {
        var entry = entries[familiarId] ?? FamiliarDashboardEntry()

        switch outcome {
        case .success(let payload):
            entry.snapshot = FamiliarDashboardSnapshot.merged(
                previous: entry.snapshot, payload: payload)
            entry.phase = .ready
            entry.error = nil
            entry.lastLoadedAt = now()

        case .failure(let error):
            entry.error = error
            if error.isMissingFamiliar {
                // The Familiar is gone. Keeping its last snapshot would render
                // a deleted Familiar's sessions as though it were still there,
                // which is worse than an empty screen.
                entry.snapshot = nil
                entry.phase = .missing
            } else if let snapshot = entry.snapshot {
                // Last-known-good survives, but every section that has content
                // now says so: the data is real, and it has stopped moving.
                entry.snapshot = snapshot.markedStale()
                entry.phase = .ready
            } else {
                entry.phase = .failed
            }
            // `lastLoadedAt` deliberately untouched — it records the last
            // SUCCESS, and a failed refresh must never make data look newer.
        }

        entries[familiarId] = entry
        touch(familiarId)
    }

    // MARK: - Bookkeeping

    private func settlePhaseAfterCancellation(_ familiarId: String) {
        // A successor took over; its own completion owns the phase.
        guard inFlight[familiarId] == nil else { return }
        guard var entry = entries[familiarId], entry.isBusy else { return }
        entry.phase = entry.snapshot == nil ? .idle : .ready
        entries[familiarId] = entry
    }

    private func touch(_ familiarId: String) {
        accessOrder.removeAll { $0 == familiarId }
        accessOrder.append(familiarId)
    }

    private func evictIfNeeded() {
        guard capacity > 0 else { return }
        while entries.count > capacity {
            // Never evict the Familiar on screen, and never one with a request
            // in flight — that answer has nowhere to land and the request
            // would have been spent for nothing.
            guard let index = accessOrder.firstIndex(where: { id in
                id != activeFamiliarId && inFlight[id] == nil && entries[id] != nil
            }) else { return }
            let victim = accessOrder.remove(at: index)
            entries[victim] = nil
        }
    }
}
