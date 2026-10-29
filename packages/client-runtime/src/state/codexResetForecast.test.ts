import { expect, it, vi } from "@effect/vitest";
import { EnvironmentId, WS_METHODS, type ServerConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";
import { AVAILABLE_CONNECTION_STATE, PrimaryConnectionTarget } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import * as Persistence from "../platform/persistence.ts";
import { createServerEnvironmentAtoms } from "./server.ts";

it.effect("shares the forecast query between readers and refreshes only every sixty minutes", () =>
  Effect.gen(function* () {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()));
    const target = new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make("forecast-test"),
      label: "Test host",
      httpBaseUrl: "https://test.invalid",
      wsBaseUrl: "wss://test.invalid",
    });
    let requests = 0;
    const session = {
      client: {
        [WS_METHODS.serverGetCodexResetForecast]: () =>
          Effect.sync(() => {
            requests++;
            return {
              generatedAt: "2026-10-19T20:00:00.000Z",
              next24Hours: { probability: 0.3, low: 0.1, high: 0.5 },
              nearTerm: { hours: 6, probability: 0.1, low: 0.01, high: 0.2 },
            };
          }),
      },
    } as unknown as RpcSession;
    const state = yield* SubscriptionRef.make({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected" as const,
      generation: 1,
    });
    const sessions = yield* SubscriptionRef.make(Option.some(session));
    const supervisor = {
      target,
      state,
      session: sessions,
    } as unknown as EnvironmentSupervisor.EnvironmentSupervisor["Service"];
    const environments = {
      run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      followStream: (_id: EnvironmentId, stream: Stream.Stream<unknown>) =>
        Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"];
    const runtime = Atom.runtime(
      Layer.merge(
        Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
        Layer.succeed(
          Persistence.EnvironmentCacheStore,
          {} as Persistence.EnvironmentCacheStore["Service"],
        ),
      ),
    );
    const atoms = createServerEnvironmentAtoms(runtime, {
      initialConfigValueAtom: () => Atom.make<ServerConfig | null>(null),
    });
    const query = atoms.codexResetForecast({ environmentId: target.environmentId, input: {} });
    const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
      Effect.sync(() => registry.dispose()),
    );
    registry.mount(query);
    registry.mount(atoms.codexResetForecast({ environmentId: target.environmentId, input: {} }));
    const read = AtomRegistry.getResult(registry, query, { suspendOnWaiting: true }).pipe(
      Effect.andThen(Effect.yieldNow),
    );
    yield* read;
    expect(requests).toBe(1);
    vi.advanceTimersByTime(3_599_000);
    yield* read;
    expect(requests).toBe(1);
    vi.advanceTimersByTime(1000);
    yield* read;
    expect(requests).toBe(2);
  }),
);
