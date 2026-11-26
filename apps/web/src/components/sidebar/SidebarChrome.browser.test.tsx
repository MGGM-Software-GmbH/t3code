import "~/index.css";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useLocation: ({ select }: { select: (loc: { pathname: string }) => unknown }) =>
    select({ pathname: "/" }),
}));
vi.mock("../../state/environments", async (original) => ({
  ...(await original<typeof import("../../state/environments")>()),
  useIssuesSupported: () => true,
  usePullRequestsSupported: () => true,
}));
vi.mock("./mainAppLocation", () => ({
  isSidebarUtilityPage: () => false,
  useNavigateToMainApp: () => vi.fn(),
}));
vi.mock("./SidebarThreadUndoNotice", () => ({ SidebarThreadUndoNotice: () => null }));
vi.mock("./PdSecretsControl", () => ({ PdSecretsControl: () => null }));
vi.mock("../usage/WeeklyLimitIndicator", () => ({
  SidebarWeeklyLimit: () => (
    <li className="size-8">
      <button
        className="size-8"
        type="button"
        aria-label="Weekly limit, all accounts: 75% remaining"
      />
    </li>
  ),
}));
vi.mock("../usage/CodexResetForecastIndicator", () => ({
  CodexResetForecastIndicator: () => (
    <li data-sidebar-forecast className="size-8 shrink-0">
      <button className="size-8" type="button" aria-label="Codex reset forecast: test" />
    </li>
  ),
}));
vi.mock("./SidebarProviderUpdatePill", () => ({ SidebarProviderUpdatePill: () => null }));
vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdateArchitectureWarning: () => null,
  SidebarUpdatePill: () => (
    <li className="ml-auto shrink-0">
      <button className="size-8" type="button" aria-label="Update" />
    </li>
  ),
}));

import { SidebarChromeFooter } from "./SidebarChrome";

function footer(width: number) {
  return (
    <SidebarProvider>
      <div style={{ width }}>
        <SidebarChromeFooter />
      </div>
    </SidebarProvider>
  );
}

it("omits the redundant Usage icon button from the sidebar footer while keeping the weekly limit indicator", async () => {
  await using screen = await render(footer(400));
  await expect.element(screen.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Fogbugz Cases", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Weekly limit, all accounts: 75% remaining" }))
    .toBeVisible();
  expect(screen.container.querySelector('button[aria-label="Usage"]')).toBeNull();
});

it("hides only the forecast when the toolbar wraps and restores it when the sidebar grows", async () => {
  await using screen = await render(footer(400));
  const forecast = screen.getByRole("button", { name: /^Codex reset forecast:/ });
  const update = screen.getByRole("button", { name: "Update" });
  await expect.element(forecast).toBeVisible();
  await screen.rerender(footer(250));
  await expect.element(forecast).not.toBeInTheDocument();
  await expect.element(update).toBeVisible();
  const settings = screen.getByRole("button", { name: "Settings", exact: true });
  expect(update.element().getBoundingClientRect().top).toBeLessThan(
    settings.element().getBoundingClientRect().bottom,
  );
  await screen.rerender(footer(400));
  await expect.element(forecast).toBeVisible();
});
