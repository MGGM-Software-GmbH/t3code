import * as Schema from "effect/Schema";

/** Cache contents and expiry policy remain owned by pd-secrets. */
export const PdSecretsStatus = Schema.Struct({
  state: Schema.Literals(["not-installed", "connected", "disconnected"]),
});
export type PdSecretsStatus = typeof PdSecretsStatus.Type;

const Password = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  // eslint-disable-next-line no-control-regex -- PTY input must reject terminal controls and line breaks.
  Schema.isPattern(/^[^\x00-\x1f\x7f]+$/),
);
export const PdSecretsLoginInput = Schema.Struct({
  password: Schema.RedactedFromValue(Password, { label: "pd-secrets password" }),
});
export type PdSecretsLoginInput = typeof PdSecretsLoginInput.Type;

export const PdSecretsRespondInput = Schema.Struct({
  flowId: Schema.String,
  code: Schema.RedactedFromValue(Schema.String.check(Schema.isPattern(/^\d{6,8}$/)), {
    label: "pd-secrets TOTP",
  }),
});
export type PdSecretsRespondInput = typeof PdSecretsRespondInput.Type;

export const PdSecretsLoginResult = Schema.Union([
  Schema.Struct({ phase: Schema.Literal("connected") }),
  Schema.Struct({ phase: Schema.Literal("totp"), flowId: Schema.String }),
]);
export type PdSecretsLoginResult = typeof PdSecretsLoginResult.Type;

const FAILURE_MESSAGES = {
  not_installed: "pd-secrets is not installed on this environment.",
  check_failed: "Could not check pd-secrets on this environment.",
  busy: "Another pd-secrets sign-in is already in progress on this environment.",
  login_failed: "pd-secrets sign-in failed. Check your password, TOTP code, and server connection.",
  configuration: "pd-secrets did not request a password. Configure pd-secrets in a terminal first.",
  expired: "This pd-secrets sign-in expired. Start sign-in again.",
  cancelled: "pd-secrets sign-in was cancelled.",
} as const;

/** CLI output can contain credentials and must never become an RPC error. */
export class PdSecretsError extends Schema.TaggedError<PdSecretsError>()("PdSecretsError", {
  reason: Schema.Literals(Object.keys(FAILURE_MESSAGES) as Array<keyof typeof FAILURE_MESSAGES>),
}) {
  override get message(): string {
    return FAILURE_MESSAGES[this.reason];
  }
}
