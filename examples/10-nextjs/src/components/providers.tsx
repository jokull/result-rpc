"use client";
/**
 * The client boundary that owns the ONE client runtime. Rendered by the
 * root layout (a server component); every ResultRpcHydrationBoundary below
 * merges its dehydrated payload into this runtime.
 */
import type { ReactNode } from "react";
import { ResultRpcProvider } from "result-rpc/react";
import { client } from "../client";

export const Providers = ({ children }: { children: ReactNode }) => (
  <ResultRpcProvider client={client}>{children}</ResultRpcProvider>
);
