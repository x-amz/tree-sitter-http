# the guide

One block of text and six steps. The page opens on plain, uncoloured text and
each step performs its own operation on whatever is in the box — the box stays
editable the whole way, so every step runs against your text, not a recording.

| step | what it does to the text |
|---|---|
| 0 plain | nothing. Bytes, and where the caret is in them |
| 1 lex | shades the tokens the lexer cut, underlines the whitespace ones; stands in the grammar's token ladder — the caret names a token and lights it and everything else that was valid there, a pick in the ladder marks every token of that kind in the text |
| 2 parse | tints each node a shade darker than its parent, so the tree is on the text; the caret gives its path, its subtree, and the LR items the automaton was in |
| 3 query | stands in the grammar's two queries, both editable — only one marked at a time: the highlight query at the pattern that claimed the character under the caret, or, inside a handed-over range, the injection query at the pattern that claimed it; the caret in either outlines everything that pattern captured, or every range it hands over |
| 4 paint | colours it — capture name to colour, which is all highlighting is; stands in the package's stylesheet, each rule's colour on this page beside it — the caret names the capture, marks the rules that paint it, and says which `--ts-*` property the colour came through and what this page resolves it to; a pick of a rule marks everywhere it paints |
| 5 inject | tints the ranges handed to another grammar, and the ones that stayed opaque; the grammar that took the range under the caret runs the five steps before this one on it, from its own tables — one row per step, at the caret — and again for any range it hands on |

Every step stands in one document beside the source on wider screens and directly
below it on mobile. Selection works from either side: the caret asks *what is
this?*, and a pick in the document asks *where are these?* The source scrolls
within a viewport-sized area, keeping long examples from pushing the analysis
out of reach. Captions and caret explanations grow to fit their content; the
step documents and supporting tables scroll inside bounded panes.

An expandable comparison below the work area contains the same text in the
package's own `<http-file>` element: what a consumer gets, beside what the
page is doing to the same characters. A range the inject step handed to another grammar can be
gone into, and the six steps run there on that grammar — its tokens and
their precedences, its item sets, its query — with the same material the
dialects have, not a note saying so. Two collapsed sections at the end are
reference rather than demonstration: the generated grammar (precedence ladder,
external token, the computed difference between the dialects, node types,
rules) and the corpus, run here against the wasm the package ships.

## The two rules the page is built on

Nothing here states a fact about the grammar. Every number, name, regex and
table is read at load from this repo's own files: `tree-sitter.json` for the
dialects, each dialect's `src/grammar.json` and `src/node-types.json`,
`common/define-grammar.js` and `common/scanner.h`, the corpus — copied under
the page by the build. Change the grammar and the page changes with it; there is
no second copy of the precedence table, the method list, or the node
vocabulary to fall out of step.

And nothing here parses or paints on its own. The page is a consumer of the
npm package `tree-sitter-http-web`, by the name a consumer imports it under:
`index.html` maps it in an import map, one entry per `package.json` export,
to the copy the build vendors from `node_modules`, and `ui.js` takes `ready`, `analyze`, `highlight`,
`CSS`, `grammars` and the element from it. The grammars are the wasms `ready`
loads, the queries shown and edited at step 3 are the flat copies it compiled,
the colours are its `CSS` through the `--ts-*` properties the page sets, and
the registry at step 5 is `grammars.js`. What the page shows is what the
package ships, and a broken package is a broken page.

## Layout

`grammar.js`, `parse.js`, `query.js` and `corpus.js` are the logic behind the
steps, all pure: text and data in, data out. `sources.js` is the one reader,
with I/O injected, so node and the browser load the same material — the
package's files by their `grammars.js` URLs, the repo's by path. `ui.js` is the
only file that touches the DOM, and `index.html` is markup, styles, the import
map, and four lines of boot.

`check.js` runs under node what the browser runs, against the built site:
the build copies it into `dist/` beside the page, and `npm run check` runs
that copy. It resolves `tree-sitter-http-web` the way node resolves any
package — the guide is a workspace, and `npm ci` links
`node_modules/tree-sitter-http-web` to `../bindings/web` — so the package's
`exports` is what is exercised. It holds the page's import map to that
`exports` map entry for entry and the vendored copy to the package's files,
loads the grammars with `ready`, runs every one of the guide's modules
against the site's files, and drives `ui.js` through both dialects and all
six steps over a DOM small enough to fit in the file — checking at the last
step that the classes the page painted are the classes `highlight` emits for
the same text. That is what makes the page's code checked code, and why the
build fails rather than shipping a page that is missing a format.

`make/build.js` writes `dist/`: the package vendored from `node_modules`;
`files.json`, every repository file the page reads — the tree, the samples,
and the generated tables of every body language the package ships — recorded
by running the page's own loader with a reader that keeps what it asks for,
so the page spends one round trip on all of them;
`states.json`, the LR item sets for every grammar the page can stand in,
keyed by the state number a live parse reports (`make/states.js`), fetched
after the first paint; and the page's own files.

`../<dialect>/test/documents/*.http` are the documents both test suites
parse: `check.js` runs them through the wasm grammars, `swift test` through
the C parsers, and a name containing `error` is one that is expected to fail.
`samples/<dialect>/*.http` are the page's own worked examples — the seed in
the editor and the first entries in the example list — and ride the same
checks.

## Running it

```
npm run build                        # from the repo root: the web package, then this site into web/dist/
python3 -m http.server -d web/dist   # or any static server
```

Then open <http://localhost:8000/>. The package fetches its wasms and
queries the way it does on any page, with the browser's ordinary caching, so
after a rebuild reload without the cache. `pages.yml` deploys the same
`dist/` to GitHub Pages from `main`, as parse.req.to.

What the build needs is in the root README under *What you need*.

`package.json` here is the guide's own manifest: private, never published,
with the web package and the grammar packages it reads tables from as its
devDependencies, and `build` and `check` as its scripts. `dist/` is the
build's, and is not committed; this directory holds only what the page loads
and what builds it.
