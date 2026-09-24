# tree-sitter-http

Tree-sitter grammars for `.http` files and for raw `message/http` wire messages. One grammar source produces two dialects:

- `http` is the file format, written to match how `.http` tooling reads it, so the tree an editor sees and the regions a client runs agree.
- `http_message` is the same grammar with the file-format features switched off: raw request and response octets.

Two smaller grammars sit beside them. `form_urlencoded` parses form-encoded bodies. `expression` parses what a `{{placeholder}}` holds. JSON, XML and HTML bodies are handed to their own upstream grammars, and every binding ships all of them.

The guide at [parse.req.to](https://parse.req.to) is the interactive companion and the debugger: paste any text and follow it through lex, parse, query, paint and inject, all computed from the files in this repository.

The format itself is documented at [http-files.org](https://http-files.org).

## Using the grammars

`src/` is generated and committed, so no consumer needs node or the tree-sitter CLI.

| You are | Take | Details |
|---|---|---|
| An editor or C program | `<dialect>/src/parser.c` and `<dialect>/src/scanner.c` (which includes `common/scanner.h`), compiled into `libtree-sitter-<dialect>`; the entry point is `tree_sitter_<dialect>()` | Nova builds this way from a git tag |
| A Swift package | The SPM product `TreeSitterHttp`, from a git tag | [bindings/swift/README.md](bindings/swift/README.md) |
| A web page or node program | The npm package `tree-sitter-http-web`: the grammars as wasm, a highlighter, and an `<http-file>` element | [bindings/web/README.md](bindings/web/README.md) |
| A tree-sitter toolchain | The npm package `tree-sitter-http`: the grammar sources and queries, packaged the way grammars are (`tree-sitter build --wasm node_modules/tree-sitter-http/http` gives a wasm) | — |

Every release is a git tag, and the tag is the version for all three: SPM resolves it, and both npm packages are published from it with provenance. Each GitHub release also carries both npm tarballs, installable without the registry:

```bash
npm i https://github.com/x-amz/tree-sitter-http/releases/download/<tag>/tree-sitter-http-web-<tag>.tgz
```

### ABI

Parsers are generated at **ABI 14**. The CLI defaults to 15, but SyntaxKit and SwiftTreeSitter load 14, and Nova reports a mismatch in its Extension Console as "incompatible version of the Tree-sitter API".

### Names

| | File dialect | Wire dialect |
|---|---|---|
| Identifier (directory, grammar, C symbol, library, wasm) | `http` | `http_message` |
| Swift | `TreeSitterHttp.file` | `TreeSitterHttp.message` |
| TextMate scope | `source.http` | `source.http-message` |
| File types | `.http`, `.rest` | — |
| Injection names it answers to | `http` | `http_message`, `message/http` |

### Node types are the contract

Each dialect's `src/node-types.json` is the vocabulary your queries bind to. Bind to named nodes and fields: `method:`, `target:`, `version:`, `name:`, `value:`, `argument:`, `status:`, `reason:`, `body:`, `path:`, `title:`. Rules whose names start with `_` never appear in a tree.

Removing or renaming a node type or field is a breaking change, and the release notes call it out. After you upgrade, recompile your queries against the new grammar: a removed node type fails there and nowhere else.

Highlight and injection queries ship in `queries/<grammar>/` with standard capture names. Neither dialect decides a body's language itself; the injection query does, from the `Content-Type` header, or by reading the body's first line when there is none.

## Setting up a development environment

You need:

- **node ≥ 22.** `npm ci` installs the pinned tree-sitter CLI (0.25.10). `allowScripts` in the root `package.json` lets its install script download the binary.
- **Swift 5.9 or later** for `swift test`. macOS is what CI runs.
- **emscripten 4.0.4**, only if you build the web package or the guide. Install it with emsdk at `~/emsdk`, or set `EMSDK_ROOT`. The build refuses any other `emcc` version:

  ```bash
  git clone https://github.com/emscripten-core/emsdk ~/emsdk
  ~/emsdk/emsdk install 4.0.4 && ~/emsdk/emsdk activate 4.0.4
  ```

Then:

```bash
npm ci                            # the CLI and the web toolchain's dependencies
npm run generate                  # every grammar's src/, at ABI 14
npm test                          # every corpus
swift test                        # loads every grammar, compiles every query, parses every document
npm run build && npm run check    # the web package and the guide, with their checks
python3 -m http.server -d web/dist   # serve the guide at http://localhost:8000/
```

On a fresh checkout, `npm run generate` should leave `git status` clean. CI fails if it doesn't.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing anything. It covers how the grammar is built, the rules a change must keep, how to report a bug, and how releases work.

## License

MIT. See [LICENSE](LICENSE).
