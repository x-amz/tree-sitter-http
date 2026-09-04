// What the guide reads. The package first: `tree-sitter-http-web` resolves to
// the build's vendored copy — through the page's import map in a browser,
// through node_modules under node, both the way a consumer wires it — and its
// grammars.js says which files a consumer loads, so the query text the guide
// shows and edits is the copy the package ships. Then this repo's own files,
// copied under the page by the build and fetched at load, so the page cannot
// drift from the grammar: the dialects, their generated tables and node
// vocabularies come from `tree-sitter.json`, the body languages' tables from
// `./languages/<name>/`, where the build puts them from the grammar packages,
// and the three listings a static server cannot produce — corpus files, the
// documents both test suites parse, and the page's samples — from
// `./sources.json`, which the build writes. A body language
// comes out in a dialect's shape, so the steps can stand in it as they stand
// in a dialect.
//
// Reading is injected: the page fetches, the node check reads the disk, and
// both get the same `Repo`. Paths are relative to this directory; the
// package's files are URLs, which both readers take as they are.

import { grammars } from "tree-sitter-http-web";

/** The repository's files, as the build copies them under the page. */
export const TREE = "./tree/";

/** Repo files that are not named by tree-sitter.json. */
export const ROOT_FILES = {
  config: `${TREE}tree-sitter.json`,
  sources: "./sources.json",
};

/** Every repository file the page reads, in one response. The build records
    what the loader asks for and writes it here; on a static host the round
    trips are the load time, not the bytes. */
export const FILES = "./files.json";

/**
 * A reader that answers from `files.json` and falls back to `read` for
 * anything not in it — the package's own URLs, which it fetches for itself.
 *
 * @param {(path: string | URL) => Promise<string>} read
 */
export async function bundled(read) {
  const files = JSON.parse(await read(FILES));
  return { text: (path) => (typeof path === "string" && path in files ? Promise.resolve(files[path]) : read(path)) };
}

const array = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
const fromRoot = (path) => `${TREE}${path}`;

const site = new URL("./", import.meta.url);

/** A URL as the page can name it: from the site's root, or from node_modules, or its file name. */
export const shown = (url) => {
  if (url.href.startsWith(site.href)) return url.href.slice(site.href.length);
  const installed = url.pathname.lastIndexOf("/node_modules/");
  return installed === -1 ? url.pathname.split("/").pop() : url.pathname.slice(installed + "/node_modules/".length);
};

/**
 * Load everything the guide reads.
 *
 * @param {{text: (path: string | URL) => Promise<string>}} reader
 * @param {{optional?: (path: string, error: Error) => void}} [on]
 *        called for a file the page can do without (the listings the build writes).
 */
export async function load(reader, on = {}) {
  const missing = [];
  const optional = async (path, fallback) => {
    try {
      return JSON.parse(await reader.text(path));
    } catch (error) {
      missing.push(path);
      on.optional?.(path, error);
      return fallback;
    }
  };

  const config = JSON.parse(await reader.text(ROOT_FILES.config));
  const sources = await optional(ROOT_FILES.sources, {});

  const dialects = {};
  for (const grammar of config.grammars) {
    const shipped = grammars.grammar(grammar.name);
    if (!shipped) throw new Error(`tree-sitter.json declares ${grammar.name}, which the package does not ship`);
    dialects[grammar.name] = await dialect(reader, grammar, shipped, sources[grammar.name] ?? {});
  }

  // Every other grammar the package ships: the body languages the injection
  // queries name, each a parser and a highlight query, plus the generated
  // tables the build copied beside the guide from the grammar package.
  const languages = {};
  for (const shipped of grammars.all) {
    if (dialects[shipped.name]) continue;
    const tables = {
      grammarJson: `./languages/${shipped.name}/grammar.json`,
      nodeTypes: `./languages/${shipped.name}/node-types.json`,
    };
    languages[shipped.name] = {
      name: shipped.name,
      title: shipped.name,
      scope: null,
      fileTypes: [],
      injectionRegex: null,
      externalFiles: [],
      paths: { wasm: shown(shipped.wasm), highlights: shown(shipped.highlights), injections: null, ...tables },
      grammarJson: await optional(tables.grammarJson, null),
      nodeTypes: await optional(tables.nodeTypes, null),
      highlights: await reader.text(shipped.highlights),
      injections: null,
      corpus: [],
      documents: [],
      samples: [],
      requires: null,
    };
  }

  // The shared grammar source, found the way node finds it: each dialect's
  // grammar.js requires it by path.
  const shared = Object.values(dialects).map((d) => d.requires).find(Boolean);
  const defineGrammar = shared ? await reader.text(shared) : null;

  // The external scanner every dialect's shim includes, named by tree-sitter.json.
  const scannerPath = fromRoot(array(config.grammars[0]?.["external-files"])[0] ?? "common/scanner.h");
  const scanner = await reader.text(scannerPath).catch(() => null);

  return {
    config,
    languages,
    dialects,
    defineGrammar,
    defineGrammarPath: shared,
    scanner,
    scannerPath,
    missing,
  };
}

async function dialect(reader, grammar, shipped, listing) {
  const dir = grammar.path ?? ".";
  const paths = {
    grammarJson: fromRoot(`${dir}/src/grammar.json`),
    nodeTypes: fromRoot(`${dir}/src/node-types.json`),
    grammarJs: fromRoot(`${dir}/grammar.js`),
    wasm: shown(shipped.wasm),
    highlights: shown(shipped.highlights),
    injections: shipped.injections ? shown(shipped.injections) : null,
  };

  const [grammarJson, nodeTypes, grammarJs, highlights, injections] = await Promise.all([
    reader.text(paths.grammarJson).then(JSON.parse),
    reader.text(paths.nodeTypes).then(JSON.parse),
    reader.text(paths.grammarJs).catch(() => ""),
    reader.text(shipped.highlights),
    shipped.injections ? reader.text(shipped.injections) : null,
  ]);

  const corpus = await Promise.all(
    (listing.corpus ?? []).map(async (path) => ({ path, text: await reader.text(path) })),
  );
  const document = async (path) => ({ path, name: title(path), text: await reader.text(path) });
  const documents = await Promise.all((listing.documents ?? []).map(document));
  const samples = await Promise.all((listing.samples ?? []).map(document));

  return {
    name: grammar.name,
    title: grammar.title ?? grammar.name,
    scope: grammar.scope ?? null,
    fileTypes: grammar["file-types"] ?? [],
    injectionRegex: grammar["injection-regex"] ?? null,
    externalFiles: array(grammar["external-files"]),
    paths,
    grammarJson,
    nodeTypes,
    highlights,
    injections,
    corpus,
    documents,
    samples,
    /** The path `<dialect>/grammar.js` requires, resolved against this directory. */
    requires: requiredPath(grammarJs, dir),
  };
}

/** `require("../common/define-grammar")` in <dialect>/grammar.js, as a path from here. */
function requiredPath(grammarJs, dir) {
  const match = /require\(\s*["']([^"']+)["']\s*\)/.exec(grammarJs);
  if (!match) return null;
  const specifier = match[1].endsWith(".js") ? match[1] : `${match[1]}.js`;
  const url = new URL(specifier, `file:///${dir}/`);
  return fromRoot(url.pathname.slice(1));
}

/** A document's display name: `http/test/documents/03-lexing.http` -> `lexing`. */
function title(path) {
  const base = path.split("/").pop().replace(/\.[^.]+$/, "");
  return base.replace(/^\d+[-_]/, "").replace(/[-_]+/g, " ");
}
