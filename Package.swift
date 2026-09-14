// swift-tools-version:5.9
import PackageDescription

// One product. `TreeSitterHttp` is the two dialects, their queries, and the
// grammars their queries inject — three from other packages, and the
// form-encoded one from this repository — with the parsers themselves in
// the C target beneath it, which it re-exports.
// Both targets sit at the repo root, so each must exclude what is not its
// own or SPM warns about unhandled files. A new root-level file goes here.
let unrelated = ["common", "web", "bindings/web", "node_modules", ".github", "README.md", "LICENSE", "tree-sitter.json", "package.json", "package-lock.json", "bindings/swift/TreeSitterHttpTests"]

let package = Package(
    name: "tree-sitter-http",
    products: [
        .library(name: "TreeSitterHttp", targets: ["TreeSitterHttp"]),
    ],
    dependencies: [
        // The body languages the queries name. A lower bound, not an exact
        // pin: an exact one is unresolvable for a consumer that also depends
        // on either. What holds the node names — a grammar's query contract —
        // is Package.resolved for this repo's own builds, the web package's
        // manifest, which its build refuses to disagree with, and `swift
        // test`, which compiles every query against whatever resolved.
        .package(url: "https://github.com/tree-sitter/tree-sitter-json", from: "0.24.8"),
        .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-xml", from: "0.7.0"),
        .package(url: "https://github.com/tree-sitter/tree-sitter-html", from: "0.23.2"),
        // Tests only: a runtime to load the grammars and compile the queries.
        .package(url: "https://github.com/tree-sitter/swift-tree-sitter", from: "0.9.0"),
    ],
    targets: [
        .target(
            name: "CTreeSitterHttp",
            path: ".",
            exclude: unrelated + [
                "queries", "bindings/swift/TreeSitterHttp",
                "http/grammar.js", "http/test",
                "http/src/grammar.json", "http/src/node-types.json",
                "http_message/grammar.js", "http_message/test",
                "http_message/src/grammar.json", "http_message/src/node-types.json",
                "form_urlencoded/grammar.js", "form_urlencoded/test",
                "form_urlencoded/src/grammar.json", "form_urlencoded/src/node-types.json",
                "expression/grammar.js", "expression/test",
                "expression/src/grammar.json", "expression/src/node-types.json",
            ],
            sources: [
                "http/src/parser.c",
                "http/src/scanner.c",
                "http_message/src/parser.c",
                "http_message/src/scanner.c",
                "form_urlencoded/src/parser.c",
                "expression/src/parser.c",
            ],
            publicHeadersPath: "bindings/swift/CTreeSitterHttp",
            cSettings: [
                .headerSearchPath("http/src"),
                .headerSearchPath("http_message/src"),
                .headerSearchPath("form_urlencoded/src"),
                .headerSearchPath("expression/src"),
            ]
        ),
        .target(
            name: "TreeSitterHttp",
            dependencies: [
                "CTreeSitterHttp",
                .product(name: "TreeSitterJSON", package: "tree-sitter-json"),
                .product(name: "TreeSitterXML", package: "tree-sitter-xml"),
                .product(name: "TreeSitterHTML", package: "tree-sitter-html"),
            ],
            path: ".",
            exclude: unrelated + ["http", "http_message", "form_urlencoded", "expression", "bindings/swift/CTreeSitterHttp"],
            sources: ["bindings/swift/TreeSitterHttp"],
            resources: [.copy("queries")]
        ),
        .testTarget(
            name: "TreeSitterHttpTests",
            dependencies: [
                "TreeSitterHttp",
                .product(name: "SwiftTreeSitter", package: "swift-tree-sitter"),
            ],
            path: "bindings/swift/TreeSitterHttpTests"
        ),
    ],
    cLanguageStandard: .c11
)
