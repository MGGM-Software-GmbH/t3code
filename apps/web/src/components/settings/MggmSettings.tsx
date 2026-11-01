import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function MggmSettingsPanel() {
  const settings = useScopedSettings();
  const enabled = settings.mggmThreadSidebarEnabled;
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="MGGM">
        <SettingsRow
          {...searchableSetting("mggm-thread-sidebar")}
          description="Group idle threads by activity and project, with compact project cards and group separators."
          resetAction={
            enabled !== DEFAULT_CLIENT_SETTINGS.mggmThreadSidebarEnabled ? (
              <SettingResetButton
                label="MGGM thread layout"
                onClick={() =>
                  updateSettings({
                    mggmThreadSidebarEnabled: DEFAULT_CLIENT_SETTINGS.mggmThreadSidebarEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => updateSettings({ mggmThreadSidebarEnabled: checked })}
              aria-label="MGGM thread layout"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
