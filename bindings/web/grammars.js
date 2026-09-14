// The grammars, as URLs under dist/ beside this module — `file:` under node,
// `http:` in a browser. The two dialects, and every body language the injection queries
// name: the set the Swift product carries. Nothing here loads; a parser is
// data, and index.js reads it.
//
// The injection queries name grammars outright (`json`, `xml`, `html`,
// `form_urlencoded`, `http_message`, `expression`), so `grammar(name)` is the
// whole lookup for an `injection.language` value. A new body language is one
// entry here and one pattern in the wire query; release.js fails until this
// list and the built assets agree.

const here = (name) => new URL(`./dist/${name}`, import.meta.url);

const describe = (name, injections) => Object.freeze({
  name,
  wasm: here(`tree-sitter-${name}.wasm`),
  highlights: here(`${name}.highlights.scm`),
  injections: injections ? here(`${name}.injections.scm`) : null,
});

/** The .http file dialect. */
export const file = describe("http", true);
/** The message/http wire dialect. */
export const message = describe("http_message", true);
/** The body languages the injection queries name. */
export const json = describe("json", false);
export const xml = describe("xml", false);
export const html = describe("html", false);
/** This repository's own body language, form-encoded pairs. */
export const formUrlencoded = describe("form_urlencoded", false);
/** This repository's own expression language, what a placeholder holds. */
export const expression = describe("expression", false);

export const all = Object.freeze([file, message, json, xml, html, formUrlencoded, expression]);

/** The grammar an `injection.language` value names, or undefined. */
export function grammar(name) {
  return all.find((g) => g.name === name);
}
