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
//     is not one of them. An indented line after a header continues its
//     value where the line before stopped. Any other indented line in the header
//     block is an error: a continuation is always indented, and it continues
//     something.
//   - Headers follow until a blank line. For GET/HEAD/OPTIONS/DELETE/TRACE/
//     CONNECT and implied GET the blank line ends the request; for
//     POST/PUT/PATCH and responses it starts a body.
//   - A body is lines of text with placeholders read inside them, and what
//     language the text is in is no business of this grammar's: the query
//     finds it (queries/http/injections.scm), as it does on the wire. The
//     one first line the format itself reads is `< path`, a `file_body` —
//     that names a file to send, not a language. Nothing a body contains
//     ends it: a status line, a `#` line or a `@` line
//     inside one is body text, and so is a blank line that more body
//     follows. What ends it is what comes after its last blank lines — the
//     last of the region: `###`, the end of the file, or a status line at
//     the margin, which is the response — and a blank line a body could
//     resume at is content only when it does resume; the scanner's
//     `_body_blank` reads past the run to decide, so the trailing blank
//     lines are the region's, never the body's. A body never *opens* with a
//     status line either: a status line where a body could begin is a
//     response — a response is never a body. A request's body and a
//     response's are one rule. That is what carries `Content-Type:
//     message/http`: the echo answers with the request's own octets, blank
//     line and body included, and a body sent to the echo holds the same.
//
// What `wire` switches off:
//
//   - Placeholders: `target` and `value` are plain text; `{` and `}` are
//     ordinary octets.
//   - File-format items: no `comment`, `directive`, `declaration`,
//     `separator`/`region`. The item set is request, response, blank.
//   - Implied GET: the request line requires a method.
//   - Target continuations: an indented line after the request line is an
//     error. A header's value still runs on across indented lines.
//   - Comments in header blocks: a `#` line is a `header`/`plain` like any
//     other.
//   - Body termination: a body runs to EOF — no `###`, no blank line, no
//     `HTTP/` status line ends it, and its trailing blank lines are its
//     octets — and is one opaque `body` node, with no file body. Its
//     language is the query's to find here too
//     (queries/http_message/injections.scm).
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
//   - `_blank` is a whitespace-only line between items. Inside a body the
//     scanner's `_body_blank` is a run of them that more body follows,
//     hidden like `_ws`.
//   - `fold` is a line break inside a header's value and the next line's
//     indentation, from the scanner: exactly the bytes that are layout and
//     no part of the value, and visible because of it. Whitespace before the
//     break is `_trail`, hidden like `_ws`, and the value's; before a
//     header's `_eol` it is `_line_trail`, and nobody's.
//   - A visible token never begins or ends with whitespace — `text()` below
//     is the shape of every one that runs along a line, and a placeholder
//     token runs from its `{{` to its `}}`. A value is pieces, text and
//     placeholders, with `_ws` between them, and the `value` node runs from
//     its first piece to its last. A consumer takes a node's text and trims
//     nothing — except a header's value, which runs on across lines: its
//     text is its range less each `fold` child's, and nothing stands in for
//     a fold.
//   - A line node — a header, a comment — spans its `_eol`. An
//     indented line begins at its first character; the indentation is the
//     parent's. A body is the exception the other way: its bytes are the
//     body's, so the body node begins where its first line's indentation
//     does, and inside it the same tokens apply.
//
// The scanner (common/scanner.h) supplies `_eol`, `_content_type_start`,
// zero-width at the header line that names Content-Type, `fold`, a line
// break whose next line is indented and not blank, with that indentation,
// and `_trail` and `_line_trail`, the whitespace before a fold and before
// a header's line end; and for the file dialect
// `placeholder` — a whole `{{…}}`, decided by looking along the line for the
// `}}` — the body opener a token cannot state without looking past itself:
// `_file_open`, the `<` or `<@name` that whitespace and a path follow — and
// `_body_blank`, the
// blank lines inside a body, decided by looking past them at the line that
// follows. What a placeholder holds is the expression grammar's
// (../expression), reached by injection; here it is one token, opaque.
//
// What a line *is* falls out of lexical precedence, highest first: `###`
// (10), a body line (8), a status line (7), a body's opener (6), a comment
// prefix (5), a header name (2),
// whitespace/blank/`@`/`=` (1), everything else (0). A body line outranks a
// comment so `# text` inside a body stays body, and it outranks a status
// line so `HTTP/1.1 …` inside one stays body — but the opener sits
// below the status line, so where a body *could* begin a status line is a
// response instead. A blank line is the one thing a body line's tokens
// never match: a run of them is the scanner's `_body_blank` when a body
// line follows, and otherwise `_blank` (1), which outlasts the `_ws` (1)
// that would otherwise be its indentation.

const PREC = {
  // `###` ends any body, so it outranks every body token.
  SEPARATOR: 10,
  // Body lines outrank a status line. Nothing a body contains ends it; only
  // where the body sits decides that.
  BODY: 8,
  RESPONSE: 7,
  // A body's opener ranks below a status line: a body never opens with
  // one, because a response is never a body. It still outranks a comment,
  // a method, a declaration — anything else a first body line may look like.
  OPENER: 6,
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

/** A fold and the whitespace before its break. */
const fold = ($) => seq(optional($._trail), $.fold);

/**
 * A header line over the token that names it: the name, `:`, the value, the
 * line's end. The value may begin on the line after the colon: a header whose
 * whole value is folded onto the next line still has one.
 */
const header = ($, name) =>
  seq(
    field("name", alias(name, $.header_name)),
    optional($._ws),
    ":",
    optional($._ws),
    optional(seq(optional(fold($)), field("value", alias($._header_value, $.value)))),
    optional($._line_trail),
    $._eol,
  );

/** Pieces — text, placeholders, braces — with a `gap` between them; the node runs from the first to the last. */
const pieces = ($, piece, gap = $._ws) => seq(piece, repeat(seq(optional(gap), piece)));

/** @param {boolean} wire */
module.exports = (wire) =>
  grammar({
    name: wire ? "http_message" : "http",

    extras: () => [],

    // From <dialect>/src/scanner.c (common/scanner.h). `_eol` is a newline,
    // or zero-width at end of file, with the whitespace before it;
    // `_content_type_start` is zero-width at a header line that names
    // Content-Type; `fold` is a line break inside a header's value and the
    // indentation after it, where an indented line continues the value;
    // `_trail` is the whitespace before a fold, the value's, and
    // `_line_trail` the whitespace before a header's `_eol`. The rest exist in the
    // file dialect alone — on the wire, braces are octets and a
    // body is opaque: `placeholder` is a `{{` through the `}}` that closes it
    // on the same line with no brace between, one token, its inside the
    // expression grammar's; `_file_open` is the `<` or `<@name`
    // a body's first line opens with when whitespace and a path follow it;
    // `_directive_start` is zero-width at the `@` a directive's name
    // follows; `_body_blank` is the blank lines inside a body that a body
    // line follows. Each is a decision that needs to look past the token.
    externals: wire
      ? ($) => [$._eol, $._content_type_start, $.fold, $._trail, $._line_trail]
      : ($) => [$._eol, $._content_type_start, $.fold, $._trail, $._line_trail, $.placeholder, $._file_open, $._directive_start, $._body_blank],

    // No conflicts: wherever a space could belong to two rules, a closer
    // owns it, and the scanner decides by looking past it.
    conflicts: () => [],

    rules: {
      document: wire
        ? ($) => repeat($._item)
        : ($) => seq(repeat($._item), repeat($.region)),

      ...(wire
        ? {}
        : {
            // A region: a `###` separator and everything up to the next one.
            // The word is the format's own — a region with a request line is
            // one a client runs, one without is the global region whose
            // declarations and directives stand over the file.
            region: ($) => seq($.separator, repeat($._item)),
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
                repeat(choice($.header, $._content_type, $.plain)),
              ),
            )
        : ($) =>
            prec.right(
              seq(
                optional(seq(field("method", alias($._bodiless_method, $.method)), $._ws)),
                $._request_line,
                repeat(seq($._ws, $.continuation)),
                repeat(choice($.header, $._content_type, $.comment, $.plain)),
              ),
            ),

      _body_request: wire
        ? ($) =>
            prec.right(
              seq(
                field("method", alias($._body_method, $.method)),
                $._ws,
                $._request_line,
                repeat(choice($.header, $._content_type, $.plain)),
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
                repeat(choice($.header, $._content_type, $.comment, $.plain)),
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

      header: ($) => header($, $._name_text),
      // The Content-Type header is a `header` like any other, held by its
      // message in the field `content_type`, because what a body's language
      // is turns on whether the message declares one at all, and a query can
      // say "no such field" (`!content_type`) where it cannot say "no header
      // by this name". Which line it is, the scanner says
      // (`_content_type_start`, zero-width): the name, in any case, then the
      // colon — a token cannot say "and nothing more of the name follows".
      _content_type: ($) => field("content_type", alias($._content_type_header, $.header)),
      _content_type_header: ($) => seq($._content_type_start, header($, $._name_text)),
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
      // (`continuation`) or the value of the header above it, and where
      // there is nothing to continue it is an error.
      plain: ($) => seq($._name_text, $._eol),

      // MARK: Responses

      response: wire
        ? ($) =>
            prec.right(
              seq(
                field("version", $.version),
                optional($._status_line_tail),
                $._eol,
                repeat(choice($.header, $._content_type, $.plain)),
                optional(seq(repeat1($._blank), optional(field("body", $.body)))),
              ),
            )
        : ($) =>
            prec.right(
              seq(
                field("version", $.version),
                optional($._status_line_tail),
                $._eol,
                repeat(choice($.header, $._content_type, $.comment, $.plain)),
                optional(seq(repeat1($._blank), optional(field("body", $._body)))),
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
          optional(seq(optional($._ws), field("reason", $.reason_phrase))),
        ),
      status_code: () => token(prec(PREC.TRIVIA, /[0-9]+/)),
      reason_phrase: () => text(""),

      // MARK: Bodies — lines of text and placeholders
      //
      // A request's body and a response's are the same rule: lines, and the blank lines between
      // them, up to the last blank lines before `###`, the end of the file
      // or a status line — the response, inline after a request or the
      // next after a response. That is what lets a `Content-Type:
      // message/http` body hold the echoed request whole, its own
      // header/body blank line included, on either side. A body is
      // right-associative: a line that could continue the body or begin the
      // next message — one opening with `{`, now that a placeholder may —
      // continues it.
      //
      // A body line is its indentation, then pieces with `_ws` between them:
      // `_body_text` runs between braces, `{` and `}` on their own, and
      // `placeholder` read the way a header value reads it. What decides the
      // line is its first token after the indentation — the opener on a
      // first line, a piece at `BODY` after it — and a whitespace-only line has
      // none of those: a run of them is the scanner's `_body_blank` when a
      // body line follows, and `_blank`, the region's, when nothing does.
      //
      // wire has one `body` node, terminal, opaque: each line is its
      // indentation, one text token, and its end, and a blank line is its
      // own token at `BODY`, so the body runs to EOF.

      ...(wire
        ? {
            body: ($) => seq($._body_line, repeat($._terminal_line)),
            _body_line: ($) => seq(optional($._ws), $._body_text, $._eol),
            _body_text: () => token(prec(PREC.BODY, text(""))),
            _terminal_line: ($) => choice($._body_line, $._terminal_blank),
            _terminal_blank: () => token(prec(PREC.BODY, /[ \t]*(\r?\n|\r)/)),
          }
        : {
            _body: ($) => choice($.file_body, $.body),

            // `< ./file`, `<@ ./file`, `<@name ./file`: the scanner's opener,
            // whitespace, the path. The one first line the format reads for
            // itself — it names what to send, not what language it is in.
            file_body: ($) => prec.right(seq($._file_line, repeat($._body_next))),
            _file_line: ($) => seq(optional($._ws), $._file_open, $._ws, field("path", $.path), $._eol),
            path: () => text(""),

            // Every other body. Its first line opens with the opener — text
            // ranked below a status line — or with a placeholder or braces.
            body: ($) => prec.right(seq($._first_line, repeat($._body_next))),
            _first_line: ($) => seq(optional($._ws), choice($._opener, $.placeholder, $._braces), $._rest),
            _opener: () => token(prec(PREC.OPENER, text("{}"))),

            // What follows a body's first line: a line inside it, or the blank
            // lines before one — the scanner's, so a run of blank lines that
            // no body line follows is never taken.
            _body_next: ($) => choice($._body_line, $._body_blank),
            // A line inside a body: indentation, then pieces. Never blank.
            _body_line: ($) => seq(optional($._ws), $._piece, $._rest),
            // The rest of a body line after its first token: more pieces, then
            // the line's end.
            _rest: ($) => seq(repeat(seq(optional($._ws), $._piece)), $._eol),

            _piece: ($) => choice($._body_text, $.placeholder, $._braces),
            _body_text: () => token(prec(PREC.BODY, text("{}"))),
          }),

      // MARK: Values and placeholders

      // A header's value: its pieces, on its own line and on every indented
      // line after it. Each indented line continues the value where the line
      // before it stopped: the line break and the indentation after it are
      // a `fold`, layout a consumer takes out of the value's text with nothing
      // in its place, and spaces before the break are the value's. Its colons
      // are its own (`00:00:00`): indented, a line can never be a header,
      // since `_name_text` demands a non-space first character.
      _header_value: wire
        ? ($) => seq($.value_text, repeat(seq(fold($), $.value_text)))
        : ($) => pieces($, choice($.value_text, $.placeholder, $._braces), choice($._ws, fold($))),
      value_text: wire ? () => text("") : () => text("{}"),

      ...(wire
        ? {}
        : {
            // A declaration's value or a directive's argument: one line.
            value: ($) => pieces($, choice($.value_text, $.placeholder, $._braces)),
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
