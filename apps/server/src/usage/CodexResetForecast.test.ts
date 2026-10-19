import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as CodexResetForecast from "./CodexResetForecast.ts";

const NOW = Date.parse("2026-10-19T20:00:00.000Z");
const forecast = {
  generatedAt: "2026-10-19T20:00:00.000Z",
  next24Hours: { probability: 0.302, low: 0.145, high: 0.505 },
  nearTerm: { hours: 6, probability: 0.114, low: 0.046, high: 0.232 },
};

function fixture(
  options: { payload?: unknown; status?: number; never?: boolean; invalidJson?: boolean } = {},
) {
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push({ url: request.url, authorization: request.headers.authorization });
      if (options.never) return yield* Effect.never;
      yield* Effect.yieldNow;
      return HttpClientResponse.fromWeb(
        request,
        options.invalidJson
          ? new Response("{", { headers: { "content-type": "application/json" } })
          : Response.json(options.payload ?? forecast, { status: options.status ?? 200 }),
      );
    }),
  );
  return {
    requests,
    options,
    layer: CodexResetForecast.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  };
}

it.effect(
  "shares one public request across concurrent clients and caches it for sixty minutes",
  () => {
    const test = fixture();
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const service = yield* CodexResetForecast.CodexResetForecast;
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => service.read),
        { concurrency: "unbounded" },
      );
      expect(results.every((result) => result.next24Hours.probability === 0.302)).toBe(true);
      expect(test.requests).toEqual([
        { url: "https://codex.lunarwerx.com/api/v1/forecast", authorization: undefined },
      ]);
      yield* TestClock.adjust(3_599_000);
      yield* service.read;
      expect(test.requests).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      test.options.payload = { ...forecast, generatedAt: "2026-10-19T21:00:00.000Z" };
      yield* service.read;
      expect(test.requests).toHaveLength(2);
    }).pipe(Effect.provide(test.layer));
  },
);

it.effect("caches a failed request without inventing a forecast and recovers after the TTL", () => {
  const test = fixture({ status: 503 });
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const service = yield* CodexResetForecast.CodexResetForecast;
    expect((yield* Effect.flip(service.read)).reason).toBe("requestFailed");
    expect((yield* Effect.flip(service.read)).reason).toBe("requestFailed");
    expect(test.requests).toHaveLength(1);
    test.options.status = 200;
    yield* TestClock.adjust("60 minutes");
    test.options.payload = { ...forecast, generatedAt: "2026-10-19T21:00:00.000Z" };
    expect((yield* service.read).next24Hours).toEqual(forecast.next24Hours);
    expect(test.requests).toHaveLength(2);
  }).pipe(Effect.provide(test.layer));
});

it.effect.each([
  [
    "out-of-range probabilities",
    { ...forecast, next24Hours: { ...forecast.next24Hours, probability: 1.1 } },
  ],
  ["missing forecast windows", { generatedAt: forecast.generatedAt }],
  [
    "reversed uncertainty bounds",
    { ...forecast, next24Hours: { probability: 0.3, low: 0.7, high: 0.2 } },
  ],
  ["invalid timestamps", { ...forecast, generatedAt: "not a date" }],
  ["future timestamps", { ...forecast, generatedAt: "2026-10-19T20:02:00.000Z" }],
] as const)("rejects %s", ([_name, payload]) => {
  const test = fixture({ payload });
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const service = yield* CodexResetForecast.CodexResetForecast;
    expect((yield* Effect.flip(service.read)).reason).toBe("invalidResponse");
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects malformed JSON", () => {
  const test = fixture({ invalidJson: true });
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const service = yield* CodexResetForecast.CodexResetForecast;
    expect((yield* Effect.flip(service.read)).reason).toBe("invalidResponse");
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects an upstream snapshot that is already over ten minutes old on retrieval", () => {
  const test = fixture({
    payload: { ...forecast, generatedAt: "2026-10-19T19:49:00.000Z" },
  });
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const service = yield* CodexResetForecast.CodexResetForecast;
    expect((yield* Effect.flip(service.read)).reason).toBe("stale");
    expect(test.requests).toHaveLength(1);
  }).pipe(Effect.provide(test.layer));
});

it.effect("times out an unresponsive upstream request", () => {
  const test = fixture({ never: true });
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const service = yield* CodexResetForecast.CodexResetForecast;
    const result = yield* Effect.flip(service.read).pipe(Effect.forkChild);
    yield* TestClock.adjust("15 seconds");
    const error = yield* Fiber.join(result);
    expect(error.reason).toBe("requestFailed");
    expect(test.requests).toHaveLength(1);
  }).pipe(Effect.provide(test.layer));
});
