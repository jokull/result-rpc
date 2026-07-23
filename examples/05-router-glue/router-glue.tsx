/**
 * Userland glue: shells + TanStack Router in ~60 lines.
 *
 * This used to be a package export (`result-rpc/router`) and was demoted on
 * purpose: shells are just providers and hooks, so they compose with any
 * router without the library knowing routers exist. This file is the whole
 * integration — copy it into an app and own it.
 */
import { createElement, type ReactNode } from "react";
import { Outlet, RouterProvider, type AnyRouter } from "@tanstack/react-router";
import type { QueryRuntime } from "../../src/react/index.js";
import {
  createQueryRuntime,
  getLayerProcedureResolver,
  ResultRpcProvider,
  type AnyShell,
} from "../../src/react/index.js";

export interface ResultRouterContext<TClient = unknown> {
  readonly client: TClient;
  readonly runtime: QueryRuntime;
}

export interface RouteShellOptions {
  readonly pending?: ReactNode;
  readonly layout?: (outlet: ReactNode) => ReactNode;
  readonly component?: () => ReactNode;
}

/**
 * A shell's route fragment: its Provider as the route component, and — for
 * layer shells — a loader that prefetches the layer's context procedure.
 */
export interface ShellRouteFragment {
  readonly component: () => ReactNode;
  readonly loader?: (args: { readonly context: ResultRouterContext }) => Promise<unknown>;
}

export const routeShell = (shell: AnyShell, options: RouteShellOptions = {}): ShellRouteFragment => {
  const content = () => {
    const inner: ReactNode = options.component
      ? createElement(options.component)
      : createElement(Outlet);
    return options.layout ? options.layout(inner) : inner;
  };
  const component = () =>
    createElement(
      shell.Provider as (props: { children?: ReactNode; fallback?: ReactNode }) => ReactNode,
      options.pending === undefined ? {} : { fallback: options.pending },
      content(),
    );
  const resolver = getLayerProcedureResolver(shell);
  if (!resolver) return { component };
  return {
    component,
    loader: ({ context }: { context: ResultRouterContext }) =>
      (context.runtime.prefetch as (procedure: unknown, input: unknown) => Promise<unknown>)(
        resolver(context.client),
        {},
      ),
  };
};

export const createResultRouter = <TClient extends object, TRouter extends AnyRouter>(options: {
  readonly client: TClient;
  readonly router: (context: ResultRouterContext<TClient>) => TRouter;
}) => {
  const runtime = createQueryRuntime({ client: options.client });
  return { client: options.client, runtime, router: options.router({ client: options.client, runtime }) };
};

export const ResultRouterProvider = <TClient, TRouter extends AnyRouter>({ world }: {
  readonly world: { readonly runtime: QueryRuntime; readonly router: TRouter; readonly client: TClient };
}): ReactNode =>
  createElement(
    ResultRpcProvider,
    { runtime: world.runtime },
    createElement(RouterProvider, { router: world.router }),
  );
