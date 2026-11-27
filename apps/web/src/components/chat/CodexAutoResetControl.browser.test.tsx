import { DEFAULT_UNIFIED_SETTINGS, EnvironmentId, type UnifiedSettings } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { CodexAutoResetControl } from "./CodexAutoResetControl";
import "~/index.css";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  writable: true,
  update: vi.fn(),
  target: "",
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((id: string, select: (settings: UnifiedSettings) => unknown) => {
    state.target = id;
    return select(state.settings!);
  }) as never,
  useUpdateEnvironmentSettings: () => state.update,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => state.writable,
}));

function setup() {
  vi.clearAllMocks();
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.writable = true;
}

it("opts into weekly exhaustion redemption on the picker's environment and reflects saved state", async () => {
  setup();
  const environmentId = EnvironmentId.make("synthetic-remote");
  await using screen = await render(<CodexAutoResetControl environmentId={environmentId} />);
  const toggle = screen.getByRole("switch", {
    name: "Auto-redeem banked reset at 0% weekly limit",
  });
  await expect.element(toggle).not.toBeChecked();
  expect(state.target).toBe(environmentId);
  await toggle.click();
  expect(state.update).toHaveBeenLastCalledWith({ mggmCodexAutoRedeemAtWeeklyLimit: true });
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS, mggmCodexAutoRedeemAtWeeklyLimit: true };
  await screen.rerender(<CodexAutoResetControl environmentId={environmentId} />);
  await expect.element(toggle).toBeChecked();
  await toggle.click();
  expect(state.update).toHaveBeenLastCalledWith({ mggmCodexAutoRedeemAtWeeklyLimit: false });
});

it("does not offer a writable control to a connection without settings permission", async () => {
  setup();
  state.writable = false;
  await using screen = await render(
    <CodexAutoResetControl environmentId={EnvironmentId.make("read-only")} />,
  );
  await expect.element(screen.getByRole("switch")).toBeDisabled();
  expect(state.update).not.toHaveBeenCalled();
});
