// The two dialects, their queries, and the grammars the queries inject.
//
// A `Grammar` is what a highlighter needs to run one language: the
// `TSLanguage` and its query text. The dialects' queries are this package's
// `queries/` directory, shipped in its resource bundle. JSON's and XML's are
// their own packages', read from the bundles SPM builds for them. No runtime
// is linked: a parser is data, and whoever runs it brings tree-sitter.

@_exported import CTreeSitterHttp
import Foundation
import TreeSitterJSON
import TreeSitterXML

// `@unchecked`: a `TSLanguage` is a constant in the generated object file, and the
// runtime documents it as safe to share across threads.
public struct Grammar: @unchecked Sendable {
    /// The tree-sitter name — the spelling an `injection.language` value uses.
    public let name: String
    /// The `TSLanguage`. Immutable, and safe to share across threads.
    public let language: OpaquePointer
    /// `highlights.scm`, standard capture names.
    public let highlights: String
    /// `injections.scm`, when the grammar hosts other languages.
    public let injections: String?
}

public enum TreeSitterHttp {
    /// The `.http` file format.
    public static let file = Grammar(
        name: "http", language: tree_sitter_http(),
        queries: .module, directory: "queries/http")

    /// A raw `message/http` wire message.
    public static let message = Grammar(
        name: "http_message", language: tree_sitter_http_message(),
        queries: .module, directory: "queries/http_message")

    /// tree-sitter-json, the language of a `json_body`.
    public static let json = Grammar(
        name: "json", language: tree_sitter_json(),
        queries: .dependency("TreeSitterJSON_TreeSitterJSON"), directory: "queries")

    /// tree-sitter-xml, the language of an `xml_body`.
    public static let xml = Grammar(
        name: "xml", language: tree_sitter_xml(),
        queries: .dependency("TreeSitterXML_TreeSitterXML"), directory: "xml")

    public static let all: [Grammar] = [file, message, json, xml]

    /// The grammar an `injection.language` value names. Both dialects'
    /// injection queries name grammars outright — on the wire, the media-type
    /// patterns are in the query — so every consumer does this one lookup.
    public static func grammar(named name: String) -> Grammar? {
        switch name {
        case "http": return file
        case "http_message": return message
        case "json": return json
        case "xml": return xml
        default: return nil
        }
    }
}

extension Grammar {
    fileprivate init(name: String, language: OpaquePointer, queries bundle: Bundle, directory: String) {
        guard let highlights = bundle.query("highlights", in: directory) else {
            fatalError("TreeSitterHttp: \(directory)/highlights.scm missing from \(bundle.bundleURL.path)")
        }
        self.name = name
        self.language = language
        self.highlights = highlights
        self.injections = bundle.query("injections", in: directory)
    }
}

extension Bundle {
    /// The resource bundle SPM builds for a dependency's target, found where
    /// each layout puts package bundles: beside this package's own bundle
    /// (`swift build`'s products directory), the main bundle's resources and
    /// root (an app built by Xcode), and beside every loaded bundle (a test
    /// host). A missing bundle is a packaging error and stops here, the way
    /// `Bundle.module` does.
    fileprivate static func dependency(_ name: String) -> Bundle {
        let file = "\(name).bundle"
        var directories = [Bundle.module.bundleURL.deletingLastPathComponent()]
        if let resources = Bundle.main.resourceURL { directories.append(resources) }
        directories.append(Bundle.main.bundleURL)
        directories += Bundle.allBundles.map { $0.bundleURL.deletingLastPathComponent() }
        for directory in directories {
            if let bundle = Bundle(url: directory.appendingPathComponent(file, isDirectory: true)) {
                return bundle
            }
        }
        fatalError("TreeSitterHttp: \(file) not found in \(directories.map(\.path))")
    }

    fileprivate func query(_ file: String, in directory: String) -> String? {
        guard let url = url(forResource: file, withExtension: "scm", subdirectory: directory),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}
