import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

const projectId = ProjectId.make("project-a");
const instanceId = ProviderInstanceId.make("codex_work");

function settingsWith(overrides: Partial<ServerSettings>): ServerSettings {
  return { ...DEFAULT_SERVER_SETTINGS, ...overrides };
}

describe("deriveProviderInstanceConfigMap", () => {
  const copilotId = ProviderInstanceId.make("githubCopilot");

  it("enables exactly one Codex instance in a new environment", () => {
    const instances = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS);
    expect(
      Object.entries(instances)
        .filter(([, instance]) => resolveProviderInstanceEnabled(instance))
        .map(([id]) => id),
    ).toEqual(["codex"]);
  });

  it("ships GitHub Copilot disabled with its executable resolved through PATH", () => {
    const merged = deriveProviderInstanceConfigMap(settingsWith({ providerInstances: {} }));

    expect(merged[copilotId]).toEqual({
      driver: "acpRegistry",
      displayName: "GitHub Copilot",
      enabled: false,
      config: { source: "registry", agentId: "github-copilot-cli", commandPath: "copilot" },
    });
    expect(merged[ProviderInstanceId.make("acpRegistry")]).toBeUndefined();
  });

  it.each([true, false])("preserves a customized shipped instance with enabled=%s", (enabled) => {
    const settings = settingsWith({
      providerInstances: {
        [copilotId]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled,
          displayName: "Work Copilot",
          config: { source: "local", commandPath: "/opt/copilot", commandArgs: ["--acp"] },
        },
      },
    });

    expect(deriveProviderInstanceConfigMap(settings)[copilotId]).toBe(
      settings.providerInstances[copilotId],
    );
  });

  it("probes a disabled shipped instance when a project enables it", () => {
    const settings = settingsWith({
      providerInstances: {
        [copilotId]: { driver: ProviderDriverKind.make("acpRegistry"), enabled: false },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [copilotId]: { enabled: true } } },
      },
    });

    expect(deriveProviderInstanceConfigMap(settings)[copilotId]?.enabled).toBe(true);
    expect(settings.providerInstances[copilotId]?.enabled).toBe(false);
  });

  it("turns a machine-disabled instance on when a project enables it", () => {
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: false },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toEqual({ driver: ProviderDriverKind.make("codex"), enabled: true });
  });

  it("clears a nested config.enabled:false flag when a project enables the instance", () => {
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("codex"),
          config: { enabled: false },
        },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toEqual({
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: { enabled: true },
    });
  });

  it("does not revive an instance a project override references but settings no longer configure", () => {
    const settings = settingsWith({
      providerInstances: {},
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toBeUndefined();
  });

  it("ignores a project override that disables an instance, leaving the machine's config in charge", () => {
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toBe(settings.providerInstances[instanceId]);
  });
});
