import Foundation
import LocalAuthentication

// This helper has no reusable approval token. Each invocation must complete a
// fresh OS authentication, for the exact project and realpath shown by Cave.
let context = LAContext()
context.touchIDAuthenticationAllowableReuseDuration = 0
let policy = LAPolicy.deviceOwnerAuthentication
var error: NSError?
guard context.canEvaluatePolicy(policy, error: &error) else { exit(2) }
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--check" { exit(0) }
guard CommandLine.arguments.count == 2 else { exit(2) }
let semaphore = DispatchSemaphore(value: 0)
var approved = false
context.evaluatePolicy(policy, localizedReason: CommandLine.arguments[1]) { success, _ in
    approved = success
    semaphore.signal()
}
if semaphore.wait(timeout: .now() + 85) == .timedOut {
    context.invalidate()
    exit(3)
}
exit(approved ? 0 : 1)
