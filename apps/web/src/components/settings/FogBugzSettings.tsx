import { useGT, T, Var } from "gt-react";
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
  const uebersetzen = useGT();
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
      setMessage(uebersetzen("Connected as {wert1}.", { wert1: result.value.personName }));
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
              title={uebersetzen("Base URL")}
              control={
                <Input
                  aria-label={uebersetzen("FogBugz base URL")}
                  type="url"
                  value={baseUrl ?? connection?.baseUrl ?? ""}
                  placeholder="https://fogbugz.example.com/"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              }
            />
            <SettingsRow
              title={uebersetzen("Account E-Mail")}
              control={
                <Input
                  aria-label={uebersetzen("FogBugz account")}
                  autoComplete="username"
                  value={username ?? connection?.username ?? ""}
                  onChange={(event) => setUsername(event.target.value)}
                />
              }
            />
            <SettingsRow
              title={
                requiresPassword ? uebersetzen("Password") : uebersetzen("Password (optional)")
              }
              description={
                accountChanged
                  ? uebersetzen("Changing the account clears its project and thread links.")
                  : requiresPassword
                    ? uebersetzen("Sign in with your existing FogBugz account.")
                    : uebersetzen(
                        "Leave empty to keep your current sign-in. Changing the URL keeps your project and thread links.",
                      )
              }
              control={
                <SecretInput
                  aria-label={uebersetzen("FogBugz password")}
                  value={password}
                  placeholder={
                    requiresPassword
                      ? uebersetzen("Account password")
                      : uebersetzen("Keep current sign-in")
                  }
                  onChange={(event) => setPassword(event.target.value)}
                />
              }
            />
            {hasUnsavedChanges ? (
              <p role="status" className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                {requiresPassword && !password
                  ? uebersetzen("Enter your password to save these connection changes.")
                  : uebersetzen(
                      "Unsaved connection changes. Save changes to apply and verify them.",
                    )}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 px-3 py-3 sm:px-4">
              <Button type="submit" disabled={requiresPassword ? !password : !hasUnsavedChanges}>
                {connection ? uebersetzen("Save changes") : uebersetzen("Connect")}
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
                        setMessage(
                          uebersetzen("Connection verified: {wert1}.", {
                            wert1: result.value.personName,
                          }),
                        );
                    }}
                  >
                    <T>Test connection</T>
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
                        setMessage(
                          uebersetzen("Disconnected. T3 threads and FogBugz cases are preserved."),
                        );
                      }
                    }}
                  >
                    <T>Disconnect</T>
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
                <T>Sign in again to reconnect FogBugz.</T>
              </p>
            ) : null}
            {connection?.authenticated ? (
              <div
                className="space-y-2 px-3 py-3 text-sm sm:px-4"
                role="status"
                aria-label={uebersetzen("FogBugz compatibility")}
              >
                {status.data?.compatibilityError ? (
                  <p className="text-destructive">
                    <T>
                      Could not check integration features:{" "}
                      <Var>{status.data.compatibilityError}</Var> Use Test connection to retry.
                    </T>
                  </p>
                ) : !connection.capabilities ? (
                  <p className="text-muted-foreground">
                    <T>
                      Integration features have not been checked. Use Test connection to check this
                      FogBugz version.
                    </T>
                  </p>
                ) : (
                  <>
                    {!connection.capabilities.projectGroups ? (
                      <p>
                        <T>
                          Project groups are not supported by this FogBugz version. You can link
                          individual projects. Existing group links are preserved but cannot load
                          cases until FogBugz is updated.
                        </T>
                      </p>
                    ) : null}
                    {!connection.capabilities.browserSession ? (
                      <p>
                        <T>
                          Automatic browser sign-in is not supported by this FogBugz version. Sign
                          in directly in the Browser panel.
                        </T>
                      </p>
                    ) : null}
                    {!connection.capabilities.caseGit ? (
                      <p>
                        <T>
                          Case-Git is not supported by this FogBugz version. Threads and cases
                          remain available; case files and automatic file synchronization require a
                          FogBugz update.
                        </T>
                      </p>
                    ) : null}
                    {Object.values(connection.capabilities).every(Boolean) ? (
                      <p className="text-muted-foreground">
                        <T>All integration features are supported.</T>
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        <T>
                          Update FogBugz to enable these features, then use Test connection to check
                          again.
                        </T>
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </SettingsSection>
        </fieldset>
      </form>
      <SettingsSection title={uebersetzen("FogBugz automation")}>
        <FogBugzAutomationSettings />
      </SettingsSection>
    </>
  );
}
