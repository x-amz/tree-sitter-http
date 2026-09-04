; Language injection for body interiors. Bodies are opaque lines in this
; grammar (parity with the engine: HttpSyntax tokenizes, ContentFormats
; parses formats), so interior highlighting is a second grammar's job —
; consumers with a JSON/XML parser at hand run it over these ranges.

((json_body) @injection.content
  (#set! injection.language "json"))

((xml_body) @injection.content
  (#set! injection.language "xml"))

; A body its message declares message/http is a wire message — the echo
; answers with the request's own octets — and this dialect's rules misread
; it, so it goes to the wire grammar. A response's body is the terminal one
; and keeps the blank line the wire message needs; a request's ends at that
; blank line, so only the nested message's start line and headers survive.
((_
   (header
     name: (header_name) @_content_type
     value: (value) @_media_type)
   body: (raw_body) @injection.content)
 (#match? @_content_type "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee][ \t]*$")
 (#match? @_media_type "^[ \t]*[Mm][Ee][Ss][Ss][Aa][Gg][Ee]/[Hh][Tt][Tt][Pp][ \t]*(;|$)")
 (#set! injection.language "http_message"))
