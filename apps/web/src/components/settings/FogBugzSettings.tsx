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
import { FogBugzAutomationSettings } from "./FogBugzAutomationSettings";

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
  const accountChanged =
    !!connection &&
    (username ?? connection.username).trim().toLowerCase() !== connection.username.toLowerCase();
  const requiresPassword = !connection || !connection.authenticated || accountChanged;
  const hasUnsavedChanges =
    !!connection &&
    ((baseUrl ?? connection.baseUrl) !== connection.baseUrl ||
      (username ?? connection.username) !== connection.username ||
      password !== "");

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
      setBaseUrl(result.value.baseUrl);
      setUsername(result.value.username);
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
              title={requiresPassword ? "Password" : "Password (optional)"}
              description={
                accountChanged
                  ? "Changing the account clears its project and thread links."
                  : requiresPassword
                    ? "Sign in with your existing FogBugz account."
                    : "Leave empty to keep your current sign-in. Changing the URL keeps your project and thread links."
              }
              control={
                <SecretInput
                  aria-label="FogBugz password"
                  value={password}
                  placeholder={requiresPassword ? "Account password" : "Keep current sign-in"}
                  onChange={(event) => setPassword(event.target.value)}
                />
              }
            />
            {hasUnsavedChanges ? (
              <p role="status" className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                {requiresPassword && !password
                  ? "Enter your password to save these connection changes."
                  : "Unsaved connection changes. Save changes to apply and verify them."}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 px-3 py-3 sm:px-4">
              <Button type="submit" disabled={requiresPassword ? !password : !hasUnsavedChanges}>
                {connection ? "Save changes" : "Connect"}
              </Button>
              {connection ? (
                <>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={hasUnsavedChanges}
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
            {message && !hasUnsavedChanges ? (
              <p role="status" className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                {message}
              </p>
            ) : null}
            {connection && !connection.authenticated ? (
              <p role="alert" className="px-3 py-3 text-sm sm:px-4">
                Sign in again to reconnect FogBugz.
              </p>
            ) : null}
            {connection?.authenticated ? (
              <div
                className="space-y-2 px-3 py-3 text-sm sm:px-4"
                role="status"
                aria-label="FogBugz compatibility"
              >
                {status.data?.compatibilityError ? (
                  <p className="text-destructive">
                    Could not check integration features: {status.data.compatibilityError} Use Test
                    connection to retry.
                  </p>
                ) : !connection.capabilities ? (
                  <p className="text-muted-foreground">
                    Integration features have not been checked. Use Test connection to check this
                    FogBugz version.
                  </p>
                ) : (
                  <>
                    {!connection.capabilities.projectGroups ? (
                      <p>
                        Project groups are not supported by this FogBugz version. You can link
                        individual projects. Existing group links are preserved but cannot load
                        cases until FogBugz is updated.
                      </p>
                    ) : null}
                    {!connection.capabilities.browserSession ? (
                      <p>
                        Automatic browser sign-in is not supported by this FogBugz version. Sign in
                        directly in the Browser panel.
                      </p>
                    ) : null}
                    {!connection.capabilities.caseGit ? (
                      <p>
                        Case-Git is not supported by this FogBugz version. Threads and cases remain
                        available; case files and automatic file synchronization require a FogBugz
                        update.
                      </p>
                    ) : null}
                    {Object.values(connection.capabilities).every(Boolean) ? (
                      <p className="text-muted-foreground">
                        All integration features are supported.
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        Update FogBugz to enable these features, then use Test connection to check
                        again.
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </SettingsSection>
        </fieldset>
      </form>
      <SettingsSection title="FogBugz automation">
        <FogBugzAutomationSettings />
      </SettingsSection>
    </>
  );
}
