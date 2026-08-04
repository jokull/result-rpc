import assert from "node:assert/strict";
import React, { Component, StrictMode, Suspense, createElement, useState } from "react";
import TestRenderer from "react-test-renderer";
import { err, error, ok, wire } from "result-rpc";
import { fetchTransport, isClaimed } from "result-rpc/client";
import { createQueryRuntime } from "result-rpc/query";
import {
  ResultRpcProvider,
  ResultSuspense,
  defineShell,
  useResultMutation,
  useResultSuspenseQuery,
} from "result-rpc/react";
import { createFetchHandler, serverRpc } from "result-rpc/server";
import { createFixtureClient } from "result-rpc/testing";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, create } = TestRenderer;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
let sequence = 0;

const SessionExpired = error({
  tag: "auth/session-expired",
  data: wire.object({}),
  retry: "never",
  visibility: "public",
});
const SessionRefreshing = error({
  tag: "auth/session-refreshing",
  data: wire.object({ retryAfterMs: wire.number }),
  retry: "after",
  visibility: "public",
});
const TitleConflict = error({
  tag: "doc/title-conflict",
  data: wire.object({}),
  retry: "never",
  visibility: "public",
});
const TemporaryConflict = error({
  tag: "doc/temporary-conflict",
  data: wire.object({ retryAfterMs: wire.number }),
  retry: "after",
  visibility: "public",
});
const CollidingSessionExpired = error({
  tag: "auth/session-expired",
  data: wire.object({ count: wire.number }),
  retry: "never",
  visibility: "public",
});

class CaptureBoundary extends Component {
  state = { caught: undefined };
  static getDerivedStateFromError(caught) {
    return { caught };
  }
  componentDidCatch(caught) {
    this.props.onCaught(caught);
  }
  render() {
    return this.state.caught === undefined ? this.props.children : null;
  }
}

const createHarness = ({ collision = false } = {}) => {
  let sessionValid = false;
  const mutationAttempts = {
    never: 0,
    after: 0,
    "residual-never": 0,
    "residual-after": 0,
  };
  const app = serverRpc.context();
  const guarded = app
    .procedure()
    .input(wire.object({ id: wire.string }))
    .output(wire.string)
    .errors({ SessionExpired })
    .query(({ input, errors }) =>
      sessionValid ? ok(`data:${input.id}`) : err(errors.SessionExpired({})),
    );
  const mutateOwned = app
    .procedure()
    .input(
      wire.object({
        mode: wire.union([
          wire.literal("never"),
          wire.literal("after"),
          wire.literal("residual-never"),
          wire.literal("residual-after"),
        ]),
      }),
    )
    .output(wire.string)
    .errors({ SessionExpired, SessionRefreshing, TitleConflict, TemporaryConflict })
    .mutation(({ input, errors }) => {
      mutationAttempts[input.mode] += 1;
      switch (input.mode) {
        case "after":
          return err(errors.SessionRefreshing({ retryAfterMs: 0 }));
        case "residual-never":
          return err(errors.TitleConflict({}));
        case "residual-after":
          return err(errors.TemporaryConflict({ retryAfterMs: 0 }));
        default:
          return err(errors.SessionExpired({}));
      }
    });
  const router = app.router({ guarded, mutateOwned });
  const handler = createFetchHandler({ router, createContext: () => ({}) });
  const client = createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://package-smoke.test/rpc",
      fetch: (input, init) => handler(new Request(input, init)),
    }),
  });
  const runtime = createQueryRuntime({ client });
  const reactions = [];
  const AuthShell = defineShell({
    name: `package-smoke-auth-${sequence++}`,
    claims: collision ? { CollidingSessionExpired } : { SessionExpired, SessionRefreshing },
    onError: (failure) => reactions.push(failure._tag),
  });
  return {
    AuthShell,
    client,
    mutationAttempts,
    reactions,
    runtime,
    validateSession: () => {
      sessionValid = true;
    },
  };
};

const mutationRetryMatrix = async () => {
  for (const hook of ["shell", "plain"]) {
    for (const retryCase of ["false", "number", "callback", "policy"]) {
      const harness = createHarness();
      const failures = [];
      const settled = [];
      let cancellations = 0;
      let retryCalls = 0;
      let rolledBack = false;
      let mutation;
      const mode = retryCase === "policy" ? "after" : "never";
      const retry =
        retryCase === "false"
          ? false
          : retryCase === "number"
            ? 2
            : retryCase === "callback"
              ? () => {
                  retryCalls += 1;
                  return true;
                }
              : undefined;
      const options = {
        ...(retry === undefined ? {} : { retry }),
        optimistic: () => ({ rollback: () => (rolledBack = true) }),
        onFailure: (failure) => failures.push(failure._tag),
        onSettled: (result) => settled.push(result.isOk() ? "ok" : result.error._tag),
        onCancel: (_input, context) => {
          cancellations += 1;
          context?.rollback();
        },
      };
      function ShellProbe() {
        mutation = harness.AuthShell.useMutation(harness.client.mutateOwned, options);
        return null;
      }
      function PlainProbe() {
        mutation = useResultMutation(harness.client.mutateOwned, options);
        return null;
      }
      const mounted = await mountHarness(
        harness,
        createElement(hook === "shell" ? ShellProbe : PlainProbe),
      );
      let rejection;
      await act(async () => {
        await mutation.mutateAsync({ mode }).catch((reason) => {
          rejection = reason;
        });
        await settle();
      });
      assert.equal(harness.mutationAttempts[mode], 1, `${hook}/${retryCase} retried`);
      assert.equal(retryCalls, 0);
      assert.equal(cancellations, 1);
      assert.equal(rolledBack, true);
      assert.deepEqual(failures, []);
      assert.deepEqual(settled, []);
      assert.equal(isClaimed(rejection), true);
      assert.equal(mutation.state, "idle");
      assert.equal(mounted.affected(), 1);
      assert.deepEqual(harness.reactions, [
        mode === "after" ? "auth/session-refreshing" : "auth/session-expired",
      ]);
      await unmountHarness(harness, mounted);
    }
  }
};

const residualMutationRetryMatrix = async () => {
  for (const hook of ["shell", "plain"]) {
    for (const [retryCase, mode, expectedAttempts, expectedRetryCounts] of [
      ["false", "residual-never", 1, []],
      ["number", "residual-never", 3, []],
      ["callback", "residual-never", 2, [0, 1]],
      ["policy", "residual-after", 4, []],
    ]) {
      const harness = createHarness();
      const failures = [];
      const settled = [];
      const retryCounts = [];
      let cancellations = 0;
      let mutation;
      const retry =
        retryCase === "false"
          ? false
          : retryCase === "number"
            ? 2
            : retryCase === "callback"
              ? (_failure, failureCount) => {
                  retryCounts.push(failureCount);
                  return failureCount < 1;
                }
              : undefined;
      const options = {
        ...(retry === undefined ? {} : { retry }),
        onFailure: (failure) => failures.push(failure._tag),
        onSettled: (result) => settled.push(result.isOk() ? "ok" : result.error._tag),
        onCancel: () => {
          cancellations += 1;
        },
      };
      function ShellProbe() {
        mutation = harness.AuthShell.useMutation(harness.client.mutateOwned, options);
        return null;
      }
      function PlainProbe() {
        mutation = useResultMutation(harness.client.mutateOwned, options);
        return null;
      }
      const mounted = await mountHarness(
        harness,
        createElement(hook === "shell" ? ShellProbe : PlainProbe),
      );
      let outcome;
      await act(async () => {
        outcome = await mutation.mutateAsync({ mode });
        await settle();
      });
      const expectedTag =
        mode === "residual-after" ? "doc/temporary-conflict" : "doc/title-conflict";
      assert.equal(harness.mutationAttempts[mode], expectedAttempts);
      assert.deepEqual(retryCounts, expectedRetryCounts);
      assert.deepEqual(failures, [expectedTag]);
      assert.deepEqual(settled, [expectedTag]);
      assert.equal(cancellations, 0);
      assert.equal(outcome.isOk(), false);
      assert.equal(mutation.state, "failure");
      assert.equal(mounted.affected(), 0);
      assert.deepEqual(harness.reactions, []);
      await unmountHarness(harness, mounted);
    }
  }
};

const mutationRetryCallbackFreshness = async () => {
  const harness = createHarness();
  const retryGenerations = [];
  const failureGenerations = [];
  let mutation;
  let advance = () => undefined;
  let resolveFirstRetry;
  const firstRetry = new Promise((resolve) => {
    resolveFirstRetry = resolve;
  });
  function Host() {
    const [generation, setGeneration] = useState(0);
    advance = () => setGeneration(1);
    mutation = harness.AuthShell.useMutation(harness.client.mutateOwned, {
      retry: (_failure, failureCount) => {
        retryGenerations.push(generation);
        if (failureCount === 0) resolveFirstRetry();
        return failureCount < 1;
      },
      onFailure: () => failureGenerations.push(generation),
    });
    return null;
  }
  const mounted = await mountHarness(harness, createElement(Host));
  let pending;
  await act(async () => {
    pending = mutation.mutateAsync({ mode: "residual-never" });
    await firstRetry;
  });
  await act(async () => {
    advance();
    await settle();
  });
  let outcome;
  await act(async () => {
    outcome = await pending;
    await settle();
  });
  assert.equal(harness.mutationAttempts["residual-never"], 2);
  assert.deepEqual(retryGenerations, [0, 1]);
  assert.deepEqual(failureGenerations, [1]);
  assert.equal(outcome.isOk(), false);
  await unmountHarness(harness, mounted);
};

const mutationDefinitionCollision = async () => {
  for (const hook of ["shell", "plain"]) {
    const harness = createHarness({ collision: true });
    const failures = [];
    const settled = [];
    let cleanups = 0;
    let rolledBack = false;
    let caught;
    let mutation;
    const options = {
      retry: false,
      optimistic: () => ({ rollback: () => (rolledBack = true) }),
      onFailure: (failure) => failures.push(failure._tag),
      onSettled: (result) => settled.push(result.isOk() ? "ok" : result.error._tag),
      onCancel: (_input, context) => {
        cleanups += 1;
        context?.rollback();
      },
    };
    function ShellProbe() {
      mutation = harness.AuthShell.useMutation(harness.client.mutateOwned, options);
      return null;
    }
    function PlainProbe() {
      mutation = useResultMutation(harness.client.mutateOwned, options);
      return null;
    }
    const mounted = await mountHarness(
      harness,
      createElement(
        CaptureBoundary,
        { onCaught: (error) => (caught = error) },
        createElement(hook === "shell" ? ShellProbe : PlainProbe),
      ),
    );
    let rejection;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await act(async () => {
        await mutation.mutateAsync({ mode: "never" }).catch((reason) => {
          rejection = reason;
        });
        await settle();
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(harness.mutationAttempts.never, 1);
    assert(rejection instanceof TypeError);
    assert.match(rejection.message, /different error definition/);
    assert(caught instanceof TypeError);
    assert.match(caught.message, /different error definition/);
    assert.deepEqual(failures, []);
    assert.deepEqual(settled, []);
    assert.equal(cleanups, 1);
    assert.equal(rolledBack, true);
    assert.equal(mounted.affected(), 0);
    assert.deepEqual(harness.reactions, []);
    await unmountHarness(harness, mounted);
  }
};

const mountHarness = async (harness, child) => {
  let affected = 0;
  let resume = () => undefined;
  function Holdings() {
    const held = harness.AuthShell.useHeld();
    affected = held.affected;
    resume = held.resume;
    return createElement("span", null, `affected:${held.affected}`);
  }
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(
        ResultRpcProvider,
        { runtime: harness.runtime },
        createElement(harness.AuthShell.Provider, null, createElement(Holdings), child),
      ),
    );
    await settle();
  });
  return {
    affected: () => affected,
    renderer,
    resume: () => resume(),
  };
};

const unmountHarness = async (harness, mounted) => {
  await act(async () => mounted.renderer.unmount());
  harness.runtime.clear();
};

const probeFor = (harness, id) => {
  function Probe() {
    const state = useResultSuspenseQuery(harness.client.guarded, { id }, { retry: false });
    return createElement("span", null, state.state === "success" ? state.value : state.error._tag);
  }
  return Probe;
};

const sameKeyRetirement = async () => {
  const harness = createHarness();
  const Probe = probeFor(harness, "same");
  let hideFirst = () => undefined;
  let hideSecond = () => undefined;
  function Host() {
    const [first, setFirst] = useState(true);
    const [second, setSecond] = useState(true);
    hideFirst = () => setFirst(false);
    hideSecond = () => setSecond(false);
    return createElement(
      React.Fragment,
      null,
      first
        ? createElement(ResultSuspense, { fallback: "loading-first" }, createElement(Probe))
        : null,
      second
        ? createElement(ResultSuspense, { fallback: "loading-second" }, createElement(Probe))
        : null,
    );
  }
  const mounted = await mountHarness(harness, createElement(Host));
  assert.equal(mounted.affected(), 1);
  assert.deepEqual(harness.reactions, ["auth/session-expired"]);
  await act(async () => {
    hideFirst();
    await settle();
  });
  assert.equal(mounted.affected(), 1);
  await act(async () => {
    hideSecond();
    await settle();
  });
  assert.equal(mounted.affected(), 0);
  await unmountHarness(harness, mounted);
};

const distinctRetirement = async () => {
  const harness = createHarness();
  let retain = () => undefined;
  function Probe({ id }) {
    useResultSuspenseQuery(harness.client.guarded, { id }, { retry: false });
    return null;
  }
  function Host() {
    const [ids, setIds] = useState(["a", "b", "c", "d"]);
    retain = (...next) => setIds(next);
    return createElement(
      React.Fragment,
      null,
      ...ids.map((id) =>
        createElement(
          ResultSuspense,
          { key: id, fallback: `loading-${id}` },
          createElement(Probe, { id }),
        ),
      ),
    );
  }
  const mounted = await mountHarness(harness, createElement(Host));
  assert.equal(mounted.affected(), 4);
  await act(async () => {
    retain("a", "c");
    await settle();
  });
  assert.equal(mounted.affected(), 2);
  await act(async () => {
    retain();
    await settle();
  });
  assert.equal(mounted.affected(), 0);
  assert.equal(harness.reactions.length, 4);
  await unmountHarness(harness, mounted);
};

const resetKeyRetirement = async () => {
  const harness = createHarness();
  const Probe = probeFor(harness, "reset");
  let replace = () => undefined;
  function Host() {
    const [branch, setBranch] = useState("query");
    replace = () => setBranch("replacement");
    return createElement(
      ResultSuspense,
      { fallback: "loading", resetKey: branch },
      branch === "query" ? createElement(Probe) : createElement("span", null, branch),
    );
  }
  const mounted = await mountHarness(harness, createElement(Host));
  assert.equal(mounted.affected(), 1);
  await act(async () => {
    replace();
    await settle();
  });
  assert.equal(mounted.affected(), 0);
  assert.match(JSON.stringify(mounted.renderer.toJSON()), /replacement/);
  await unmountHarness(harness, mounted);
};

const plainSuspenseFailure = async () => {
  const harness = createHarness();
  const Probe = probeFor(harness, "plain");
  let caught;
  class Boundary extends Component {
    state = { caught: undefined };
    static getDerivedStateFromError(error) {
      return { caught: error };
    }
    componentDidCatch(error) {
      caught = error;
    }
    render() {
      return this.state.caught ? createElement("span", null, "caught") : this.props.children;
    }
  }
  const originalConsoleError = console.error;
  let mounted;
  console.error = () => undefined;
  try {
    mounted = await mountHarness(
      harness,
      createElement(
        Boundary,
        null,
        createElement(Suspense, { fallback: "loading" }, createElement(Probe)),
      ),
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert(caught instanceof TypeError);
  assert.match(caught.message, /<ResultSuspense>/);
  assert.equal(mounted.affected(), 0);
  assert.deepEqual(harness.reactions, []);
  await unmountHarness(harness, mounted);
};

const strictResume = async () => {
  const harness = createHarness();
  const Probe = probeFor(harness, "strict");
  const mounted = await mountHarness(
    harness,
    createElement(
      StrictMode,
      null,
      createElement(ResultSuspense, { fallback: "loading" }, createElement(Probe)),
    ),
  );
  assert.equal(mounted.affected(), 1);
  assert.deepEqual(harness.reactions, ["auth/session-expired"]);
  harness.validateSession();
  await act(async () => {
    mounted.resume();
    await settle();
  });
  assert.equal(mounted.affected(), 0);
  assert.match(JSON.stringify(mounted.renderer.toJSON()), /data:strict/);
  await unmountHarness(harness, mounted);
};

await sameKeyRetirement();
await distinctRetirement();
await resetKeyRetirement();
await plainSuspenseFailure();
await strictResume();
await mutationRetryMatrix();
await residualMutationRetryMatrix();
await mutationRetryCallbackFreshness();
await mutationDefinitionCollision();

console.log(`React ${React.version} installed ResultSuspense and mutation retry lifecycle passed`);
