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

it("hides unavailable registry-agent quotas while preserving reported limits", async () => {
  const copilot = {
    ...entry("githubCopilot"),
    displayName: "GitHub Copilot",
    driverKind: ProviderDriverKind.make("acpRegistry"),
    snapshot: {
      ...entry("githubCopilot").snapshot,
      driver: ProviderDriverKind.make("acpRegistry"),
    },
  };
  const reported = {
    ...copilot,
    instanceId: ProviderInstanceId.make("reported-copilot"),
    displayName: "Reported Copilot",
    snapshot: { ...copilot.snapshot, usageLimits: limits(25) },
  };
  await using screen = await render(
    <ModelPickerSidebar
      selectedInstanceId={copilot.instanceId}
      onSelectInstance={() => undefined}
      onFocusSearch={() => undefined}
      instanceEntries={[copilot, reported]}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "GitHub Copilot", exact: true }))
    .toBeVisible();
  expect(screen.container.textContent).not.toContain("?");
  expect(screen.container.querySelector('[role="img"][aria-label*="Weekly limit"]')).toBeNull();
  await expect
    .element(
      screen.getByRole("meter", { name: "Reported Copilot: 75% remaining · 2 banked resets" }),
    )
    .toBeVisible();
  expect(
    screen
      .getByRole("button", { name: "GitHub Copilot", exact: true })
      .element()
      .getAttribute("aria-description"),
  ).toBeNull();
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

it("shows Antigravity Gemini weekly limits instead of a placeholder and excludes non-Gemini windows", async () => {
  const antigravity = ProviderDriverKind.make("antigravity");
  const makeAntigravityEntry = (
    id: string,
    displayName: string,
    usageLimits?: ServerProviderUsageLimits,
  ) => {
    const base = entry(id, usageLimits);
    return {
      ...base,
      displayName,
      driverKind: antigravity,
      snapshot: { ...base.snapshot, displayName, driver: antigravity },
    };
  };
  const withGemini = makeAntigravityEntry("antigravity", "Antigravity", {
    checkedAt: "2026-11-06T12:00:00Z",
    windows: [
      {
        id: "gemini-weekly",
        kind: "weekly",
        label: "Gemini · Weekly",
        usedPercent: 4,
        windowDurationMins: 10080,
      },
      {
        id: "gemini-neon-wtu-weekly",
        kind: "weekly",
        label: "Gemini 4 Neon · Weekly",
        usedPercent: 30,
        windowDurationMins: 10080,
      },
      {
        id: "3p-weekly",
        kind: "weekly",
        label: "Claude & GPT (shared) · Weekly",
        usedPercent: 100,
        windowDurationMins: 10080,
      },
    ],
  });
  const argonOnly = makeAntigravityEntry("antigravity-argon", "Antigravity Argon", {
    checkedAt: "2026-11-06T12:00:00Z",
    windows: [
      {
        id: "gemini-argon-wtu-weekly",
        kind: "weekly",
        label: "Gemini 4 Argon · Weekly",
        usedPercent: 14,
        windowDurationMins: 10080,
      },
    ],
  });
  const thirdPartyOnly = makeAntigravityEntry("antigravity-3p", "Antigravity 3P", {
    checkedAt: "2026-11-06T12:00:00Z",
    windows: [
      {
        id: "3p-weekly",
        kind: "weekly",
        label: "Claude & GPT (shared) · Weekly",
        usedPercent: 50,
        windowDurationMins: 10080,
      },
    ],
  });

  await using screen = await render(
    <ModelPickerSidebar
      selectedInstanceId={withGemini.instanceId}
      onSelectInstance={() => undefined}
      onFocusSearch={() => undefined}
      instanceEntries={[withGemini, argonOnly, thirdPartyOnly]}
    />,
  );
  await expect
    .element(screen.getByRole("meter", { name: "Antigravity: 96% remaining" }))
    .toHaveAttribute("aria-valuenow", "96");
  await expect
    .element(screen.getByRole("meter", { name: "Antigravity Argon: 86% remaining" }))
    .toHaveAttribute("aria-valuenow", "86");
  await expect
    .element(screen.getByRole("img", { name: "Antigravity 3P: Weekly limit unavailable" }))
    .toBeVisible();
});
