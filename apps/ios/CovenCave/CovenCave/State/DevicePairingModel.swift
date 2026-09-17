import Foundation
import Observation

@MainActor @Observable
final class DevicePairingModel {
    private(set) var pending: PendingDeviceAccess?
    private(set) var isRunning = false
    private(set) var message: String?
    private(set) var legacyDesktop = false

    @ObservationIgnored private let load: () throws -> PendingDeviceAccess?
    @ObservationIgnored private let save: (PendingDeviceAccess) throws -> Void
    @ObservationIgnored private let installationID: () -> String
    @ObservationIgnored private var presentationGeneration = 0

    init(
        load: @escaping () throws -> PendingDeviceAccess? = DeviceAccessStore.load,
        save: @escaping (PendingDeviceAccess) throws -> Void = DeviceAccessStore.save,
        installationID: @escaping () -> String = { DeviceAccessStore.installationID() }
    ) {
        self.load = load
        self.save = save
        self.installationID = installationID
    }

    func restore() -> String? {
        do {
            pending = try load()
            message = pending?.device.status.message
            return pending?.origin
        } catch {
            message = error.localizedDescription
            return nil
        }
    }

    func resetPresentation() {
        presentationGeneration += 1
        pending = nil
        message = nil
        legacyDesktop = false
    }

    /// Returns a credential only after /status says allowed. A cancelled task
    /// never hands authority to AppModel, even if its HTTP response won the race.
    func run(
        client: DeviceAccessClient,
        create: Bool,
        label: String,
        pollingInterval: Duration = .seconds(2),
        maximumWait: Duration = .seconds(300)
    ) async -> PendingDeviceAccess? {
        guard !isRunning else { return nil }
        let generation = presentationGeneration
        isRunning = true
        legacyDesktop = false
        defer { isRunning = false }
        do {
            let initial: PendingDeviceAccess
            if create {
                message = "Requesting desktop access…"
                initial = try await client.request(installationID: installationID(), label: label)
                // Preserve a returned secret even if the view was just dismissed.
                // This does not activate it; resuming still requires /status.
                try save(initial)
            } else {
                guard let stored = try load() else { throw DeviceAccessError.storage }
                initial = stored
            }
            guard generation == presentationGeneration else { return nil }
            pending = initial
            message = initial.device.status.message
            try Task.checkCancellation()
            let device = try await withThrowingTaskGroup(of: DeviceAccessDevice.self) { group in
                group.addTask {
                    var current = initial
                    while true {
                        try Task.checkCancellation()
                        current.device = try await client.status(current)
                        try Task.checkCancellation()
                        if current.device.status != .pending { return current.device }
                        if current.device.pairingExpiresAt <= Date() {
                            current.device.status = .expired
                            return current.device
                        }
                        try await Task.sleep(for: pollingInterval)
                    }
                }
                group.addTask {
                    try await Task.sleep(for: maximumWait)
                    var expired = initial.device
                    expired.status = .expired
                    return expired
                }
                defer { group.cancelAll() }
                guard let device = try await group.next() else { throw CancellationError() }
                return device
            }
            try Task.checkCancellation()
            guard generation == presentationGeneration else { return nil }
            let result = PendingDeviceAccess(origin: initial.origin, credential: initial.credential, device: device)
            try save(result)
            pending = result
            message = device.status.message
            return device.status == .allowed ? result : nil
        } catch {
            guard generation == presentationGeneration else { return nil }
            if Task.isCancelled || error is CancellationError {
                message = "Approval waiting paused. Resume to check the desktop's decision."
            } else if !create,
                      let refusal = error as? DeviceAccessError,
                      refusal == .refused(401) || refusal == .refused(403),
                      var stored = pending {
                stored.device.status = .revoked
                do {
                    try save(stored)
                    pending = stored
                    message = DeviceAccessStatus.revoked.message
                } catch {
                    message = error.localizedDescription
                }
            } else {
                legacyDesktop = (error as? DeviceAccessError) == .legacyDesktop
                    || (error as? DeviceAccessError) == .disabled
                message = error.localizedDescription
            }
            return nil
        }
    }
}
