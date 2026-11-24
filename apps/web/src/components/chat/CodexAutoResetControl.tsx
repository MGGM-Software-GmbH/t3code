import { useGT, T } from "gt-react";
import {
  AuthSettingsWriteScope,
  isManagedSettingPath,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentScope } from "../../state/session";
import { useServerConfigs } from "../../state/entities";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function CodexAutoResetControl({ environmentId }: { environmentId: EnvironmentId }) {
  const uebersetzen = useGT();
  const enabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.mggmCodexAutoRedeemAtWeeklyLimit,
  );
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const writable = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const policy = useServerConfigs().get(environmentId)?.managedPolicy;
  const managed =
    policy !== undefined && isManagedSettingPath(policy, "mggmCodexAutoRedeemAtWeeklyLimit");
  return (
    <div className="shrink-0 border-t border-border/70 px-3 py-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
              <span>
                <T>Auto-redeem at 0%</T>
              </span>
              <Switch
                size="sm"
                checked={enabled}
                disabled={!writable || managed}
                onCheckedChange={(checked) =>
                  updateSettings({ mggmCodexAutoRedeemAtWeeklyLimit: checked })
                }
                aria-label={uebersetzen("Auto-redeem banked reset at 0% weekly limit")}
              />
            </label>
          }
        />
        <TooltipPopup>
          <T>
            Redeem a banked reset when a Codex account has no weekly allowance left. Applies to all
            Codex accounts on this environment, even when the picker is closed.
          </T>
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
