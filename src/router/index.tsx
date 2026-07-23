/**
 * TanStack Router integration: routes are shells.
 *
 * result-rpc owns the authoring surface; @tanstack/react-router (a peer
 * dependency) stays the routing engine, so params, search params, preloading,
 * and devtools keep their native types and behavior.
 *
 * The fusion point is the route fragment: a shell emits `component` (its
 * Provider wrapping the route's content) and — for layer-derived shells — a
 * `loader` that prefetches the layer's context procedure. Fragments spread
 * into `createRoute`, so one declaration produces both halves:
 *
 *     const authedRoute = createRoute({
 *       getParentRoute: () => sessionRoute,
 *       id: "authed",
 *       ...routeShell(ViewerShell, { pending: <p>signing in…</p> }),
 *     })
 *
 * `createResultRouter` builds the world — client, runtime, router — and puts
 * `{ client, runtime }` in the router context so loaders can prefetch.
 */
import { createElement, type ReactNode } from "react";
import { Outlet, RouterProvider, type AnyRouter } from "@tanstack/react-router";
import type { QueryRuntime } from "../query/runtime.js";
import { createQueryRuntime } from "../query/runtime.js";
import {
  getLayerProcedureResolver,
  type AnyShell,
  type Shell,
} from "../react/shell.js";
import { ResultRpcProvider } from "../react/index.js";

/**
 * The router-context shape every result-rpc route expects. Spread additional
 * app context alongside it if needed.
 */
export interface ResultRouterContext<TClient = unknown> {
  readonly client: TClient;
  readonly runtime: QueryRuntime;
}

export interface RouteShellOptions {
  /** Rendered while a layer shell establishes its value (layer shells only). */
  readonly pending?: ReactNode;
  /**
   * Wraps the route's outlet inside the shell — banners, headers, notices that
   * belong to this layer. Receives the outlet element.
   */
  readonly layout?: (outlet: ReactNode) => ReactNode;
  /** Renders instead of an Outlet — for leaf routes that own their page. */
  readonly component?: () => ReactNode;
}

export interface ShellRouteFragment {
  readonly component: () => ReactNode;
  readonly loader?: (args: {
    readonly context: ResultRouterContext;
  }) => Promise<unknown>;
}

/**
 * A shell's route fragment. Spread into `createRoute` options. The shell's
 * Provider wraps the route content; layer shells additionally contribute a
 * loader that warms their context procedure through the runtime, so the layer
 * value is established before the route commits.
 */
export const routeShell = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shell: Shell<any, any, any, any>,
  options: RouteShellOptions = {},
): ShellRouteFragment => {
  const content = () => {
    const inner: ReactNode = options.component
      ? createElement(options.component)
      : createElement(Outlet);
    return options.layout ? options.layout(inner) : inner;
  };
  const Provider = shell.Provider as (props: {
    readonly children?: ReactNode;
    readonly fallback?: ReactNode;
  }) => ReactNode;
  const component = () =>
    createElement(
      Provider,
      options.pending === undefined ? {} : { fallback: options.pending },
      content(),
    );

  const resolver = getLayerProcedureResolver(shell as AnyShell);
  if (!resolver) return { component };
  return {
    component,
    loader: ({ context }) => {
      const procedure = resolver(context.client);
      return (context.runtime.prefetch as (procedure: unknown, input: unknown) => Promise<unknown>)(
        procedure,
        {},
      );
    },
  };
};

export interface CreateResultRouterOptions<TClient, TRouter extends AnyRouter> {
  readonly client: TClient;
  /**
   * Builds the TanStack router given the result-rpc context. Call
   * `createRouter({ routeTree, context, ... })` here — history, preloading,
   * and every other router option stays in your hands.
   */
  readonly router: (context: ResultRouterContext<TClient>) => TRouter;
}

export interface ResultRouterWorld<TClient, TRouter extends AnyRouter> {
  readonly client: TClient;
  readonly runtime: QueryRuntime;
  readonly router: TRouter;
}

/** One world per app startup: client, runtime, and the router wired to both. */
export const createResultRouter = <TClient extends object, TRouter extends AnyRouter>(
  options: CreateResultRouterOptions<TClient, TRouter>,
): ResultRouterWorld<TClient, TRouter> => {
  const runtime = createQueryRuntime({ client: options.client });
  const router = options.router({ client: options.client, runtime });
  return { client: options.client, runtime, router };
};

export interface ResultRouterProviderProps<TClient, TRouter extends AnyRouter> {
  readonly world: ResultRouterWorld<TClient, TRouter>;
}

/** Mounts the query runtime and the router in one element. */
export const ResultRouterProvider = <TClient, TRouter extends AnyRouter>({
  world,
}: ResultRouterProviderProps<TClient, TRouter>): ReactNode =>
  createElement(
    ResultRpcProvider,
    { runtime: world.runtime },
    createElement(RouterProvider, { router: world.router }),
  );
