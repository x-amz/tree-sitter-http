; Body language in the file format: what the body's own text reveals. The
; grammar typed the body by its first line — `{` or `[` json, `<` xml,
; `key=` form — and that type is the language; a Content-Type header does
; not overrule it. Patterns are tried in order and a body keeps the first
; that claims it, so the html opener stands ahead of the xml it would
; otherwise be. The one thing the text cannot reveal is a wire message,
; which opens like any request; that alone is routed by the header. A
; `file_body` names a file, not its bytes, and is never injected. The wire
; dialect is the other way round: declared only, never sniffed
; (queries/http_message/injections.scm).

((json_body) @injection.content
  (#set! injection.language "json"))

; A body the grammar typed by its `<` that opens with a doctype or `<html`
; is HTML, not XML.
((xml_body) @injection.content
  (#match? @injection.content "^<(![Dd][Oo][Cc][Tt][Yy][Pp][Ee][ \t]+[Hh][Tt][Mm][Ll]|[Hh][Tt][Mm][Ll])([ \t>]|$)")
  (#set! injection.language "html"))

((xml_body) @injection.content
  (#set! injection.language "xml"))

((form_body) @injection.content
  (#set! injection.language "form_urlencoded"))

; message/http — the echo's answer: a wire message as a body. Only a
; `raw_body` can hold one: a wire message opens with a method or a version,
; never with `{`, `[`, `<` or `key=`. A response's body is the terminal one
; and keeps the blank line the wire message needs; a request's ends at that
; blank line, so only the nested message's start line and headers survive.
; A media type is case-insensitive; the CLI, web-tree-sitter, and
; SwiftTreeSitter disagree on regex flags, so the pattern spells it out.
((_
   (header name: (header_name) @_content_type value: (value) @_media_type)
   body: (raw_body) @injection.content)
 (#match? @_content_type "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee][ \t]*$")
 (#match? @_media_type "^[ \t]*[Mm][Ee][Ss][Ss][Aa][Gg][Ee]/[Hh][Tt][Tt][Pp][ \t]*(;|$)")
 (#set! injection.language "http_message"))
