import ActivityKit
import AppIntents
import WidgetKit
import SwiftUI

/// The "task running" Live Activity — Lock Screen banner + Dynamic Island.
/// Shows the task title and a live elapsed-time counter from `startedAt`.
struct TaskLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TaskActivityAttributes.self) { context in
            // Lock Screen / banner presentation.
            HStack(spacing: 12) {
                Image(systemName: "play.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Running task")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(context.attributes.title)
                        .font(.headline).lineLimit(2)
                }
                Spacer(minLength: 8)
                Text(context.attributes.startedAt, style: .timer)
                    .font(.title3.monospacedDigit())
                    .frame(maxWidth: 64, alignment: .trailing)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.35))
            .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "play.circle.fill").foregroundStyle(.tint)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.body.monospacedDigit())
                        .frame(maxWidth: 64, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.subheadline.weight(.medium)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.statusLabel)
                        .font(.caption2).foregroundStyle(.secondary)
                }
            } compactLeading: {
                Image(systemName: "play.fill").foregroundStyle(.tint)
            } compactTrailing: {
                Text(context.attributes.startedAt, style: .timer)
                    .font(.caption2.monospacedDigit())
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "play.fill").foregroundStyle(.tint)
            }
        }
    }
}

// MARK: - Chat turn Live Activity

/// The "familiar is working" Live Activity — mirrors a running chat turn on
/// the Lock Screen and Dynamic Island, ticking through the agent's current
/// step. Tapping anywhere deep-links back into the thread.
struct ChatLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ChatActivityAttributes.self) { context in
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                    .font(.title2)
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.familiarName)
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(context.state.statusLabel)
                        .font(.headline).lineLimit(2)
                }
                Spacer(minLength: 8)
                Text(context.attributes.startedAt, style: .timer)
                    .font(.title3.monospacedDigit())
                    .frame(maxWidth: 64, alignment: .trailing)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.35))
            .activitySystemActionForegroundColor(.primary)
            .widgetURL(URL(string: "covencave://thread/\(context.attributes.threadId)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "bubble.left.and.text.bubble.right.fill")
                        .foregroundStyle(.tint)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.body.monospacedDigit())
                        .frame(maxWidth: 64, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.familiarName)
                        .font(.subheadline.weight(.medium)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.statusLabel)
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "bubble.left.fill").foregroundStyle(.tint)
            } compactTrailing: {
                Text(context.attributes.startedAt, style: .timer)
                    .font(.caption2.monospacedDigit())
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "bubble.left.fill").foregroundStyle(.tint)
            }
            .widgetURL(URL(string: "covencave://thread/\(context.attributes.threadId)"))
        }
    }
}

@main
struct CovenCaveWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TaskLiveActivity()
        ChatLiveActivity()
        TasksControl()
    }
}
