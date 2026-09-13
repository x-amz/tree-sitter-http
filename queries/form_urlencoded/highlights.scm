; Highlight query with standard tree-sitter capture names, for a
; form-encoded body: keys as properties, values as strings, the joins as
; delimiters.

(pair key: (key) @property)
(pair value: (value) @string)

[
  "="
  "&"
] @punctuation.delimiter
