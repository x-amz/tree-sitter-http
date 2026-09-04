#!/usr/bin/env node
// The package's build: dist/, from the grammar above it and the grammars it
// depends on.
//
// The dialects come from this repository — tree-sitter.json two levels up
// names them, their directories and their queries. The body languages come
// from devDependencies: the injection queries name grammars (`#set!
// injection.language "json"`), and each name is looked up in the
// tree-sitter.json of every grammar package this package depends on. Each
// grammar is compiled to wasm with the tree-sitter CLI and its highlight
// query copied beside it under the flat name grammars.js uses. The runtime,
// web-tree-sitter at its pinned version, is copied in whole so a consumer
// maps one specifier. A name no dependency provides is an error.
//
// Compiling wasm needs emcc, at the version the CLI was built against or the
// wasm does not load in the runtime; the CLI's own fallback of running emcc
// in a Docker container is not used. An emsdk checkout with that version
// activated, at $EMSDK_ROOT or ~/emsdk, is put first on PATH here.
//
// The Swift package pins the same grammar packages in Package.swift; this
// build refuses to run if the two pin sets disagree, so the two bindings
// always ship the same grammars.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const ROOT = join(PKG, "..", "..");
const DIST = join(PKG, "dist");
/** The emscripten tree-sitter-cli 0.25.10 was built against (cli/loader/emscripten-version at v0.25.10). */
const EMSCRIPTEN = "4.0.4";

const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));
const die = (message) => { console.error(`build: ${message}`); process.exit(1); };

/** A dependency's directory, however npm placed it. */
function dependency(name) {
  for (let dir = PKG; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return die(`${name} is not installed — run npm ci`);
  }
}

function emcc() {
  const emsdk = process.env.EMSDK_ROOT ?? join(homedir(), "emsdk");
  const local = join(emsdk, "upstream", "emscripten");
  if (existsSync(join(local, "emcc"))) process.env.PATH = `${local}${delimiter}${process.env.PATH}`;
  let version;
  try { version = execFileSync("emcc", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0]; }
  catch { die(`no emcc; install emsdk ${EMSCRIPTEN} at ${emsdk} (./emsdk install ${EMSCRIPTEN} && ./emsdk activate ${EMSCRIPTEN})`); }
  if (!version.includes(` ${EMSCRIPTEN} `)) die(`emcc is not ${EMSCRIPTEN} — install emsdk ${EMSCRIPTEN} at ${emsdk}; found: ${version}`);
}

/** Every grammar name the injection queries hand a body to. */
function injected(config) {
  const names = new Set();
  for (const grammar of config.grammars)
    for (const [, name] of read(join(ROOT, grammar.injections)).matchAll(/#set!\s+injection\.language\s+"([^"]+)"/g)) names.add(name);
  return names;
}

/** name -> {dir, grammar, pkg} for every grammar every grammar dependency declares. */
function provided() {
  const table = new Map();
  const manifest = json(join(PKG, "package.json"));
  for (const name of Object.keys(manifest.devDependencies)) {
    const dir = dependency(name);
    if (!existsSync(join(dir, "tree-sitter.json"))) continue;
    const pkg = json(join(dir, "package.json"));
    for (const grammar of json(join(dir, "tree-sitter.json")).grammars) table.set(grammar.name, { dir, grammar, pkg });
  }
  return table;
}

/** A package.json repository field as owner/name — a string, a shorthand, or an object. */
function repository(pkg) {
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
  return url.replace(/^git\+/, "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
}

/** The Swift package pins the same grammar packages; hold the two together. */
function agree(used) {
  const pins = json(join(ROOT, "Package.resolved")).pins;
  for (const { pkg } of used) {
    const repo = repository(pkg);
    const pin = pins.find((one) => one.location.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "") === repo);
    if (!pin) die(`${pkg.name} (${repo}) is not pinned in Package.resolved; the Swift package must ship the same grammars`);
    if (pin.state.version !== pkg.version)
      die(`${pkg.name} is ${pkg.version} here and ${pin.state.version} in Package.resolved; the two bindings must ship the same grammars`);
  }
}

function wasm(name, dir) {
  const out = join(DIST, `tree-sitter-${name}.wasm`);
  execFileSync("tree-sitter", ["build", "--wasm", "-o", out, dir], { cwd: ROOT, stdio: "inherit" });
  return out;
}

emcc();
mkdirSync(DIST, { recursive: true });
const config = json(join(ROOT, "tree-sitter.json"));
const built = [];

for (const grammar of config.grammars) {
  wasm(grammar.name, join(ROOT, grammar.path ?? "."));
  for (const kind of ["highlights", "injections"])
    copyFileSync(join(ROOT, grammar[kind]), join(DIST, `${grammar.name}.${kind}.scm`));
  built.push(grammar.name);
}

const table = provided();
const used = new Map();
for (const name of [...injected(config)].filter((one) => !built.includes(one)).sort()) {
  const entry = table.get(name);
  if (!entry) die(`the queries name \`${name}\` and no grammar package in devDependencies provides it`);
  const { dir, grammar, pkg } = entry;
  wasm(name, join(dir, grammar.path ?? "."));
  copyFileSync(join(dir, [grammar.highlights ?? "queries/highlights.scm"].flat()[0]), join(DIST, `${name}.highlights.scm`));
  used.set(pkg.name, { pkg, dir, name });
  built.push(`${name} (${pkg.name}@${pkg.version})`);
}
agree(used.values());

// Every grammar compiled in above is redistributed as wasm and as its
// verbatim highlight query, so its licence has to travel with it: MIT keeps
// its condition in compiled form. Derived, not a hand-kept list — a body
// language cannot be added without its notice.
for (const { dir, name } of used.values()) {
  const notice = readdirSync(dir).find((one) => /^licen[cs]e/i.test(one));
  if (!notice) die(`${name}: no licence file in ${dir}; a redistributed grammar must carry its notice`);
  copyFileSync(join(dir, notice), join(DIST, `${name}.LICENSE`));
}

const runtime = dependency("web-tree-sitter");
for (const [from, to] of [["tree-sitter.js", "tree-sitter.js"], ["tree-sitter.wasm", "tree-sitter.wasm"], ["LICENSE", "tree-sitter.LICENSE"]])
  copyFileSync(join(runtime, from), join(DIST, to));

console.log(`build: ${built.join(", ")}; web-tree-sitter ${json(join(runtime, "package.json")).version}; ${readdirSync(DIST).length} files in dist/`);
