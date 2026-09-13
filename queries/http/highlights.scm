; Highlight query with standard tree-sitter capture names — the grammar's
; public surface, read by the wasm test page, the echo frontend, and any
; editor consuming the wasm. (The Nova extension carries its own copy in
; SyntaxKit's capture vocabulary; node names are the contract between them.)

; Request line
(method) @keyword
(target) @string.special
(continuation) @string.special
(version) @constant
(trailer) @error

; Headers
(header
  name: (header_name) @property
  ":" @punctuation.delimiter)
(header value: (value) @string)

; {{placeholders}}
(placeholder
  "{{" @punctuation.special
  "}}" @punctuation.special)
(reference name: (identifier) @variable)
(reference path: (path_expression) @property)
(dynamic name: (dynamic_name) @variable.builtin)
(dynamic (argument) @variable.parameter)

; @name = value
(declaration
  "@" @operator
  name: (identifier) @variable
  "=" @operator)
(declaration value: (value) @string)

; Comments and # @directives
(comment) @comment
(directive) @comment
(directive
  "@" @attribute
  name: (identifier) @attribute)
(directive argument: (value) @string)

; ### separators
(separator) @punctuation.special
(separator title: (title) @string.special)

; Responses. A status code's class is its first digit, and each class is
; its own capture so a theme can colour success, redirect, client error and
; server error apart. Patterns are tried in order and a node keeps the first
; that matches, so the plain `@constant` below catches what no class claims:
; a 1xx code, or the digits of a status line the format does not know.
((status_code) @constant.status.success
  (#match? @constant.status.success "^2"))
((status_code) @constant.status.redirect
  (#match? @constant.status.redirect "^3"))
((status_code) @constant.status.client
  (#match? @constant.status.client "^4"))
((status_code) @constant.status.server
  (#match? @constant.status.server "^5"))
(status_code) @constant
(status_text) @string

; Bodies
(file_body path: (path) @string.special)

; Regions the parser could not make sense of
(ERROR) @error
