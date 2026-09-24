# Contributing to tree-sitter-http

This file is for anyone changing this repository, whether a person or an automated agent. It is written to be followed literally. The rules are stated as things a reviewer or CI can check, and each rule gives its reason, so you can tell when a case falls outside it.

For how to consume the grammars and set up a development environment, see [README.md](README.md). This file assumes you have run `npm ci` and can run `npm test`.

## Contents

- [Rules](#rules)
- [Layout](#layout)
- [Making a grammar change](#making-a-grammar-change)
- [How the grammar works](#how-the-grammar-works)
- [Queries](#queries)
- [The Swift binding](#the-swift-binding)
- [The web binding and the guide](#the-web-binding-and-the-guide)
- [Adding a body language](#adding-a-body-language)
- [What CI checks](#what-ci-checks)
- [Things that bit once](#things-that-bit-once)
- [Reporting a bug or asking for a feature](#reporting-a-bug-or-asking-for-a-feature)
- [Pull requests](#pull-requests)
- [Releasing](#releasing)

## Rules

1. **Never edit generated files by hand.** These are `<grammar>/src/parser.c`, `src/grammar.json`, `src/node-types.json` and `src/tree_sitter/*.h`. `npm run generate` rewrites them, they are always committed, and CI fails if they differ from what the grammar generates. Edit `common/define-grammar.js`, `common/scanner.h`, a grammar's `grammar.js`, the corpus, the queries or the bindings.
2. **Generate at ABI 14**, which `npm run generate` does. Never run a bare `tree-sitter generate`; it emits ABI 15, which SwiftTreeSitter, SyntaxKit and Nova cannot load.
3. **Every behavior change starts as a corpus case that fails.** A bug fix adds the case that reproduces the bug. A feature adds the cases that define it. If the change touches both dialects, add a case in each.
4. **Read every tree `--update` records.** `tree-sitter test --update` will record a regression as readily as a fix. The recorded tree has to be the one you meant, and the diff to existing cases has to be only the changes you intended.
5. **Treat node types as a public API.** Consumers' queries bind to the node names and fields in `src/node-types.json`. Adding a node type or field is compatible. Removing or renaming one is breaking: the PR title starts with `breaking:` and the description lists every name that went away. Check with `git diff -- '*/src/node-types.json'`.
6. **Keep every `version` field at `0.0.0`.** The release tag stamps the version into `tree-sitter.json` and every `package.json`. Never bump one by hand.
7. **Keep the Swift and npm pins of upstream grammars in step.** tree-sitter-json, tree-sitter-xml and tree-sitter-html are pinned in `Package.swift`/`Package.resolved`, `bindings/web/package.json` and `web/package.json`. The web build refuses to run while they disagree.
8. **List every new root-level file or directory in `Package.swift`'s `unrelated` array.** Both SPM targets sit at the repository root, so anything there that isn't theirs makes SPM warn.
9. **Run all the checks before pushing:** `npm run generate`, `npm test`, `swift test` (on macOS, or leave it to CI), and `npm run build && npm run check`. Each proves something different; see [What CI checks](#what-ci-checks).
10. **Keep a change to one concern.** A grammar fix, a query change and a binding change are three pull requests unless one cannot land without the others.

## Layout

```
common/define-grammar.js    the grammar for both dialects: module.exports = (wire) => grammar({...})
common/scanner.h            the external scanner: _eol, the placeholder, and the lookaheads a token cannot express
http/grammar.js             a one-line shim: define-grammar(false)
http_message/grammar.js     a one-line shim: define-grammar(true)
<dialect>/src/              generated and committed; scanner.c is a two-line shim that includes common/scanner.h
<dialect>/test/corpus/      tree-sitter corpus cases
<dialect>/test/documents/   whole documents, parsed by the Swift tests and the guide's check
form_urlencoded/            the form-encoded body language: grammar.js, src/, test/corpus/
expression/                 the placeholder expression language: grammar.js, src/, test/corpus/
queries/<grammar>/          highlights.scm; injections.scm for the two dialects
bindings/swift/             the Swift package: C target, Swift target, tests
bindings/web/               the npm package tree-sitter-http-web
web/                        the guide at parse.req.to (see web/README.md)
tree-sitter.json            the grammar registry: names, scopes, file types, injection regexes, query paths
Package.swift               the Swift package manifest; both targets are rooted at the repository root
.github/workflows/          ci.yml (every push), pages.yml (main → parse.req.to), publish.yml (tags)
```

## Making a grammar change

The loop:

1. Edit `common/define-grammar.js`, or `common/scanner.h` for a scanner change.
2. Add a corpus case in each dialect the change touches, under `<dialect>/test/corpus/`. The format is the standard tree-sitter one: a `===` header with a name, the input, `---`, and the expected tree.
3. `npm run generate`.
4. `npm test`. The new case should fail and every other case should pass.
5. From the dialect's directory, `npx tree-sitter test --update -i '<case name regex>'` records the new tree. Read it. Fix the grammar until it is the tree you meant.
6. `npm test` again, then the remaining checks from rule 9.

Useful commands, run from a dialect directory (`http/` or `http_message/`):

```bash
npx tree-sitter test -i 'Implied GET'                          # one case, by name regex
npx tree-sitter parse ../path/to/file.http                     # print the tree
npx tree-sitter parse --rebuild ../path/to/file.http           # after using another checkout; see below
npx tree-sitter query ../queries/http/highlights.scm file.http # run a query
npx tree-sitter test -D -i '<name>'                            # log.html with parse graphs (gitignored)
```

From the repository root, `tree-sitter parse` uses the `http` dialect.

**The CLI caches each compiled parser by grammar name, not by checkout.** If you parse with a second checkout of this repository (a worktree on `main`, for example), the cache keeps that checkout's parser. Every `tree-sitter parse` after that runs the wrong grammar until you pass `--rebuild` once, in the checkout you mean.

**Real `.http` files are the second corpus.** A precedence change shows up there before it shows up in the corpus. Before and after a change to the grammar or the `PREC` ladder, count errors over any collection of real files and compare:

```bash
for f in $(find <dir> -name '*.http'); do
  printf '%s  errors=%s\n' "$f" "$(npx tree-sitter parse "$f" | grep -c -E '\(ERROR|MISSING')"
done
```

A file whose count goes up is a regression unless the file was wrong.

**Documents.** `<dialect>/test/documents/*.http` are whole files that both the Swift tests (C parsers) and the guide's check (wasm parsers) parse. A document whose file name contains `error` must parse with errors, and every other document must parse clean. Add one when a behavior is best shown by a whole file rather than a case.

**Most grammar bugs are a line lexing as the wrong kind.** The guide's lex step lists every token that was valid at the caret and says which won and why. Reproduce there first. Run `npm run build`, serve `web/dist/`, and paste the input.

## How the grammar works

### Two dialects from one source

`http_message` is `define-grammar(true)`. Placeholders thread through `target` and `value`, so there is no clean base grammar to extract. Instead, `wire` states exactly which constructs do not exist on the wire. It switches off:

- **Placeholders.** `target` and `value` are plain text, and `{` and `}` are ordinary octets.
- **File-format items.** There is no `comment`, `directive`, `declaration` or `separator`/`region`. The items are request, response and blank.
- **Implied GET.** The request line requires a method, and an unknown first word is an error.
- **Target continuations and `#` lines in header blocks.** Both are `plain`.
- **Body termination.** A body runs to EOF as one opaque `body` node. No `###`, blank line or `HTTP/` status line ends it, and its trailing blank lines are its octets.

Each switch is a corpus case under `http_message/test/corpus/`, and the guide computes the rule-by-rule difference between the two generated grammars.

In the file dialect, a `body` is lines of text with placeholders read inside it. `file_body` (`< path`, naming a file to send) is the one first line the grammar reads. A body keeps its blank lines and ends at the last of them before `###`, EOF, or a status line at the margin (the response). The scanner's `_body_blank` reads past a blank run to decide whether the body goes on.

The comment block at the top of `common/define-grammar.js` states the `.http` rules in full: what starts a message, which methods are bodiless, what continues a target or a value, and what is an error on purpose.

### Whitespace is structure

There are no `extras`. Every space, blank line and line end is a token, under one rule:

- `_ws` is the whitespace between two tokens on a line, and is hidden.
- `_eol` ends the line and owns the whitespace before it. It is an external token: a newline, or zero-width at EOF.
- A visible token never begins or ends with whitespace. `web/check.js` holds every document and corpus input to that.
- Every line-shaped rule ends in `$._eol`. Matching `"\0"` from the grammar looks like it works in one code path and not another, so don't.
- A header's `value` runs on across indented lines. Each line break in it, with the indentation after it, is a `fold` node: exactly the bytes that are not the value's. A value's text is its range with each `fold` cut out and nothing put in its place.

### The precedence ladder

`PREC` at the top of `define-grammar.js` decides which kind of line a line lexes as. Read its comments before changing a number. The request, response and body rules are `prec.right`, so a trailing comment, blank line or brace-led line attaches to them.

### Placeholders

Whether a `{{` opens a placeholder depends on a `}}` further along the line, so it is the one thing the grammar cannot decide from the token in front of it. A placeholder never contains a brace, so the scanner's `placeholder` token looks along the line as far as the first brace and is the whole `{{…}}` only when that brace is the `}}`. A `{{` the scanner declines becomes the grammar's own `{{` token, text like any other brace. That makes an unclosed `{{`, stray closers and openers, and braces around a placeholder all error-free, and the corpus has cases for each. Stopping the look at the first brace keeps a line of braces linear.

What a placeholder holds (a reference and its path, or a builtin call with its arguments) belongs to the `expression` grammar, reached by injection with the braces included. There, whitespace is trivia, and the syntax can grow without touching the line grammar.

### Bodies and injection

Neither dialect types a body. The injection query finds its language, by one rule in both dialects:

- A message that declares a `Content-Type` has said what its body is. A media type the query knows (json, xml, html, form-urlencoded, `message/http`) is a directive: the body goes to that grammar and its text is not consulted. A media type the query does not know names nothing.
- A message that declares no `Content-Type` is sniffed: its body's first line is read for the same languages and no others.

The message holds its `Content-Type` header in the field `content_type`, decided by the scanner's zero-width `_content_type_start`. "Declares none" is therefore `!content_type`, and no two patterns claim one body. The file dialect's sniff differs from the wire's where the format does: a `{{` opens a placeholder, not JSON, and `<@` is not a tag.

### Naming nodes

A node is named for what the thing is called, not for this grammar's shapes.

- **The format's own words come first.** A `###` and everything up to the next one is a `region`, and the `###` line is a `separator` with a `title`. `@name = value` is a `declaration`, `# @name arg` is a `directive`, and `{{name}}` is a `placeholder` holding an expression.
- **Where the format has no word, HTTP's stands.** A request line is a `method`, a `target` and a `version`, resumed by a `continuation`. A header is a `header_name` and a `value`. A status line is a `status_code` and a `reason_phrase`, in RFC 9112's spelling.
- **A text leaf is named for what stands there, not for its parent.** `target` holds `url_text`, because while the request-target is host and path together, what is written in that position is only ever a URL.
- `plain`, an unindented colon-less line in a header block, is the one node neither vocabulary has a word for.

A new node follows the same order. Renaming an existing one is breaking (rule 5).

### What the grammar is written to

The format is documented at [http-files.org](https://http-files.org). This repository documents the grammar, not the format. The rules are `common/define-grammar.js`, the output is each dialect's `src/node-types.json`, and the corpus pins the behavior. Where the rule the format's tooling follows and this grammar disagree, the tooling's rule wins, and a corpus case records it.

## Queries

`queries/<grammar>/highlights.scm` uses standard capture names. `injections.scm` exists only for the two dialects. A grammar in `tree-sitter.json` with a highlight query and no injection query is, to every build here, a body language rather than a dialect.

- `swift test` compiles every query against its grammar, so an unknown node name fails there.
- The guide's check requires that every capture name any loaded highlight query can produce has a CSS rule.
- Media types are case-insensitive, and the tree-sitter CLI, web-tree-sitter and SwiftTreeSitter disagree on regex flags. So the injection patterns spell case out (`[Mm][Ee]…`) instead of using a flag.
- A wildcard `_` does not honor a negated field. Put `!content_type` on a named node.

## The Swift binding

One product, `TreeSitterHttp`, with two targets:

- `CTreeSitterHttp` compiles every `parser.c` and `scanner.c`. Its public header is `bindings/swift/CTreeSitterHttp/tree-sitter-http.h`.
- `TreeSitterHttp` is `bindings/swift/TreeSitterHttp/TreeSitterHttp.swift`. It pairs each `TSLanguage` with its query text and re-exports the C target. The queries ship as a copied `queries/` directory, because SPM refuses two resources with one basename in a target.

No tree-sitter runtime is linked, so the package builds anywhere SPM does. The tests bring SwiftTreeSitter to load the grammars. They check that every query compiles, that every injection name has a grammar, and that every document parses as its name promises.

The upstream grammars are lower bounds (`from:`), not exact pins, because an exact pin cannot be resolved for a consumer that also depends on one of them. What holds the node names they expose is `Package.resolved` for this repository's builds, plus `swift test` compiling the queries against whatever resolved.

Consumer-facing documentation is [bindings/swift/README.md](bindings/swift/README.md). Update it when the public API changes.

## The web binding and the guide

`bindings/web/` is the npm package `tree-sitter-http-web`: every grammar compiled to wasm, `painter.js` (per-character capture classes and the injection tree), `index.js` (`ready`, `highlight`, `CSS`), `element.js` (`<http-file>`) and `grammars.js` (wasm and query URLs). `make/build.js` builds `dist/` with emscripten 4.0.4, and `make/release.js` checks the release: every asset built and named, and the tarball carrying it all. Its README is the npm package's README, so it is written for consumers.

The painter hands a body to its language with placeholders masked by digits, not cut out. Cutting a placeholder out left the language a hole: `"count": {{n}}` became `"count": ,` to tree-sitter-json, and its recovery painted the whole object as an error. With a mask, a `{{n}}` in value position is a number to the JSON grammar, and the painter stops its strokes at the mask.

`web/` is the guide at parse.req.to. It states no fact of its own: every table is read from this repository's files at load time, and it parses and paints only through the npm package, imported by its public name. A broken package is therefore a broken guide, and `npm run check` catches both. [web/README.md](web/README.md) explains its structure.

## Adding a body language

**From another package** (as json, xml and html are):

1. Add a dependency in `Package.swift`. In `TreeSitterHttp.swift`, add a static `Grammar`, list it in `all`, and add a case to `grammar(named:)`.
2. Add a pattern to each dialect's `injections.scm`, for both the declared `Content-Type` and the sniff.
3. Add a devDependency, at the same version, in `bindings/web/package.json` and `web/package.json`. The Swift and npm pins must name the same grammar tag.

**One of this repository's own** (as `form_urlencoded` is):

1. Add a grammar directory with `grammar.js`, generated `src/` and `test/corpus/`, and add its `generate` and `test` steps to the root `package.json` scripts.
2. Add an entry in `tree-sitter.json` with a highlight query and no injection query.
3. Add its `parser.c` to the C target's `sources` in `Package.swift` (and its non-source files to that target's `exclude`), plus a static in `TreeSitterHttp.swift`, listed in `all` and in `grammar(named:)`.
4. Add injection patterns, as above.

## What CI checks

`ci.yml` runs on every push and pull request:

| Step | What it proves |
|---|---|
| `swift test` (macOS) | Every grammar loads under the Swift runtime, every query compiles, every injection name resolves, every document parses as named |
| `npm run generate` + clean `git status` | `src/` is what the committed grammar generates |
| `npm test` | Every corpus case in every grammar passes |
| `npm run build` | The web package and the guide build, with the pinned emscripten |
| `npm run check` | The web package's release check, and the guide's check: the page's code run under node against the built site, every document through the wasm grammars, and the page's paint identical to `highlight()` |

`pages.yml` deploys the guide from `main`. `publish.yml` runs on a version tag; see [Releasing](#releasing).

A red check is never a flake to re-run until it passes. Find the cause.

## Things that bit once

Each of these cost real debugging. Check a change against them.

- **Precedence ties.** Two tokens at the same precedence that can match the same text tie, and the tie-break depends on parse state. Make them structurally different: `plain` consumes its newline, so it is longer on a colon-less line and impossible on a header line.
- **Body lines against other line kinds.** A body line must outrank a comment prefix, or `# …` inside a body ends it. In the wire dialect it must also outrank the status line, or `HTTP/1.1 200` inside a body ends it.
- **Header names against target text.** Inside a header block, `header_name` must outrank target text, or every header becomes an implied-GET request.
- **External tokens bypass lexical precedence.** The scanner is asked first, and what it returns is taken. The scanner's `{{` is safe only because every position a `{{` may stand in accepts a placeholder (a body line does, since it reads them), so the parser, not the lexer, chooses between a body and a request. The one shape where that does not hold is a header whose name is a placeholder, which the scanner would open as a request.
- **Forking on `{{` is quadratic.** Reading `{{` as two `{` tokens and forking the parse at each read every case right, but was quadratic on a line of braces, because each fork's failing version lived on through error recovery. The scanner is linear because a placeholder cannot contain a brace.
- **A scanner that has advanced and then declines must return false itself.** Falling through to the line-end check with the lexer standing at the newline returned an `_eol` whose end was marked after the `{{`, and every unclosed `{{` swallowed the rest of its line.
- **Never put a `_ws` in front of an `_eol`.** The lexer runs a line's end in a state it shares with a line's start, where `_blank` is valid and outlasts `_ws` on `  \n`. The `_ws` was lexed as a `_blank` the rule could not take, which is how trailing spaces after a version left a missing line end. The scanner's `_eol` takes the spaces before it instead. A method with no target, an indented request line, and a `@` that declares nothing are errors on purpose, and the corpus says so.
- **The CLI's parser cache is keyed by grammar name.** See [Making a grammar change](#making-a-grammar-change).
- **SPM resource names.** SPM refuses two resources with one basename in a target, so the queries are copied as a directory.
- **Root-level files.** Both SPM targets sit at the root, so a new root-level file goes into `Package.swift`'s `unrelated` list or the build warns.
- **Placeholders cut out of injected ranges.** See [The web binding and the guide](#the-web-binding-and-the-guide).

Add an entry here when something costs you an afternoon.

## Reporting a bug or asking for a feature

Open an issue at [github.com/x-amz/tree-sitter-http/issues](https://github.com/x-amz/tree-sitter-http/issues). A parse bug is fixable fastest with:

- **The input**: the smallest text that shows the problem, in a fenced block. Whitespace matters to this grammar, so keep it exact. Say if there are tabs, trailing spaces or CRLF line endings.
- **The dialect**: `http` (a `.http` file) or `http_message` (wire octets).
- **What you expected**: the tree, the highlight or the injection you expected, and why. A link to the format's rule, or to how an `.http` client runs the file, settles most questions.
- **What you got**: `tree-sitter parse` output, or a description from the guide at [parse.req.to](https://parse.req.to).
- **Where you found it**: the binding and version (Swift, `tree-sitter-http-web`, a C build), and the consuming project if it is public.

If you depend on this grammar from another project and an upgrade broke you, say which node types or fields your queries bind. That separates a regression from an intended breaking change.

## Pull requests

- Branch from `main`, and keep one concern per pull request (rule 10).
- Include the corpus cases that fail before and pass after (rule 3).
- In the description, say what changed in the trees, not only in the code. If any `src/node-types.json` changed, list the added and removed names. Start the title with `breaking:` if anything was removed or renamed (rule 5).
- Include the regenerated `src/` in the same commit as the grammar change that produced it.
- CI must be green. A pull request that changes a grammar should also say whether the real-file error counts moved, and which files.

## Releasing

A release is a tag, and the tag is the version:

```bash
git tag <major>.<minor>.<patch> && git push origin <major>.<minor>.<patch>
```

`publish.yml` then:

1. Runs `swift test` on macOS. The tag is also the Swift package, and nothing on the npm side builds Swift.
2. Runs `npm test`, builds the web package, and runs `bindings/web/make/release.js <tag>`, which stamps the version into `tree-sitter.json` and every `package.json` and checks the release.
3. Packs both npm packages and creates the GitHub release with both tarballs attached.
4. Publishes `tree-sitter-http` and `tree-sitter-http-web` to npm with provenance, under trusted publishing. The workflow's OIDC token is the credential, and no npm token is stored in the repository.

While the version is `0.x`, a breaking change (rule 5) bumps the minor version, and everything else bumps the patch.
