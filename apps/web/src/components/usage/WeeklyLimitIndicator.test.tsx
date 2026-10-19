// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const actions = vi.hoisted(() => ({ navigate: vi.fn(), closeSidebar: vi.fn(), touch: false }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => actions.navigate }));
vi.mock("../../hooks/useSettings", () => ({ usePrimarySettings: () => "24h" }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => actions.touch }));
vi.mock("../../state/presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  const { useAtomValue } = await import("@effect/atom-react");
  const presentationsAtom = Atom.make(new Map());
  return {
    environmentPresentations: { presentationsAtom },
    useEnvironmentPresentation: (id: string) => ({
      presentation: useAtomValue(presentationsAtom).get(id),
    }),
  };
});
vi.mock("../ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: actions.touch, setOpenMobile: actions.closeSidebar }),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size: string }) => <button {...props} />,
}));

import { environmentPresentations } from "../../state/presentation";
import { ComposerWeeklyLimit, SidebarWeeklyLimit } from "./WeeklyLimitIndicator";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const wsl = EnvironmentId.make("wsl");
const dgx = EnvironmentId.make("dgx");
const codex = ProviderInstanceId.make("codex");
const second = ProviderInstanceId.make("codex-two");
let root: Root;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;

function provider(
  instanceId: ProviderInstanceId,
  usedPercent: number,
  email: string,
): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    displayName: instanceId === codex ? "Team" : "Second",
    enabled: true,
    installed: true,
    status: "ready",
    version: null,
    auth: { status: "authenticated", email },
    models: [],
    skills: [],
    slashCommands: [],
    checkedAt: "2026-10-19T08:00:00.000Z",
    usageLimits: {
      checkedAt: "2026-10-19T08:00:00.000Z",
      windows: [
        {
          id: "secondary",
          kind: "weekly",
          label: "Weekly",
          windowDurationMins: 10080,
          usedPercent,
          resetsAt: "2026-10-23T08:00:00.000Z",
        },
      ],
    },
  };
}

function setProviders(local: readonly ServerProvider[], remote: readonly ServerProvider[] = []) {
  registry.set(
    environmentPresentations.presentationsAtom as Atom.Writable<unknown>,
    new Map([
      [wsl, { entry: { target: { label: "WSL test" } }, serverConfig: { providers: local } }],
      [dgx, { entry: { target: { label: "DGX test" } }, serverConfig: { providers: remote } }],
    ]),
  );
}

async function render(environmentId = wsl, instanceId = codex) {
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <ul>
          <SidebarWeeklyLimit />
        </ul>
        <ComposerWeeklyLimit environmentId={environmentId} instanceId={instanceId} size="sm" />
      </RegistryContext.Provider>,
    ),
  );
}

const labels = () =>
  [...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T08:00:00.000Z"));
  actions.navigate.mockReset();
  actions.closeSidebar.mockReset();
  actions.touch = false;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Provider requests are forbidden in indicator tests"),
  );
  registry = AtomRegistry.make();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it("explains elapsed days and banked resets for the selected account and deduplicated pool", async () => {
  actions.touch = true;
  const local = provider(codex, 35, "team@example.test");
  const withCredits = {
    ...local,
    usageLimits: {
      ...local.usageLimits!,
      resetCredits: { availableCount: 2, nextExpiresAt: "2026-10-31T08:00:00.000Z" },
    },
  };
  setProviders([withCredits], [withCredits]);
  await render();
  expect(container.querySelectorAll("button")[0]?.textContent).toBe("65%+2");
  expect(container.querySelectorAll("button")[1]?.textContent).toBe("65%+2");
  await act(async () => {
    container.querySelectorAll("button")[1]!.click();
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.body.textContent).toContain("Weekly period elapsed: 3.0 of 7 days");
  expect(document.body.textContent).toContain("Banked resets: 2");
  expect(document.body.textContent).toContain("Next credit expiry:");
  expect(fetch).not.toHaveBeenCalled();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  registry.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("pools distinct accounts once across environments and keeps the composer scoped to its account", async () => {
  const team = provider(codex, 25, "team@example.test");
  setProviders([team, provider(second, 75, "second@example.test")], [team]);
  await render();
  expect(labels()).toEqual([
    "Weekly limit, all accounts: 50% remaining",
    "Weekly limit, Team: 75% remaining",
  ]);
  expect(container.textContent).toBe("50%75%");
  expect(fetch).not.toHaveBeenCalled();
});

it("updates from pushed snapshots and resolves the selected instance in the selected environment", async () => {
  setProviders(
    [provider(codex, 10, "local@example.test"), provider(second, 80, "second@example.test")],
    [provider(codex, 60, "remote@example.test")],
  );
  await render(dgx);
  expect(labels()[1]).toBe("Weekly limit, Team: 40% remaining");
  await act(async () =>
    setProviders(
      [provider(codex, 50, "local@example.test"), provider(second, 80, "second@example.test")],
      [provider(codex, 65, "remote@example.test")],
    ),
  );
  expect(labels()[1]).toBe("Weekly limit, Team: 35% remaining");
  await render(wsl, second);
  expect(labels()[1]).toBe("Weekly limit, Second: 20% remaining");
  expect(fetch).not.toHaveBeenCalled();
});

it("explains weekly usage and the regular reset on keyboard focus without polling or exposing email", async () => {
  setProviders([provider(codex, 20, "private@example.test")]);
  await render();
  await act(async () => {
    container.querySelector("button")!.focus();
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.body.textContent).toContain("Next regular reset:");
  expect(document.body.textContent).toContain("23rd October 2026");
  expect(document.body.textContent).toContain("Updated");
  expect(document.body.textContent).not.toContain("private@example.test");
  await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
  expect(fetch).not.toHaveBeenCalled();
});

it("shows unknown rather than a full circle when the selected account has no weekly window", async () => {
  const account = provider(codex, 0, "team@example.test");
  setProviders([
    {
      ...account,
      usageLimits: {
        ...account.usageLimits!,
        windows: [
          {
            id: "primary",
            kind: "session",
            label: "Session",
            usedPercent: 0,
            windowDurationMins: 300,
          },
        ],
      },
    },
  ]);
  await render();
  expect(labels()).toEqual([
    "Weekly limit, all accounts: unavailable",
    "Weekly limit, Team: unavailable",
  ]);
  expect(container.textContent).toBe("??");
  expect(fetch).not.toHaveBeenCalled();
});

it("reports an expired reset as awaiting an update instead of claiming a new balance", async () => {
  vi.setSystemTime(new Date("2026-10-24T08:00:00.000Z"));
  setProviders([provider(codex, 80, "team@example.test")]);
  await render();
  await act(async () => {
    container.querySelector("button")!.focus();
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.body.textContent).toContain("awaiting updated limits");
  expect(labels()[0]).toBe("Weekly limit, all accounts: 20% remaining");
  expect(fetch).not.toHaveBeenCalled();
});

it("excludes disabled accounts and explains a failed read without counting it as full", async () => {
  const failed = provider(second, 0, "second@example.test");
  setProviders(
    [
      provider(codex, 75, "team@example.test"),
      {
        ...failed,
        usageLimits: {
          ...failed.usageLimits!,
          unavailable: { reason: "probeFailed", message: "Limit service unavailable" },
        },
      },
    ],
    [{ ...provider(codex, 0, "disabled@example.test"), enabled: false }],
  );
  await render();
  expect(labels()[0]).toBe("Weekly limit, all accounts: 25% remaining");
  await act(async () => {
    container.querySelector("button")!.focus();
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.body.textContent).toContain("Second: Limit service unavailable");
});

it("opens the existing usage details page from the indicator", async () => {
  saveUsagePagePreferences({ metric: "cost", windowDays: 7 });
  setProviders([provider(codex, 20, "team@example.test")]);
  await render();
  await act(async () => container.querySelector("button")!.click());
  expect(actions.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/usage" });
  expect(readUsagePagePreferences()).toMatchObject({ metric: "limits", windowDays: 7 });
});

it.each([
  [0, "Weekly limit, all accounts", "50% remaining"],
  [1, "Weekly limit, Team", "75% remaining"],
] as const)(
  "opens readable touch details for indicator %i before navigating",
  async (index, title, balance) => {
    actions.touch = true;
    setProviders([
      provider(codex, 25, "team@example.test"),
      provider(second, 75, "second@example.test"),
    ]);
    await render();
    await act(async () => {
      container.querySelectorAll("button")[index]!.click();
      await vi.advanceTimersByTimeAsync(1000);
    });
    const popup = document.querySelector('[data-slot="popover-popup"]');
    expect(popup?.textContent).toContain(title);
    expect(popup?.textContent).toContain(balance);
    expect(popup?.textContent).toContain("Next regular reset:");
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const action = [...popup!.querySelectorAll("button")].find(
      (button) => button.textContent === "Usage details",
    );
    expect(action).toBeDefined();
    await act(async () => action!.click());
    expect(actions.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/usage" });
    if (index === 0) expect(actions.closeSidebar).toHaveBeenCalledExactlyOnceWith(false);
    else expect(actions.closeSidebar).not.toHaveBeenCalled();
    expect(readUsagePagePreferences().metric).toBe("limits");
  },
);
