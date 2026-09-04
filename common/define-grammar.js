/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// tree-sitter-http — one grammar source, two dialects (the
// tree-sitter-typescript layout). `http/grammar.js` and
// `http_message/grammar.js` both call this file:
//
//   http          the .http file format, written to the format as the
//                 `.http` tooling reads it, so an editor's tree and the
//                 regions a client runs agree.
//   http_message  raw wire messages (message/http): the same grammar with
//                 every file-format feature switched off. Not a component
//                 split — placeholders thread through `target` and `value`,
//                 so there is no clean base to extract; `wire` states
//                 exactly which constructs do not exist on the wire.
//
// The .http rules:
//
//   - A message starts at a line that is not blank, `###`, a comment, or an
//     `@name = value` declaration. Its first word is a known method
//     (case-insensitive), an `HTTP/` version (a response), or the target of
//     an implied GET. Unknown words are targets, not methods.
//   - Indented lines beginning with `/`, `?`, or `&` right after the request
//     line continue the target.
//   - Headers follow until a blank line. For GET/HEAD/OPTIONS/DELETE/TRACE/
//     CONNECT and implied GET the blank line ends the request; for
//     POST/PUT/PATCH and responses it starts a body.
//   - A body is opaque lines, typed by its first line (JSON, XML, `< file`,
//     or raw). Nothing about an `HTTP/x nnn` line ends one; a body line that
//     looks like a status line is body text. But a body never *opens* with
//     one: a status line where a body could begin is a response — a
//     response is never a body. What ends one is where it sits:
//     a request's body ends at a blank line — the same blank line that lets
//     an inline response follow it — while a response's body is terminal and
//     ends only at `###` or EOF, so the blank lines inside it are content.
//     That asymmetry is what carries `Content-Type: message/http`: the echo
//     answers with the request's own octets, blank line and body included.
//
// What `wire` switches off:
//
//   - Placeholders: `target` and `value` are plain text; `{` and `}` are
//     ordinary octets.
//   - File-format items: no `comment`, `directive`, `declaration`,
//     `separator`/`section`. The item set is request, response, blank.
//   - Implied GET: the request line requires a method. Unknown first words
//     are errors, not targets.
//   - Target continuations: an indented line after the request line is
//     `plain` (obs-fold), as in a header block.
//   - Comments in header blocks: a `#` line is a `header`/`plain` like any
//     other.
//   - Body termination and typing: a body runs to EOF — no `###`, no blank
//     line, no `HTTP/` status line ends it — and is one opaque `body` node,
//     the same terminal body a response carries in http. On the wire a
//     body's type is declared by Content-Type, not sniffed from its first
//     line; each dialect's queries/injections.scm encodes its rule.
//
// Both dialects are line-oriented with no `extras`: whitespace and newlines
// are tokens (`_eol`, from the external scanner, is also zero-width at EOF).
// What a line *is* falls out of lexical precedence, highest first: `###`
// (10), a typed body's opener (9), a body line (8), a status line (7), a raw
// body's opener (6), a comment prefix (5), a header name (2),
// whitespace/blank/`@`/`=` (1), everything else (0). A body line outranks a
// comment so `# text` inside a body stays body, and it outranks a status
// line so `HTTP/1.1 …` inside one stays body — but the raw opener sits
// below the status line, so where a body *could* begin a status line is a
// response instead. A blank line is the one thing
// a body line cannot be — where a body may end at one, its line token
// declines to match it, and `_blank` (1) takes the line instead.

const PREC = {
  // `###` ends any body, so it outranks every body token.
  SEPARATOR: 10,
  // A typed opener outranks a raw one: the same line matches both, and the
  // type is the more specific reading.
  TYPED_BODY: 9,
  // Body lines outrank a status line. Nothing a body contains ends it; only
  // where the body sits decides that.
  BODY: 8,
  RESPONSE: 7,
  // A raw body's opener ranks below a status line: a body never opens with
  // one, because a response is never a body. It still outranks a comment,
  // a method, a declaration — anything else a first body line may look like.
  RAW_OPENER: 6,
  COMMENT: 5,
  HEADER: 2,
  TRIVIA: 1,
};

/** Case-insensitive literal, as a regex: ci("get") → /[Gg][Ee][Tt]/ */
const ci = (word) =>
  new RegExp(
    word
      .split("")
      .map((c) => `[${c.toUpperCase()}${c.toLowerCase()}]`)
      .join(""),
  );

/** Text that may carry {{placeholders}}: header values, declaration values, directive arguments. */
const withPlaceholders = ($, text) => repeat1(choice(text, $.placeholder, "{", "}"));

/** @param {boolean} wire */
module.exports = (wire) =>
  grammar({
    name: wire ? "http_message" : "http",

    extras: () => [],

    // `_eol` comes from <dialect>/src/scanner.c (common/scanner.h): a
    // newline, or zero-width at end of file.
    externals: ($) => [$._eol],

    rules: {
      document: wire
        ? ($) => repeat($._item)
        : ($) => seq(repeat($._item), repeat($.section)),

      ...(wire
        ? {}
        : {
            // A `###` line and everything up to the next one.
            section: ($) => seq($.separator, repeat($._item)),
          }),

      _item: wire
        ? ($) => choice($._blank, $.request, $.response)
        : ($) => choice($._blank, $.comment, $.directive, $.declaration, $.request, $.response),

      // MARK: Lines between messages (file format only)

      ...(wire
        ? {}
        : {
            separator: ($) => seq($._hashes, optional($._ws), optional(field("title", $.title)), $._eol),
            _hashes: () => token(prec(PREC.SEPARATOR, /###+/)),
            title: () => /[^\s][^\r\n]*/,

            // `# text` or `// text`
            comment: ($) => seq($._comment_prefix, optional(/[^\r\n]+/), $._eol),
            // `# @name login`, `// @disabled`, `# @name = login`
            directive: ($) =>
              seq(
                $._comment_prefix,
                $._at,
                field("name", $.identifier),
                optional(
                  seq(
                    choice($._ws, seq(optional($._ws), $._eq, optional($._ws))),
                    optional(field("argument", $.value)),
                  ),
                ),
                $._eol,
              ),
            _comment_prefix: () => token(prec(PREC.COMMENT, /(#{1,2}|\/\/)[ \t]*/)),

            // `@host = https://example.com`
            declaration: ($) =>
              seq(
                $._at,
                field("name", $.identifier),
                optional($._ws),
                $._eq,
                optional($._ws),
                optional(field("value", $.value)),
                $._eol,
              ),
          }),

      // MARK: Requests

      request: ($) => choice($._bodiless_request, $._body_request),

      _bodiless_request: wire
        ? ($) =>
            prec.right(
              seq(
                field("method", alias($._bodiless_method, $.method)),
                $._ws,
                $._request_line,
                repeat(choice($.header, $.plain)),
              ),
            )
        : ($) =>
            prec.right(
              seq(
                optional(seq(field("method", alias($._bodiless_method, $.method)), $._ws)),
                $._request_line,
                repeat($.continuation),
                repeat(choice($.header, $.comment, $.plain)),
              ),
            ),

      _body_request: wire
        ? ($) =>
            prec.right(
              seq(
                field("method", alias($._body_method, $.method)),
                $._ws,
                $._request_line,
                repeat(choice($.header, $.plain)),
                optional(seq(repeat1($._blank), optional(field("body", $.body)))),
              ),
            )
        : ($) =>
            prec.right(
              seq(
                field("method", alias($._body_method, $.method)),
                $._ws,
                $._request_line,
                repeat($.continuation),
                repeat(choice($.header, $.comment, $.plain)),
                optional(seq(repeat1($._blank), optional(field("body", $._body)))),
              ),
            ),

      _bodiless_method: () =>
        token(choice(ci("get"), ci("head"), ci("options"), ci("delete"), ci("trace"), ci("connect"))),
      _body_method: () => token(choice(ci("post"), ci("put"), ci("patch"))),

      _request_line: ($) =>
        seq(
          field("target", $.target),
          optional(seq($._ws, choice(field("version", $.version), $.trailer))),
          optional($._ws),
          $._eol,
        ),

      target: wire
        ? ($) => $.url_text
        : ($) => repeat1(choice($.url_text, $.placeholder, "{", "}")),
      url_text: wire ? () => /[^\s]+/ : () => /[^\s{}]+/,

      ...(wire
        ? {}
        : {
            // An indented line continuing the target: `  ?page=2` / `  &limit=10`
            continuation: ($) =>
              seq(
                $._ws,
                alias($._continuation_head, $.url_text),
                repeat(choice($.url_text, $.placeholder, "{", "}")),
                optional($._ws),
                $._eol,
              ),
            _continuation_head: () => /[\/?&][^\s{}]*/,
          }),

      version: () => token(prec(PREC.RESPONSE, /HTTP\/[0-9.]+/)),
      // Text after the target that is not a version. Still part of the line.
      trailer: () => /[^\s][^\r\n]*/,

      header: ($) =>
        seq(
          field("name", $.header_name),
          optional($._ws),
          ":",
          optional($._ws),
          optional(field("value", $.value)),
          $._eol,
        ),
      // Outranks a target so that, once in the header block, every line is a
      // header (the engine's rule: a colon-less line there is still not a request).
      header_name: () => token(prec(PREC.HEADER, /[^\s:][^:\r\n]*/)),
      // A line in the header block with no colon — an obs-fold continuation or a
      // stray line. The engine keeps it as `plain`; so do we, so it is not an error.
      // Not indented, or indented but (in http) not a target continuation
      // (`/`, `?`, `&`). Consumes its newline so that on a colon-less line it is
      // the longer match than `header_name`, and on a header line it cannot match
      // at all — the two never tie. (Consequences: a colon-less last line with no
      // trailing newline is an error, and so is a whitespace-only final line —
      // `_blank` needs its newline and no body may open with whitespace.)
      // Indentation is read by position, not by content. Unindented, a line is
      // `plain` only without a colon — with one it is a header. Indented, it can
      // never be a header in either dialect (`header_name` demands a non-space
      // first character), so it is a continuation and its colons are its own: a
      // real obs-fold carries them (`00:00:00`, host:port). Both arms admit them.
      // The arms differ only in the first character: in http, `/`, `?` and `&`
      // are left to `_continuation_head`, which claims an indented line that
      // continues the target.
      plain: wire
        ? () => token(prec(PREC.HEADER, /([^\s:][^:\r\n]*|[ \t]+[^\s][^\r\n]*)(\r?\n|\r)/))
        : () => token(prec(PREC.HEADER, /([^\s:][^:\r\n]*|[ \t]+[^\s:\/?&][^\r\n]*)(\r?\n|\r)/)),

      // MARK: Responses

      response: wire
        ? ($) =>
            prec.right(
              seq(
                field("version", $.version),
                optional($._status_line_tail),
                $._eol,
                repeat(choice($.header, $.plain)),
                optional(seq(repeat1($._blank), optional(field("body", $.body)))),
              ),
            )
        : ($) =>
            prec.right(
              seq(
                field("version", $.version),
                optional($._status_line_tail),
                $._eol,
                repeat(choice($.header, $.comment, $.plain)),
                optional(seq(repeat1($._blank), optional(field("body", $._terminal_body)))),
              ),
            ),
      // The engine's rule: a first word beginning `HTTP/` is a response, and
      // the code is whatever digits follow — possibly none. `HTTP/1.1 is a
      // protocol` is a response with no code and that reason. The code
      // outranks the reason so `200 OK` is not one reason.
      _status_line_tail: ($) =>
        seq(
          $._ws,
          optional(field("status", $.status_code)),
          optional(seq(optional($._ws), field("reason", $.status_text))),
        ),
      status_code: () => token(prec(PREC.TRIVIA, /[0-9]+/)),
      status_text: () => /[^\s][^\r\n]*/,

      // MARK: Bodies — opaque lines
      //
      // http types a body by its first line, and carries each type twice.
      // A request's body ends at a blank line, so an inline response can
      // follow it; a response's body is terminal — only `###` or EOF ends
      // it — so a blank line inside it is content. That is what lets a
      // `Content-Type: message/http` body hold the echoed request whole,
      // its own header/body blank line included. The pair differ in one
      // token, the line they repeat, and alias to the same node names, so
      // a query never sees which side it is on.
      //
      // wire has one `body` node, terminal like a response's; its first line
      // is a separate token only so blank lines before the body stay the
      // message's.

      ...(wire
        ? {
            body: ($) => seq($._body_head, repeat($._terminal_line)),
            _body_head: () => token(prec(PREC.BODY, /[ \t]*[^\s][^\r\n]*(\r?\n|\r)?/)),
          }
        : {
            _body: ($) => choice($.json_body, $.xml_body, $.file_body, $.raw_body),
            _terminal_body: ($) =>
              choice(
                alias($._terminal_json_body, $.json_body),
                alias($._terminal_xml_body, $.xml_body),
                alias($._terminal_file_body, $.file_body),
                alias($._terminal_raw_body, $.raw_body),
              ),

            // `[`, or `{` not followed by another `{` (that is a placeholder).
            // The exclusion guards `{` alone: `[{…}]` is an array of objects.
            json_body: ($) => seq($._json_head, repeat($._body_line)),
            _terminal_json_body: ($) => seq($._json_head, repeat($._terminal_line)),
            _json_head: () =>
              token(
                prec(
                  PREC.TYPED_BODY,
                  /\[[^\r\n]*(\r?\n|\r)?|\{(\r?\n|\r|[^{\r\n][^\r\n]*(\r?\n|\r)?)/,
                ),
              ),

            xml_body: ($) => seq($._xml_head, repeat($._body_line)),
            _terminal_xml_body: ($) => seq($._xml_head, repeat($._terminal_line)),
            _xml_head: () => token(prec(PREC.TYPED_BODY, /<[^\s@<][^\r\n]*(\r?\n|\r)?/)),

            // `< ./file`, `<@ ./file`, `<@name ./file`
            file_body: ($) => seq($._file_line, repeat($._body_line)),
            _terminal_file_body: ($) => seq($._file_line, repeat($._terminal_line)),
            _file_line: ($) => seq($._file_head, field("path", $.path), optional($._ws), $._eol),
            _file_head: () => token(prec(PREC.TYPED_BODY, /<(@[^\s]*)?[ \t]+/)),
            path: () => /[^\s][^\r\n]*/,

            raw_body: ($) => seq($._raw_head, repeat($._body_line)),
            _terminal_raw_body: ($) => seq($._raw_head, repeat($._terminal_line)),
            _raw_head: () => token(prec(PREC.RAW_OPENER, /[ \t]*[^\s][^\r\n]*(\r?\n|\r)?/)),

            // A request's body: never a blank line, so a blank line ends it.
            _body_line: () => token(prec(PREC.BODY, /[ \t]*[^\s][^\r\n]*(\r?\n|\r)?/)),
          }),

      // A terminal body's line: a blank line is content, not an end.
      _terminal_line: () => token(prec(PREC.BODY, /[^\r\n]*(\r?\n|\r)|[^\r\n]+/)),

      // MARK: Values and placeholders

      value: wire ? ($) => $.value_text : ($) => withPlaceholders($, $.value_text),
      value_text: wire ? () => /[^\r\n]+/ : () => /[^\r\n{}]+/,

      ...(wire
        ? {}
        : {
            // `{{host}}`, `{{ login.response.body.$.token }}`, `{{$randomInt 1 100}}`
            placeholder: ($) =>
              seq("{{", optional($._ws), optional(choice($.dynamic, $.reference)), optional($._ws), "}}"),
            reference: ($) => seq(field("name", $.identifier), optional(field("path", $.path_expression))),
            path_expression: () => /[.\[][^\s{}]*/,
            dynamic: ($) => prec.right(seq(field("name", $.dynamic_name), repeat(seq($._ws, $.argument)))),
            dynamic_name: () => /\$[^\s{}]*/,
            argument: () => /[^\s{}]+/,

            identifier: () => /[^\s.\[\]{}$=][^\s.\[\]{}=]*/,
          }),

      // MARK: Trivia

      ...(wire
        ? {}
        : {
            _at: () => token(prec(PREC.TRIVIA, "@")),
            _eq: () => token(prec(PREC.TRIVIA, "=")),
          }),
      _ws: () => token(prec(PREC.TRIVIA, /[ \t]+/)),
      _blank: () => token(prec(PREC.TRIVIA, /[ \t]*(\r?\n|\r)/)),
    },
  });
