import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

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
    <li>
      <button type="button" aria-label="Weekly limit, all accounts: 75% remaining" />
    </li>
  ),
}));
vi.mock("../usage/CodexResetForecastIndicator", () => ({
  CodexResetForecastIndicator: () => null,
}));
vi.mock("./SidebarProviderUpdatePill", () => ({ SidebarProviderUpdatePill: () => null }));
vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdateArchitectureWarning: () => null,
  SidebarUpdatePill: () => null,
}));
vi.mock("../ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
  SidebarFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({
    size: _size,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SidebarTrigger: () => null,
}));

import { SidebarChromeFooter } from "./SidebarChrome";

it("omits the redundant Usage icon button from the sidebar footer while keeping the weekly limit indicator", async () => {
  await using screen = await render(<SidebarChromeFooter />, { router: false });
  await expect.element(screen.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Fogbugz Cases", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Weekly limit, all accounts: 75% remaining" }))
    .toBeVisible();
  expect(screen.container.querySelector('button[aria-label="Usage"]')).toBeNull();
});
