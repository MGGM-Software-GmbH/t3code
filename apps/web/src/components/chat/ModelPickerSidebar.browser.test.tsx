import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import "../../index.css";

vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-11-06T12:00" }));

function entry(name: string, usageLimits?: ServerProviderUsageLimits) {
  return deriveProviderInstanceEntries([
    {
      instanceId: ProviderInstanceId.make(name),
      driver: ProviderDriverKind.make("codex"),
      displayName: name,
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-11-06T12:00:00Z",
      models: [],
      skills: [],
      slashCommands: [],
      ...(usageLimits ? { usageLimits } : {}),
    },
  ])[0]!;
}

function limits(usedPercent: number, nextExpiresAt?: string): ServerProviderUsageLimits {
  return {
    checkedAt: "2026-11-06T12:00:00Z",
    windows: [
      { id: "secondary", kind: "weekly", label: "Weekly", usedPercent, windowDurationMins: 10080 },
    ],
    resetCredits: { availableCount: 2, ...(nextExpiresAt ? { nextExpiresAt } : {}) },
  };
}

it("shows each account's own weekly balance and keeps account selection usable", async () => {
  const first = entry("First", limits(23));
  const second = entry("Second", limits(80));
  const onSelect = vi.fn();
  await using screen = await render(
    <ModelPickerSidebar
      selectedInstanceId={first.instanceId}
      onSelectInstance={onSelect}
      onFocusSearch={() => undefined}
      instanceEntries={[first, second]}
    />,
  );
  await expect
    .element(screen.getByRole("meter", { name: "First: 77% remaining · 2 banked resets" }))
    .toHaveAttribute("aria-valuenow", "77");
  await expect
    .element(screen.getByRole("meter", { name: "Second: 20% remaining · 2 banked resets" }))
    .toHaveAttribute("aria-valuenow", "20");
  await screen.getByRole("button", { name: "Second", exact: true }).click();
  expect(onSelect).toHaveBeenCalledWith(second.instanceId);
});

it.each([
  ["2026-11-06T12:00:00Z", true],
  ["2026-11-11T12:00:00Z", true],
  ["2026-11-11T12:01:00Z", false],
  ["2026-11-06T11:59:00Z", false],
  [undefined, false],
] as const)("uses the thread indicator's expiry warning for %s", async (expiry, warns) => {
  const account = entry("Account", limits(23, expiry));
  await using screen = await render(
    <ModelPickerSidebar
      selectedInstanceId={account.instanceId}
      onSelectInstance={() => undefined}
      onFocusSearch={() => undefined}
      instanceEntries={[account]}
    />,
  );
  const badge = screen.getByText("+2", { exact: true });
  await expect.element(badge).toBeVisible();
  expect(badge.element().classList.contains("text-reset-expiry-foreground")).toBe(warns);
});

it("does not invent a balance or resets for missing and unavailable reports", async () => {
  const unavailable = entry("Unavailable", {
    ...limits(23),
    unavailable: { reason: "probeFailed" },
  });
  const missing = entry("Missing");
  await using screen = await render(
    <ModelPickerSidebar
      selectedInstanceId={missing.instanceId}
      onSelectInstance={() => undefined}
      onFocusSearch={() => undefined}
      instanceEntries={[missing, unavailable]}
    />,
  );
  await expect
    .element(screen.getByRole("img", { name: "Missing: Weekly limit unavailable" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("img", { name: "Unavailable: Weekly limit unavailable" }))
    .toBeVisible();
  expect(screen.container.querySelectorAll('[role="meter"]')).toHaveLength(0);
  expect(screen.container.textContent).not.toContain("+2");
});

it("renders zero remaining without showing a zero-reset badge", async () => {
  const account = entry("Empty", { ...limits(100), resetCredits: { availableCount: 0 } });
  await using screen = await render(
    <ModelPickerSidebar
      selectedInstanceId={account.instanceId}
      onSelectInstance={() => undefined}
      onFocusSearch={() => undefined}
      instanceEntries={[account]}
    />,
  );
  await expect
    .element(screen.getByRole("meter", { name: "Empty: 0% remaining · 0 banked resets" }))
    .toHaveAttribute("aria-valuenow", "0");
  expect(screen.container.textContent).not.toContain("+0");
});

it("does not substitute a model-specific limit for the account's weekly allowance", async () => {
  const report = limits(23, "2026-11-07T12:00:00Z");
  const account = entry("Account", {
    ...report,
    windows: [{ ...report.windows[0]!, id: "seven_day_model", label: "Model weekly" }],
  });
  await using screen = await render(
    <ModelPickerSidebar
      selectedInstanceId={account.instanceId}
      onSelectInstance={() => undefined}
      onFocusSearch={() => undefined}
      instanceEntries={[account]}
    />,
  );
  await expect
    .element(
      screen.getByRole("img", { name: "Account: Weekly limit unavailable · 2 banked resets" }),
    )
    .toBeVisible();
  await expect.element(screen.getByText("+2", { exact: true })).toBeVisible();
});
