; Body language in the file format: what the body's own text reveals. The
; grammar typed the body by its first line — `{` or `[` json, `<` xml — and
; that type is the language; a Content-Type header does not overrule it.
; Patterns are tried in order and a body keeps the first that claims it, so
; the html opener stands ahead of the xml it would otherwise be. A raw body
; is what no opener typed, and what it is, this grammar decides: the last
; pattern hands every raw body still unclaimed to `http` itself, marked
; tentative, and the painter keeps that layer only when the body parses
; clean — a `.http` document inside a request, opening with a declaration,
; a comment, or a request line with or without its version, is read by the
; grammar that reads the file, recursively, and a body that is not one is
; left as it is. Before that, the header has two sayings: `message/http`
; names the wire grammar outright, and a media type the wire query knows
; claims the body and names nothing, so a body labelled json that did not
; open like json is not tried as `.http` either. A `form_body` is the
; grammar's own pairs and a `file_body` names a file, not its bytes;
; neither is injected. The wire dialect reads the same way, its text first,
; its header after, and itself last (queries/http_message/injections.scm).

((json_body) @injection.content
  (#set! injection.language "json"))

; A body the grammar typed by its `<` that opens with a doctype or `<html`
; is HTML, not XML.
((xml_body) @injection.content
  (#match? @injection.content "^<(![Dd][Oo][Cc][Tt][Yy][Pp][Ee][ \t]+[Hh][Tt][Mm][Ll]|[Hh][Tt][Mm][Ll])([ \t>]|$)")
  (#set! injection.language "html"))

((xml_body) @injection.content
  (#set! injection.language "xml"))

; message/http — the echo's answer, or a message on its way to the echo: a
; wire message as a body. Only a `raw_body` can hold one: a wire message
; opens with a method or a version, never with `{`, `[`, `<` or `key=`. The
; body keeps the blank line the wire message needs, on either side of the
; exchange. A media type is case-insensitive; the CLI, web-tree-sitter, and
; SwiftTreeSitter disagree on regex flags, so the patterns spell it out.
((_
   (header name: (header_name) @_content_type value: (value) @_media_type)
   body: (raw_body) @injection.content)
 (#match? @_content_type "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]$")
 (#match? @_media_type "^[Mm][Ee][Ss][Ss][Aa][Gg][Ee]/[Hh][Tt][Tt][Pp][ \t]*(;|$)")
 (#set! injection.language "http_message"))

; A raw body whose header names a language the wire query knows — json,
; xml, html, a form — is that language's claim, one the text did not bear
; out; the pattern claims the body and names nothing, so it is left as it
; is rather than tried as `.http`.
((_
   (header name: (header_name) @_content_type value: (value) @_media_type)
   body: (raw_body) @injection.content)
 (#match? @_content_type "^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]$")
 (#match? @_media_type "^[^ \t/;]+/(([^ \t;]*[+])?([Jj][Ss][Oo][Nn]|[Xx][Mm][Ll]|[Hh][Tt][Mm][Ll])|[Xx][Hh][Tt][Mm][Ll][+][Xx][Mm][Ll]|[Xx]-[Ww][Ww][Ww]-[Ff][Oo][Rr][Mm]-[Uu][Rr][Ll][Ee][Nn][Cc][Oo][Dd][Ee][Dd])[ \t]*(;|$)"))

; Every raw body still unclaimed, to this grammar, tentatively: kept as a
; `.http` document when it parses clean, left as it is when it does not.
((raw_body) @injection.content
 (#set! injection.language "http")
 (#set! injection.tentative))

; Every placeholder, braces included, to the expression grammar. A
; placeholder inside a body is masked for the body's language and painted
; by this one.
((placeholder) @injection.content
 (#set! injection.language "expression"))
