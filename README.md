# tree-sitter-http

Tree-sitter grammars for `.http` files and raw `message/http` wire messages: one source, two dialects. `http` is the file format, written to the format as the `.http` tooling reads it, so the tree an editor sees and the regions a client runs agree. `http_message` is the same grammar with the file-format features switched off.

The guide at [parse.req.to](https://parse.req.to) is the interactive form of this file and the debugger for both grammars: it takes any text through lex, parse, query, paint and inject, computed from the files in this tree. `npm ci && npm run build` builds it into `web/dist/`; serve that directory.

## Using the grammars

`src/` is committed, so every consumer builds from it with no node and no CLI:

- **C, editors** — compile `<dialect>/src/parser.c` and `<dialect>/src/scanner.c` (which includes `common/scanner.h`) into `libtree-sitter-<dialect>`; the entry point is `tree_sitter_<dialect>`. Nova does this from a git tag.
- **Swift** — the package `TreeSitterHttp`, from a git tag. See [The Swift package](#the-swift-package).
- **npm** — `tree-sitter-http` is these files, packaged the way grammars are (`tree-sitter build --wasm node_modules/tree-sitter-http/http` gives a wasm); `tree-sitter-http-web` is `bindings/web/`: the grammars as wasm, a painter, and an `<http-file>` element. `bindings/web/README.md` documents it.

Parsers are generated at **ABI 14**. The CLI emits 15 by default; SyntaxKit and SwiftTreeSitter load 14, and Nova reports a mismatch in its Extension Console as "incompatible version of the Tree-sitter API".

The dialects are spelled `http` and `http_message` wherever an identifier is needed (directories, grammar names, `tree_sitter_http()`, `libtree-sitter-http.dylib`, `tree-sitter-http.wasm`), `TreeSitterHttp.file` and `.message` in Swift, `source.http` and `source.http-message` as scopes. The file dialect carries the plain name: `.http` is associated with a grammar by it.

## Layout

```
common/define-grammar.js    the grammar: module.exports = (wire) => grammar({...})
common/scanner.h            the _eol external scanner
<dialect>/grammar.js        a one-line shim calling define-grammar
<dialect>/src/              generated, committed; scanner.c is a two-line shim
<dialect>/test/corpus/      the corpus
<dialect>/test/documents/   whole documents, parsed by every test suite
queries/<dialect>/          highlights.scm, injections.scm, standard capture names
bindings/swift/             the Swift package
bindings/web/               the npm package tree-sitter-http-web
web/                        the guide (web/README.md)
```

Edit the grammar, the scanner, the corpus, the queries, and the bindings. Never edit `src/parser.c`, `src/grammar.json`, `src/node-types.json`, or `src/tree_sitter/*.h`: `tree-sitter generate` rewrites them, and they are always committed. Every `version` field stays `0.0.0`; the tag stamps them.

## The wire dialect

`http_message` is `define-grammar(true)`. It switches off:

- **Placeholders** — `target` and `value` are plain text; `{` and `}` are ordinary octets.
- **File-format items** — no `comment`, `directive`, `declaration`, `separator`/`section`. The items are request, response, blank.
- **Implied GET** — the request line requires a method; an unknown first word is an error.
- **Target continuations and `#` lines in header blocks** — both are `plain`.
- **Body termination and typing** — a body runs to EOF as one opaque `body` node; no `###`, blank line, or `HTTP/` status line ends it. Its language comes from the message's own Content-Type, which is what `queries/http_message/injections.scm` matches on. The file dialect types a body from its first line (`json_body`, `xml_body`, `file_body`, `raw_body`) and sends a `raw_body` whose message declares `message/http` to `http_message`.

Each switch is a corpus case under `http_message/test/corpus/`, and the guide computes the rule-by-rule diff between the two generated grammars.

## Changing the grammar

```bash
npm ci
npm run generate                  # both dialects: tree-sitter generate --abi 14
npm test                          # both corpora
swift test                        # loads every grammar, compiles every query, parses every document
npm run build && npm run check    # the web package and the guide, with their checks
```

`tree-sitter parse file.http` from the repo root uses `http`; from a dialect directory, that dialect. From `http/`, `tree-sitter query ../queries/http/highlights.scm <file>` runs a query.

The loop: edit `common/define-grammar.js`, add a corpus case in each dialect the change touches, `generate`, `test` (the new case fails), `test --update`, then read the recorded tree and fix until it is the tree you meant. `--update` will happily record a regression; review the diff. A document under `test/documents/` whose name contains `error` is expected to fail; every other one must parse clean.

Whitespace is structure: there are no `extras`, and every space, blank line and line end is a token. Every line-shaped rule ends in `$._eol`, the one external token, a newline or zero-width at EOF. (Matching `"\0"` from the grammar looks like it works in one code path and not another; don't.) Most grammar bugs are a line lexing as the wrong kind. `PREC` at the top of `define-grammar.js` is the ladder that decides it; read its comments before touching a number. The guide's lex step lists, for the token under the caret, every token that was valid there and which won. The request and response rules are `prec.right` so a trailing comment or blank line attaches to them.

Node names are the contract with every consumer's queries. `src/node-types.json` is the vocabulary, and its fields (`method:`, `target:`, `version:`, `name:`, `value:`, `argument:`, `status:`, `reason:`, `body:`, `path:`, `title:`) are what queries should bind; underscore rules never appear in a tree. After a grammar change, recompile each consumer's queries against the grammar: a removed node type fails there and nowhere else. Real `.http` files are the second corpus, and where a precedence change shows up:

```bash
for f in $(find <dir> -name '*.http'); do
  printf '%s  errors=%s\n' "$f" "$(tree-sitter parse "$f" | grep -c -E '\(ERROR|MISSING')"
done
```

## The Swift package

One product, `TreeSitterHttp`: the two dialects, their queries, and the grammars the queries inject.

```swift
public struct Grammar: @unchecked Sendable {
    public let name: String            // http, http_message, json, xml
    public let language: OpaquePointer // the TSLanguage
    public let highlights: String
    public let injections: String?
}

public enum TreeSitterHttp {
    public static let file: Grammar
    public static let message: Grammar
    public static let json: Grammar
    public static let xml: Grammar
    public static let all: [Grammar]
    public static func grammar(named name: String) -> Grammar?
}
```

`grammar(named:)` resolves the names the injection queries use. A new body language is one dependency in `Package.swift`, one static here, one pattern in the wire injection query, and a matching devDependency in `bindings/web/package.json`; the Swift and npm pins must name the same grammar tags, and the web build refuses to run until they do. No runtime is linked, so the package builds anywhere SPM does; the tests bring SwiftTreeSitter.

## Releasing

A release is a tag, and the tag is the version: `git tag <version> && git push --tags`. `publish.yml` runs `swift test`, stamps the version into `tree-sitter.json` and every `package.json`, checks the web package's release, and publishes both npm packages with provenance under trusted publishing. `ci.yml` runs on every push: `src/` matches what the grammar generates, the corpus passes, both builds and both checks pass. `pages.yml` deploys the guide from `main`.

Building here needs node ≥ 22 (`npm ci` fetches the pinned tree-sitter CLI 0.25.10; `allowScripts` names it so its install script runs) and, for the web package only, emscripten 4.0.4 through emsdk at `~/emsdk` or `EMSDK_ROOT`. The build refuses any other emcc.

## Things that bit once

- Two tokens at the same precedence that can match the same text tie, and the tie-break depends on parse state. Make them structurally different: `plain` consumes its newline, so it is longer on a colon-less line and impossible on a header line.
- A body line must outrank a comment prefix, or `# …` inside a body ends it. In the wire dialect it must also outrank the status line, or `HTTP/1.1 200` inside a body ends it.
- Inside a header block, `header_name` must outrank target text, or every header becomes an implied-GET request.
- SPM refuses two resources with one basename in a target, so the queries are copied as a directory.
- Both SPM targets sit at the root, so a new root-level file goes into `Package.swift`'s `unrelated` list or the build warns.

## What the grammar is written to

The format is documented at [http-files.org](https://http-files.org). This repository documents the grammar, not the format: the rules are `common/define-grammar.js`, the output is each dialect's `src/node-types.json`, and the pin is the corpus. When the engine's rule and this grammar disagree, the engine's rule wins and a corpus case records it.
