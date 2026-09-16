; Body language on the wire: what the body's own first line reveals — the
; openers the .http dialect types a body by — then what the message's
; Content-Type declares, and last this grammar itself. Patterns are tried
; in order and a body keeps the first that claims it, so the text stands
; ahead of the header wherever the text can speak: a label is a claim, the
; octets are the fact, and a body labelled application/octet-stream or
; text/plain is still whatever it is. The header decides what a first line
; leaves open — `<` opens html and xml alike, and only a doctype or `<html`
; settles it from the text — and what neither settled goes to
; `http_message`, tentatively: a body that parses clean as a wire message
; is one, recursively, and one that does not is left as it is. Each pattern
; names a grammar outright, so the media-type table is these patterns, and
; every consumer resolves the name alone — the same lookup the .http
; dialect's query needs. A media type is case-insensitive; the CLI,
; web-tree-sitter, and SwiftTreeSitter disagree on regex flags, so the
; patterns spell it out.

; MARK: What the first line reveals

; `{` or `[` opens JSON.
((body) @injection.content
 (#match? @injection.content "^[ \t]*(\\{|\\[)")
 (#set! injection.language "json"))

; `key=` with no space after the `=` opens a form body, the .http dialect's
; own rule for typing one.
((body) @injection.content
 (#match? @injection.content "^[^ \t\r\n=&{}<\\[][^ \t\r\n=&{}]*=([^ \t]|$)")
 (#set! injection.language "form_urlencoded"))

; A doctype or `<html` opens HTML.
((body) @injection.content
 (#match? @injection.content "^[ \t]*<(![Dd][Oo][Cc][Tt][Yy][Pp][Ee][ \t]+[Hh][Tt][Mm][Ll]|[Hh][Tt][Mm][Ll])([ \t>]|$)")
 (#set! injection.language "html"))

; MARK: What Content-Type declares

; message/http — the echo's answer: a wire message as a body.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]$")
 (#match? @_type "^[Mm][Ee][Ss][Ss][Aa][Gg][Ee]/[Hh][Tt][Tt][Pp][ \t]*(;|$)")
 (#set! injection.language "http_message"))

; application/json, text/json, and any +json structured-syntax suffix.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]$")
 (#match? @_type "^[^ \t/;]+/([^ \t;]*[+])?[Jj][Ss][Oo][Nn][ \t]*(;|$)")
 (#set! injection.language "json"))

; text/html and application/xhtml+xml. Ahead of xml, whose `+xml` suffix
; would otherwise claim xhtml.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]$")
 (#match? @_type "^[^ \t/;]+/(([^ \t;]*[+])?[Hh][Tt][Mm][Ll]|[Xx][Hh][Tt][Mm][Ll][+][Xx][Mm][Ll])[ \t]*(;|$)")
 (#set! injection.language "html"))

; application/xml, text/xml, image/svg+xml, and any +xml suffix.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]$")
 (#match? @_type "^[^ \t/;]+/([^ \t;]*[+])?[Xx][Mm][Ll][ \t]*(;|$)")
 (#set! injection.language "xml"))

; application/x-www-form-urlencoded.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]$")
 (#match? @_type "^[^ \t/;]+/[Xx]-[Ww][Ww][Ww]-[Ff][Oo][Rr][Mm]-[Uu][Rr][Ll][Ee][Nn][Cc][Oo][Dd][Ee][Dd][ \t]*(;|$)")
 (#set! injection.language "form_urlencoded"))

; MARK: What `<` alone reveals

; A `<` that no header and no doctype settled is XML.
((body) @injection.content
 (#match? @injection.content "^[ \t]*<[^ \t\r\n<{}]")
 (#set! injection.language "xml"))

; MARK: What the grammar decides

; Every body still unclaimed, to this grammar, tentatively: kept as a wire
; message when it parses clean, left as it is when it does not.
((body) @injection.content
 (#set! injection.language "http_message")
 (#set! injection.tentative))
