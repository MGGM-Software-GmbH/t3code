import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { PdSecretsError } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { KeyRoundIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Label } from "../ui/label";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
const isPdSecretsError = Schema.is(PdSecretsError);

const snapshotsAtom = Atom.make((get) =>
  [...get(environmentPresentations.presentationsAtom)]
    .filter(
      ([, presentation]) =>
        presentation.connection.phase === "connected" &&
        presentation.serverConfig?.environment.capabilities.pdSecrets === true,
    )
    .map(([environmentId, presentation]) => {
      const result = get(serverEnvironment.pdSecretsStatus({ environmentId, input: {} }));
      return {
        environmentId,
        label: presentation.entry.target.label,
        status: Option.getOrUndefined(AsyncResult.value(result))?.state,
        failed: result._tag === "Failure",
        waiting: result.waiting,
        allowed: get(serverEnvironment.loginPdSecrets.permissionAtom(environmentId)),
      };
    }),
);

interface SignInTarget {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

const PdSecretsContext = createContext<{
  readonly installed: ReadonlyArray<
    SignInTarget & { readonly status: string | undefined; readonly failed: boolean }
  >;
  readonly connected: boolean;
  readonly pending: boolean;
  readonly label: string;
  readonly check: () => Promise<void>;
} | null>(null);

/** Keep connection checks alive even while the mobile sidebar is closed. */
export function PdSecretsProvider({ children }: { readonly children: ReactNode }) {
  const registry = useContext(RegistryContext);
  const snapshots = useAtomValue(snapshotsAtom);
  const installed = useMemo(
    () =>
      snapshots.filter(
        (snapshot) => snapshot.status !== undefined && snapshot.status !== "not-installed",
      ),
    [snapshots],
  );
  const [target, setTarget] = useState<SignInTarget>();
  const [flowId, setFlowId] = useState<string>();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const dismissed = useRef(new Set<EnvironmentId>());
  const generation = useRef(0);
  const login = useAtomCommand(serverEnvironment.loginPdSecrets, {
    reportFailure: false,
    reportDefect: false,
  });
  const respond = useAtomCommand(serverEnvironment.respondPdSecrets, {
    reportFailure: false,
    reportDefect: false,
  });
  const cancel = useAtomCommand(serverEnvironment.cancelPdSecrets, {
    reportFailure: false,
    reportDefect: false,
  });

  useEffect(() => {
    for (const id of dismissed.current) {
      const snapshot = snapshots.find((item) => item.environmentId === id);
      if (!snapshot || snapshot.status === "connected") dismissed.current.delete(id);
    }
    if (target || pending) return;
    const next = snapshots.find(
      (snapshot) =>
        snapshot.status === "disconnected" &&
        !snapshot.waiting &&
        snapshot.allowed &&
        !dismissed.current.has(snapshot.environmentId),
    );
    if (next) setTarget(next);
  }, [snapshots, target, pending]);

  // Unmounting or losing the environment closes only this browser's owned login process.
  useEffect(() => {
    if (!target) return;
    return () => {
      void cancel({ environmentId: target.environmentId, input: {} });
    };
  }, [cancel, target]);
  useEffect(() => {
    if (target && !snapshots.some((snapshot) => snapshot.environmentId === target.environmentId)) {
      generation.current++;
      // eslint-disable-next-line react/set-state-in-effect -- A server disconnect must clear the in-flight credential form.
      setTarget(undefined);
      setFlowId(undefined);
      setValue("");
      setError(undefined);
    }
  }, [snapshots, target]);

  const open = (next: SignInTarget) => {
    generation.current++;
    setFlowId(undefined);
    setValue("");
    setError(undefined);
    setTarget(next);
  };
  const dismiss = () => {
    if (!target) return;
    generation.current++;
    dismissed.current.add(target.environmentId);
    setTarget(undefined);
    setFlowId(undefined);
    setValue("");
    setError(undefined);
  };
  const check = useStableCallback(async () => {
    if (pending) return;
    setPending(true);
    const checked = await Promise.all(
      snapshots.map(async (snapshot) => {
        const atom = serverEnvironment.pdSecretsStatus({
          environmentId: snapshot.environmentId,
          input: {},
        });
        registry.refresh(atom);
        const result = await Effect.runPromise(
          AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
            Effect.timeout("15 seconds"),
            Effect.exit,
          ),
        );
        return { ...snapshot, result };
      }),
    );
    setPending(false);
    const invalid = checked.find(
      (item) => Exit.isSuccess(item.result) && item.result.value.state === "disconnected",
    );
    if (invalid) {
      if (invalid.allowed) open(invalid);
      else
        toastManager.add({
          type: "error",
          title: `pd-secrets is disconnected on ${invalid.label}`,
          description: "This session cannot manage environment credentials.",
        });
    } else if (checked.some((item) => Exit.isFailure(item.result))) {
      toastManager.add({ type: "error", title: "Could not check pd-secrets" });
    } else if (
      checked.some((item) => Exit.isSuccess(item.result) && item.result.value.state === "connected")
    ) {
      toastManager.add({ type: "success", title: "pd-secrets is connected" });
    }
  });
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || pending || !value) return;
    const requestGeneration = generation.current;
    const secret = Redacted.make(value, {
      label: flowId ? "pd-secrets TOTP" : "pd-secrets password",
    });
    setValue("");
    setError(undefined);
    setPending(true);
    const result = flowId
      ? await respond({ environmentId: target.environmentId, input: { flowId, code: secret } })
      : await login({ environmentId: target.environmentId, input: { password: secret } });
    Redacted.wipeUnsafe(secret);
    if (requestGeneration !== generation.current) {
      await cancel({ environmentId: target.environmentId, input: {} });
    } else if (result._tag === "Success") {
      if (result.value.phase === "totp") setFlowId(result.value.flowId);
      else {
        toastManager.add({ type: "success", title: `pd-secrets is connected on ${target.label}` });
        setTarget(undefined);
        setFlowId(undefined);
      }
    } else {
      const failure = squashAtomCommandFailure(result);
      setError(
        isPdSecretsError(failure)
          ? failure.message
          : "Could not sign in to pd-secrets. Check the environment connection and configuration.",
      );
      setFlowId(undefined);
    }
    setPending(false);
  };
  const connected = installed.every(
    (snapshot) => snapshot.status === "connected" && !snapshot.failed,
  );
  const label = pending
    ? "pd-secrets: checking"
    : connected
      ? "pd-secrets: connected"
      : "pd-secrets: disconnected";
  const allowed =
    target &&
    snapshots.find((snapshot) => snapshot.environmentId === target.environmentId)?.allowed;
  const control = useMemo(
    () => ({ installed, connected, pending, label, check }),
    [installed, connected, pending, label, check],
  );

  return (
    <PdSecretsContext value={control}>
      {children}
      <Dialog
        open={target !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) dismiss();
        }}
      >
        <DialogPopup>
          <form
            aria-busy={pending}
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <DialogHeader>
              <DialogTitle>Sign in to pd-secrets</DialogTitle>
              <DialogDescription>{target?.label}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 px-6 pb-6">
              <Label htmlFor="pd-secrets-credential">
                {flowId ? "TOTP code" : "Password Depot password"}
              </Label>
              <Input
                key={flowId ?? "password"}
                id="pd-secrets-credential"
                type="password"
                autoComplete={flowId ? "one-time-code" : "off"}
                inputMode={flowId ? "numeric" : undefined}
                maxLength={flowId ? 8 : 4096}
                pattern={flowId ? "[0-9]{6,8}" : undefined}
                required
                autoFocus
                disabled={pending || !allowed}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              {pending ? (
                <div
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Spinner size="sm" aria-hidden="true" role="presentation" />
                  <span>Signing in and completing setup…</span>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {!allowed ? (
                <p role="alert" className="text-sm text-destructive">
                  This session cannot manage environment credentials.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={dismiss}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !allowed || !value}>
                {flowId ? "Verify code" : "Sign in"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </PdSecretsContext>
  );
}

/** The footer contains only the status control; sign-in also works outside the sidebar. */
export function PdSecretsControl() {
  const context = useContext(PdSecretsContext);
  if (!context) throw new Error("PdSecretsControl requires PdSecretsProvider");
  const { installed, connected, pending, label, check } = context;
  if (installed.length === 0) return null;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              disabled={pending}
              onClick={() => {
                void check();
              }}
              size="icon"
            >
              <span
                className={connected ? "text-success-foreground" : "text-warning-foreground"}
                aria-hidden="true"
              >
                <KeyRoundIcon className="size-4" />
              </span>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">
          <div>{label}</div>
          {installed.map((snapshot) => (
            <div key={snapshot.environmentId}>
              {snapshot.label}: {snapshot.failed ? "check failed" : snapshot.status}
            </div>
          ))}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
