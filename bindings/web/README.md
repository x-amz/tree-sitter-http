# tree-sitter-http-web

The `.http` and `message/http` grammars as wasm, the painter that highlights
them, and an `<http-file>` element that shows or edits one. One import; the
runtime, the grammars and the queries are inside:

```json
"dependencies": { "tree-sitter-http-web": "0.3.0" }
```

```js
import { ready, highlight, CSS } from "tree-sitter-http-web";

await ready();                        // loads the grammars; idempotent
highlight(text)                       // an .http document, as HTML spans in tree-sitter's capture classes
highlight(octets, "http_message")     // raw wire octets
CSS                                   // the rules for those classes, coloured by --ts-* custom properties
```

`highlight` runs under node and in a browser the same way, so a server can
paint a page before it is sent. The output's text content is the input.

```html
<script type="module" src="./node_modules/tree-sitter-http-web/element.js"></script>

<http-file>GET https://example.org/</http-file>          <!-- highlighted -->
<http-file dialect="http_message">…</http-file>          <!-- wire octets -->
<http-file editable id="editor"></http-file>             <!-- an editor -->
```

`<http-file>` paints its text in a shadow root; `editable` lays a
transparent textarea over it, so the caret sits on coloured text. The
element takes `value`, `selectionStart`, `selectionEnd`, `setSelectionRange`,
`scrollTop` and `scrollLeft`, and fires `input` and `select`. The host is the
box: font, colour, border, background, height — and `display` — are its
styles; give it no height and it grows with the text. Stacking the two layers
is a box inside the shadow root, so styling the host cannot take it away.
`--http-file-padding` and `--http-file-selection` are the two knobs inside,
and `::part(box)`, `::part(text)` and `::part(textarea)` reach the three
elements.

With no bundler, map the specifier once:

```html
<script type="importmap">{ "imports": { "tree-sitter-http-web": "./node_modules/tree-sitter-http-web/index.js", "tree-sitter-http-web/element": "./node_modules/tree-sitter-http-web/element.js" } }</script>
```

or load it from a CDN, straight from the registry: `https://cdn.jsdelivr.net/npm/tree-sitter-http-web@0.3.0/element.js`.

Two more entry points for a consumer that wants the parts: `tree-sitter-http-web/grammars`
is the grammars as URLs (`file`, `message`, `json`, `xml`, `html`,
`formUrlencoded`, `all`, `grammar(name)`), and `tree-sitter-http-web/painter`
is the engine (`bundle`, `analyze`, `injectionNames`, `injection`), which
returns per-character capture classes, parse verdicts and the injection tree
rather than HTML. A body is handed to its language with the placeholders the
host grammar found inside it masked by digits, so the JSON grammar never
sees a `{{name}}` and a `{{n}}` in value position is a number to it; the
layer's paint stops at each one.

Built and published from [x-amz/tree-sitter-http](https://github.com/x-amz/tree-sitter-http)
at the tag the version names, with provenance. The grammar itself is the
package `tree-sitter-http`, from the same tag; this package is that grammar
compiled for the web, with json, xml, html and the form-encoded grammar
beside it for the bodies.
