import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import { PdSecretsLoginInput, PdSecretsRespondInput } from "./pdSecrets.ts";
const decodeLogin = Schema.decodeSync(PdSecretsLoginInput);
const encodeLogin = Schema.encodeSync(PdSecretsLoginInput);
const decodeResponse = Schema.decodeSync(PdSecretsRespondInput);

describe("pd-secrets credentials", () => {
  it("redacts decoded passwords while preserving whitespace and the wire contract", () => {
    const input = decodeLogin({ password: " synthetic password " });
    expect(Redacted.value(input.password)).toBe(" synthetic password ");
    expect(JSON.stringify(input)).not.toContain("synthetic password");
    expect(encodeLogin(input)).toEqual({ password: " synthetic password " });
  });
  it("accepts redacted client inputs through the RPC payload constructor", () => {
    const login = PdSecretsLoginInput.make({
      password: Redacted.make("synthetic-password", { label: "pd-secrets password" }),
    });
    const response = PdSecretsRespondInput.make({
      flowId: "flow",
      code: Redacted.make("123456", { label: "pd-secrets TOTP" }),
    });
    expect(encodeLogin(login)).toEqual({ password: "synthetic-password" });
    expect(Redacted.value(response.code)).toBe("123456");
  });
  it.each(["", "password\ncommand", "password\rcommand", "password\u0003", "a".repeat(4097)])(
    "rejects empty, oversized, or terminal control input",
    (password) => {
      expect(() => decodeLogin({ password })).toThrow();
    },
  );
  it("accepts only numeric TOTP input and redacts it", () => {
    const input = decodeResponse({ flowId: "flow", code: "123456" });
    expect(JSON.stringify(input)).not.toContain("123456");
    expect(() => decodeResponse({ flowId: "flow", code: "12\n3456" })).toThrow();
  });
  it("keeps rejected input out of validation errors", () => {
    expect(() => decodeLogin({ password: "synthetic-secret\n" })).toThrow();
    try {
      decodeLogin({ password: "synthetic-secret\n" });
      throw new Error("Accepted terminal controls");
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-secret");
    }
  });
});
