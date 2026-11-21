import { useGT } from "gt-react";
import { DEFAULT_CLIENT_SETTINGS, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";
import { Switch } from "../ui/switch";
import { useSearchableSetting } from "./settingsSearch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { FogBugzSettings } from "./FogBugzSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { ScopedSwitch } from "./ScopedSwitch";

export function MggmSettingsPanel() {
  const uebersetzen = useGT();
  const searchableSetting = useSearchableSetting();
  const { target, connectedEnvironments } = useSettingsScope();
  const svnAvailable =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (environment) =>
        environment.serverConfig?.environment.capabilities.mggmClaudeSvnCheckout === true,
    );
  const settings = useScopedSettings();
  const enabled = settings.mggmThreadSidebarEnabled;
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      {target ? (
        <FogBugzSettings key={target.environmentId} environmentId={target.environmentId} />
      ) : null}
      <SettingsSection title={uebersetzen("Subversion")}>
        <SettingsRow
          {...searchableSetting("mggm-auto-svn-update")}
          serverScoped
          settingKeys={["mggmAutoSvnUpdate"]}
          description={
            svnAvailable
              ? uebersetzen(
                  "Runs svn update in ~/.claude/ daily at 06:00 and 13:00, in the environment’s local time.",
                )
              : uebersetzen(
                  "Requires a T3 environment with a ~/.claude/.svn/ directory. Select an environment with an SVN working copy.",
                )
          }
          control={
            <ScopedSwitch
              settingKeys={["mggmAutoSvnUpdate"]}
              disabled={!svnAvailable}
              checked={svnAvailable && settings.mggmAutoSvnUpdate}
              onCheckedChange={(checked) => updateSettings({ mggmAutoSvnUpdate: checked })}
              aria-label={uebersetzen("Auto-SVN-Update ~/.claude/")}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Codex">
        <SettingsRow
          {...searchableSetting("mggm-codex-expiring-resets")}
          serverScoped
          settingKeys={["mggmCodexAutoRedeemExpiringResets"]}
          description={uebersetzen(
            "Redeem a banked reset during its last hour before expiry, even when the model picker is closed. Applies to Codex accounts on this environment.",
          )}
          resetAction={
            settings.mggmCodexAutoRedeemExpiringResets !==
            DEFAULT_SERVER_SETTINGS.mggmCodexAutoRedeemExpiringResets ? (
              <SettingResetButton
                ariaLabel={uebersetzen("Redeem expiring banked resets")}
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
              aria-label={uebersetzen("Redeem expiring banked resets")}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title={uebersetzen("Layout")}>
        <SettingsRow
          {...searchableSetting("mggm-thread-sidebar")}
          description={uebersetzen(
            "Group idle threads by activity and project, with compact project cards and group separators.",
          )}
          resetAction={
            enabled !== DEFAULT_CLIENT_SETTINGS.mggmThreadSidebarEnabled ? (
              <SettingResetButton
                ariaLabel={uebersetzen("MGGM thread layout")}
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
              aria-label={uebersetzen("MGGM thread layout")}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
