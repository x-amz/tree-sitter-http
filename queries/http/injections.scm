; Body language in the file format. The grammar does not type a body, so
; this query finds its language, by one rule in both dialects
; (queries/http_message/injections.scm is the other):
;
;   - A message that declares a Content-Type has said what its body is. A
;     media type this query knows is a directive — the body goes to that
;     grammar and its text is not consulted — and one it does not know names
;     nothing: the body is left as it is.
;   - A message that declares none is sniffed, its body's first line read
;     for the same languages and no others.
;
; The message holds its Content-Type header in the field `content_type`, so
; "declares none" is `!content_type` — on a named node: a wildcard does not
; honour a negated field — and no two patterns here claim one body. A media type is case-insensitive; the CLI, web-tree-sitter, and
; SwiftTreeSitter disagree on regex flags, so the patterns spell it out.
; A header's value runs on across its indented lines, so the whitespace
; after a media type may hold a line break.
; A `file_body` names a file, not its bytes, and is never injected; and
; where the file format differs from the wire the sniff says so: a `{{`
; opens a placeholder, not JSON, and `<@` is not a tag.

; MARK: What Content-Type declares

; message/http — the echo's answer, or a message on its way to the echo: a
; wire message as a body, on either side of the exchange.
((_
   content_type: (header value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_type "^[Mm][Ee][Ss][Ss][Aa][Gg][Ee]/[Hh][Tt][Tt][Pp][ \\t\\r\\n]*(;|$)")
 (#set! injection.language "http_message"))

; application/json, text/json, and any +json structured-syntax suffix.
((_
   content_type: (header value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_type "^[^ \\t/;]+/([^ \\t;]*[+])?[Jj][Ss][Oo][Nn][ \\t\\r\\n]*(;|$)")
 (#set! injection.language "json"))

; text/html and application/xhtml+xml.
((_
   content_type: (header value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_type "^[^ \\t/;]+/(([^ \\t;]*[+])?[Hh][Tt][Mm][Ll]|[Xx][Hh][Tt][Mm][Ll][+][Xx][Mm][Ll])[ \\t\\r\\n]*(;|$)")
 (#set! injection.language "html"))

; application/xml, text/xml, image/svg+xml, and any +xml suffix but xhtml's.
((_
   content_type: (header value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_type "^[^ \\t/;]+/([^ \\t;]*[+])?[Xx][Mm][Ll][ \\t\\r\\n]*(;|$)")
 (#not-match? @_type "^[^ \\t/;]+/[Xx][Hh][Tt][Mm][Ll][+]")
 (#set! injection.language "xml"))

; application/x-www-form-urlencoded.
((_
   content_type: (header value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_type "^[^ \\t/;]+/[Xx]-[Ww][Ww][Ww]-[Ff][Oo][Rr][Mm]-[Uu][Rr][Ll][Ee][Nn][Cc][Oo][Dd][Ee][Dd][ \\t\\r\\n]*(;|$)")
 (#set! injection.language "form_urlencoded"))

; MARK: What the first line reveals, where nothing was declared

; `[` opens JSON, and so does a `{` that another `{` does not follow.
([
   (request !content_type body: (body) @injection.content)
   (response !content_type body: (body) @injection.content)
 ]
 (#match? @injection.content "^[ \\t]*(\\[|\\{[ \\t]*([^{ \\t]|$))")
 (#set! injection.language "json"))

; `key=` with no space after the `=` opens a form body: `a= b` and `a = b`
; are prose.
([
   (request !content_type body: (body) @injection.content)
   (response !content_type body: (body) @injection.content)
 ]
 (#match? @injection.content "^[ \\t]*[^ \\t\\r\\n=&{}<\\[][^ \\t\\r\\n=&{}]*=([^ \\t]|$)")
 (#set! injection.language "form_urlencoded"))

; A doctype or `<html` opens HTML.
([
   (request !content_type body: (body) @injection.content)
   (response !content_type body: (body) @injection.content)
 ]
 (#match? @injection.content "^[ \\t]*<(![Dd][Oo][Cc][Tt][Yy][Pp][Ee][ \\t]+[Hh][Tt][Mm][Ll]|[Hh][Tt][Mm][Ll])([ \\t\\r\\n>]|$)")
 (#set! injection.language "html"))

; Any other tag opens XML.
([
   (request !content_type body: (body) @injection.content)
   (response !content_type body: (body) @injection.content)
 ]
 (#match? @injection.content "^[ \\t]*<[^ \\t\\r\\n@<{}]")
 (#not-match? @injection.content "^[ \\t]*<(![Dd][Oo][Cc][Tt][Yy][Pp][Ee][ \\t]+[Hh][Tt][Mm][Ll]|[Hh][Tt][Mm][Ll])([ \\t\\r\\n>]|$)")
 (#set! injection.language "xml"))

; MARK: Placeholders

; Every placeholder, braces included, to the expression grammar. A
; placeholder inside a body is masked for the body's language and painted
; by this one.
((placeholder) @injection.content
 (#set! injection.language "expression"))
