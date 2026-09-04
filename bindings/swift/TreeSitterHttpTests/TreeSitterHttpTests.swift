import Foundation
import SwiftTreeSitter
import TreeSitterHttp
import Testing

/// A document the whole repository parses: `<dialect>/test/documents/*.http`.
/// The guide's `npm run check` runs the same files through the wasm grammars,
/// so a document that parses here and not there is a difference between the
/// two builds of one grammar, not between two sets of files.
struct Document: Sendable, CustomTestStringConvertible {
    let grammar: Grammar
    let file: String
    let text: String

    /// The name says it: `error` in a document's name makes it the parser's
    /// recovery material, and every other one must come back clean.
    var expectsError: Bool { file.contains("error") }

    var testDescription: String { "\(grammar.name)/\(file)" }

    /// Every document in the repository, found from this file's path — the
    /// tests run from a checkout, which is where the documents are. A dialect
    /// with none is a failure of `everyDialectHasDocuments`, not silence here.
    static let all: [Document] = [TreeSitterHttp.file, TreeSitterHttp.message].flatMap { grammar -> [Document] in
        let directory = repository.appending(path: "\(grammar.name)/test/documents")
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return files
            .filter { $0.pathExtension == "http" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .compactMap { url -> Document? in
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
                return Document(grammar: grammar, file: url.lastPathComponent, text: text)
            }
    }

    /// `bindings/swift/TreeSitterHttpTests/` is four levels down from the root.
    private static let repository = URL(filePath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}

@Suite("TreeSitterHttp")
struct TreeSitterHttpTests {
    /// Every grammar loads under the runtime, and its queries compile against
    /// it — an unknown node name in a `.scm` fails here, not in an editor.
    @Test("queries compile", arguments: TreeSitterHttp.all.map(\.name))
    func queriesCompile(_ name: String) throws {
        let grammar = try #require(TreeSitterHttp.grammar(named: name))
        let language = Language(grammar.language)
        _ = try Query(language: language, data: Data(grammar.highlights.utf8))
        if let injections = grammar.injections {
            _ = try Query(language: language, data: Data(injections.utf8))
        }
    }

    /// Both dialects carry documents to parse; an empty directory would make
    /// the parameterized test below vacuous.
    @Test("both dialects have documents")
    func everyDialectHasDocuments() {
        for grammar in [TreeSitterHttp.file, TreeSitterHttp.message] {
            #expect(Document.all.contains { $0.grammar.name == grammar.name },
                    "\(grammar.name)/test/documents is empty")
        }
    }

    /// Every document parses as its name promises: clean, unless the name says
    /// error — those are the parser's error-recovery material.
    @Test("documents parse as their names promise", arguments: Document.all)
    func documentParses(_ document: Document) throws {
        let parser = Parser()
        try parser.setLanguage(document.grammar.language)
        let root = try #require(parser.parse(document.text)?.rootNode)
        #expect(root.hasError == document.expectsError, "\(root.sExpressionString ?? "")")
    }

    /// Every name either dialect's injection query can ask for has a grammar.
    @Test("every injection name has a grammar")
    func everyInjectionNameHasAGrammar() throws {
        let pattern = try NSRegularExpression(pattern: #"#set!\s+injection\.language\s+"([^"]+)""#)
        var names: Set<String> = []
        for grammar in TreeSitterHttp.all {
            guard let injections = grammar.injections else { continue }
            let range = NSRange(injections.startIndex..., in: injections)
            for match in pattern.matches(in: injections, range: range) {
                names.insert(String(injections[Range(match.range(at: 1), in: injections)!]))
            }
        }
        #expect(names == ["http_message", "json", "xml"])
        for name in names {
            #expect(TreeSitterHttp.grammar(named: name) != nil, "\(name)")
        }
        #expect(TreeSitterHttp.grammar(named: "application/json") == nil)
    }
}
