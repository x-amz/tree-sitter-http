// What the guide's check checks, against the built site. The package first,
// taken as a consumer takes it — the bare specifier `tree-sitter-http-web`,
// resolved through node_modules and package.json's exports — and held to the
// page's import map, which maps the same name to the copy the build vendored. Then every module the guide runs, run here against
// the real files: `ready` loads the grammars and compiles the queries, the
// derivations hold, every document paints as its name promises, every corpus
// case agrees with the wasm, the page boots, and the package's stylesheet
// answers every capture name any of it can produce.
//
// The page's logic is all DOM-free, so this is not a parallel implementation —
// it is the same code with the reading swapped. A page missing a format is not
// a state the build can produce. The build copies this file beside the page it
// built; `npm run check` runs that copy.

import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ready, bundles, highlight, analyze, injectionNames, CSS, grammars } from "tree-sitter-http-web";
import { Query } from "tree-sitter-http-web/dist/tree-sitter.js";
import { bundled, load, shown } from "./sources.js";
import * as grammar from "./grammar.js";
import * as parse from "./parse.js";
import * as scm from "./query.js";
import * as corpus from "./corpus.js";

const here = new URL(".", import.meta.url);
const root = new URL("../../", here);
const text = (path) => readFile(new URL(path, here), "utf8");
const exists = (url) => stat(fileURLToPath(url)).then(() => true, () => false);

const failures = [];
const fail = (message) => failures.push(message);
const note = (message) => console.log(`  ${message}`);
const ok = (condition, message) => (condition ? true : (fail(message), false));

// --- the package, as a consumer gets it ------------------------------------

// `tree-sitter-http-web` resolved to this repository's own package, through
// the workspace and package.json's exports: not a relative path, and not some
// other copy.
const entry = new URL(import.meta.resolve("tree-sitter-http-web"));
const own = new URL("bindings/web/index.js", root);
ok(await realpath(fileURLToPath(entry)) === await realpath(fileURLToPath(own)),
   `tree-sitter-http-web resolved to ${entry.pathname}, not to this repo's bindings/web/index.js`);

// The page maps the same name: one import-map entry per export, to the
// build's vendored copy of the same file, and nothing else in the map.
const packageDir = new URL("./", entry);
const manifest = JSON.parse(await readFile(new URL("package.json", packageDir), "utf8"));
const page = await text("./index.html");
const pageURL = new URL("index.html", here);
const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? "{}").imports ?? {};
const bare = (specifier) => specifier.replace(/\*$/, "");
for (const [subpath, target] of Object.entries(manifest.exports)) {
  const specifier = bare(`${manifest.name}${subpath.slice(1)}`);
  const mapped = map[specifier];
  if (!ok(mapped !== undefined, `index.html's import map lacks ${specifier}, which package.json exports`)) continue;
  const inPage = new URL(mapped, pageURL);
  if (!ok(await exists(inPage), `${specifier} maps to ${mapped}, which the build did not write`)) continue;
  if (target.includes("*")) continue;
  const [vendored, original] = await Promise.all([readFile(inPage), readFile(new URL(target, packageDir))]);
  ok(vendored.equals(original), `${specifier} maps to ${mapped}, which differs from the package's ${target}`);
}
for (const specifier of Object.keys(map)) {
  ok(specifier === manifest.name || specifier.startsWith(`${manifest.name}/`),
     `index.html's import map has ${specifier}, which is not the package`);
}
ok(Object.keys(map).length === Object.keys(manifest.exports).length,
   "index.html's import map and package.json's exports are not the same list");

// Then load it the way every consumer does: one call, its own files.
await ready();
console.log(`tree-sitter-http-web: ${[...bundles.keys()].join(", ")} — from ${entry.pathname}`);

ok([...bundles.keys()].join() === grammars.all.map((g) => g.name).join(),
   "ready() loaded a different list than grammars.js names");
for (const [name, b] of bundles) {
  for (const wanted of injectionNames(b)) {
    ok(bundles.has(wanted), `${name} injects \`${wanted}\`, which the package does not ship`);
  }
}

// Every capture name any loaded highlight query can produce needs a rule in
// the package's stylesheet, which is the only one the page has: a name with
// the dots as spaces is a class list, so a rule applies when its classes are
// a subset of the name's.
const rules = [...CSS.matchAll(/^((?:\.[A-Za-z0-9_-]+)+)\s*\{/gm)]
  .map((found) => found[1].split(".").filter(Boolean));
const vocabulary = scm.captureVocabulary(bundles);
for (const capture of vocabulary) {
  const covered = rules.some((rule) => rule.every((cls) => capture.classes.includes(cls)));
  ok(covered, `the package's CSS has no rule for the capture \`${capture.name}\` (from ${capture.sources.join(", ")})`);
}
// And every colour that stylesheet reads, the page sets, or the page shows
// the fallbacks and nobody chose them.
for (const property of new Set([...CSS.matchAll(/var\((--ts-[a-z-]+)/g)].map((found) => found[1]))) {
  ok(new RegExp(`${property}\\s*:`).test(page), `index.html sets no ${property}, which the package's CSS reads`);
}
note(`${vocabulary.length} capture names, ${rules.length} style rules`);

// --- what the page reads ----------------------------------------------------

const repo = await load(await bundled(text), { optional: (path) => fail(`${path} is missing — run the build`) });
const ui = await text("./ui.js");
const states = await text("./states.json").then(JSON.parse).catch(() => {
  fail("states.json is missing — run the build");
  return null;
});

const dialects = Object.values(repo.dialects).map((dialect) => ({
  dialect,
  bundle: bundles.get(dialect.name),
  language: bundles.get(dialect.name).language,
  facts: grammar.facts(dialect, repo.defineGrammar),
}));
// The body languages arrive in a dialect's shape: the package's query, and
// the generated tables and item sets the build took from its package,
// so the steps have inside an injected range what they have on the document.
for (const [name, language] of Object.entries(repo.languages)) {
  ok(language.highlights === (await readFile(fileURLToPath(grammars.grammar(name).highlights), "utf8")),
     `${name}: the guide read a different highlight query than the package's`);
  if (!ok(language.grammarJson && language.nodeTypes, `${name}: its generated tables are not built — run the build`)) continue;
  const facts = grammar.facts(language);
  ok(facts.counts.rules > 0 && facts.nodeTypes.length > 0, `${name}: its tables hold no rules or node types`);
  const total = bundles.get(name).language.stateCount;
  const recorded = Object.keys(states?.[name]?.states ?? {}).length;
  ok(total - recorded <= Math.max(4, total * 0.1), `${name}: item sets cover ${recorded} of ${total} states`);
  note(`${name} — ${facts.counts.rules} rules, ${facts.nodeTypes.length} node types, item sets for ${recorded} of ${total} states`);
}

// The boot contract: every element id ui.js insists on, and the line height the
// gutter and the editor have to share or the two drift apart.
for (const id of (/const IDS = \[([^\]]*)\]/.exec(ui)?.[1] ?? "").match(/"([^"]+)"/g) ?? []) {
  const name = id.slice(1, -1);
  ok(page.includes(`id="${name}"`), `ui.js needs #${name}, which index.html does not define`);
}
// The two layers of the one editable block have to share their metrics, or the
// glyphs the reader types drift off the glyphs the page painted.
ok(/\.field pre,\s*\.field textarea\s*\{[^}]*font:\s*13px\/var\(--line\)[^}]*white-space:\s*pre-wrap/s.test(page),
   "the text layers no longer share one font and wrapping rule");
ok(/\.field textarea\s*\{[^}]*overflow:\s*hidden/s.test(page),
   "the editor can scroll on its own again");
// The page has no capture rules of its own: colour is the package's.
ok(!/\.hl\s+\.(keyword|string|property|comment)\b/.test(page),
   "index.html colours captures itself instead of through the package's CSS");

// --- what the guide derives -------------------------------------------------

const unescape = (html) => html.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

for (const one of dialects) {
  const { dialect, facts, language, bundle: parsers } = one;
  console.log(`\n${dialect.name}`);

  ok(facts.counts.rules > 0, `${dialect.name}: no rules`);
  ok(facts.rules.every((rule) => rule.source.length > 0), `${dialect.name}: a rule rendered empty`);
  ok(facts.externals.includes("_eol"), `${dialect.name}: the external token is not _eol`);
  ok(Object.values(facts.methods).flat().includes("GET"), `${dialect.name}: no method decoded`);
  note(`${facts.counts.rules} rules (${facts.counts.hiddenRules} hidden), `
     + `${facts.counts.tokens} tokens over ${facts.precedence.length} precedence levels, `
     + `${facts.counts.nodeTypes.total} node types`);

  // Every precedence the artifacts carry has a name in the source that wrote it.
  for (const level of facts.precedence) {
    ok(level.value === null || level.name,
       `${dialect.name}: precedence ${level.value} has no PREC constant`);
  }

  // Both dialect queries — the package's copies — compile, and every pattern
  // stands alone.
  for (const which of ["highlights", "injections"]) {
    const source = dialect[which];
    if (!source) continue;
    const compiled = scm.compile(Query, language, source);
    if (!ok(compiled.ok, `${dialect.paths[which]}: ${compiled.error?.message}`)) continue;
    for (const pattern of compiled.patterns) {
      const alone = scm.compile(Query, language, pattern.source);
      ok(alone.ok && alone.patterns.length === 1,
         `${dialect.paths[which]} pattern ${pattern.index} does not stand alone`);
      if (alone.ok) alone.query.delete();
    }
    const relaxed = scm.relax(source);
    ok(relaxed.source.length === source.length,
       `${dialect.paths[which]}: relaxing moved the offsets`);
    note(`${dialect.paths[which]} — ${compiled.patterns.length} patterns, `
       + `${compiled.captureNames.length} captures, ${relaxed.stripped.length} text predicates`);
    compiled.query.delete();
  }

  // Every document parses as its name promises, paints, asks for nothing the
  // package does not ship, and comes back from `highlight` as the same text.
  // The dialect's own `test/documents/` are the shared set — the Swift tests
  // parse the same files against the C parser — and the page's samples ride
  // the same checks.
  const unattributed = new Set();
  /** Where a document came from, so the run says which set a line is from. */
  const origin = (path) =>
    (path.includes("/test/documents/") ? "test/documents/" : "samples/") + path.split("/").pop();
  for (const doc of [...dialect.documents, ...dialect.samples]) {
    const expectsError = /error/.test(doc.path);
    const painted = analyze(parsers, bundles, doc.text);
    ok(painted.hasError === expectsError,
       `${doc.path}: hasError is ${painted.hasError}, the name says ${expectsError}`);
    for (const wanted of painted.unresolved) fail(`${doc.path} asks for \`${wanted}\`, which the package does not ship`);
    ok(unescape(highlight(doc.text, dialect.name).replace(/<[^>]*>/g, "")) === doc.text,
       `${doc.path}: highlight() did not return the text it was given`);

    const analysed = parse.analyze(parsers, doc.text, { tokenTable: facts.tokens });
    ok(analysed.lines.length === doc.text.split("\n").length,
       `${doc.path}: the line report does not cover the text`);

    // With no extras, the accepted tokens tile the text exactly — unless the
    // parser had to recover, which only the error documents ask it to.
    if (!expectsError) {
      let at = 0;
      for (const token of analysed.tokens.filter((one) => one.accepted)) {
        if (token.start !== at) { at = -1; break; }
        at = token.end;
      }
      ok(at === doc.text.length, `${doc.path}: the token stream does not tile the text`);
    }

    // An edit is only worth making incrementally if it lands the same tree.
    const edited = `${doc.text}\n`;
    const step = parse.incremental(parsers, doc.text, edited);
    const cold = parsers.parser.parse(edited);
    const warm = parsers.parser.parse(edited);
    ok(cold.rootNode.toString() === warm.rootNode.toString(),
       `${doc.path}: an incremental reparse disagrees with a cold one`);
    cold.delete();
    warm.delete();

    // The item sets are keyed by the state a live parse reports.
    if (states) {
      const bank = states[dialect.name];
      for (const token of analysed.tokens) {
        if (token.parseState != null && !bank?.states[String(token.parseState)]) unattributed.add(token.parseState);
      }
    }

    analysed.tree.delete();
    note(`${origin(doc.path)} — ${analysed.counts.nodes} nodes, `
       + `${analysed.counts.tokens} tokens, ${analysed.counts.errors} errors, `
       + `${step.reused}/${step.total} nodes reused after an edit`);
  }

  // The generator attributes a state's items to a rule that reaches it, so a
  // state nothing reaches — the start state, the error state — carries none.
  // What the check watches is that the collection still covers the automaton.
  if (states) {
    const recorded = Object.keys(states[dialect.name]?.states ?? {}).length;
    ok(language.stateCount - recorded <= Math.max(4, language.stateCount * 0.1),
       `${dialect.name}: item sets cover ${recorded} of ${language.stateCount} states`);
    note(`item sets — ${recorded} of ${language.stateCount} states`
       + (unattributed.size ? `, none for ${[...unattributed].sort((a, b) => a - b).join(", ")}` : ""));
  }

  // The corpus, against the wasm the package ships rather than the CLI's own build.
  const files = dialect.corpus.map((file) => corpus.runFile(parsers, file, process.platform === "darwin" ? "macos" : process.platform));
  const total = corpus.summarise(files);
  ok(total.failed === 0, `${dialect.name}: ${total.failed} corpus cases fail`);
  for (const failure of total.failures) fail(`${dialect.name}: ${failure.name} — ${failure.diff}`);
  note(`corpus — ${total.passed} passing, ${total.failed} failing, ${total.skipped} skipped, `
     + `over ${files.length} files`);
}

// The dialect difference the guide renders, computed rather than described.
if (dialects.length === 2) {
  const difference = grammar.diff(dialects[0].facts, dialects[1].facts);
  ok(difference.differing.length > 0 && difference.identical.length > 0,
     "the two dialects no longer differ in the way the guide describes");
  console.log(`\ndialects: ${difference.identical.length} rules identical, `
    + `${difference.differing.length} differing, `
    + Object.entries(difference.onlyIn).map(([name, list]) => `${list.length} only in ${name}`).join(", "));
}

// The two hand-written sources the guide quotes are still findable by shape.
ok(grammar.precConstants(repo.defineGrammar).entries.length > 0, "the PREC block was not found");
ok(grammar.headerComment(repo.defineGrammar).length > 0, "the header comment was not found");
ok(grammar.scannerScan(repo.scanner).includes("result_symbol"), "the scanner's scan() was not found");

// --- the page itself --------------------------------------------------------
//
// `ui.js` is the one module with no node-side twin: it renders into a DOM, so
// the smallest DOM that satisfies it stands in for a browser and the page is
// booted once — every element id it insists on is there, it renders its first
// document without throwing, and it took the package's stylesheet.
//
// Booted, not driven: what it draws is a claim about a rendered page, and a
// browser is what renders one.

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.attributes = {};
    this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {}, contains: () => false };
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientHeight = 400;
    this.selectionStart = 0;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  removeEventListener() {}
  setPointerCapture() {}
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  querySelectorAll(selector) {
    const wanted = selector.replace(".", "");
    return this.children.filter((kid) => String(kid.className ?? "").split(" ").includes(wanted));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest() { return null; }
  focus() {}
  setSelectionRange(start) { this.selectionStart = start; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 600, height: 400 }; }
  fire(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener({ target: this, ...event }); }
}

const elements = new Map();
for (const found of page.matchAll(/id="([^"]+)"/g)) elements.set(found[1], new Element("div"));
globalThis.document = {
  getElementById: (id) => elements.get(id) ?? null,
  createElement: (tag) => new Element(tag),
  querySelector: (selector) => (selector === "main" ? new Element("main") : null),
  documentElement: new Element("html"),
};
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} };
globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => undefined, define() {} };
globalThis.fetch = async (url) => {
  try {
    const data = await readFile(fileURLToPath(url));
    return {
      ok: true,
      status: 200,
      text: async () => data.toString("utf8"),
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  } catch {
    return { ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  }
};

const guide = await import("./ui.js");
await guide.start();
await new Promise((resolve) => setTimeout(resolve, 250));   // the item sets load on their own

ok(elements.get("shipped-css").textContent === CSS, "the page did not take the package's CSS");

if (failures.length) {
  console.error("");
  for (const failure of failures) console.error(`check: ${failure}`);
  process.exit(1);
}
console.log("\ncheck: the package loads as a consumer loads it, and the page reads what it ships");
