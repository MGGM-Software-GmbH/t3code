import { useGT } from "gt-react";
import { useRef } from "react";
import { Input } from "../ui/input";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/** The path belongs to the selected host, regardless of which browser edits it. */
export function PdSecretsSettings() {
  const uebersetzen = useGT();
  const searchableSetting = useSearchableSetting();
  const { targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["pdSecretsPostLoginScript"]);
  const edited = useRef(false);
  const scopeKey = targets.map((target) => target.environmentId).join(",");

  return (
    <SettingsSection id="pd-secrets" title="pd-secrets">
      <SettingsRow
        {...searchableSetting("pd-secrets-post-login-script")}
        description={uebersetzen(
          "Bash script on this environment, run after successful sign-in. Use an absolute path or ~/; leave empty to skip.",
        )}
        serverScoped
        settingKeys={["pdSecretsPostLoginScript"]}
        resetAction={
          mixed || settings.pdSecretsPostLoginScript !== "" ? (
            <SettingResetButton
              ariaLabel={uebersetzen("pd-secrets post-login script")}
              onClick={() => updateSettings({ pdSecretsPostLoginScript: "" })}
            />
          ) : null
        }
        control={
          <Input
            key={`${scopeKey}:${mixed}:${settings.pdSecretsPostLoginScript}`}
            aria-label={uebersetzen("Post-login script")}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={mixed ? uebersetzen("Mixed") : uebersetzen("No script")}
            defaultValue={mixed ? "" : settings.pdSecretsPostLoginScript}
            onChange={() => {
              edited.current = true;
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (edited.current && (mixed || value !== settings.pdSecretsPostLoginScript))
                updateSettings({ pdSecretsPostLoginScript: value });
              edited.current = false;
            }}
          />
        }
      />
    </SettingsSection>
  );
}
