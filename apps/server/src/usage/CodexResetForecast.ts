import { CodexResetForecast as Forecast, CodexResetForecastError } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const FORECAST_URL = "https://codex.lunarwerx.com/api/v1/forecast";
const MAX_SNAPSHOT_AGE_MS = 10 * 60_000;
const decodeForecast = Schema.decodeUnknownEffect(Forecast);

export class CodexResetForecast extends Context.Service<
  CodexResetForecast,
  { readonly read: Effect.Effect<Forecast, CodexResetForecastError> }
>()("t3/usage/CodexResetForecast") {}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const load = Effect.fn("CodexResetForecast.load")(function* () {
    const response = yield* client.get(FORECAST_URL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((cause) => new CodexResetForecastError({ reason: "requestFailed", cause })),
    );
    const payload = yield* response.json.pipe(
      Effect.mapError((cause) => new CodexResetForecastError({ reason: "invalidResponse", cause })),
    );
    const forecast = yield* decodeForecast(payload).pipe(
      Effect.mapError((cause) => new CodexResetForecastError({ reason: "invalidResponse", cause })),
    );
    if (
      !Number.isFinite(Date.parse(forecast.generatedAt)) ||
      forecast.next24Hours.low > forecast.next24Hours.high ||
      forecast.nearTerm.low > forecast.nearTerm.high
    ) {
      return yield* new CodexResetForecastError({ reason: "invalidResponse" });
    }
    const age = (yield* Clock.currentTimeMillis) - Date.parse(forecast.generatedAt);
    if (age < -60_000) {
      return yield* new CodexResetForecastError({ reason: "invalidResponse" });
    }
    if (age > MAX_SNAPSHOT_AGE_MS) {
      return yield* new CodexResetForecastError({ reason: "stale" });
    }
    return forecast;
  });

  // Cache failures as well: clients, reconnects and tooltip opens must not bypass
  // LunarWerx's maximum of one data request every 300 seconds. Hourly snapshots
  // retain their original forecast timestamp throughout the requested cache period.
  const cache = yield* Cache.makeWith(
    (_key: "forecast") =>
      load().pipe(
        Effect.timeout("15 seconds"),
        Effect.catchTags({
          TimeoutError: (cause) =>
            Effect.fail(new CodexResetForecastError({ reason: "requestFailed", cause })),
        }),
      ),
    { capacity: 1, timeToLive: () => "60 minutes" },
  );
  const read = Cache.get(cache, "forecast");
  return CodexResetForecast.of({ read });
});

export const layer = Layer.effect(CodexResetForecast, make);
