import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";

export function FogBugzProjectSettings({
  environmentId,
  projectId,
  label,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  label?: string;
}) {
  const status = useEnvironmentQuery(fogbugzEnvironment.status({ environmentId, input: {} }));
  const connected = status.data?.connection?.authenticated;
  const projects = useEnvironmentQuery(
    connected ? fogbugzEnvironment.projects({ environmentId, input: {} }) : null,
  );
  const permission = useAtomValue(fogbugzEnvironment.linkProject.permissionAtom(environmentId));
  const link = useAtomCommand(fogbugzEnvironment.linkProject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = status.data?.projects.find(
    (item) => item.projectId === projectId,
  )?.fogbugzProjectId;
  const failure = error ?? status.error ?? projects.error;

  return (
    <SettingsRow
      title="FogBugz project"
      description={label}
      status={
        failure ? (
          <span role="alert" className="text-destructive">
            {failure}
          </span>
        ) : status.isPending ? (
          "Loading connection…"
        ) : !connected ? (
          "Connect your FogBugz account in MGGM settings."
        ) : undefined
      }
      control={
        connected ? (
          <Select
            value={selected ? String(selected) : "none"}
            disabled={busy || !permission || projects.isPending || !!projects.error}
            onValueChange={async (value) => {
              setBusy(true);
              const result = await link({
                environmentId,
                input: { projectId, fogbugzProjectId: value === "none" ? null : Number(value) },
              });
              setBusy(false);
              setError(
                result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
              );
              if (result._tag === "Success") status.refresh();
            }}
          >
            <SelectTrigger aria-label={label ? `FogBugz project for ${label}` : "FogBugz project"}>
              <SelectValue>
                {projects.isPending
                  ? "Loading projects…"
                  : (projects.data?.find((item) => item.id === selected)?.name ?? "Not linked")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="none">Not linked</SelectItem>
              {projects.data?.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : status.isPending || status.error ? undefined : (
          <Button
            variant="outline"
            render={<Link to="/settings/mggm" search={{ machine: environmentId }} />}
          >
            Set up connection
          </Button>
        )
      }
    />
  );
}
