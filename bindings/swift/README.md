# TreeSitterHttp for Swift

A Swift package for the tree-sitter-http grammars. It contains the `.http` file dialect and the `message/http` wire dialect, their highlight and injection queries, and every grammar those queries hand a body or placeholder to: JSON, XML, HTML, form-urlencoded and the placeholder expression language.

## Installing

Add the repository by tag. Every release tag is a package version.

```swift
.package(url: "https://github.com/x-amz/tree-sitter-http", from: "<version>"),
```

```swift
.product(name: "TreeSitterHttp", package: "tree-sitter-http"),
```

The package links no tree-sitter runtime, so it builds anywhere SPM does. Bring your own runtime, such as [SwiftTreeSitter](https://github.com/tree-sitter/swift-tree-sitter) or SyntaxKit. The parsers are generated at ABI 14, which both load.

## API

```swift
public struct Grammar: @unchecked Sendable {
    public let name: String            // http, http_message, json, xml, html, form_urlencoded, expression
    public let language: OpaquePointer // the TSLanguage; immutable, safe to share across threads
    public let highlights: String      // highlights.scm, standard capture names
    public let injections: String?     // injections.scm, for the grammars that host other languages
}

public enum TreeSitterHttp {
    public static let file: Grammar            // .http files
    public static let message: Grammar         // raw message/http octets
    public static let json: Grammar
    public static let xml: Grammar
    public static let html: Grammar            // shipped without its own injection query
    public static let formUrlencoded: Grammar
    public static let expression: Grammar      // what a {{placeholder}} holds
    public static let all: [Grammar]
    public static func grammar(named name: String) -> Grammar?
}
```

The C entry points (`tree_sitter_http()`, `tree_sitter_http_message()`, and so on) are re-exported from the `CTreeSitterHttp` target.

`grammar(named:)` resolves every name the injection queries produce. When your highlighter meets an `injection.language` capture, look the name up here. A `nil` result means the query named a language this package does not carry.

## Example

With SwiftTreeSitter:

```swift
import SwiftTreeSitter
import TreeSitterHttp

let grammar = TreeSitterHttp.file
let parser = Parser()
try parser.setLanguage(grammar.language)
let tree = parser.parse("GET https://example.org/\nAccept: application/json\n")

let language = Language(grammar.language)
let highlights = try Query(language: language, data: Data(grammar.highlights.utf8))
let injections = try grammar.injections.map { try Query(language: language, data: Data($0.utf8)) }
```

## Queries and node types

The node names and fields in each dialect's `src/node-types.json` are the contract your own queries bind to. Removing or renaming one is a breaking change, marked as such in the release. After you upgrade, compile your queries against the new grammar; a removed node type fails there and nowhere else. The root [README](../../README.md#node-types-are-the-contract) lists the fields to bind.

## Contributing

The package's sources are `CTreeSitterHttp/` (the public C header), `TreeSitterHttp/` (the Swift API) and `TreeSitterHttpTests/`. `Package.swift` is at the repository root. See [CONTRIBUTING.md](../../CONTRIBUTING.md#the-swift-binding).
