; Body language on the wire: declared by the message's own Content-Type,
; never sniffed from the body's first line. Each pattern names a grammar
; outright, so the media-type table is these patterns, and every consumer
; resolves the name alone — the same lookup the .http dialect's query needs.
; A media type is case-insensitive; the CLI, web-tree-sitter, and
; SwiftTreeSitter disagree on regex flags, so the patterns spell it out.

; message/http — the echo's answer: a wire message as a body.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee][ \t]*$")
 (#match? @_type "^[ \t]*[Mm][Ee][Ss][Ss][Aa][Gg][Ee]/[Hh][Tt][Tt][Pp][ \t]*(;|$)")
 (#set! injection.language "http_message"))

; application/json, text/json, and any +json structured-syntax suffix.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee][ \t]*$")
 (#match? @_type "^[ \t]*[^ \t/;]+/([^ \t;]*[+])?[Jj][Ss][Oo][Nn][ \t]*(;|$)")
 (#set! injection.language "json"))

; text/html and application/xhtml+xml. Ahead of xml, whose `+xml` suffix
; would otherwise claim xhtml.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee][ \t]*$")
 (#match? @_type "^[ \t]*[^ \t/;]+/(([^ \t;]*[+])?[Hh][Tt][Mm][Ll]|[Xx][Hh][Tt][Mm][Ll][+][Xx][Mm][Ll])[ \t]*(;|$)")
 (#set! injection.language "html"))

; application/xml, text/xml, image/svg+xml, and any +xml suffix.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee][ \t]*$")
 (#match? @_type "^[ \t]*[^ \t/;]+/([^ \t;]*[+])?[Xx][Mm][Ll][ \t]*(;|$)")
 (#set! injection.language "xml"))

; application/x-www-form-urlencoded.
((_
   (header name: (header_name) @_name value: (value) @_type)
   body: (body) @injection.content)
 (#match? @_name "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee][ \t]*$")
 (#match? @_type "^[ \t]*[^ \t/;]+/[Xx]-[Ww][Ww][Ww]-[Ff][Oo][Rr][Mm]-[Uu][Rr][Ll][Ee][Nn][Cc][Oo][Dd][Ee][Dd][ \t]*(;|$)")
 (#set! injection.language "form_urlencoded"))
