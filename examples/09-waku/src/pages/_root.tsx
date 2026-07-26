import type { ReactNode } from "react";

export default async function RootElement({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Spots — result-rpc × Waku</title>
      </head>
      <body>{children}</body>
    </html>
  );
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
