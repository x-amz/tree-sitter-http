/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// application/x-www-form-urlencoded: `key=value` pairs joined by `&`. The
// language of a `form_body` in the file dialect, and of a message that
// declares the type on the wire. A body language, not a dialect: it hosts
// nothing, shares no scanner, and has no messages to read.
//
// Whitespace between pairs is trivia, so the multi-line form the .http
// tooling accepts — one pair per line, `&` leading each continuation — reads
// as the one-line form does. Inside a value whitespace is text: a value runs
// from its first non-space character to the last before the next `&` or the
// end of its line, and only the first `=` of a pair splits it.

module.exports = grammar({
  name: "form_urlencoded",

  extras: () => [/\s/],

  rules: {
    document: ($) => repeat(choice($.pair, "&")),

    pair: ($) => seq(field("key", $.key), optional(seq("=", optional(field("value", $.value))))),

    key: () => /[^=&\s]+/,
    // Outranks `key`: after `=` a pair may also have ended, so both are
    // valid there and the same text matches both.
    value: () => token(prec(1, /[^&\s][^&\r\n]*[^&\s]|[^&\s]/)),
  },
});
