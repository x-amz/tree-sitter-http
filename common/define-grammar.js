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
//     and a `@` that declares nothing are errors.
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
//     `< file`, or raw), with placeholders read inside them. The first
//     line's first token, after any indentation, is what types it. Nothing
//     about an `HTTP/x nnn` line ends one; a body line that looks like a
//     status line is body text. But a body never *opens* with one: a status
//     line where a body could begin is a response — a response is never a
//     body. What ends one is where it sits: a request's body ends at a blank
//     line — the same blank line that lets an inline response follow it —
//     while a response's body is terminal and ends only at `###` or EOF, so
//     the blank lines inside it are content. That asymmetry is what carries
//     `Content-Type: message/http`: the echo answers with the request's own
//     octets, blank line and body included.
//   - A form body's pairs are the wire format, `key=value` joined by `&`,
//     with the one extension every client observes: a line may break before
//     an `&`, so a pair line after the first begins with one. Nothing else
//     is pair syntax — a space is never a separator, and a space after `=`
//     makes the line prose, not a pair. A line that begins with neither is
//     body text, as in every other type: the body still runs to the blank
//     line, and nothing it contains ends it. The body is typed by its first
//     pair, decided by the scanner (`_form_start`, zero-width) the way the
//     other types are decided by their opener tokens.
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
// Whitespace. Both dialects are line-oriented with no `extras`, so every
// space and newline is some token's, and one rule says whose:
//
//   - `_ws` is a run of spaces and tabs between two tokens on a line: after
//     a method, around a `:` or an `=`, inside a placeholder's braces,
//     between the pieces of a value, and a line's indentation. It is hidden,
//     so a consumer sees a gap between siblings and never a node.
//   - `_eol` ends a line and owns the whitespace before it: a newline, or
//     zero-width at end of file, with the spaces before it, from the
//     scanner. No rule writes a `_ws` in front of an `_eol`.
//   - `_blank` is a whitespace-only line.
//   - A visible token never begins or ends with whitespace — `text()` below
//     is the shape of every one that runs along a line, and a placeholder
//     token runs from its `{{` to its `}}`. A value is pieces, text and
//     placeholders, with `_ws` between them, and the `value` node runs from
//     its first piece to its last. A consumer takes a node's text and trims
//     nothing.
//   - A line node — a header, a comment, a fold — spans its `_eol`. An
//     indented line begins at its first character; the indentation is the
//     parent's. A body is the exception the other way: its bytes are the
//     body's, so the body node begins where its first line's indentation
//     does, and inside it the same tokens apply.
//
// The scanner (common/scanner.h) supplies `_eol`, and for the file dialect
// `placeholder` — a whole `{{…}}`, decided by looking along the line for the
// `}}` — and the two body openers a token cannot state without looking past
// itself: `_form_start`, zero-width at a `key=`, and `_file_open`, the `<`
// or `<@name` that whitespace and a path follow. What a placeholder holds
// is the expression grammar's (../expression), reached by injection; here
// it is one token, opaque.
//
// What a line *is* falls out of lexical precedence, highest first: `###`
// (10), a typed body's opener (9), a body line (8), a status line (7), a raw
// body's opener (6), a comment prefix (5), a header name (2),
// whitespace/blank/`@`/`=` (1), everything else (0). A body line outranks a
// comment so `# text` inside a body stays body, and it outranks a status
// line so `HTTP/1.1 …` inside one stays body — but the raw opener sits
// below the status line, so where a body *could* begin a status line is a
// response instead. A blank line is the one thing a body line cannot be —
// where a body may end at one, its tokens decline to match it, and `_blank`
// (1) outlasts the `_ws` (1) that would otherwise be its indentation.

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

/**
 * A run of text along a line that begins and ends off whitespace, never
 * containing a character of `except` (the inside of a character class):
 * text("{}") → /[^\s{}]([^\r\n{}]*[^\s{}])?/. Whitespace inside the run is
 * the text's own; at its edges it is `_ws` or the `_eol`'s.
 */
const text = (except) => new RegExp(`[^\\s${except}]([^\\r\\n${except}]*[^\\s${except}])?`);

/** Pieces — text, placeholders, braces — with `_ws` between them; the node runs from the first to the last. */
const pieces = ($, piece) => seq(piece, repeat(seq(optional($._ws), piece)));

/** @param {boolean} wire */
module.exports = (wire) =>
  grammar({
    name: wire ? "http_message" : "http",

    extras: () => [],

    // From <dialect>/src/scanner.c (common/scanner.h). `_eol` is a newline,
    // or zero-width at end of file, with the whitespace before it. The rest
    // exist in the file dialect alone — on the wire, braces are octets and a
    // body is opaque: `placeholder` is a `{{` through the `}}` that closes it
    // on the same line with no brace between, one token, its inside the
    // expression grammar's; `_form_start` is zero-width at a body's first
    // line when that line opens `key=`; `_file_open` is the `<` or `<@name`
    // a body's first line opens with when whitespace and a path follow it.
    // Each is a decision that needs to look past the token.
    externals: wire
      ? ($) => [$._eol]
      : ($) => [$._eol, $.placeholder, $._form_start, $._file_open, $._directive_start],

    // No conflicts: wherever a space could belong to two rules, a closer
    // owns it, and the scanner decides by looking past it.
    conflicts: () => [],

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
            title: () => text(""),

            // `# text` or `// text`
            comment: ($) => seq($._comment_prefix, optional($._ws), optional($._comment_text), $._eol),
            // `# @name login`, `// @disabled`, `# @name = login`. Until the
            // line is a directive it is a comment: `_directive_start` is the
            // scanner's, zero-width at a `@` that an identifier and then a
            // line end, whitespace or `=` follow, and without it the `@`
            // token would outrank the comment text and commit the line.
            directive: ($) =>
              seq(
                $._comment_prefix,
                optional($._ws),
                $._directive_start,
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
            _comment_prefix: () => token(prec(PREC.COMMENT, /#{1,2}|\/\//)),
            _comment_text: () => text(""),

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
                repeat(seq($._ws, $.continuation)),
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
                repeat(seq($._ws, $.continuation)),
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
        seq(field("target", $.target), optional(seq($._ws, field("version", $.version))), $._eol),

      target: wire
        ? ($) => $.url_text
        : ($) => repeat1(choice($.url_text, $.placeholder, $._braces)),
      url_text: wire ? () => /[^\s]+/ : () => /[^\s{}]+/,

      ...(wire
        ? {}
        : {
            // An indented line continuing the target: `  ?page=2` / `  &limit=10`
            // / `  /path`. Always at one of the three punctuation marks a
            // target can resume at; the indentation is the request's.
            continuation: ($) =>
              seq(
                alias($._continuation_head, $.url_text),
                repeat(choice($.url_text, $.placeholder, $._braces)),
                $._eol,
              ),
            _continuation_head: () => /[\/?&][^\s{}]*/,
          }),

      version: () => token(prec(PREC.RESPONSE, /HTTP\/[0-9.]+/)),

      header: ($) =>
        seq(
          field("name", alias($._name_text, $.header_name)),
          optional($._ws),
          ":",
          optional($._ws),
          optional(field("value", $.value)),
          $._eol,
          repeat(seq($._ws, $.fold)),
        ),
      // An indented line after a header continues its value — the obs-fold.
      // The value is the header's; the line break and the indentation are
      // layout, and a consumer joins the two values with one space. Its
      // colons are its own (`00:00:00 GMT`): indented, a line can never be
      // a header, since `_name_text` demands a non-space first character.
      fold: ($) => seq(field("value", $.value), $._eol),
      // The text of an unindented line in the header block, up to a colon or
      // the line's end: a header's name, or the whole of a `plain` line.
      // Outranks a target so that, once in the header block, every line is a
      // header (the engine's rule: a colon-less line there is still not a
      // request). One token for both, and what follows it decides: a `:`
      // makes a header, the line's end makes it plain.
      _name_text: () => token(prec(PREC.HEADER, text(":"))),
      // An unindented line in the header block with no colon — stray text.
      // The engine keeps it as `plain`; so do we, so it is not an error. An
      // indented line is never `plain`: it continues the target
      // (`continuation`) or the header above it (`fold`), and where there is
      // nothing to continue it is an error.
      plain: ($) => seq($._name_text, $._eol),

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
      status_text: () => text(""),

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
      // A body line is its indentation, then pieces with `_ws` between them:
      // `_body_text` runs between braces, `{` and `}` on their own, and
      // `placeholder` read the way a header value reads it. What decides the
      // line is its first token after the indentation — a typed opener, the
      // raw opener, or a piece at `BODY` — and a whitespace-only line has
      // none of those, so where a body may end at a blank line, `_blank`
      // takes it.
      //
      // wire has one `body` node, terminal like a response's, opaque: each
      // line is its indentation, one text token, and its end.

      ...(wire
        ? {
            body: ($) => seq($._body_line, repeat($._terminal_line)),
            _body_line: ($) => seq(optional($._ws), $._body_text, $._eol),
            _body_text: () => token(prec(PREC.BODY, text(""))),
            _terminal_line: ($) => choice($._body_line, $._terminal_blank),
            _terminal_blank: () => token(prec(PREC.BODY, /[ \t]*(\r?\n|\r)/)),
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
              seq(optional($._ws), choice(seq($._json_head, $._rest), prec(1, seq("{", $._eol)))),
            _json_head: () =>
              token(prec(PREC.TYPED_BODY, /\[([^\r\n{}]*[^\s{}])?|\{[ \t]*[^{\s]([^\r\n{}]*[^\s{}])?/)),

            xml_body: ($) => prec.right(seq($._xml_line, repeat($._body_line))),
            _terminal_xml_body: ($) => prec.right(seq($._xml_line, repeat($._terminal_line))),
            _xml_line: ($) => seq(optional($._ws), $._xml_head, $._rest),
            // `<` then a tag's first character: not a space, `@` (a file body),
            // another `<`, or a brace (a placeholder, which is raw text).
            _xml_head: () => token(prec(PREC.TYPED_BODY, /<[^\s@<{}]([^\r\n{}]*[^\s{}])?/)),

            // `key=value&key=value`, the wire format: pairs joined by `&`, and
            // a line may break before an `&`, so a pair line after the first
            // begins with one. That is all the pair syntax there is — no
            // space separates anything, and a space after `=` makes the line
            // prose and the body raw, like `a = b`. Any other line is body
            // text, so the body runs to the blank line like every other type
            // and a status line inside it stays inside it. The opener is the
            // scanner's `_form_start`: zero-width, true when the line reads
            // `key=` from a first character none of the other openers claim,
            // with no space after the `=`. A pair line's `&` is its opener,
            // at TYPED_BODY, so it outranks the text a body line would read.
            form_body: ($) => prec.right(seq($._form_line, repeat(choice($._form_next, $._body_line)))),
            _terminal_form_body: ($) =>
              prec.right(seq($._form_line, repeat(choice($._form_next, $._terminal_line)))),
            _form_line: ($) => seq(optional($._ws), $._form_start, $.pair, repeat($._amp_pair), $._eol),
            _form_next: ($) => seq(optional($._ws), $._amp_pair, repeat($._amp_pair), $._eol),
            _amp_pair: ($) => seq(alias($._amp, "&"), optional($.pair)),
            pair: ($) =>
              seq(
                field("key", $.key),
                optional(seq(alias($._eq, "="), optional(field("value", alias($._form_value, $.value))))),
              ),
            key: () => token(prec(PREC.BODY, /[^\s=&{}]+/)),
            _amp: () => token(prec(PREC.TYPED_BODY, "&")),
            // A value runs from the `=` to the next `&` or the line's end, its
            // bytes verbatim; after an `=` the text outranks a key, so
            // `a=b=c` is one pair.
            _form_value: ($) => pieces($, choice(alias($._form_text, $.value_text), $.placeholder, $._braces)),
            _form_text: () => token(prec(PREC.TYPED_BODY, text("&{}"))),

            // `< ./file`, `<@ ./file`, `<@name ./file`: the scanner's opener,
            // whitespace, the path.
            file_body: ($) => prec.right(seq($._file_line, repeat($._body_line))),
            _terminal_file_body: ($) => prec.right(seq($._file_line, repeat($._terminal_line))),
            _file_line: ($) => seq(optional($._ws), $._file_open, $._ws, field("path", $.path), $._eol),
            path: () => text(""),

            // A raw body's first line: the raw opener, or a line that opens
            // with a placeholder or braces — the json opener has declined a
            // `{` only when another brace follows it.
            raw_body: ($) => prec.right(seq($._raw_line, repeat($._body_line))),
            _terminal_raw_body: ($) => prec.right(seq($._raw_line, repeat($._terminal_line))),
            _raw_line: ($) => seq(optional($._ws), choice($._raw_start, $.placeholder, $._braces), $._rest),
            _raw_start: () => token(prec(PREC.RAW_OPENER, text("{}"))),

            // A line inside a body: indentation, then pieces. Never blank.
            _body_line: ($) => seq(optional($._ws), $._piece, $._rest),
            // The rest of a body line after its first token: more pieces, then
            // the line's end.
            _rest: ($) => seq(repeat(seq(optional($._ws), $._piece)), $._eol),

            // A terminal body's line: the same, or a blank line — content
            // here, so its token outranks `_blank`.
            _terminal_line: ($) => choice($._body_line, $._terminal_blank),
            _terminal_blank: () => token(prec(PREC.BODY, /[ \t]*(\r?\n|\r)/)),

            _piece: ($) => choice($._body_text, $.placeholder, $._braces),
            _body_text: () => token(prec(PREC.BODY, text("{}"))),
          }),

      // MARK: Values and placeholders

      value: wire ? ($) => $.value_text : ($) => pieces($, choice($.value_text, $.placeholder, $._braces)),
      value_text: wire ? () => text("") : () => text("{}"),

      ...(wire
        ? {}
        : {
            // A `placeholder` is the scanner's, whole: `{{host}}`,
            // `{{ login.response.body.$.token }}`, `{{$randomInt 1 100}}`. A
            // `{{` is one only when `}}` closes it on the line with no brace
            // between. Every other brace is text — `{{` and `}}` included, as
            // the grammar's own tokens — so an unclosed `{{`, stray closers,
            // and braces around a placeholder are the text they are, never an
            // error. What the token holds is the expression grammar's.
            _braces: () => choice("{{", "}}", "{", "}"),

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
