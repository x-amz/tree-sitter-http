// tree-sitter-http for the web: the grammars as wasm, the runtime, and the
// painter, in one import. `ready()` loads the four grammars — the two
// dialects, and the body languages their queries inject — and compiles their
// queries. After it, `highlight(text, dialect)` is a plain function of the
// text: the text as HTML, painted in tree-sitter's capture classes, with the
// output's text content equal to the input, so a mirror laid under a
// textarea tiles it (element.js). `CSS` colours those classes through
// `--ts-*` custom properties a page defines.
//
// Runs under node and in a browser with no bundler: every file is read
// beside this module, `node:fs` for a `file:` URL, `fetch` otherwise, so
// node and the browser get the same bytes for the same text.

import { Parser, Language } from "./dist/tree-sitter.js";
import { bundle, analyze } from "./painter.js";
import * as grammars from "./grammars.js";

export { grammars };
export { bundle, analyze, injectionNames, MAX_DEPTH } from "./painter.js";

/** Text past this is escaped and not parsed; a pasted megabyte is not a mirror's job. */
export const PAINT_CAP = 128 * 1024;

const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** The three characters that would otherwise be markup. The output's text content is the input. */
export function escape(text) {
  return text.replace(/[&<>]/g, (c) => escapes[c]);
}

/** One of the package's files: bytes for a `.wasm`, text for a `.scm`. */
async function read(url, as) {
  if (url.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    return as === "text" ? readFile(url, "utf8") : new Uint8Array(await readFile(url));
  }
  // Cached like anything else. These URLs are `./dist/` beside this module, so
  // a consumer that serves the package from a versioned path — what a bundler
  // and the guide's build both do — has a URL that changes when the bytes do,
  // and nothing to go stale.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname.split("/").pop()}: ${res.status}`);
  return as === "text" ? res.text() : new Uint8Array(await res.arrayBuffer());
}

/** name -> bundle, filled by `ready`. `highlight` reads it by dialect; the guide reads it whole. */
export const bundles = new Map();
let started = null;

/**
 * Load the grammars and compile the queries. Idempotent: the first call does
 * the work and every later one waits on it. Rejects if a query does not
 * compile against its grammar.
 */
export function ready() {
  started ??= (async () => {
    await Parser.init();
    for (const g of grammars.all) {
      const language = await Language.load(await read(g.wasm));
      const highlights = await read(g.highlights, "text");
      const injections = g.injections ? await read(g.injections, "text") : null;
      bundles.set(g.name, bundle(language, highlights, injections));
    }
  })();
  return started;
}

/** Runs of like class as spans; the unclassed run is plain escaped text. */
function spanify(source, classes) {
  let html = "";
  for (let i = 0; i < source.length; ) {
    let j = i;
    while (j < source.length && classes[j] === classes[i]) j++;
    const run = escape(source.slice(i, j));
    html += classes[i] === null ? run : `<span class="${classes[i]}">${run}</span>`;
    i = j;
  }
  return html;
}

/**
 * `text` as HTML, painted by `dialect` — `http` for an `.http` document,
 * `http_message` for wire octets. Past `cap` characters the text is escaped
 * and not parsed. Synchronous, and throws before `ready` has resolved.
 */
export function highlight(text, dialect = "http", { cap = PAINT_CAP } = {}) {
  const b = bundles.get(dialect);
  if (!b) throw new Error(started ? `no such dialect: ${dialect}` : "highlight: await ready() first");
  if (text.length > cap) return escape(text);
  return spanify(text, analyze(b, bundles, text).classes);
}

/**
 * Every class the queries can emit, as the stylesheet's contract: a capture
 * name with the dots as spaces is a class list, so `.string` paints
 * `string.special.key` too and only the families listed here need a rule.
 */
export const CAPTURE_FAMILIES = Object.freeze([
  "attribute", "boolean", "comment", "constant", "embedded", "error", "escape",
  "keyword", "label", "markup", "number", "operator", "property", "punctuation",
  "string", "tag", "type", "variable",
]);

/**
 * The rules for those classes. Colours are `--ts-*` custom properties the page
 * defines; a page that defines nothing gets the fallbacks, which are a light
 * set. `.error` is deliberately quiet — an unfinished line is mid-edit, not a
 * mistake to shout about.
 */
export const CSS = `.keyword { color: var(--ts-keyword, #1d5fb4); font-weight: 600; }
.string { color: var(--ts-string, inherit); }
.string.special { color: var(--ts-string-special, #6b3fb5); }
.constant { color: var(--ts-constant, #5b6675); }
.constant.builtin { color: var(--ts-boolean, #b4421f); }
.boolean { color: var(--ts-boolean, #b4421f); }
.number { color: var(--ts-number, #b4421f); }
.property { color: var(--ts-property, #0f766e); }
.punctuation { color: var(--ts-punctuation, #6b7280); }
.punctuation.special { color: var(--ts-punctuation-special, #6b7280); font-weight: 600; }
.operator { color: var(--ts-operator, #6b7280); }
.attribute { color: var(--ts-attribute, #8a5a00); }
.variable { color: var(--ts-variable, #b4421f); }
.variable.builtin { color: var(--ts-variable, #b4421f); font-style: italic; }
.variable.parameter { color: var(--ts-string, inherit); font-style: italic; }
.comment { color: var(--ts-comment, #6b7280); font-style: italic; }
.escape { color: var(--ts-escape, #b4421f); }
.tag { color: var(--ts-tag, #1d5fb4); }
.type { color: var(--ts-type, #0f766e); }
.label { color: var(--ts-property, #0f766e); }
.embedded { color: var(--ts-comment, #6b7280); }
.markup { color: var(--ts-markup, inherit); }
.markup.link { color: var(--ts-string-special, #6b3fb5); text-decoration: underline; }
.markup.heading { color: var(--ts-punctuation, #6b7280); }
.error { color: var(--ts-error, #a86a00); text-decoration: underline wavy 1px; text-underline-offset: 3px; }
`;
