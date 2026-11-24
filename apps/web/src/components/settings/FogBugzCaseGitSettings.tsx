import { useGT } from "gt-react";
import { DraftInput } from "../ui/draft-input";
import { SettingsRow } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function FogBugzCaseGitSettings() {
  const uebersetzen = useGT();
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["fogbugzCaseGitDirectory"]);
  return (
    <SettingsRow
      title={uebersetzen("Case-Git checkout folder")}
      description={uebersetzen(
        "Absolute or project-relative path. Threads share {folder}/FB12345; empty keeps per-thread checkouts. For SVN projects, adding this folder to svn:ignore is recommended.",
        { folder: "<folder>" },
      )}
      serverScoped
      settingKeys={["fogbugzCaseGitDirectory"]}
      mixed={mixed}
      control={
        <DraftInput
          aria-label={uebersetzen("Case-Git checkout folder")}
          placeholder={mixed ? uebersetzen("Mixed") : uebersetzen("Separate per-thread checkouts")}
          value={mixed ? "" : settings.fogbugzCaseGitDirectory}
          onCommit={(value) => update({ fogbugzCaseGitDirectory: value.trim() })}
        />
      }
    />
  );
}
