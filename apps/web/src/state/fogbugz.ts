import { createFogBugzEnvironmentAtoms } from "@t3tools/client-runtime/state/fogbugz";
import { connectionAtomRuntime } from "../connection/runtime";

export const fogbugzEnvironment = createFogBugzEnvironmentAtoms(connectionAtomRuntime);
