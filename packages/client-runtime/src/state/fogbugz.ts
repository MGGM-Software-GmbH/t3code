import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";
import * as Effect from "effect/Effect";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createFogBugzEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const revisions = Atom.family((_environmentId: EnvironmentId) => Atom.make(0));
  const refreshTrigger = ({ environmentId }: { environmentId: EnvironmentId }) =>
    revisions(environmentId);
  const onSuccess = (
    { environmentId }: { environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.update(revisions(environmentId), (revision) => revision + 1));
  return {
    manageCaseGit: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:manage-case-git",
      tag: WS_METHODS.fogbugzManageCaseGit,
    }),
    mutateCaseFiles: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:mutate-case-files",
      tag: WS_METHODS.fogbugzMutateCaseFiles,
    }),
    ensureCaseGit: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:ensure-case-git",
      tag: WS_METHODS.fogbugzEnsureCaseGit,
    }),
    threadCases: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "fogbugz:thread-cases",
      tag: WS_METHODS.fogbugzThreadCases,
      refreshTrigger,
      refreshIntervalMs: 30_000,
    }),
    caseContext: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:case-context",
      tag: WS_METHODS.fogbugzCaseContext,
    }),
    openCase: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:open-case",
      tag: WS_METHODS.fogbugzOpenCase,
    }),
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "fogbugz:status",
      tag: WS_METHODS.fogbugzStatus,
      refreshTrigger,
    }),
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "fogbugz:projects",
      tag: WS_METHODS.fogbugzProjects,
      refreshTrigger,
    }),
    cases: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "fogbugz:cases",
      tag: WS_METHODS.fogbugzCases,
      refreshTrigger,
    }),
    thread: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "fogbugz:thread",
      tag: WS_METHODS.fogbugzThread,
      refreshTrigger,
    }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:connect",
      tag: WS_METHODS.fogbugzConnect,
      onSuccess,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:disconnect",
      tag: WS_METHODS.fogbugzDisconnect,
      onSuccess,
    }),
    test: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:test",
      tag: WS_METHODS.fogbugzTest,
      onSuccess,
    }),
    linkProject: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:link-project",
      tag: WS_METHODS.fogbugzLinkProject,
      onSuccess,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:link-thread",
      tag: WS_METHODS.fogbugzLinkThread,
      onSuccess,
    }),
    createThread: createEnvironmentRpcCommand(runtime, {
      label: "fogbugz:create-thread",
      tag: WS_METHODS.fogbugzCreateThread,
      onSuccess,
    }),
  };
}
