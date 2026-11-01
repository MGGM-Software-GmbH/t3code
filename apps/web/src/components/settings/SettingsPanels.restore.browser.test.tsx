import { useEffect } from "react";
import { act, render } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import "~/index.css";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () =>
    ({
      theme: "system",
      followSystem: true,
      themeHalves: null,
      setTheme: vi.fn(),
      setFollowSystem: vi.fn(),
      setThemeHalf: vi.fn(),
      clearThemeHalves: vi.fn(),
    }) as never,
  readThemePreference: () => "system",
  readThemeHalves: () => null,
  readAppearanceModePreference: () => "system",
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings!) as never,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock(import("../../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () => ({ dialogs: { confirm: state.confirm } }) as never,
}));

import { useSettingsRestore } from "./SettingsPanels";
import { MggmSettingsPanel } from "./MggmSettings";

async function renderRestore() {
  let restore!: ReturnType<typeof useSettingsRestore>;
  function Probe() {
    const result = useSettingsRestore();
    useEffect(() => {
      restore = result;
    });
    return null;
  }
  const screen = await render(<Probe />);
  return {
    ...screen,
    get restore() {
      return restore;
    },
  };
}
function setup() {
  vi.clearAllMocks();
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.confirm.mockResolvedValue(true);
}

describe("restoring V2 settings", () => {
  it("toggles the MGGM layout and restores its enabled default", async () => {
    setup();
    await using screen = await render(<MggmSettingsPanel />);
    const toggle = screen.getByRole("switch", { name: "MGGM thread layout" });
    await expect.element(toggle).toBeChecked();
    await toggle.click();
    expect(state.update).toHaveBeenLastCalledWith({ mggmThreadSidebarEnabled: false });

    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, mggmThreadSidebarEnabled: false };
    await screen.rerender(<MggmSettingsPanel />);
    await expect.element(toggle).not.toBeChecked();
    await screen.getByRole("button", { name: "Reset MGGM thread layout to default" }).click();
    expect(state.update).toHaveBeenLastCalledWith({ mggmThreadSidebarEnabled: true });
  });
  it("restores model capacity retries after disabling them", async () => {
    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, modelCapacityRetryDelayMinutes: 0 };
    await using screen = await renderRestore();
    const { restore } = screen;
    expect(restore.changedSettingLabels).toEqual(["Model capacity retry delay"]);
    await act(() => restore.restoreDefaults());
    expect(state.update.mock.calls[0]?.[0].modelCapacityRetryDelayMinutes).toBe(5);
  });

  it("restores the slow request warning threshold after disabling warnings", async () => {
    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, slowRequestWarningThresholdSeconds: 0 };
    await using screen = await renderRestore();
    const { restore } = screen;
    expect(restore.changedSettingLabels).toEqual(["Slow request warning threshold"]);
    await act(() => restore.restoreDefaults());
    expect(state.update.mock.calls[0]?.[0].slowRequestWarningThresholdSeconds).toBe(60);
  });

  it.each([
    ["persistComposerContextStrip", "Composer context"],
    ["autoResumeLimitedThreads", "Resume after usage limits"],
    ["snoozeLimitedThreads", "Snooze until limits reset"],
  ] as const)("restores %s when it is the only changed setting", async (key, label) => {
    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, [key]: !DEFAULT_UNIFIED_SETTINGS[key] };
    await using screen = await renderRestore();
    const { restore } = screen;

    expect(restore.changedSettingLabels).toEqual([label]);
    await act(() => restore.restoreDefaults());

    expect(state.confirm.mock.calls[0]?.[0]).toContain(label);
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.update.mock.calls[0]?.[0][key]).toBe(DEFAULT_UNIFIED_SETTINGS[key]);
  });

  it("does not reset settings after cancellation", async () => {
    setup();
    state.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      autoResumeLimitedThreads: !DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
    };
    state.confirm.mockResolvedValue(false);
    await using screen = await renderRestore();
    const { restore } = screen;

    await act(() => restore.restoreDefaults());

    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.update).not.toHaveBeenCalled();
  });
});
