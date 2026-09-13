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
//     `@name = value` declaration. Its first word is a method — any token
//     word followed by a space and a target — an `HTTP/` version (a
//     response), or the target of an implied GET. GET, HEAD, OPTIONS,
//     DELETE, TRACE and CONNECT are the bodiless methods; every other method
//     may carry a body. After the target only a version may follow: any
//     other text there, a method with no target, an indented request line,
//     and a `@` that declares nothing are errors. Spaces before a line's end
//     belong to the line end.
//   - Indented lines beginning with `/`, `?` or `&` right after the request
//     line continue the target — a fragment never reaches the wire, so `#`
//     is not one of them. An indented line after a header
//     continues its value (`fold`). Any other indented line in the header
//     block is an error: a continuation is always indented, and it continues
//     something.
//   - Headers follow until a blank line. For GET/HEAD/OPTIONS/DELETE/TRACE/
//     CONNECT and implied GET the blank line ends the request; for
//     POST/PUT/PATCH and responses it starts a body.
//   - A body is lines, typed by its first line (JSON, XML, form-encoded,
//     `< file`, or raw), with placeholders read inside them. Nothing about an `HTTP/x nnn` line ends one; a body line that
//     looks like a status line is body text. But a body never *opens* with
//     one: a status line where a body could begin is a response — a
//     response is never a body. What ends one is where it sits:
//     a request's body ends at a blank line — the same blank line that lets
//     an inline response follow it — while a response's body is terminal and
//     ends only at `###` or EOF, so the blank lines inside it are content.
//     That asymmetry is what carries `Content-Type: message/http`: the echo
//     answers with the request's own octets, blank line and body included.
//   - A form body is pairs, not lines: `pair` nodes with `key` and `value`,
//     joined by `&` or by a line break — whitespace between pairs is layout,
//     the format's and never the body's, so a consumer's wire form is the
//     pairs joined on `&`. The body is typed by its first pair, decided by
//     the scanner (`_form_start`, zero-width) the way the other types are
//     decided by their opener tokens.
//
// What `wire` switches off:
//
//   - Placeholders: `target` and `value` are plain text; `{` and `}` are
//     ordinary octets.
//   - File-format items: no `comment`, `directive`, `declaration`,
//     `separator`/`section`. The item set is request, response, blank.
//   - Implied GET: the request line requires a method.
//   - Target continuations: an indented line after the request line is an
//     error. A header still folds.
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
// The scanner's other token, `_placeholder_open`, is the file dialect's `{{`
// where a placeholder opens: a placeholder never contains a brace, so the
// scanner looks along the line for `}}` as far as the first brace, and a
// `{{` it declines is the grammar's own `{{` token — text, like every other
// brace that closes no placeholder.
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
const withPlaceholders = ($, text) => repeat1(choice(text, $.placeholder, $._braces));

/** @param {boolean} wire */
module.exports = (wire) =>
  grammar({
    name: wire ? "http_message" : "http",

    extras: () => [],

    // From <dialect>/src/scanner.c (common/scanner.h). `_eol` is a newline,
    // or zero-width at end of file. `_placeholder_open` is a `{{` whose `}}`
    // closes it on the same line with no brace between, and `_form_start` is
    // zero-width at a body's first line when that line opens `key=` — the
    // two decisions that need to look past the token. Both exist in the
    // file dialect alone: on the wire, braces are octets and a body is
    // opaque.
    externals: wire ? ($) => [$._eol] : ($) => [$._eol, $._placeholder_open, $._form_start],

    // The one ambiguity, read both ways: inside a placeholder, the space
    // after a dynamic's last argument may be the trailing space before `}}`,
    // and only the token after it says which.
    conflicts: wire ? () => [] : ($) => [[$.dynamic]],

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

      // The bodiless set is closed; every other token word is a method that
      // may carry a body (PROPFIND, REPORT, PURGE). A word the bodiless set
      // names matches both tokens at one length, and the bodiless rule stands
      // first, so it wins. A target outlasts a method wherever it carries a
      // character a method cannot (`:`, `/`, `.`, `{`), so an implied GET's
      // first word stays its target.
      _bodiless_method: () =>
        token(choice(ci("get"), ci("head"), ci("options"), ci("delete"), ci("trace"), ci("connect"))),
      _body_method: () => /[A-Za-z][A-Za-z0-9-]*/,

      // The target, then at most a version. Anything else after the target
      // is an error, not a trailer.
      _request_line: ($) =>
        seq(
          field("target", $.target),
          optional(seq($._ws, field("version", $.version))),
          optional($._ws),
          $._eol,
        ),

      target: wire
        ? ($) => $.url_text
        : ($) => repeat1(choice($.url_text, $.placeholder, $._braces)),
      url_text: wire ? () => /[^\s]+/ : () => /[^\s{}]+/,

      ...(wire
        ? {}
        : {
            // An indented line continuing the target: `  ?page=2` / `  &limit=10`
            // / `  /path`. Always indented, always at one of the three
            // punctuation marks a target can resume at.
            continuation: ($) =>
              seq(
                $._ws,
                alias($._continuation_head, $.url_text),
                repeat(choice($.url_text, $.placeholder, $._braces)),
                optional($._ws),
                $._eol,
              ),
            _continuation_head: () => /[\/?&][^\s{}]*/,
          }),

      version: () => token(prec(PREC.RESPONSE, /HTTP\/[0-9.]+/)),

      header: ($) =>
        seq(
          field("name", $.header_name),
          optional($._ws),
          ":",
          optional($._ws),
          optional(field("value", $.value)),
          $._eol,
          repeat($.fold),
        ),
      // An indented line after a header continues its value — the obs-fold.
      // The value is the header's; the line break and the indentation are
      // layout, and a consumer joins the two values with one space. Its
      // colons are its own (`00:00:00 GMT`): indented, a line can never be
      // a header, since `header_name` demands a non-space first character.
      fold: ($) => seq($._ws, field("value", $.value), $._eol),
      // Outranks a target so that, once in the header block, every line is a
      // header (the engine's rule: a colon-less line there is still not a request).
      header_name: () => token(prec(PREC.HEADER, /[^\s:][^:\r\n]*/)),
      // An unindented line in the header block with no colon — stray text.
      // The engine keeps it as `plain`; so do we, so it is not an error.
      // Consumes its newline so that on a colon-less line it is the longer
      // match than `header_name`, and on a header line it cannot match at
      // all — the two never tie. (Consequences: a colon-less last line with
      // no trailing newline is an error, and so is a whitespace-only final
      // line — `_blank` needs its newline and no body may open with
      // whitespace.) An indented line is never `plain`: it continues the
      // target (`continuation`) or the header above it (`fold`), and where
      // there is nothing to continue it is an error.
      plain: () => token(prec(PREC.HEADER, /[^\s:][^:\r\n]*(\r?\n|\r)/)),

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

      // MARK: Bodies — lines of text and placeholders
      //
      // http types a body by its first line, and carries each type twice.
      // A request's body ends at a blank line, so an inline response can
      // follow it; a response's body is terminal — only `###` or EOF ends
      // it — so a blank line inside it is content. That is what lets a
      // `Content-Type: message/http` body hold the echoed request whole,
      // its own header/body blank line included. The pair differ in one
      // rule, the line they repeat, and alias to the same node names, so
      // a query never sees which side it is on. Both are right-associative:
      // a line that could continue the body or begin the next message —
      // one opening with `{`, now that a placeholder may — continues it.
      //
      // A body line is text and placeholders: `_body_text` runs between
      // braces, `{` and `}` on their own, and `placeholder` read the way a
      // header value reads it. What decides the line is still its first
      // token — the typed opener, the raw opener, or a body-line start at
      // `BODY` — and a whitespace-only line is never one of those, so where
      // a body may end at a blank line, `_blank` takes it. A line that opens
      // with a brace or a placeholder is the one shape those starts cannot
      // carry, and is spelled out beside them.
      //
      // wire has one `body` node, terminal like a response's, opaque: its
      // lines are whole tokens, its first line a separate token only so
      // blank lines before the body stay the message's.

      ...(wire
        ? {
            body: ($) => seq($._body_head, repeat($._terminal_line)),
            _body_head: () => token(prec(PREC.BODY, /[ \t]*[^\s][^\r\n]*(\r?\n|\r)?/)),
            _terminal_line: () => token(prec(PREC.BODY, /[^\r\n]*(\r?\n|\r)|[^\r\n]+/)),
          }
        : {
            _body: ($) => choice($.json_body, $.xml_body, $.form_body, $.file_body, $.raw_body),
            _terminal_body: ($) =>
              choice(
                alias($._terminal_json_body, $.json_body),
                alias($._terminal_xml_body, $.xml_body),
                alias($._terminal_form_body, $.form_body),
                alias($._terminal_file_body, $.file_body),
                alias($._terminal_raw_body, $.raw_body),
              ),

            // `[`, or `{` not followed by another `{` (that is a placeholder).
            // The opener runs to the first brace on its line; the rest of the
            // line is pieces. A `{` alone on its line — pretty-printed JSON's
            // first line — is the one opener the regex cannot state without
            // looking past it, so it is the plain `{` token followed by the
            // line end, which nothing else reads that way.
            json_body: ($) => prec.right(seq($._json_line, repeat($._body_line))),
            _terminal_json_body: ($) => prec.right(seq($._json_line, repeat($._terminal_line))),
            _json_line: ($) =>
              choice(seq($._json_head, repeat($._piece), $._eol), prec(1, seq("{", $._eol))),
            _json_head: () => token(prec(PREC.TYPED_BODY, /\[[^\r\n{}]*|\{[^{\r\n][^\r\n{}]*/)),

            xml_body: ($) => prec.right(seq($._xml_line, repeat($._body_line))),
            _terminal_xml_body: ($) => prec.right(seq($._xml_line, repeat($._terminal_line))),
            _xml_line: ($) => seq($._xml_head, repeat($._piece), $._eol),
            // `<` then a tag's first character: not a space, `@` (a file body),
            // another `<`, or a brace (a placeholder, which is raw text).
            _xml_head: () => token(prec(PREC.TYPED_BODY, /<[^\s@<{}][^\r\n{}]*/)),

            // `key=value…`: pairs, opened by a first pair whose key has no
            // space in it and whose value, if any, starts at the `=`. What
            // `a = b` is not — that is prose, and raw. The opener is the
            // scanner's `_form_start`: zero-width, true when the line reads
            // `key=` from a first character none of the other openers claim.
            // After it the body is pairs and `&`, over as many lines as the
            // author laid them out on: a value never spans a line, whitespace
            // between pairs is layout, and a consumer's wire form is the
            // pairs joined on `&`. The pair tokens sit at BODY, so what a
            // line of the body may look like — a status line, a method, a
            // `#` — stays a line of pairs, and only `###` or the blank line
            // ends the body, as with every other type.
            form_body: ($) => prec.right(seq($._form_start, $._form_line, repeat($._form_next))),
            _terminal_form_body: ($) =>
              prec.right(seq($._form_start, $._form_line, repeat(choice($._form_next, $._terminal_blank)))),
            _form_line: ($) => seq($._form_pairs, $._eol),
            _form_next: ($) => seq(optional($._ws), $._form_pairs, $._eol),
            _form_pairs: ($) => repeat1(seq(choice($.pair, alias($._amp, "&")), optional($._ws))),
            // Right-associative: the space after an `=` is the value's lead,
            // not the gap before the next pair.
            pair: ($) =>
              prec.right(
                seq(
                  field("key", $.key),
                  optional(
                    seq(alias($._eq, "="), optional($._ws), optional(field("value", alias($._form_value, $.value)))),
                  ),
                ),
              ),
            key: () => token(prec(PREC.BODY, /[^\s=&{}]+/)),
            _amp: () => token(prec(PREC.BODY, "&")),
            // A value runs from its first non-space character to the last
            // before the next `&` or the line's end; the spaces inside are
            // its own, the ones at its edges are layout. After an `=` the
            // text outranks a key, so `a=b=c` is one pair.
            _form_value: ($) => repeat1(choice(alias($._form_text, $.value_text), $.placeholder, $._braces)),
            _form_text: () => token(prec(PREC.TYPED_BODY, /[^\s&{}]([^&\r\n{}]*[^\s&{}])?/)),

            // `< ./file`, `<@ ./file`, `<@name ./file`
            file_body: ($) => prec.right(seq($._file_line, repeat($._body_line))),
            _terminal_file_body: ($) => prec.right(seq($._file_line, repeat($._terminal_line))),
            _file_line: ($) => seq($._file_head, field("path", $.path), optional($._ws), $._eol),
            _file_head: () => token(prec(PREC.TYPED_BODY, /<(@[^\s]*)?[ \t]+/)),
            path: () => /[^\s][^\r\n]*/,

            // A raw body's first line: the raw opener, or a line that opens
            // with a placeholder or braces — the json opener has declined a
            // `{` only when another brace follows it.
            raw_body: ($) => prec.right(seq($._raw_line, repeat($._body_line))),
            _terminal_raw_body: ($) => prec.right(seq($._raw_line, repeat($._terminal_line))),
            _raw_line: ($) =>
              choice(
                seq($._raw_start, repeat($._piece), $._eol),
                seq(optional($._ws), choice($.placeholder, $._braces), repeat($._piece), $._eol),
              ),
            _raw_start: () => token(prec(PREC.RAW_OPENER, /[ \t]*[^\s{}][^\r\n{}]*/)),

            // A line inside a body: text from its first non-space character,
            // or whitespace then braces or a placeholder. Never blank.
            _body_line: ($) =>
              seq(
                choice($._body_start, seq(optional($._ws), choice($.placeholder, $._braces))),
                repeat($._piece),
                $._eol,
              ),
            _body_start: () => token(prec(PREC.BODY, /[ \t]*[^\s{}][^\r\n{}]*/)),

            // A terminal body's line: the same, or a blank line — content
            // here, so its token outranks `_blank`.
            _terminal_line: ($) => choice($._body_line, $._terminal_blank),
            _terminal_blank: () => token(prec(PREC.BODY, /[ \t]*(\r?\n|\r)/)),

            _piece: ($) => choice($._body_text, $.placeholder, $._braces),
            _body_text: () => token(prec(PREC.BODY, /[^\r\n{}]+/)),
          }),

      // MARK: Values and placeholders

      value: wire ? ($) => $.value_text : ($) => withPlaceholders($, $.value_text),
      value_text: wire ? () => /[^\r\n]+/ : () => /[^\r\n{}]+/,

      ...(wire
        ? {}
        : {
            // `{{host}}`, `{{ login.response.body.$.token }}`, `{{$randomInt 1 100}}`
            // The opener is the scanner's: a `{{` is one only when `}}` closes
            // it on the line with no brace between. Every other brace is text
            // — `{{` and `}}` included, as the grammar's own tokens — so an
            // unclosed `{{`, stray closers, and braces around a placeholder
            // are the text they are, never an error.
            placeholder: ($) =>
              seq(
                alias($._placeholder_open, "{{"),
                optional($._ws),
                optional(choice($.dynamic, $.reference)),
                optional($._ws),
                "}}",
              ),
            _braces: () => choice("{{", "}}", "{", "}"),
            reference: ($) => seq(field("name", $.identifier), optional(field("path", $.path_expression))),
            path_expression: () => /[.\[][^\s{}]*/,
            // No associativity: the space after the last argument may be the
            // placeholder's trailing space before `}}`, and only what follows
            // it says which — the one conflict declared above.
            dynamic: ($) => seq(field("name", $.dynamic_name), repeat(seq($._ws, $.argument))),
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
