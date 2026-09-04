#!/usr/bin/env node
// What a release of the package requires. Run after the build; `npm run
// check` does, and the publish workflow runs it before `npm publish`.
//
// **The tag is the version.** Given one, this writes it into every file that
// carries a version — `VERSIONED` below — and those files are committed at
// 0.0.0, a number nobody moves and nothing believes. The tag is the only place
// a version is decided, and `git tag <version> && git push --tags` is the
// whole release.
//
// Then the checks: every asset a consumer loads — a wasm and a highlight
// query for every grammar the queries name, the dialects' injection queries,
// the runtime — is in dist/; grammars.js names exactly those assets, so a
// body language added to the queries and not to grammars.js, or the reverse,
// stops here; and the tarball `npm publish` would send carries all of it.
//
//     node make/release.js [tag]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const ROOT = join(PKG, "..", "..");
const DIST = join(PKG, "dist");
const RUNTIME = ["tree-sitter.js", "tree-sitter.wasm", "tree-sitter.LICENSE"];

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const die = (message) => { console.error(`release: ${message}`); process.exit(1); };

// Everything that carries a version, from the repository root. The guide's
// manifest is private and never published; it is stamped anyway so that one
// grep answers what a checkout thinks it is.
const VERSIONED = ["tree-sitter.json", "package.json", "bindings/web/package.json", "web/package.json"];

/** What those files carry between releases. */
const PLACEHOLDER = "0.0.0";

/** Write `version` into a file's one `"version"` field, leaving every other
    byte alone — these files stay hand-formatted, and a stamped release should
    read as a one-line diff, not a reserialization. */
const stampOne = (path, version) => {
  const file = join(ROOT, path);
  const before = readFileSync(file, "utf8");
  const after = before.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`);
  if (after === before) die(`${path} has no version to stamp`);
  writeFileSync(file, after);
};

const tag = process.argv[2];
if (tag) {
  if (!/^\d+\.\d+\.\d+$/.test(tag)) die(`${tag} is not a version — the publish workflow only fires on x.y.z tags`);
  // 0.0.0 is the committed placeholder. The tag pattern accepts it, npm would
  // publish it, and the number would be spent on nothing.
  if (tag === PLACEHOLDER) die(`${PLACEHOLDER} is the placeholder these files carry, not a release — tag a real version`);
  for (const path of VERSIONED) stampOne(path, tag);
  console.log(`release: ${tag} stamped into ${VERSIONED.join(", ")}`);
}

const manifest = json(join(PKG, "package.json"));
const config = json(join(ROOT, "tree-sitter.json"));
const grammar = json(join(ROOT, "package.json"));

// Stamped or not, the files agree. Untagged this catches a hand-edited
// version — the only way one of them can drift now.
if (manifest.version !== config.metadata.version || manifest.version !== grammar.version)
  die(`versions disagree — ${manifest.name} ${manifest.version}, tree-sitter.json ${config.metadata.version}, ` +
      `${grammar.name} ${grammar.version}. The tag stamps all of them; ` +
      "a committed version is 0.0.0 and is not edited by hand");

// Every file a consumer loads, by its flat name in dist/. The notices of the
// grammars this package redistributes are not loaded, but they must ship, so
// they are expected and packed like the rest — and excluded from the
// grammars.js comparison, which names only what a consumer fetches.
const notices = new Set();
const expected = new Set(RUNTIME);
for (const one of config.grammars) {
  expected.add(`tree-sitter-${one.name}.wasm`);
  for (const kind of ["highlights", "injections"]) if (kind in one) expected.add(`${one.name}.${kind}.scm`);
  for (const [, name] of readFileSync(join(ROOT, one.injections), "utf8").matchAll(/#set!\s+injection\.language\s+"([^"]+)"/g))
    if (!config.grammars.some((g) => g.name === name)) {
      expected.add(`tree-sitter-${name}.wasm`);
      expected.add(`${name}.highlights.scm`);
      notices.add(`${name}.LICENSE`);
      expected.add(`${name}.LICENSE`);
    }
}
const missing = [...expected].sort().filter((name) => !existsSync(join(DIST, name)));
if (missing.length) die("not built — run npm run build: " + missing.join(", "));

const { all } = await import(new URL("../grammars.js", import.meta.url));
const named = new Set(all.flatMap((g) => [g.wasm, g.highlights, g.injections]).filter(Boolean).map((url) => url.pathname.split("/").pop()));
const assets = new Set([...expected].filter((name) => !RUNTIME.includes(name) && !notices.has(name)));
const only = (a, b) => [...a].filter((name) => !b.has(name)).sort();
if (only(named, assets).length || only(assets, named).length)
  die("grammars.js and the built assets disagree — " +
      `grammars.js only: ${only(named, assets).join(", ") || "-"}; built only: ${only(assets, named).join(", ") || "-"}`);

for (const target of Object.values(manifest.exports))
  if (!target.includes("*") && !existsSync(join(PKG, target))) die(`package.json exports ${target}, which is not there`);

// `npm pack --json` reported an array of results through npm 11 and an object
// keyed by package name from npm 12. One package is packed either way.
const report = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--silent", "--ignore-scripts"], { cwd: PKG, encoding: "utf8" }));
const [{ files }] = Array.isArray(report) ? report : Object.values(report);
const packed = new Set(files.map((file) => file.path));
const left = [...expected].sort().filter((name) => !packed.has(`dist/${name}`));
if (left.length) die("package.json's files leave assets out of the tarball: " + left.join(", "));

console.log(`release: ${manifest.name}@${manifest.version}: ${assets.size} assets built and named, runtime and ${notices.size} redistributed notices present, ${packed.size} files in the tarball`);
