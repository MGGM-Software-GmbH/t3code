import { createFileRoute } from "@tanstack/react-router";
import { MggmSettingsPanel } from "../components/settings/MggmSettings";

export const Route = createFileRoute("/_chat/settings/mggm")({
  component: MggmSettingsPanel,
});
