# tree-sitter-http

Tree-sitter grammars for `.http` files and raw `message/http` wire messages: one source, two dialects. `http` is the file format, written to the format as the `.http` tooling reads it, so the tree an editor sees and the regions a client runs agree. `http_message` is the same grammar with the file-format features switched off. Beside them, `form_urlencoded` is the one body language this repository carries itself; json, xml and html come from their own grammars, and every binding ships all of them.

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
common/scanner.h            the external scanner: _eol, the placeholder, and the looks a token cannot make
<dialect>/grammar.js        a one-line shim calling define-grammar
<dialect>/src/              generated, committed; scanner.c is a two-line shim
<dialect>/test/corpus/      the corpus
<dialect>/test/documents/   whole documents, parsed by every test suite
form_urlencoded/            the form-encoded body language: grammar.js, src/, test/corpus/
expression/                 the expression language, what a placeholder holds: grammar.js, src/, test/corpus/
queries/<grammar>/          highlights.scm, and for a dialect injections.scm, standard capture names
bindings/swift/             the Swift package
bindings/web/               the npm package tree-sitter-http-web
web/                        the guide (web/README.md)
```

Edit the grammar, the scanner, the corpus, the queries, and the bindings. Never edit `src/parser.c`, `src/grammar.json`, `src/node-types.json`, or `src/tree_sitter/*.h`: `tree-sitter generate` rewrites them, and they are always committed. Every `version` field stays `0.0.0`; the tag stamps them.

## The wire dialect

`http_message` is `define-grammar(true)`. It switches off:

- **Placeholders** — `target` and `value` are plain text; `{` and `}` are ordinary octets.
- **File-format items** — no `comment`, `directive`, `declaration`, `separator`/`region`. The items are request, response, blank.
- **Implied GET** — the request line requires a method; an unknown first word is an error.
- **Target continuations and `#` lines in header blocks** — both are `plain`.
- **Body termination and typing** — a body runs to EOF as one opaque `body` node; no `###`, blank line, or `HTTP/` status line ends it, and its trailing blank lines are its octets. Its language is what its first line reveals — `{` or `[`, `key=`, a doctype — then what the message's own Content-Type declares, then the `<` that only a header could have made HTML, and last the wire grammar itself, tentatively, in that order in `queries/http_message/injections.scm`. The file dialect types a body from its first line (`json_body`, `xml_body`, `form_body`, `file_body`, `raw_body`) and reads placeholders inside it; `queries/http/injections.scm` routes by that type — the header does not overrule what the text reveals — and a `raw_body` goes to `http_message` when the message declares `message/http`, is left alone when the header names a language the text did not bear out, and otherwise goes to `http` itself, tentatively. A tentative handoff (`#set! injection.tentative`) is the painter's to keep or decline: kept when the range parses clean, declined — nothing painted, the errors the guess's own — when it does not, which is how a `.http` document inside a request is read by the grammar that reads the file, recursively, and a body that is not one stays as it is. In the file dialect a body keeps its blank lines and ends at the last of them before `###`, EOF, or a status line at the margin — the response — on either side of an exchange; the scanner's `_body_blank` reads past a blank run to decide whether the body goes on.

Each switch is a corpus case under `http_message/test/corpus/`, and the guide computes the rule-by-rule diff between the two generated grammars.

## Changing the grammar

```bash
npm ci
npm run generate                  # every grammar: tree-sitter generate --abi 14
npm test                          # every corpus
swift test                        # loads every grammar, compiles every query, parses every document
npm run build && npm run check    # the web package and the guide, with their checks
```

`tree-sitter parse file.http` from the repo root uses `http`; from a dialect directory, that dialect. From `http/`, `tree-sitter query ../queries/http/highlights.scm <file>` runs a query.

The loop: edit `common/define-grammar.js`, add a corpus case in each dialect the change touches, `generate`, `test` (the new case fails), `test --update`, then read the recorded tree and fix until it is the tree you meant. `--update` will happily record a regression; review the diff. A document under `test/documents/` whose name contains `error` is expected to fail; every other one must parse clean.

Whitespace is structure: there are no `extras`, and every space, blank line and line end is a token, under one rule. `_ws` is the whitespace between two tokens on a line, hidden; `_eol` ends the line and owns the whitespace before it; a visible token never begins or ends with whitespace, so a consumer takes a node's text and trims nothing — `web/check.js` holds every document and corpus input to that. Every line-shaped rule ends in `$._eol`, an external token, a newline or zero-width at EOF. (Matching `"\0"` from the grammar looks like it works in one code path and not another; don't.) Most grammar bugs are a line lexing as the wrong kind. `PREC` at the top of `define-grammar.js` is the ladder that decides it; read its comments before touching a number. The guide's lex step lists, for the token under the caret, every token that was valid there and which won. The request, response and body rules are `prec.right` so a trailing comment, blank line or brace-led line attaches to them.

A placeholder is the one thing the grammar cannot decide from the token in front of it: whether a `{{` opens one depends on a `}}` further along the line. A placeholder never contains a brace, so the scanner's `placeholder` token looks along the line as far as the first brace and is the whole `{{…}}` only when that brace is the `}}`. A `{{` it declines is the grammar's own `{{` token, text like any other brace, so an unclosed `{{`, stray closers and openers, and braces around a placeholder are all error-free, and the corpus has cases for each. The look stops at the first brace, which is what keeps a line of braces linear. What the token holds — a reference and its path, or a call of a builtin with its arguments — is the `expression` grammar's, reached by injection with the braces included, where whitespace is trivia and the syntax can grow without touching the line grammar. The file sees a placeholder; the placeholder holds an expression.

Node names are what the thing is called, not this grammar's shapes. The format's own words come first: a `###` and everything up to the next one is a `region` and the `###` line a `separator` with a `title`; `@name = value` is a `declaration`, `# @name arg` a `directive`, `{{name}}` a `placeholder` holding an expression. Where the format has no word, HTTP's stands: a request line is a `method`, a `target` and a `version`, resumed by a `continuation`; a header is a `header_name` and a `value`, continued by a `fold`; a status line is a `status_code` and a `reason_phrase`, RFC 9112's spelling. A text leaf is named for what stands there, not for its parent: `target` holds `url_text` because the request-target is host and path together, while what is written in that position is only ever a URL. `plain`, an unindented colon-less line in a header block, is the one node neither has a word for.

Those names are the contract with every consumer's queries. `src/node-types.json` is the vocabulary, and its fields (`method:`, `target:`, `version:`, `name:`, `value:`, `argument:`, `status:`, `reason:`, `body:`, `path:`, `title:`) are what queries should bind; underscore rules never appear in a tree. After a grammar change, recompile each consumer's queries against the grammar: a removed node type fails there and nowhere else. Real `.http` files are the second corpus, and where a precedence change shows up:

```bash
for f in $(find <dir> -name '*.http'); do
  printf '%s  errors=%s\n' "$f" "$(tree-sitter parse "$f" | grep -c -E '\(ERROR|MISSING')"
done
```

## The Swift package

One product, `TreeSitterHttp`: the two dialects, their queries, and the grammars the queries inject.

```swift
public struct Grammar: @unchecked Sendable {
    public let name: String            // http, http_message, json, xml, html, form_urlencoded, expression
    public let language: OpaquePointer // the TSLanguage
    public let highlights: String
    public let injections: String?
}

public enum TreeSitterHttp {
    public static let file: Grammar
    public static let message: Grammar
    public static let json: Grammar
    public static let xml: Grammar
    public static let html: Grammar
    public static let formUrlencoded: Grammar
    public static let expression: Grammar
    public static let all: [Grammar]
    public static func grammar(named name: String) -> Grammar?
}
```

`grammar(named:)` resolves the names the injection queries use. A new body language from another package is one dependency in `Package.swift`, one static here, a pattern in each injection query, and a matching devDependency in `bindings/web/package.json` and `web/package.json`; the Swift and npm pins must name the same grammar tags, and the web build refuses to run until they do. One of this repository's own, like `form_urlencoded`, is a grammar directory, an entry in `tree-sitter.json` with a highlight query and no injection query — that absence is what makes it a body language rather than a dialect to every build here — a C source in the Swift target, and a static. No runtime is linked, so the package builds anywhere SPM does; the tests bring SwiftTreeSitter.

## Releasing

A release is a tag, and the tag is the version: `git tag <version> && git push --tags`. `publish.yml` runs `swift test`, stamps the version into `tree-sitter.json` and every `package.json`, checks the web package's release, and publishes both npm packages with provenance under trusted publishing. `ci.yml` runs on every push: `src/` matches what the grammar generates, the corpus passes, both builds and both checks pass. `pages.yml` deploys the guide from `main`.

Building here needs node ≥ 22 (`npm ci` fetches the pinned tree-sitter CLI 0.25.10; `allowScripts` names it so its install script runs) and, for the web package only, emscripten 4.0.4 through emsdk at `~/emsdk` or `EMSDK_ROOT`. The build refuses any other emcc.

## Things that bit once

- Two tokens at the same precedence that can match the same text tie, and the tie-break depends on parse state. Make them structurally different: `plain` consumes its newline, so it is longer on a colon-less line and impossible on a header line.
- A body line must outrank a comment prefix, or `# …` inside a body ends it. In the wire dialect it must also outrank the status line, or `HTTP/1.1 200` inside a body ends it.
- Inside a header block, `header_name` must outrank target text, or every header becomes an implied-GET request.
- SPM refuses two resources with one basename in a target, so the queries are copied as a directory.
- Both SPM targets sit at the root, so a new root-level file goes into `Package.swift`'s `unrelated` list or the build warns.
- An external token bypasses lexical precedence: the scanner is asked first, and what it returns is taken. The scanner's `{{` is safe only because every position a `{{` may stand in accepts a placeholder — a body line does, since it reads them — so the parser, not the lexer, chooses between a body and a request. The one shape that does not hold for is a header whose name is a placeholder, which the scanner would open as a request.
- Reading `{{` as two `{` tokens and forking the parse at each was tried first. It read every case right and was quadratic in a line of braces: each fork's failing version lived on through error recovery. The scanner is linear because a placeholder cannot contain a brace.
- A scanner that has advanced and then declines must return false itself. Falling through to the line-end check with the lexer standing at the newline returned an `_eol` whose end was marked after the `{{`, and every unclosed `{{` swallowed the rest of its line.
- A rule never puts a `_ws` in front of its `_eol`. The lexer runs a line's end in a state it shares with a line's start, where `_blank` is valid and outlasts `_ws` on `  \n`, so the `_ws` was lexed as a `_blank` the rule could not take — which is how trailing spaces after a version left a missing line end. The scanner's `_eol` takes the spaces before it instead. A method with no target, an indented request line and a `@` that declares nothing are errors on purpose, and the corpus says so.
- The CLI caches each compiled parser by grammar name, not by checkout, and rebuilds only when the sources are newer than the cache. Parsing from a second checkout of this repository — the sweep below, against `main` — leaves the cache holding that checkout's grammar, and every `tree-sitter parse` afterwards runs it. `tree-sitter parse --rebuild` once, in the checkout you mean, before trusting a tree.
- Cutting a placeholder out of an injected range, rather than masking it, leaves the language a hole: `"count": {{n}}` became `"count": ,` to tree-sitter-json and its recovery painted the whole object as an error. The painter masks with digits and stops its strokes at the mask.

## What the grammar is written to

The format is documented at [http-files.org](https://http-files.org). This repository documents the grammar, not the format: the rules are `common/define-grammar.js`, the output is each dialect's `src/node-types.json`, and the pin is the corpus. When the engine's rule and this grammar disagree, the engine's rule wins and a corpus case records it.
