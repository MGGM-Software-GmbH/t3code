import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { fogbugzEnvironment } from "../../state/fogbugz";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SecretInput } from "./SecretInput";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function FogBugzSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const status = useEnvironmentQuery(fogbugzEnvironment.status({ environmentId, input: {} }));
  const connection = status.data?.connection;
  const permission = useAtomValue(fogbugzEnvironment.connect.permissionAtom(environmentId));
  const connect = useAtomCommand(fogbugzEnvironment.connect);
  const disconnect = useAtomCommand(fogbugzEnvironment.disconnect);
  const test = useAtomCommand(fogbugzEnvironment.test);
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
    }
  }
  return (
    <>
      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy || !permission} className="contents">
          <SettingsSection title="FogBugz">
            {status.error || error ? (
              <p role="alert" className="px-3 py-3 text-sm text-destructive sm:px-4">
                {error ?? status.error}
              </p>
            ) : null}
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
              title="Account E-Mail"
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
              description="Use your existing FogBugz account. Changing the URL or email clears its project and thread links."
              control={
                <SecretInput
                  aria-label="FogBugz password"
                  value={password}
                  configured={!!connection}
                  onChange={(event) => setPassword(event.target.value)}
                />
              }
            />
            <div className="flex flex-wrap gap-2 px-3 py-3 sm:px-4">
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
                        result._tag === "Failure"
                          ? formatEnvironmentQueryError(result.cause)
                          : null,
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
                        result._tag === "Failure"
                          ? formatEnvironmentQueryError(result.cause)
                          : null,
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
            {message ? (
              <p role="status" className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                {message}
              </p>
            ) : null}
            {connection && !connection.authenticated ? (
              <p role="alert" className="px-3 py-3 text-sm sm:px-4">
                Sign in again to reconnect FogBugz.
              </p>
            ) : null}
          </SettingsSection>
        </fieldset>
      </form>
    </>
  );
}
