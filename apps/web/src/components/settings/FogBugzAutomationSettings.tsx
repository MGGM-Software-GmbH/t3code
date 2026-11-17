import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useUpdateScopedSettings,
  useScopedSettingsMixed,
} from "./useScopedSettings";

export function FogBugzAutomationSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const mixedSettle = useScopedSettingsMixed(["fogbugzAutoSettle"]);
  const mixedUnsettle = useScopedSettingsMixed(["fogbugzAutoUnsettle"]);
  const mixedAnalyze = useScopedSettingsMixed(["fogbugzAutoAnalyze"]);
  const settle = { never: "Never", resolved: "On resolved", closed: "On closed" };
  const analyze = { never: "Never", initial: "Only initial event", assigned: "Any assigned to me" };
  return (
    <>
      <SettingsRow
        {...searchableSetting("fogbugz-auto-settle")}
        title="Auto-Settle on"
        serverScoped
        settingKeys={["fogbugzAutoSettle"]}
        mixed={mixedSettle}
        control={
          <Select
            value={mixedSettle ? null : settings.fogbugzAutoSettle}
            onValueChange={(value) => {
              if (value === "never" || value === "resolved" || value === "closed")
                update({ fogbugzAutoSettle: value });
            }}
          >
            <SelectTrigger aria-label="Auto-Settle on">
              <SelectValue>
                {mixedSettle ? "Mixed" : settle[settings.fogbugzAutoSettle]}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {Object.entries(settle).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("fogbugz-auto-unsettle")}
        title="Auto-Unsettle On reactivate"
        serverScoped
        settingKeys={["fogbugzAutoUnsettle"]}
        mixed={mixedUnsettle}
        control={
          <Switch
            aria-label="Auto-Unsettle On reactivate"
            checked={settings.fogbugzAutoUnsettle}
            onCheckedChange={(value) => update({ fogbugzAutoUnsettle: value })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("fogbugz-auto-analyze")}
        title="Auto-Analyze New Cases"
        serverScoped
        settingKeys={["fogbugzAutoAnalyze"]}
        mixed={mixedAnalyze}
        description="Starts an analysis-only agent run for newly created cases assigned to you, or also after a later assignment. Uses the project's default model and may incur costs."
        control={
          <Select
            value={mixedAnalyze ? null : settings.fogbugzAutoAnalyze}
            onValueChange={(value) => {
              if (value === "never" || value === "initial" || value === "assigned")
                update({ fogbugzAutoAnalyze: value });
            }}
          >
            <SelectTrigger aria-label="Auto-Analyze New Cases">
              <SelectValue>
                {mixedAnalyze ? "Mixed" : analyze[settings.fogbugzAutoAnalyze]}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {Object.entries(analyze).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {settings.fogbugzAutoAnalyze !== "never" && settings.defaultModelSelection === null ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          Select a default model for this scope to run automatic case analysis.
        </p>
      ) : null}
    </>
  );
}
