import { DEFAULT_CLIENT_SETTINGS, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { FogBugzSettings } from "./FogBugzSettings";
import { useSettingsScope } from "./SettingsScopeContext";

export function MggmSettingsPanel() {
  const { target } = useSettingsScope();
  const settings = useScopedSettings();
  const enabled = settings.mggmThreadSidebarEnabled;
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      {target ? (
        <FogBugzSettings key={target.environmentId} environmentId={target.environmentId} />
      ) : null}
      <SettingsSection title="Codex">
        <SettingsRow
          {...searchableSetting("mggm-codex-expiring-resets")}
          serverScoped
          settingKeys={["mggmCodexAutoRedeemExpiringResets"]}
          description="Redeem a banked reset during its last hour before expiry, even when the model picker is closed. Applies to Codex accounts on this environment."
          resetAction={
            settings.mggmCodexAutoRedeemExpiringResets !==
            DEFAULT_SERVER_SETTINGS.mggmCodexAutoRedeemExpiringResets ? (
              <SettingResetButton
                label="Redeem expiring banked resets"
                onClick={() => updateSettings({ mggmCodexAutoRedeemExpiringResets: true })}
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.mggmCodexAutoRedeemExpiringResets}
              onCheckedChange={(checked) =>
                updateSettings({ mggmCodexAutoRedeemExpiringResets: checked })
              }
              aria-label="Redeem expiring banked resets"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Layout">
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
