import * as Schema from "effect/Schema";

const Probability = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const ForecastWindow = Schema.Struct({
  probability: Probability,
  low: Probability,
  high: Probability,
});

/** Public reset estimates are separate from an account's scheduled quota rollover. */
export const CodexResetForecast = Schema.Struct({
  generatedAt: Schema.String,
  next24Hours: ForecastWindow,
  nearTerm: Schema.Struct({
    hours: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    probability: Probability,
    low: Probability,
    high: Probability,
  }),
});
export type CodexResetForecast = typeof CodexResetForecast.Type;

export class CodexResetForecastError extends Schema.TaggedError<CodexResetForecastError>()(
  "CodexResetForecastError",
  {
    reason: Schema.Literals(["requestFailed", "invalidResponse", "stale"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "requestFailed":
        return "Could not read the reset forecast from LunarWerx.";
      case "invalidResponse":
        return "LunarWerx returned an invalid reset forecast.";
      case "stale":
        return "The reset forecast is out of date.";
    }
  }
}
