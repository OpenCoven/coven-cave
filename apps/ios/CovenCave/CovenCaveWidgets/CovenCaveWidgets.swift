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

// MARK: - Home-screen "Up Next" widget

struct UpNextEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct UpNextProvider: TimelineProvider {
    private var sample: WidgetSnapshot {
        WidgetSnapshot(nextReminderId: "preview",
                       nextReminderTitle: "Stand-up sync",
                       nextReminderDate: Date().addingTimeInterval(3600),
                       dueTaskCount: 2, runningTaskCount: 1, updatedAt: Date())
    }

    func placeholder(in context: Context) -> UpNextEntry {
        UpNextEntry(date: Date(), snapshot: sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (UpNextEntry) -> Void) {
        let snap = context.isPreview ? sample : (WidgetSnapshotStore.read() ?? sample)
        completion(UpNextEntry(date: Date(), snapshot: snap))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpNextEntry>) -> Void) {
        let entry = UpNextEntry(date: Date(), snapshot: WidgetSnapshotStore.read())
        // The app reloads timelines whenever its data changes; this hourly
        // backstop just keeps the relative time fresh while the app is closed.
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date())
            ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct UpNextWidgetView: View {
    var entry: UpNextEntry
    @Environment(\.widgetFamily) private var family

    private var reminderId: String? { entry.snapshot?.nextReminderId }

    var body: some View {
        content
            // Tapping (outside the home-screen buttons) opens the reminders list.
            .widgetURL(URL(string: "covencave://reminders"))
            .containerBackground(for: .widget) {
                switch family {
                case .accessoryCircular: AccessoryWidgetBackground()
                case .accessoryRectangular, .accessoryInline: Color.clear
                default: Rectangle().fill(.fill.tertiary)
                }
            }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline: inlineView
        case .accessoryCircular: circularView
        case .accessoryRectangular: rectangularView
        default: homeScreenView
        }
    }

    // MARK: Home Screen (small / medium)

    private var homeScreenView: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: "sparkles")
                Text("Up Next").font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.tint)

            if let s = entry.snapshot, let title = s.nextReminderTitle {
                VStack(alignment: .leading, spacing: 2) {
                    if let when = s.nextReminderDate {
                        Text(when, format: .dateTime.weekday().hour().minute())
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(title)
                        .font(family == .systemSmall ? .subheadline.weight(.semibold) : .headline)
                        .lineLimit(family == .systemSmall ? 3 : 2)
                }
            } else {
                Text("No upcoming reminders")
                    .font(.subheadline).foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            // When there's a reminder, offer one-tap Complete / Snooze (interactive
            // widget buttons). Otherwise fall back to the running / due counts.
            if let id = reminderId {
                actionButtons(id: id)
            } else {
                counts
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    // MARK: Lock Screen / StandBy (accessory families)

    @ViewBuilder private var inlineView: some View {
        if let s = entry.snapshot, let title = s.nextReminderTitle {
            if let when = s.nextReminderDate {
                Label("\(title) · \(when.formatted(.dateTime.hour().minute()))",
                      systemImage: "bell.fill")
            } else {
                Label(title, systemImage: "bell.fill")
            }
        } else {
            Label("No reminders", systemImage: "bell")
        }
    }

    @ViewBuilder private var circularView: some View {
        VStack(spacing: 1) {
            Image(systemName: "bell.fill").font(.system(size: 12))
            if let when = entry.snapshot?.nextReminderDate {
                Text(when, format: .dateTime.hour().minute())
                    .font(.system(size: 11, weight: .semibold))
                    .minimumScaleFactor(0.6)
            }
        }
        .widgetAccentable()
    }

    @ViewBuilder private var rectangularView: some View {
        if let s = entry.snapshot, let title = s.nextReminderTitle {
            VStack(alignment: .leading, spacing: 1) {
                Label("Up Next", systemImage: "sparkles")
                    .font(.caption2.weight(.semibold))
                    .widgetAccentable()
                Text(title).font(.headline).lineLimit(1)
                if let when = s.nextReminderDate {
                    Text(when, format: .dateTime.weekday().hour().minute())
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
            Label("No upcoming reminders", systemImage: "bell")
                .font(.caption)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }

    private func actionButtons(id: String) -> some View {
        HStack(spacing: 8) {
            Button(intent: CompleteReminderIntent(reminderId: id)) {
                Label("Done", systemImage: "checkmark")
            }
            .tint(.green)
            Button(intent: SnoozeReminderIntent(reminderId: id)) {
                Label("15m", systemImage: "clock.arrow.circlepath")
            }
            .tint(.orange)
        }
        .font(.caption2.weight(.semibold))
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .lineLimit(1)
    }

    private var counts: some View {
        HStack(spacing: 12) {
            if let s = entry.snapshot, s.runningTaskCount > 0 {
                Label("\(s.runningTaskCount) running", systemImage: "play.fill")
                    .foregroundStyle(.tint)
            }
            if let s = entry.snapshot, s.dueTaskCount > 0 {
                Label("\(s.dueTaskCount) due", systemImage: "checklist")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.caption2)
        .lineLimit(1)
    }
}

struct UpNextWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CovenCaveUpNext", provider: UpNextProvider()) { entry in
            UpNextWidgetView(entry: entry)
        }
        .configurationDisplayName("Up Next")
        .description("Your next reminder — on the Home Screen, Lock Screen, or StandBy.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryRectangular, .accessoryCircular, .accessoryInline,
        ])
    }
}

@main
struct CovenCaveWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TaskLiveActivity()
        UpNextWidget()
        RemindersControl()
        TasksControl()
    }
}
