import { createFileRoute } from "@tanstack/react-router";
import { FogBugzCasesPage } from "../components/fogbugz/FogBugzCasesPage";

export const Route = createFileRoute("/_chat/cases")({ component: FogBugzCasesPage });
