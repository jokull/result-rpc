import assert from "node:assert/strict";
import React, { Component, StrictMode, Suspense, createElement, useState } from "react";
import TestRenderer from "react-test-renderer";
import { err, error, ok, wire } from "result-rpc";
import { fetchTransport } from "result-rpc/client";
import { createQueryRuntime } from "result-rpc/query";
import {
  ResultRpcProvider,
  ResultSuspense,
  defineShell,
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

const createHarness = () => {
  let sessionValid = false;
  const app = serverRpc.context();
  const guarded = app
    .procedure()
    .input(wire.object({ id: wire.string }))
    .output(wire.string)
    .errors({ SessionExpired })
    .query(({ input, errors }) =>
      sessionValid ? ok(`data:${input.id}`) : err(errors.SessionExpired({})),
    );
  const router = app.router({ guarded });
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
    claims: { SessionExpired },
    onError: (failure) => reactions.push(failure._tag),
  });
  return {
    AuthShell,
    client,
    reactions,
    runtime,
    validateSession: () => {
      sessionValid = true;
    },
  };
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

console.log(`React ${React.version} installed ResultSuspense lifecycle passed`);
