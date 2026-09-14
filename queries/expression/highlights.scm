; Highlight query for an expression, standard capture names — the file
; dialect's injection hands every placeholder here, braces included.

(expression
  "{{" @punctuation.special
  "}}" @punctuation.special)
(reference name: (identifier) @variable)
(reference path: (path) @property)
(call name: (builtin) @function.builtin)
(call (argument) @constant)
