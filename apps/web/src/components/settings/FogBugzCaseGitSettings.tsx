import { DraftInput } from "../ui/draft-input";
import { SettingsRow } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function FogBugzCaseGitSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["fogbugzCaseGitDirectory"]);
  return (
    <SettingsRow
      title="Case-Git checkout folder"
      description="Absolute or project-relative path. Threads share <folder>/FB12345; empty keeps per-thread checkouts. For SVN projects, adding this folder to svn:ignore is recommended."
      serverScoped
      settingKeys={["fogbugzCaseGitDirectory"]}
      mixed={mixed}
      control={
        <DraftInput
          aria-label="Case-Git checkout folder"
          placeholder={mixed ? "Mixed" : "Separate per-thread checkouts"}
          value={mixed ? "" : settings.fogbugzCaseGitDirectory}
          onCommit={(value) => update({ fogbugzCaseGitDirectory: value.trim() })}
        />
      }
    />
  );
}
