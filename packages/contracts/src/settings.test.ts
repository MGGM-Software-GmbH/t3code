import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { type CommandId, ProjectId } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  ClientSettingsSchema,
  ClientSettingsPatch,
  StoredClientSettingsSchema,
  ClaudeSettings,
  CodexSettings,
  DEFAULT_SERVER_SETTINGS,
  globalIdleCompaction,
  idleCompactionPatch,
  requiredScopesForProjectMutation,
  resolveIdleCompaction,
  resolveProjectProviderInstanceEnabled,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ServerSettingsPatch,
  withIdleCompaction,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeStoredClientSettings = Schema.decodeUnknownSync(StoredClientSettingsSchema);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);

describe("MGGM thread sidebar settings", () => {
  it("enables the layout for new and stored settings and preserves an explicit opt-out", () => {
    expect(decodeClientSettings({}).mggmThreadSidebarEnabled).toBe(true);
    expect(decodeStoredClientSettings({}).mggmThreadSidebarEnabled).toBe(true);
    const patch = decodeClientSettingsPatch({ mggmThreadSidebarEnabled: false });
    expect(patch.mggmThreadSidebarEnabled).toBe(false);
    const disabled = decodeClientSettings(patch);
    expect(
      decodeStoredClientSettings(encodeClientSettings(disabled)).mggmThreadSidebarEnabled,
    ).toBe(false);
    expect(() => decodeClientSettingsPatch({ mggmThreadSidebarEnabled: "true" })).toThrow();
  });
});
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);

describe("Codex weekly window starter", () => {
  it("defaults to enabled for existing configurations and preserves an explicit opt-out", () => {
    const decode = Schema.decodeUnknownSync(CodexSettings);
    const encode = Schema.encodeSync(CodexSettings);
    expect(decode({}).autoStartWeeklyWindow).toBe(true);
    const disabled = decode({ autoStartWeeklyWindow: false });
    expect(decode(encode(disabled)).autoStartWeeklyWindow).toBe(false);
    expect(() => decode({ autoStartWeeklyWindow: "true" })).toThrow();
  });
});

describe("slow request warnings", () => {
  it("defaults to 60 seconds and persists zero as disabled", () => {
    expect(decodeClientSettings({}).slowRequestWarningThresholdSeconds).toBe(60);
    const disabled = decodeClientSettings({ slowRequestWarningThresholdSeconds: 0 });
    expect(
      decodeClientSettings(encodeClientSettings(disabled)).slowRequestWarningThresholdSeconds,
    ).toBe(0);
    expect(
      decodeClientSettingsPatch({ slowRequestWarningThresholdSeconds: 0 })
        .slowRequestWarningThresholdSeconds,
    ).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_484, "60"])(
    "rejects invalid thresholds: %s",
    (slowRequestWarningThresholdSeconds) => {
      expect(() => decodeClientSettings({ slowRequestWarningThresholdSeconds })).toThrow();
      expect(() => decodeClientSettingsPatch({ slowRequestWarningThresholdSeconds })).toThrow();
    },
  );
});

describe("pd-secrets post-login script", () => {
  it("defaults to no script and preserves a host-local path through settings patches", () => {
    expect(decodeServerSettings({}).pdSecretsPostLoginScript).toBe("");
    const patch = decodeServerSettingsPatch({
      pdSecretsPostLoginScript: "  ~/.claude/install/pd-secrets-post-login.sh  ",
    });
    expect(patch.pdSecretsPostLoginScript).toBe("~/.claude/install/pd-secrets-post-login.sh");
    expect(
      decodeServerSettings(
        encodeServerSettings({
          ...DEFAULT_SERVER_SETTINGS,
          pdSecretsPostLoginScript: "~/.claude/install/pd-secrets-post-login.sh",
        }),
      ).pdSecretsPostLoginScript,
    ).toBe(patch.pdSecretsPostLoginScript);
    expect(
      decodeServerSettingsPatch({ pdSecretsPostLoginScript: "" }).pdSecretsPostLoginScript,
    ).toBe("");
  });
});

describe("MGGM defaults", () => {
  it("starts with one Codex account and an adjustable Standard model selection", () => {
    const settings = decodeServerSettings({});
    expect(settings.defaultModelSelection).toEqual({
      instanceId: "codex",
      model: "gpt-6.1-sol",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "default" },
      ],
    });
    expect(settings.favorites).toEqual([{ provider: "codex", model: "gpt-6.1-sol" }]);
    expect(settings.providerModelPreferences).toBeNull();
    expect(decodeClaudeSettings({}).enabled).toBe(false);
    expect(settings).toMatchObject({
      defaultRuntimeMode: "full-access",
      enableProviderUpdateChecks: false,
      defaultAutoPull: true,
      sidebarAutoSettleAfterDays: null,
      autoResumeLimitedThreads: true,
      modelCapacityRetryDelayMinutes: 5,
      pullRequestMergeMethod: "rebase",
    });
  });

  it("accepts zero and custom capacity retry delays and rejects invalid delays", () => {
    for (const minutes of [0, 1, 5, 30]) {
      expect(
        decodeServerSettings({ modelCapacityRetryDelayMinutes: minutes })
          .modelCapacityRetryDelayMinutes,
      ).toBe(minutes);
      expect(
        decodeServerSettingsPatch({ modelCapacityRetryDelayMinutes: minutes })
          .modelCapacityRetryDelayMinutes,
      ).toBe(minutes);
    }
    for (const minutes of [-1, 0.5, "5", null]) {
      expect(() =>
        decodeServerSettingsPatch({ modelCapacityRetryDelayMinutes: minutes }),
      ).toThrow();
    }
  });

  it("starts the client with Working, steering, and the approved font sizes", () => {
    expect(decodeClientSettings({})).toMatchObject({
      sidebarWorkingShelfEnabled: true,
      followUpBehavior: "steer",
      fontSizeInterface: 17,
      fontSizePrompt: 16,
      fontSizeCode: 15,
      glassOpacity: 90,
    });
  });
});

describe("storage cleanup settings", () => {
  it("keeps cleanup disabled for existing installations", () => {
    expect(decodeServerSettings({}).worktreeCleanup).toBeNull();
    expect(decodeServerSettings({}).storageCleanup).toEqual({
      worktreeAfterDays: null,
      worktreeSettledAfterDays: null,
      worktreeOnMerge: false,
      worktreeOnDelete: false,
      worktreeUnchanged: false,
      worktreeKeepWhen: "uncommitted-changes",
      browserArtifactsAfterDays: null,
      logsAfterDays: null,
    });
  });

  it("accepts partial custom patches but requires complete stored project rules", () => {
    expect(
      decodeServerSettingsPatch({
        worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } },
      }),
    ).toEqual({ worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } } });
    expect(() =>
      decodeServerSettings({
        projectSettingsOverrides: {
          project: { worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } } },
        },
      }),
    ).toThrow();
    expect(
      decodeServerSettings({
        projectSettingsOverrides: {
          project: {
            worktreeCleanup: {
              mode: "custom",
              rules: {
                worktreeAfterDays: null,
                worktreeOnMerge: false,
                worktreeOnDelete: false,
                worktreeUnchanged: false,
              },
            },
          },
        },
      }).projectSettingsOverrides[ProjectId.make("project")]?.worktreeCleanup,
    ).toMatchObject({
      mode: "custom",
      rules: { worktreeSettledAfterDays: null, worktreeKeepWhen: "uncommitted-changes" },
    });
  });

  it("decodes older custom rules with the default local-file policy", () => {
    const settings = decodeServerSettings({
      worktreeCleanup: {
        mode: "custom",
        rules: {
          worktreeAfterDays: 8,
          worktreeOnMerge: false,
          worktreeOnDelete: false,
          worktreeUnchanged: false,
        },
      },
    });
    expect(settings.worktreeCleanup).toMatchObject({
      rules: { worktreeKeepWhen: "uncommitted-changes" },
    });
    expect(
      decodeServerSettingsPatch({ storageCleanup: { worktreeKeepWhen: "tracked-changes" } }),
    ).toEqual({ storageCleanup: { worktreeKeepWhen: "tracked-changes" } });
    expect(() =>
      decodeServerSettingsPatch({ storageCleanup: { worktreeKeepWhen: "unknown" } }),
    ).toThrow();
  });
});

describe("ServerSettings usage price overrides", () => {
  const prices = { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 };

  it("rejects empty model IDs and incomplete input/output pricing", () => {
    for (const usagePriceOverrides of [
      { " ": prices },
      { "example-model": { inputCostPerMillionTokens: 2 } },
      { "example-model": { outputCostPerMillionTokens: 8 } },
    ]) {
      expect(() => decodeServerSettingsPatch({ usagePriceOverrides })).toThrow();
    }
  });
});

describe("custom model settings", () => {
  const capabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
      },
    ],
  };

  it("accepts legacy bare slugs alongside full entries", () => {
    const decoded = decodeClaudeSettings({
      customModels: ["bare-slug", { slug: "named", name: "Named", capabilities }],
    });
    expect(decoded.customModels).toEqual([
      "bare-slug",
      { slug: "named", name: "Named", capabilities },
    ]);
  });
});

describe("resolveIdleCompaction", () => {
  it("lets a Claude instance override the global default", () => {
    const settings = decodeServerSettings({
      idleCompaction: "off",
      providerInstances: {
        claude_work: { driver: "claudeAgent", config: { idleCompaction: "onReturn" } },
        claude_personal: { driver: "claudeAgent" },
      },
    });
    expect(resolveIdleCompaction(settings, ProviderInstanceId.make("claude_work"))).toBe(
      "onReturn",
    );
    expect(resolveIdleCompaction(settings, ProviderInstanceId.make("claude_personal"))).toBe("off");
    expect(resolveIdleCompaction(settings, ProviderInstanceId.make("claudeAgent"))).toBe("off");
  });

  it("reads the mode from the legacy switch, in either form servers saved it", () => {
    expect(globalIdleCompaction(decodeServerSettings({ compactIdleThreads: true }))).toBe(
      "beforeCacheExpires",
    );
    expect(globalIdleCompaction(decodeServerSettings({ compactIdleThreads: "off" }))).toBe("off");
    expect(globalIdleCompaction(decodeServerSettings({}))).toBe("onReturn");
  });

  it("keeps the legacy switch a boolean, as shipped clients decode it", () => {
    const encode = Schema.encodeSync(Schema.toCodecJson(ServerSettings));
    for (const mode of ["onReturn", "beforeCacheExpires", "off"] as const) {
      const encoded = encode(withIdleCompaction(DEFAULT_SERVER_SETTINGS, mode)) as {
        readonly compactIdleThreads: unknown;
        readonly idleCompaction: unknown;
      };
      expect(encoded.compactIdleThreads).toBe(mode === "beforeCacheExpires");
      expect(encoded.idleCompaction).toBe(mode);
    }
  });

  it("patches the field the server reads", () => {
    expect(
      idleCompactionPatch({ compactIdleThreads: false, idleCompaction: "onReturn" }, "off"),
    ).toEqual({
      idleCompaction: "off",
    });
    expect(idleCompactionPatch({ compactIdleThreads: "onReturn" }, "off")).toEqual({
      compactIdleThreads: "off",
    });
    expect(idleCompactionPatch({ compactIdleThreads: false }, "beforeCacheExpires")).toEqual({
      compactIdleThreads: true,
    });
  });
});

describe("ClientSettings notifications", () => {
  it("requires opt-in when existing settings omit notification preferences", () => {
    expect(decodeClientSettings({}).notificationMode).toBe("off");
    expect(decodeClientSettings({}).inAppNotificationsEnabled).toBe(false);
    expect(decodeClientSettingsPatch({})).not.toHaveProperty("inAppNotificationsEnabled");
    expect(decodeClientSettingsPatch({})).not.toHaveProperty("notificationMode");
  });
});

describe("ClientSettings quit confirmation", () => {
  it.each([
    [true, "hold"],
    [false, "direct"],
  ] as const)("migrates the legacy %s value to %s", (legacyValue, mode) => {
    const settings = decodeClientSettings({ confirmQuit: legacyValue });

    expect(settings.confirmQuit).toBe(mode);
    expect(encodeClientSettings(settings).confirmQuit).toBe(mode);
  });
});

describe("provider enabled defaults", () => {
  it("resolves instance enabled state with explicit false winning", () => {
    const grok = ProviderDriverKind.make("grok");
    const codex = ProviderDriverKind.make("codex");
    expect(resolveProviderInstanceEnabled({ driver: grok, config: {} })).toBe(false);
    expect(resolveProviderInstanceEnabled({ driver: codex, config: {} })).toBe(true);
    expect(
      resolveProviderInstanceEnabled({ driver: ProviderDriverKind.make("ollama"), config: {} }),
    ).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: {} })).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: {} })).toBe(
      false,
    );
    expect(resolveProviderInstanceEnabled({ driver: grok, config: { enabled: true } })).toBe(true);
    expect(
      resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: { enabled: false } }),
    ).toBe(false);
    expect(
      resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: { enabled: true } }),
    ).toBe(false);
  });

  it("enables only Codex by default", () => {
    const enabledByDefault = (driver: string) =>
      resolveProviderInstanceEnabled({ driver: ProviderDriverKind.make(driver), config: {} });
    expect(enabledByDefault("codex")).toBe(true);
    for (const driver of [
      "claudeAgent",
      "cursor",
      "grok",
      "muse",
      "pi",
      "opencode",
      "antigravity",
    ]) {
      expect(enabledByDefault(driver)).toBe(false);
    }
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults the thread env mode to inherit and keeps stored values", () => {
    expect(decodeServerSettings({}).defaultThreadEnvMode).toBeNull();
    expect(decodeServerSettings({ defaultThreadEnvMode: "worktree" }).defaultThreadEnvMode).toBe(
      "worktree",
    );
    expect(
      decodeServerSettings({ defaultThreadEnvMode: "remote" }).defaultThreadEnvMode,
    ).toBeNull();
    expect(
      decodeServerSettingsPatch({ defaultThreadEnvMode: null }).defaultThreadEnvMode,
    ).toBeNull();
  });

  it("keeps an inherited thread env mode off the wire for older clients", () => {
    const encode = Schema.encodeSync(ServerSettings);
    expect("defaultThreadEnvMode" in encode(decodeServerSettings({}))).toBe(false);
    expect(
      encode(decodeServerSettings({ defaultThreadEnvMode: "worktree" })).defaultThreadEnvMode,
    ).toBe("worktree");
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it.each([
    { legacy: "", mode: "repo_conventions", customInstructions: "" },
    { legacy: " \t\n ", mode: "repo_conventions", customInstructions: "" },
    {
      legacy: "  Prefer concise wording.\nKeep issue references.  ",
      mode: "custom",
      customInstructions: "Prefer concise wording.\nKeep issue references.",
    },
  ])("normalizes legacy writing style $legacy in snapshots only", ({ legacy, ...expected }) => {
    const style = { ...expected, followChangeRequestTemplates: true };
    for (const [input, normalized] of [
      [{ sourceControlWritingStyle: legacy }, { sourceControlWritingStyle: style }],
      [
        { projectSettingsOverrides: { project: { sourceControlWritingStyle: legacy } } },
        { projectSettingsOverrides: { project: { sourceControlWritingStyle: style } } },
      ],
    ] as const) {
      const settings = decodeServerSettings(input);
      expect(settings).toMatchObject(normalized);
      expect(encodeServerSettings(settings)).toMatchObject(normalized);
      expect(() => decodeServerSettingsPatch(input)).toThrow();
    }
  });
});

describe("ServerSettings environment icon", () => {
  it("decodes a kind from a newer server as null instead of failing the snapshot", () => {
    expect(decodeServerSettings({ environmentIcon: "toaster" }).environmentIcon).toBeNull();
  });
});

const decodeDeviceHostSettings = Schema.decodeSync(ServerSettings);

// `deviceHosts` as it was decoded before EAS hosts existed: an SSH host needs a target.
const decodeOlderDeviceHostSettings = Schema.decodeUnknownSync(
  Schema.Struct({
    deviceHosts: Schema.Array(Schema.Struct({ id: Schema.String, target: Schema.String })),
  }),
);

it("keeps EAS hosts out of the SSH host list servers and clients before EAS hosts decode", () => {
  const settings = decodeDeviceHostSettings({
    deviceHosts: [{ id: "mini", label: "Mac mini", target: "user@mini" }],
    easDeviceHosts: [{ kind: "eas", id: "eas", label: "EAS Simulator" }],
  });
  const wire = encodeServerSettings(settings);
  expect(decodeOlderDeviceHostSettings(wire).deviceHosts).toEqual([
    { id: "mini", target: "user@mini" },
  ]);
  expect(settings.easDeviceHosts.map((host) => host.id)).toEqual(["eas"]);
});

it("validates remote device hosts and rejects ambiguous host ids", () => {
  const host = { id: "mini", label: "Mac mini", target: "user@mini", port: 2222 };
  // Hosts saved before EAS hosts existed have no `kind`; they are SSH hosts.
  expect(decodeDeviceHostSettings({ deviceHosts: [host] }).deviceHosts).toEqual([
    { kind: "ssh", ...host },
  ]);
  expect(() => decodeDeviceHostSettings({ deviceHosts: [host, host] })).toThrow();
  expect(() => decodeDeviceHostSettings({ deviceHosts: [{ ...host, id: "local" }] })).toThrow();
  expect(() =>
    decodeDeviceHostSettings({ deviceHosts: [{ ...host, target: "-oProxyCommand=bad" }] }),
  ).toThrow();
  expect(() => decodeDeviceHostSettings({ deviceHosts: [{ ...host, port: 0 }] })).toThrow();
});

describe("resolveProjectProviderInstanceEnabled", () => {
  const projectId = "project-a" as ProjectId;
  const instanceId = ProviderInstanceId.make("codex_work");

  it("keeps the shipped Copilot instance off until explicitly enabled", () => {
    const copilotId = ProviderInstanceId.make("githubCopilot");
    expect(resolveProjectProviderInstanceEnabled(DEFAULT_SERVER_SETTINGS, null, copilotId)).toBe(
      false,
    );
    expect(
      resolveProjectProviderInstanceEnabled(
        {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [copilotId]: { driver: ProviderDriverKind.make("acpRegistry"), enabled: true },
          },
        },
        null,
        copilotId,
      ),
    ).toBe(true);
    expect(
      resolveProjectProviderInstanceEnabled(
        {
          ...DEFAULT_SERVER_SETTINGS,
          projectSettingsOverrides: {
            [projectId]: { providerInstances: { [copilotId]: { enabled: false } } },
          },
        },
        projectId,
        copilotId,
      ),
    ).toBe(false);
  });

  it("lets a project disable an instance the machine enabled", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    };
    expect(resolveProjectProviderInstanceEnabled(settings, projectId, instanceId)).toBe(false);
  });
});

describe("requiredScopesForProjectMutation", () => {
  it("adds the settings scope only when a mutation carries scripts", () => {
    const projectId = "project-1" as ProjectId;
    const commandId = "command-1" as CommandId;
    expect(
      requiredScopesForProjectMutation({ type: "project.update", commandId, projectId }),
    ).toEqual(["orchestration:operate"]);
    expect(
      requiredScopesForProjectMutation({
        type: "project.update",
        commandId,
        projectId,
        scripts: [],
      }),
    ).toEqual(["orchestration:operate", "settings:write"]);
  });
});

describe("server model preferences", () => {
  it("distinguishes unmigrated lists from deliberately cleared lists", () => {
    expect(decodeServerSettings({ favorites: null })).toMatchObject({
      favorites: null,
      providerModelPreferences: null,
    });
    const input = { favorites: [], providerModelPreferences: {} };
    expect(encodeServerSettings(decodeServerSettings(input))).toMatchObject(input);
    expect(decodeServerSettingsPatch(input)).toEqual(input);
  });
});

it("defaults merge settlement on and inactivity settlement off", () => {
  const settings = decodeServerSettings({});
  expect(settings.sidebarAutoSettleAfterDays).toBeNull();
  expect(settings.sidebarAutoSettleOnMerge).toBe(true);
});

it("defaults to steering and accepts either behavior", () => {
  expect(decodeClientSettings({}).followUpBehavior).toBe("steer");
  for (const followUpBehavior of ["queue", "steer"]) {
    expect(decodeClientSettings({ followUpBehavior }).followUpBehavior).toBe(followUpBehavior);
    expect(decodeClientSettingsPatch({ followUpBehavior }).followUpBehavior).toBe(followUpBehavior);
  }
  expect(() => decodeClientSettingsPatch({ followUpBehavior: "invalid" })).toThrow();
});

it("defaults to a readable translucent surface", () => {
  expect(decodeClientSettings({}).glassOpacity).toBe(90);
});
