import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../../test/render";
import { Button } from "../ui/button";
import { FoldedSettingsSection } from "./FoldedSettingsSection";

it.each([390, 1280])(
  "keeps folded section actions clear of the title at %i pixels",
  async (width) => {
    await page.viewport(width, 844);
    try {
      await using screen = await render(
        <div style={{ width: width < 640 ? 280 : 900, fontSize: 17 }}>
          <FoldedSettingsSection
            id="authorized-clients"
            title="Authorized clients"
            summary="1 client"
            control={
              <div data-testid="header-actions" className="flex items-center gap-2">
                <Button variant="ghost" size="sm">
                  Revoke others
                </Button>
                <Button size="sm">Create link</Button>
              </div>
            }
          >
            <div>Client details</div>
          </FoldedSettingsSection>
        </div>,
        { router: false }, // The section owns no routes or navigation.
      );
      await vi.waitFor(() => {
        const title = screen.getByText("Authorized clients").element().getBoundingClientRect();
        const actions = screen.getByTestId("header-actions").element().getBoundingClientRect();
        expect(title.right <= actions.left || title.bottom <= actions.top).toBe(true);
      });
      await userEvent.click(screen.getByText("Authorized clients"));
      await expect.element(screen.getByText("Client details")).toBeVisible();
    } finally {
      await page.viewport(1280, 900);
    }
  },
);
