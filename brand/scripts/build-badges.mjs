import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(resolve(root, "brand/logo/result-rpc-wordmark.svg"), "utf8");
const paths = [...source.matchAll(/<path d="([\s\S]*?)"\/>/g)].map((match) => match[1]);

if (paths.length !== 10) {
  throw new Error(`Expected 10 wordmark paths, found ${paths.length}`);
}

const path = (index) => `<path d="${paths[index]}"/>`;
const originalTransform = "translate(-8.366206 254.819505) scale(.1 -.1)";

// The source path order is RESULT, RPC, T, separator. Reordering the T into
// the first row preserves the hand-cleaned letter geometry exactly.
const resultPaths = [0, 1, 2, 3, 4, 8].map(path).join("\n");
const rpcPaths = [5, 6, 7].map(path).join("\n");

const badge = (fill) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">result-rpc square badge</title>
  <desc id="desc">RESULT over RPC, with both rows the same width, knocked out of a rounded square.</desc>
  <defs>
    <mask id="badge-knockout" x="0" y="0" width="1024" height="1024" maskUnits="userSpaceOnUse">
      <rect width="1024" height="1024" fill="#fff"/>
      <g id="result-row" fill="#000" transform="translate(122 196) scale(.7735)">
        <g transform="${originalTransform}">
${resultPaths}
        </g>
      </g>
      <g id="rpc-row" fill="#000" transform="translate(122 442)">
        <g transform="scale(1.4985)">
          <g transform="translate(-1096.333794 0)">
            <g transform="${originalTransform}">
${rpcPaths}
            </g>
          </g>
        </g>
      </g>
    </mask>
  </defs>
  <rect x="24" y="24" width="976" height="976" rx="144" fill="${fill}" mask="url(#badge-knockout)"/>
</svg>
`;

const favicon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">result-rpc R badge</title>
  <rect x="2" y="2" width="60" height="60" rx="8" fill="#2e5090"/>
  <g fill="#f6f1e7" transform="translate(15 10.75) scale(.1712)">
    <g transform="${originalTransform}">
${path(0)}
    </g>
  </g>
</svg>
`;

const outputs = new Map([
  ["brand/logo/result-rpc-badge.svg", badge("#111111")],
  ["brand/logo/result-rpc-badge-blue.svg", badge("#2e5090")],
  ["brand/logo/result-rpc-favicon.svg", favicon],
  ["website/public/result-rpc-badge.svg", badge("#111111")],
  ["website/public/result-rpc-badge-blue.svg", badge("#2e5090")],
  ["website/public/favicon.svg", favicon],
  ["demo/public/favicon.svg", favicon],
]);

for (const [relativePath, contents] of outputs) {
  const output = resolve(root, relativePath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, contents);
}
