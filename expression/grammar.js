/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// An expression in braces: `{{host}}`, `{{ login.response.body.$.token }}`,
// `{{$randomInt 1 100}}`. The language of every `placeholder` token the file
// dialect finds — in a target, a header value, a declaration, a body — which
// hands each one here by injection, braces included, so this grammar is
// complete on its own and the injection needs no offset. Not a dialect: it
// hosts nothing and shares no scanner.
//
// Inside the braces there are no lines, so whitespace is trivia and no rule
// ever says whose a space is. An expression is a `reference` — a name, and
// a path into what it names — or a `call`: a builtin and its arguments. An
// empty pair of braces is an expression with nothing in it, not an error.

module.exports = grammar({
  name: "expression",

  extras: () => [/\s/],

  rules: {
    expression: ($) => seq("{{", optional(choice($.call, $.reference)), "}}"),

    // `host`, `login.response.body.$.token`
    reference: ($) => seq(field("name", $.identifier), optional(field("path", $.path))),
    identifier: () => /[^\s.\[\]{}$=][^\s.\[\]{}=]*/,
    path: () => /[.\[][^\s{}]*/,

    // `$guid`, `$randomInt 1 100`
    call: ($) => seq(field("name", $.builtin), repeat($.argument)),
    builtin: () => /\$[^\s{}]*/,
    argument: () => /[^\s{}]+/,
  },
});
