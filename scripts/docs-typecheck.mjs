/**
 * Typechecks the code samples in the docs.
 *
 * `blume check` runs `astro check` over `.astro` and config files and never
 * opens a Markdown fence, so documented API could drift out of compilability
 * with every gate green. It did: a factory split stranded fourteen snippets,
 * and an entry-point mistake in ARCHITECTURE.md survived because the API report
 * cannot tell `export type *` from `export *`.
 *
 * Only blocks that import `result-rpc*` are compiled. The rest are fragments
 * referencing locals the page never defines (`app`, `server`, `client`), so
 * compiling them would report noise rather than drift. Bare specifiers are
 * rewritten to the built `dist`, which is what makes a wrong entry point — the
 * exact bug this exists to catch — a failure rather than a resolution.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, ".docs-typecheck");

const sourcesBelow = (directory, extension) => {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(extension)) found.push(path);
    }
  };
  walk(directory);
  return found;
};

// ARCHITECTURE.md earns its place here: the one entry-point mistake that
// reached main lived in its public-surface sketch, not in the user-facing docs.
const documents = [
  ...sourcesBelow(join(root, "website/src/content/docs"), ".md"),
  join(root, "README.md"),
  join(root, "ARCHITECTURE.md"),
  join(root, "DESIGN.md"),
  join(root, "skills/result-rpc/SKILL.md"),
].filter((path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
});

/** Points a bare specifier at the built types the published package exposes. */
const toDistSpecifier = (subpath) => {
  const entries = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports;
  const key = subpath === "" ? "." : `.${subpath}`;
  const target = entries[key]?.types;
  return target ? join(root, target) : undefined;
};

const rewrite = (code) =>
  code.replace(/from "result-rpc(\/[a-z-]+)?"/g, (match, subpath) => {
    const target = toDistSpecifier(subpath ?? "");
    return target ? `from "${target.replace(/\.d\.ts$/, ".js")}"` : match;
  });

/**
 * The site renders neither Starlight `:::` directives nor GitHub `[!NOTE]`
 * alerts — it emits them as literal text in a paragraph, and the build still
 * succeeds. Four callouts shipped that way before anyone read the rendered
 * page. A bold lead inside a blockquote renders everywhere.
 */
const UNSUPPORTED_CALLOUTS = [
  [/^:{3,}\w/m, "`:::` directive (use `> **Title.** …` instead)"],
  [/^>\s*\[!\w+\]/m, "GitHub alert syntax (use `> **Title.** …` instead)"],
];

// Checked before any scratch directory exists, so a failure here cannot leave
// residue behind for the linter to trip over.
for (const document of documents) {
  const source = readFileSync(document, "utf8");
  for (const [pattern, description] of UNSUPPORTED_CALLOUTS) {
    const found = pattern.exec(source);
    if (found) {
      const line = source.slice(0, found.index).split("\n").length;
      throw new Error(
        `${relative(root, document)}:${line} uses ${description} — it renders as literal text.`,
      );
    }
  }
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

/**
 * The docs' placeholder convention: `.input(...)` and `.handler(/* ... *\/)`
 * stand in for detail the page is not about. Those calls are illustrations, not
 * programs — one parses and one does not, but neither is a claim about the API,
 * so neither should be typechecked.
 */
const isIllustrative = (body) => /\(\s*(?:\/\*[^*]*\.\.\.[^*]*\*\/|\.\.\.)\s*\)/.test(body);

/**
 * Most samples are fragments: they use `app`, `server` or `client` without
 * importing anything, because the page already established them. Skipping those
 * would leave the largest class of drift unchecked — the factory split stranded
 * nine snippets and only one of them had an import. Declaring the locals lets
 * them compile as far as the API surface, which is the part being claimed.
 *
 * `client` stays `any`: its type comes from the reader's own router, so any
 * shape asserted here would be fiction. The factories are real, which is what
 * makes "handler passed to the contract factory" a detectable error.
 */
const preambleFor = (body) => {
  const needs = (name) => new RegExp(`\\b${name}\\s*\\.`).test(body);
  if (/from "result-rpc/.test(body)) return "";
  if (!needs("app") && !needs("server") && !needs("client")) return "";
  const rootEntry = toDistSpecifier("").replace(/\.d\.ts$/, ".js");
  const serverEntry = toDistSpecifier("/server").replace(/\.d\.ts$/, ".js");
  return [
    `import { rpc as __rpc } from "${rootEntry}";`,
    `import { serverRpc as __serverRpc } from "${serverEntry}";`,
    "declare const app: ReturnType<typeof __rpc.context<Record<string, unknown>>>;",
    "declare const server: ReturnType<typeof __serverRpc.context<Record<string, unknown>>>;",
    "declare const client: any;",
    "",
  ].join("\n");
};

const blocks = [];
let illustrative = 0;
for (const document of documents) {
  const source = readFileSync(document, "utf8");
  for (const match of source.matchAll(/```(ts|tsx)\n([\s\S]*?)```/g)) {
    const [, language, body] = match;
    const preamble = preambleFor(body);
    if (!/from "result-rpc/.test(body) && preamble === "") continue;
    if (isIllustrative(body)) {
      illustrative += 1;
      continue;
    }
    const line = source.slice(0, match.index).split("\n").length;
    const name = `block${blocks.length}.${language === "tsx" ? "tsx" : "ts"}`;
    writeFileSync(join(work, name), preamble + rewrite(body));
    const offset = preamble === "" ? 0 : preamble.split("\n").length - 1;
    blocks.push({ name, document: relative(root, document), line, offset });
  }
}

const COMPILER_OPTIONS = {
  strict: true,
  target: "ES2022",
  module: "preserve",
  moduleResolution: "bundler",
  noEmit: true,
  skipLibCheck: true,
  jsx: "react-jsx",
  types: [],
  lib: ["ES2022", "DOM"],
};

writeFileSync(
  join(work, "tsconfig.json"),
  JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files: blocks.map((b) => b.name) }, null, 2),
);

// Undeclared locals are expected — a fragment referencing `app` or `client` is
// documentation, not a program. Drift is the narrower set: a specifier that
// does not resolve, a name the entry point does not export, a signature that
// changed shape.
const DRIFT = new Set([
  "TS2305", // module has no exported member
  "TS2307", // cannot find module
  "TS2724", // no exported member named X, did you mean Y
  "TS2554", // wrong number of arguments
  "TS2559", // no properties in common
  "TS2739", // missing properties from type
  "TS2551", // property does not exist, did you mean
]);

const writeProject = (files) =>
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files }, null, 2),
  );

const runTsc = () => {
  try {
    execFileSync(
      "node",
      [join(root, "node_modules/typescript/bin/tsc"), "-p", join(work, "tsconfig.json")],
      { encoding: "utf8" },
    );
    return "";
  } catch (failure) {
    return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
};

let raw = runTsc();

// Some samples are deliberately not programs — `.input(...)` and `.handler(...)`
// stand in for detail the page is not about. Those fail to PARSE, and a
// syntactic error stops the compiler before it reaches the semantic checks this
// gate is for, so one pseudo-code block would silently disable the whole run.
// Drop them and re-check, reporting how many so the coverage is never overstated.
const unparseable = new Set();
for (const line of raw.split("\n")) {
  const parsed = /(block\d+\.tsx?)\(\d+,\d+\): error (TS1\d{3}):/.exec(line.trim());
  if (parsed) unparseable.add(parsed[1]);
}
if (unparseable.size > 0) {
  writeProject(blocks.map((block) => block.name).filter((name) => !unparseable.has(name)));
  raw = runTsc();
}

const drifted = [];
for (const line of raw.split("\n")) {
  // Unanchored: tsc reports paths relative to the working directory, so the
  // line arrives as `.docs-typecheck/block12.ts(3,10): error ...`. Anchoring on
  // the bare filename matched nothing and made this whole gate silently vacuous.
  const parsed = /(block\d+\.tsx?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line.trim());
  if (!parsed) continue;
  const [, file, blockLine, code, message] = parsed;
  if (!DRIFT.has(code)) continue;
  // A sample importing `./contract` or `@app/server` is describing the reader's
  // own project, and those files are meant not to exist here. Only an
  // unresolvable result-rpc specifier is drift — which is precisely the wrong
  // entry point that reached main.
  if (code === "TS2307" && !message.includes("result-rpc")) continue;
  const block = blocks.find((candidate) => candidate.name === file);
  if (!block) continue;
  // Blocks are extracted verbatim, so a line inside one maps straight back.
  drifted.push(
    `${block.document}:${block.line + Number(blockLine) - block.offset}  ${code}  ${message}`,
  );
}

rmSync(work, { recursive: true, force: true });

const skipped = illustrative + unparseable.size;
console.log(
  `docs typecheck: ${blocks.length - unparseable.size} blocks importing result-rpc compiled, ` +
    `across ${documents.length} documents` +
    (skipped > 0 ? ` (${skipped} skipped as illustrative placeholders)` : ""),
);
if (drifted.length > 0) {
  console.error(`\n${drifted.length} documented sample(s) no longer compile:\n`);
  for (const entry of drifted) console.error(`  ${entry}`);
  process.exit(1);
}
console.log("docs typecheck: every documented import and signature still resolves");
