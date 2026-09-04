#!/usr/bin/env node
// The guide, built: dist/ is the site a static host serves as-is.
//
// The page is a consumer of tree-sitter-http-web and a reader of the
// repository. The build gives it both: the package, copied from node_modules
// into vendor/ as an ordinary consumer's bundler would, where the import map
// points; and files.json, every repository file the page reads, keyed by the
// path it asks for — tree-sitter.json, the shared grammar source and scanner,
// each dialect's grammar.js, generated tables, corpus and documents, the
// page's samples, and each body language's generated tables from the same
// grammar package the library built it from.
//
// One response, not one per file: on a static host the round trips are the
// load time and these files together weigh less than the parser the page has
// already fetched. The build reads each file to write the bundle, then removes
// what it read from, so nothing is served twice.
//
// Then states.json, the LR item sets from `tree-sitter generate
// --report-states-for-rule`, fetched after the first paint because it is the
// largest thing here and nothing on screen needs it yet; and the page's own
// files, check.js among them, so `npm run check` runs against what was built.
//
// Nothing here is listed twice: the dialects come from tree-sitter.json, the
// body languages from the package's grammars.js, and the contents of
// files.json from what the page's loader (sources.js) asks for, recorded by
// running it.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { grammars } from "tree-sitter-http-web";
import { FILES, load, TREE } from "../sources.js";
import { sources } from "./sources.js";
import { itemSets } from "./states.js";

const WEB = fileURLToPath(new URL("../", import.meta.url));
const ROOT = join(WEB, "..");
const DIST = join(WEB, "dist");
const HOST = "parse.req.to";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const die = (message) => { console.error(`build: ${message}`); process.exit(1); };
const copy = (from, to) => { mkdirSync(dirname(to), { recursive: true }); cpSync(from, to, { recursive: true }); };

/** A dependency's directory, however npm placed it. */
function dependency(name) {
  for (let dir = WEB; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return die(`${name} is not installed — run npm ci`);
  }
}

/** name -> {dir, grammar} for every grammar every grammar package in devDependencies declares. */
function provided() {
  const table = new Map();
  for (const name of Object.keys(json(join(WEB, "package.json")).devDependencies)) {
    const dir = dependency(name);
    if (!existsSync(join(dir, "tree-sitter.json"))) continue;
    for (const grammar of json(join(dir, "tree-sitter.json")).grammars) table.set(grammar.name, { dir, grammar });
  }
  return table;
}

rmSync(DIST, { recursive: true, force: true });
const config = json(join(ROOT, "tree-sitter.json"));

const packageDir = dependency("tree-sitter-http-web");
if (!existsSync(join(packageDir, "dist", "tree-sitter.js"))) die("tree-sitter-http-web is not built — run npm run build -w bindings/web");

/** Everything under `dir`, as [path, bytes], for hashing and for copying. */
const contents = (dir, only = () => true) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && only(relative(dir, join(e.parentPath, e.name))))
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();

// The page's own files. The samples are copied because the loader reads them
// from here, and files.json takes them from the copy along with everything
// else; the copy itself is what the build then leaves behind.
for (const name of readdirSync(WEB))
  if (name === "index.html" || name === "samples" || (name.endsWith(".js") && name !== "package.json")) copy(join(WEB, name), join(DIST, name));

// The listings.
const listed = sources(config, { root: ROOT, web: WEB, tree: TREE });
writeFileSync(join(DIST, "sources.json"), JSON.stringify(listed, null, 2) + "\n");

// The body languages' tables, from the packages that provide them.
const table = provided();
const stand = config.grammars.map((grammar) => [grammar.name, join(ROOT, grammar.path ?? ".")]);
for (const shipped of grammars.all) {
  if (config.grammars.some((grammar) => grammar.name === shipped.name)) continue;
  const entry = table.get(shipped.name);
  if (!entry) die(`the package ships \`${shipped.name}\` and no grammar package in devDependencies provides it`);
  const dir = join(entry.dir, entry.grammar.path ?? ".");
  for (const generated of ["grammar.json", "node-types.json"])
    copy(join(dir, "src", generated), join(DIST, "languages", shipped.name, generated));
  stand.push([shipped.name, dir]);
}

// The tree: what the page's loader asks for, recorded as it asks. Every
// repository path it reads goes into files.json, which the page fetches once
// rather than one round trip per file; the package's own URLs are the
// package's to fetch and are not recorded.
const files = {};
const reader = {
  text: async (path) => {
    if (path instanceof URL) return readFileSync(path, "utf8");
    if (path.startsWith(TREE)) {
      const inRepo = path.slice(TREE.length);
      const from = join(ROOT, inRepo);
      if (!existsSync(from)) die(`the page reads ${inRepo}, which is not in the repository`);
      return (files[path] = readFileSync(from, "utf8"));
    }
    return (files[path] = readFileSync(resolve(DIST, path), "utf8"));
  },
};
await load(reader, { optional: (path) => die(`${path} is missing`) });
// Sorted: the loader reads through `Promise.all`, so insertion order is
// completion order and varies between runs. An unsorted bundle hashes
// differently every build and every visitor fetches it again for nothing.
const filesJson = JSON.stringify(Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]))) + "\n";
writeFileSync(join(DIST, "files.json"), filesJson);

// The item sets, for every grammar the page can stand in.
const states = {};
for (const [name, dir] of stand) {
  states[name] = itemSets(name, join(dir, "grammar.js"), join(dir, "src", "grammar.json"));
  console.log(`states: ${name} — ${Object.keys(states[name].states).length} states`);
}
const statesJson = JSON.stringify(states) + "\n";
writeFileSync(join(DIST, "states.json"), statesJson);

// Every URL the page fetches carries a hash of what is behind it, so the
// browser may cache all of it and a rebuild is a different URL. Per artifact,
// not per build: one hash over everything would rename the package on a
// changed sample and cost a visitor the parser again for a sample they
// already have.
const hash = (...parts) => {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest("hex").slice(0, 12);
};

// The package, vendored under a hash of itself, and the import map pointed
// there. Its own files address each other from that directory, so hashing the
// directory versions every asset it loads without touching the package.
const packaged = contents(packageDir, (path) => path.endsWith(".js") || path.startsWith("dist"));
const vendorDir = `tree-sitter-http-web@${hash(
  packaged.map((path) => `${path}\0`).join(""),
  Buffer.concat(packaged.map((path) => readFileSync(join(packageDir, path)))),
)}`;
const vendor = join(DIST, "vendor", vendorDir);
for (const path of packaged) copy(join(packageDir, path), join(vendor, path));

// The data files, each versioned by its own bytes, as a table the page reads:
// a path it fetches, and what to ask for. A new one is an entry here.
const stamps = { [FILES]: hash(filesJson), "./states.json": hash(statesJson) };
const page = join(DIST, "index.html");
const html = readFileSync(page, "utf8").replace(/\.\/vendor\/tree-sitter-http-web\//g, `./vendor/${vendorDir}/`);
if (!html.includes(vendorDir)) die("index.html names no vendor path to stamp");
writeFileSync(page, html.replace("</head>",
  `<script type="application/json" id="build">${JSON.stringify(stamps)}</script>\n</head>`));

writeFileSync(join(DIST, "CNAME"), `${HOST}\n`);
writeFileSync(join(DIST, ".nojekyll"), "");
// The loader read every repository file into files.json, so the copies it
// read them from are not served: one response answers all of them.
for (const name of ["samples", "languages", "sources.json"]) rmSync(join(DIST, name), { recursive: true, force: true });
const count = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
console.log(`build: ${count(DIST)} files in web/dist/ for ${HOST}: the page, ${count(vendor)} vendored from ${relative(ROOT, packageDir)}, ${Object.keys(files).length} repository files in files.json`);
