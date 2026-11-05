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

it.effect("checks pd-secrets on connection, hourly, on demand, and after reconnect", () =>
  Effect.gen(function* () {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()));
    const target = new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make("pd-test"),
      label: "Test host",
      httpBaseUrl: "https://test.invalid",
      wsBaseUrl: "wss://test.invalid",
    });
    let requests = 0;
    const session = {
      client: {
        [WS_METHODS.pdSecretsStatus]: () =>
          Effect.sync(() => {
            requests++;
            return { state: "disconnected" as const };
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
    const query = atoms.pdSecretsStatus({ environmentId: target.environmentId, input: {} });
    const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
      Effect.sync(() => registry.dispose()),
    );
    registry.mount(query);
    const read = AtomRegistry.getResult(registry, query, { suspendOnWaiting: true }).pipe(
      Effect.andThen(Effect.yieldNow),
    );
    yield* read;
    expect(requests).toBe(1);
    vi.advanceTimersByTime(59 * 60_000);
    yield* read;
    expect(requests).toBe(1);
    vi.advanceTimersByTime(60_000);
    yield* read;
    expect(requests).toBe(2);
    registry.refresh(query);
    yield* read;
    expect(requests).toBe(3);
    yield* SubscriptionRef.update(state, (current) => ({ ...current, generation: 2 }));
    yield* read;
    expect(requests).toBe(4);
  }),
);
