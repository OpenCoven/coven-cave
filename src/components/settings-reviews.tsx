"use client";

/**
 * Settings › General › Reviews (#5930).
 *
 * "Include my pull requests in Reviews" (default on) adds your own open pull
 * requests to the new-session launcher's Reviews group, marked as yours. It
 * lives in the server-backed `github` preferences. "Review automatically when
 * marked ready" joins this group once its watcher can ship (#5930 part 2).
 */

import { useId } from "react";
import { SettingsGroup } from "@/components/ui/settings-group";
import { useAnnouncer } from "@/components/ui/live-region";
import { updateAppPreferences, useAppPreferences } from "@/lib/app-preferences";
import { showSettingsSavedAfterPreferencesFlush } from "@/lib/settings-save-feedback";
import { SettingsRow } from "./settings-layout";

export function ReviewsSettingsGroup() {
  const github = useAppPreferences().github;
  const { announce } = useAnnouncer();
  const includeDescriptionId = useId();

  return (
    <SettingsGroup label="Reviews" variant="ruled" panel={false}>
      <div className="settings-progression-card">
        <SettingsRow
          label="Include my pull requests in Reviews"
          description="Your open pull requests appear in the new-session Reviews group, marked as yours."
          descriptionId={includeDescriptionId}
        >
          <button
            type="button"
            role="switch"
            aria-checked={github.reviewOwnPrs}
            aria-label="Include my pull requests in Reviews"
            aria-describedby={includeDescriptionId}
            onClick={() => {
              updateAppPreferences({ github: { reviewOwnPrs: !github.reviewOwnPrs } });
              announce(
                github.reviewOwnPrs
                  ? "Your pull requests no longer appear in Reviews."
                  : "Your pull requests now appear in Reviews.",
                "polite",
              );
              void showSettingsSavedAfterPreferencesFlush();
            }}
            className={`settings-switch focus-ring${github.reviewOwnPrs ? " is-on" : ""}`}
          >
            <span className="settings-switch__knob" aria-hidden />
          </button>
        </SettingsRow>
      </div>
    </SettingsGroup>
  );
}
