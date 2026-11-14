import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test("A task can run on the first Wednesday of every month", WEB, async ({ t3, app, screen }) => {
  await t3.project("MonthlyChecks");
  await t3.open();
  await expect(screen.getByRole("navigation", "Threads", { exact: true })).toBeVisible();
  await app.open("/settings/scheduled-tasks");
  await screen.getByRole("button", "New task", { exact: true }).tap();
  await screen.getByRole("textbox", "Name", { exact: true }).fill("Monthly Wednesday check");
  await screen.getByRole("textbox", "Prompt", { exact: true }).fill("Review the monthly report.");
  const monthly = screen.getByRole("combobox", "Week of month", { exact: true });
  await app.screenshot("monthly-weekday-editor");
  await expect(monthly).toBeVisible();
  await monthly.tap();
  await screen.getByRole("option", "First of every month", { exact: true }).tap();
  for (const day of ["Mon", "Tue", "Thu", "Fri"]) {
    await screen.getByRole("button", day, { exact: true }).tap();
  }
  await screen.getByRole("combobox", "Workspace", { exact: true }).tap();
  await screen.getByRole("option", "Use the project checkout", { exact: true }).tap();
  await screen.getByRole("switch").tap();
  await app.screenshot("monthly-weekday-selection");
  await screen.getByRole("button", "Create task", { exact: true }).tap();
  await expect(
    screen.getByText("First Wed of every month at 09:00", { exact: false }),
  ).toBeVisible();
  await app.screenshot("monthly-weekday-saved");
});
