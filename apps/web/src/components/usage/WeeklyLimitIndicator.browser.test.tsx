import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { act, fakeTimers, render as renderScreen, type Screen } from "../../../test/render";
type Root = { render: Screen["rerender"]; unmount: Screen["unmount"] };
import { expect, it, vi } from "vite-plus/test";

const actions = vi.hoisted(() => ({ navigate: vi.fn(), closeSidebar: vi.fn(), touch: false }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => actions.navigate,
}));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => actions.touch }));
vi.mock("../../state/presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  const { useAtomValue } = await import("@effect/atom-react");
  const presentationsAtom = Atom.make(new Map());
  return {
    environmentPresentations: { presentationsWithProvidersAtom: presentationsAtom },
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

it("explains elapsed days and banked resets for the selected account and deduplicated pool", async () => {
  await using test = await setup();
  const { container, setProviders, render } = test;
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
  expect(document.body.textContent).toContain("Next banked reset expiry:");
  expect(fetch).not.toHaveBeenCalled();
});

it("pools distinct accounts once across environments and keeps the composer scoped to its account", async () => {
  await using test = await setup();
  const { container, setProviders, render, labels } = test;
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
  await using test = await setup();
  const { setProviders, render, labels } = test;
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
  await using test = await setup();
  const { container, setProviders, render } = test;
  setProviders([provider(codex, 20, "private@example.test")]);
  await render();
  await act(async () => {
    container.querySelector("button")!.focus();
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.body.textContent).toContain("Next regular reset:");
  expect(document.body.textContent).toMatch(/Freitag, 23\.10\.2026 \d{2}:\d{2}/);
  expect(document.body.textContent).toContain("Updated");
  expect(document.body.textContent).not.toContain("private@example.test");
  await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  [0, true],
  [120, true],
  [120 + 1 / 60, false],
  [-1, false],
] as const)(
  "warns in both limit indicators when a banked reset expires in %s hours",
  async (hours, warning) => {
    await using test = await setup();
    const { container, setProviders, render } = test;
    actions.touch = true;
    const expiresAt = new Date(
      Date.parse("2026-10-19T08:00:00.000Z") + hours * 60 * 60_000,
    ).toISOString();
    const account = provider(codex, 20, "team@example.test");
    setProviders([
      {
        ...account,
        usageLimits: {
          ...account.usageLimits!,
          resetCredits: { availableCount: 2, nextExpiresAt: expiresAt },
        },
      },
    ]);
    await render();
    for (const button of container.querySelectorAll("button")) {
      const creditCount = [...button.querySelectorAll("text")].find(
        (text) => text.textContent === "+2",
      )!;
      expect(creditCount.classList.contains("text-reset-expiry-foreground")).toBe(warning);
    }
    await act(async () => container.querySelectorAll("button")[1]!.click());
    const expiry = document.querySelector(`time[datetime="${expiresAt}"]`)!;
    expect(expiry.textContent).toMatch(/^\S+, \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    expect(expiry.classList.contains("text-reset-expiry-foreground")).toBe(warning);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("warns as a banked expiry enters the next 120 hours without polling", async () => {
  await using test = await setup();
  const { container, setProviders, render } = test;
  actions.touch = true;
  const account = provider(codex, 20, "team@example.test");
  const expiresAt = new Date(
    Date.parse("2026-10-19T08:00:00.000Z") + 120 * 60 * 60_000 + 60_000,
  ).toISOString();
  setProviders([
    {
      ...account,
      usageLimits: {
        ...account.usageLimits!,
        resetCredits: { availableCount: 1, nextExpiresAt: expiresAt },
      },
    },
  ]);
  await render();
  await act(async () => container.querySelector("button")!.click());
  const expiry = document.querySelector(`time[datetime="${expiresAt}"]`)!;
  expect(expiry.classList.contains("text-reset-expiry-foreground")).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(expiry.classList.contains("text-reset-expiry-foreground")).toBe(true);
  expect(container.querySelectorAll("text.text-reset-expiry-foreground")).toHaveLength(2);
  expect(fetch).not.toHaveBeenCalled();
});

it("shows each account's expiry while using the earliest expiry for the pooled warning", async () => {
  await using test = await setup();
  const { container, setProviders, render } = test;
  actions.touch = true;
  const later = "2026-10-31T08:00:00.000Z";
  const sooner = "2026-10-20T08:00:00.000Z";
  const team = provider(codex, 25, "team@example.test");
  const other = provider(second, 75, "second@example.test");
  setProviders([
    {
      ...team,
      usageLimits: {
        ...team.usageLimits!,
        resetCredits: { availableCount: 2, nextExpiresAt: later },
      },
    },
    {
      ...other,
      usageLimits: {
        ...other.usageLimits!,
        resetCredits: { availableCount: 1, nextExpiresAt: sooner },
      },
    },
  ]);
  await render();
  const indicators = container.querySelectorAll("button");
  expect(indicators[0]!.querySelector("text.text-reset-expiry-foreground")?.textContent).toBe("+3");
  expect(indicators[1]!.querySelector("text.text-reset-expiry-foreground")).toBeNull();
  await act(async () => indicators[0]!.click());
  const popup = document.querySelector('[data-slot="popover-popup"]')!;
  expect(popup.querySelector(`time[datetime="${sooner}"]`)).not.toBeNull();
  expect(popup.querySelector(`time[datetime="${later}"]`)).not.toBeNull();
  expect(
    popup.querySelector('[role="group"][aria-label="Team"] time')?.getAttribute("datetime"),
  ).toBe(later);
  expect(
    popup.querySelector('[role="group"][aria-label="Second"] time')?.getAttribute("datetime"),
  ).toBe(sooner);
  expect(
    popup
      .querySelector(`time[datetime="${later}"]`)
      ?.classList.contains("text-reset-expiry-foreground"),
  ).toBe(false);
  expect(
    popup
      .querySelector(`time[datetime="${sooner}"]`)
      ?.classList.contains("text-reset-expiry-foreground"),
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not warn about banked credits whose expiry was not reported", async () => {
  await using test = await setup();
  const { container, setProviders, render } = test;
  actions.touch = true;
  const account = provider(codex, 20, "team@example.test");
  setProviders([
    { ...account, usageLimits: { ...account.usageLimits!, resetCredits: { availableCount: 2 } } },
  ]);
  await render();
  expect(container.textContent).toBe("80%+280%+2");
  expect(container.querySelector(".text-reset-expiry-foreground")).toBeNull();
  await act(async () => container.querySelector("button")!.click());
  expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
    "Next banked reset expiry: not reported",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("distinguishes accounts without banked resets from accounts with an unreported expiry", async () => {
  await using test = await setup();
  const { container, setProviders, render } = test;
  actions.touch = true;
  const team = provider(codex, 20, "team@example.test");
  const other = provider(second, 30, "second@example.test");
  setProviders([
    { ...team, usageLimits: { ...team.usageLimits!, resetCredits: { availableCount: 0 } } },
    { ...other, usageLimits: { ...other.usageLimits!, resetCredits: { availableCount: 2 } } },
  ]);
  await render();
  await act(async () => container.querySelector("button")!.click());
  const popup = document.querySelector('[data-slot="popover-popup"]')!;
  expect(popup.querySelector('[role="group"][aria-label="Team"]')?.textContent).toContain(
    "Next banked reset expiry: none",
  );
  expect(popup.querySelector('[role="group"][aria-label="Second"]')?.textContent).toContain(
    "Next banked reset expiry: not reported",
  );
  expect(popup.querySelector("time")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("shows unknown rather than a full circle when the selected account has no weekly window", async () => {
  await using test = await setup();
  const { container, setProviders, render, labels } = test;
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
  await using test = await setup();
  const { container, setProviders, render, labels } = test;
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
  await using test = await setup();
  const { container, setProviders, render, labels } = test;
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
  await using test = await setup();
  const { container, setProviders, render } = test;
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
    await using test = await setup();
    const { container, setProviders, render } = test;
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

async function setup() {
  let root: Root;
  let container: HTMLDivElement;
  let registry: AtomRegistry.AtomRegistry;
  function setProviders(local: readonly ServerProvider[], remote: readonly ServerProvider[] = []) {
    registry.set(
      environmentPresentations.presentationsWithProvidersAtom as Atom.Writable<unknown>,
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

  actions.navigate.mockReset();
  actions.closeSidebar.mockReset();
  actions.touch = false;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Provider requests are forbidden in indicator tests"),
  );
  registry = AtomRegistry.make();
  container = document.createElement("div");
  document.body.append(container);
  // These isolated controls use mocked navigation and no route context.
  const screen = await renderScreen(null, { container, router: false });
  const timers = fakeTimers();
  vi.setSystemTime(new Date("2026-10-19T08:00:00.000Z"));
  root = { render: screen.rerender, unmount: screen.unmount };

  return {
    container,
    registry,
    setProviders,
    render,
    labels,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      registry.dispose();
      timers[Symbol.dispose]();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
