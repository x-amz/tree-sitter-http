// The listings a static server cannot produce.
//
// The page derives everything it says from the repository's files, copied
// under it by the build: each dialect's `src/grammar.json` and
// `src/node-types.json`, its queries, `common/define-grammar.js`,
// `common/scanner.h`. Those paths follow from `tree-sitter.json`. Three sets
// do not, because a static server has no directory listing — a dialect's
// corpus files, the documents under `<dialect>/test/documents/`, and the
// page's own samples — so the build writes them to sources.json, as paths
// from the page. Drop a file into `<dialect>/test/corpus/`,
// `<dialect>/test/documents/` or `web/samples/<dialect>/` and it appears in
// the page after the next build.

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The files in `directory`, as the page will ask for them under `prefix`. */
export function listing(directory, prefix) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .map((name) => `${prefix}/${name}`);
}

/** `{ <dialect>: { corpus: [...], documents: [...], samples: [...] } }` for every grammar in `config`. */
export function sources(config, { root, web, tree }) {
  const out = {};
  for (const grammar of config.grammars) {
    const dir = grammar.path ?? ".";
    out[grammar.name] = {
      corpus: listing(join(root, dir, "test", "corpus"), `${tree}${dir}/test/corpus`),
      documents: listing(join(root, dir, "test", "documents"), `${tree}${dir}/test/documents`),
      samples: listing(join(web, "samples", grammar.name), `./samples/${grammar.name}`),
    };
  }
  return out;
}
