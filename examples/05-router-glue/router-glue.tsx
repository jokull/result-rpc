/**
 * Userland glue: shells + TanStack Router in ~60 lines.
 *
 * Shells are providers and hooks, so they compose with any router without the
 * library knowing routers exist. This file is the whole integration — copy it
 * into an app and own it.
 */
import { createElement, type ReactNode } from "react";
import { Outlet, RouterProvider, type AnyRouter } from "@tanstack/react-router";
import type { QueryRuntime } from "../../src/react/index.js";
import {
  prefetchLayer,
  type ResultRpcProviderProps,
  type AnyLayerShell,
  type AnyShell,
  type LayerShellClient,
} from "../../src/react/index.js";
import { createQueryRuntime } from "../../src/query/runtime.js";

export interface ResultRouterContext<TClient = unknown> {
  readonly client: TClient;
  readonly runtime: QueryRuntime<TClient>;
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
}

export interface LayerShellRouteFragment<TClient> extends ShellRouteFragment {
  readonly loader: (args: { readonly context: ResultRouterContext<TClient> }) => Promise<unknown>;
}

type RoutableShell = AnyShell & {
  readonly Provider: (props: {
    readonly fallback?: ReactNode;
    readonly children?: ReactNode;
  }) => ReactNode;
};

export const routeShell = (
  shell: RoutableShell,
  options: RouteShellOptions = {},
): ShellRouteFragment => {
  const content = () => {
    const inner: ReactNode = options.component
      ? createElement(options.component)
      : createElement(Outlet);
    return options.layout ? options.layout(inner) : inner;
  };
  const component = () =>
    createElement(
      shell.Provider,
      options.pending === undefined ? {} : { fallback: options.pending },
      content(),
    );
  return { component };
};

export const routeLayerShell = <TShell extends AnyLayerShell>(
  shell: TShell,
  options: RouteShellOptions = {},
): LayerShellRouteFragment<LayerShellClient<TShell>> => {
  const content = () => {
    const inner: ReactNode = options.component
      ? createElement(options.component)
      : createElement(Outlet);
    return options.layout ? options.layout(inner) : inner;
  };
  const component = () =>
    createElement(
      shell.Provider,
      options.pending === undefined ? {} : { fallback: options.pending },
      content(),
    );
  return {
    component,
    loader: ({ context }) => prefetchLayer(context.runtime, shell, context.client),
  };
};

export const createResultRouter = <TClient extends object, TRouter extends AnyRouter>(options: {
  readonly client: TClient;
  readonly router: (context: ResultRouterContext<TClient>) => TRouter;
}) => {
  const runtime = createQueryRuntime({ client: options.client });
  return {
    client: options.client,
    runtime,
    router: options.router({ client: options.client, runtime }),
  };
};

export const ResultRouterProvider = <TClient extends object, TRouter extends AnyRouter>({
  world,
  provider: Provider,
}: {
  readonly world: {
    readonly runtime: QueryRuntime<TClient>;
    readonly router: TRouter;
    readonly client: TClient;
  };
  readonly provider: (props: ResultRpcProviderProps<TClient>) => ReactNode;
}): ReactNode =>
  createElement(
    Provider,
    { runtime: world.runtime },
    createElement(RouterProvider, { router: world.router }),
  );
