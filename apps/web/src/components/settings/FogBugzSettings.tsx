import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SecretInput } from "./SecretInput";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function FogBugzSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const status = useEnvironmentQuery(fogbugzEnvironment.status({ environmentId, input: {} }));
  const connection = status.data?.connection;
  const projects = useEnvironmentQuery(
    connection?.authenticated ? fogbugzEnvironment.projects({ environmentId, input: {} }) : null,
  );
  const localProjects = useProjects().filter((project) => project.environmentId === environmentId);
  const permission = useAtomValue(fogbugzEnvironment.connect.permissionAtom(environmentId));
  const linkPermission = useAtomValue(fogbugzEnvironment.linkProject.permissionAtom(environmentId));
  const connect = useAtomCommand(fogbugzEnvironment.connect);
  const disconnect = useAtomCommand(fogbugzEnvironment.disconnect);
  const test = useAtomCommand(fogbugzEnvironment.test);
  const link = useAtomCommand(fogbugzEnvironment.linkProject);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    const result = await connect({
      environmentId,
      input: {
        baseUrl: baseUrl ?? connection?.baseUrl ?? "",
        username: username ?? connection?.username ?? "",
        password,
      },
    });
    setPassword("");
    setBusy(false);
    if (result._tag === "Failure") setError(formatEnvironmentQueryError(result.cause));
    if (result._tag === "Success") {
      setMessage(`Connected as ${result.value.personName}.`);
      status.refresh();
      projects.refresh();
    }
  }
  return (
    <SettingsSection title="FogBugz">
      {status.error ? <p role="alert">{status.error}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy || !permission} className="grid gap-4">
          <SettingsRow
            title="Base URL"
            control={
              <Input
                aria-label="FogBugz base URL"
                type="url"
                value={baseUrl ?? connection?.baseUrl ?? ""}
                placeholder="https://fogbugz.example.com/"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Account"
            control={
              <Input
                aria-label="FogBugz account"
                autoComplete="username"
                value={username ?? connection?.username ?? ""}
                onChange={(event) => setUsername(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Password"
            description="Uses your existing FogBugz account. The API token is stored on this environment. Changing the server or account clears its project and thread links."
            control={
              <SecretInput
                aria-label="FogBugz password"
                value={password}
                configured={!!connection}
                onChange={(event) => setPassword(event.target.value)}
              />
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!password}>
              {connection ? "Update connection" : "Connect"}
            </Button>
            {connection ? (
              <>
                <Button
                  variant="outline"
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    const result = await test({ environmentId, input: {} });
                    setBusy(false);
                    setError(
                      result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
                    );
                    status.refresh();
                    if (result._tag === "Success")
                      setMessage(`Connection verified: ${result.value.personName}.`);
                  }}
                >
                  Test connection
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    const result = await disconnect({ environmentId, input: {} });
                    setBusy(false);
                    setError(
                      result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
                    );
                    if (result._tag === "Success") {
                      status.refresh();
                      setMessage("Disconnected. T3 threads and FogBugz cases are preserved.");
                    }
                  }}
                >
                  Disconnect
                </Button>
              </>
            ) : null}
          </div>
        </fieldset>
      </form>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {connection && !connection.authenticated ? (
        <p role="alert">Sign in again to reconnect FogBugz.</p>
      ) : null}
      {connection?.authenticated ? (
        <>
          {projects.error ? <p role="alert">{projects.error}</p> : null}
          {localProjects.map((project) => {
            const selected = status.data?.projects.find(
              (item) => item.projectId === project.id,
            )?.fogbugzProjectId;
            return (
              <SettingsRow
                key={project.id}
                title={project.title}
                control={
                  <Select
                    value={selected ? String(selected) : "none"}
                    disabled={busy || !linkPermission || projects.isPending}
                    onValueChange={async (value) => {
                      setBusy(true);
                      const result = await link({
                        environmentId,
                        input: {
                          projectId: project.id,
                          fogbugzProjectId: value === "none" ? null : Number(value),
                        },
                      });
                      setBusy(false);
                      setError(
                        result._tag === "Failure"
                          ? formatEnvironmentQueryError(result.cause)
                          : null,
                      );
                      if (result._tag === "Success") status.refresh();
                    }}
                  >
                    <SelectTrigger aria-label={`FogBugz project for ${project.title}`}>
                      <SelectValue>
                        {projects.data?.find((item) => item.id === selected)?.name ?? "Not linked"}
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
                }
              />
            );
          })}
        </>
      ) : null}
    </SettingsSection>
  );
}
