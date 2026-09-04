; Highlight query with standard tree-sitter capture names — the grammar's
; public surface, read by the wasm test page, the echo frontend, and any
; editor consuming the wasm. The .http query (../../http/queries) minus the
; captures for the wire dialect's switched-off nodes; keep the two in step.

; Request line
(method) @keyword
(target) @string.special
(trailer) @error
(version) @constant

; Headers
(header
  name: (header_name) @property
  ":" @punctuation.delimiter)
(header value: (value) @string)

; Responses
(status_code) @constant
(status_text) @string

; Regions the parser could not make sense of
(ERROR) @error
