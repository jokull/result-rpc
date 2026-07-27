"use client";
/**
 * The client boundary that owns the ONE client runtime. Rendered by the
 * static root layout; every hydration boundary below merges into it.
 */
import type { ReactNode } from "react";
import { ResultRpcProvider } from "result-rpc/react";
import { client } from "../client.js";

export const Providers = ({ children }: { children: ReactNode }) => (
  <ResultRpcProvider client={client}>{children}</ResultRpcProvider>
);
