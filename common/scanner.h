// What the grammar cannot say itself.
//
// `_eol`: a line ends at a newline or at the end of the file — zero-width at
// EOF, so a final line without a trailing newline is still a complete line —
// and takes the spaces and tabs before it. A rule never needs a `_ws` in
// front of its `_eol`: the lexer runs a line's end in a state it shares
// with a line's start, where `_blank` is valid and outlasts `_ws` on
// `  \n`, and a `_ws` written there was lexed as a `_blank` the rule could
// not take.
//
// `_fold`: the line break inside a header's value — the spaces and tabs
// before it, the break, and the indentation after it — only when the
// indented line is not blank. A header's value continues on every such
// line, and whether a break is `_fold` or the header's `_eol` is decided by
// the line after it, which a grammar rule cannot look at without taking.
//
// `_content_type_start`: zero-width at a header line whose name is
// Content-Type, in any case, with nothing more to the name: spaces or tabs
// and a `:` follow it. The grammar's name token cannot say "and then a
// colon", and the message holds this header in a field a query can ask
// after, or find absent.
//
// `placeholder`: a whole `{{…}}`, one token. A placeholder never contains a
// brace, so a `{{` opens one exactly when `}}` follows on the same line with
// no brace between, and that is decided by looking along the line as far as
// the first brace — a grammar rule cannot look past the token it is
// deciding; a scanner can. A `{{` that opens nothing is left to the
// grammar's own `{{` token, which is text. What the token holds is the
// expression grammar's, by injection.
//
// `_file_open`: the `<` or `<@name` that opens a file body, which it is only
// when whitespace and a path follow on the line. A token cannot say
// "followed by whitespace" without taking it, and the whitespace is the
// grammar's `_ws`, so the scanner takes the opener and looks past it.
//
// `_directive_start`: zero-width at the `@` after a comment prefix, only
// when an identifier follows it and the identifier ends the line or is
// followed by whitespace or `=`. Until a line is a directive it is a
// comment, and the grammar's `@` token would outrank the comment text and
// commit the line; the scanner looks along it first.
//
// `_body_blank`: a run of blank lines inside a body, which is content only
// when the body goes on after it — the token is the blank lines, and it is
// one only when the line after them is a body line: not the end of the
// file, not `###`, and not a status line, which is the response. A grammar
// can only say "a blank line, then a body line" by committing to the body
// at the first blank, and a body ending in blank lines would then be an
// error; the scanner reads past the run and decides. An indented line
// after the run is always a body line — a separator and a status line
// begin at the margin.
//
// The file dialect alone has placeholders and file bodies; the wire dialect
// defines HAS_PLACEHOLDERS 0 and lists `_eol`, `_content_type_start` and
// `_fold`.
//
// Shared by both dialects. External scanner symbols carry the language name,
// so each `<dialect>/src/scanner.c` defines SCANNER(fn) to prefix its own
// and includes this file.

#include "tree_sitter/parser.h"

enum TokenType { EOL, CONTENT_TYPE_START, FOLD, PLACEHOLDER, FILE_OPEN, DIRECTIVE_START, BODY_BLANK };

void *SCANNER(create)(void) { return NULL; }
void SCANNER(destroy)(void *payload) {}
unsigned SCANNER(serialize)(void *payload, char *buffer) { return 0; }
void SCANNER(deserialize)(void *payload, const char *buffer, unsigned length) {}

// At a `c`: true when the line reads `content-type`, in any case, then spaces
// or tabs, then `:`. The end is marked before the look, so the token is
// zero-width and the grammar reads the name itself.
static bool scan_content_type_start(TSLexer *lexer) {
  static const char name[] = "content-type";
  lexer->mark_end(lexer);
  for (const char *c = name; *c; c++) {
    int32_t l = lexer->lookahead;
    if (l >= 'A' && l <= 'Z') l += 'a' - 'A';
    if (l != *c) return false;
    lexer->advance(lexer, false);
  }
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
  return lexer->lookahead == ':';
}

#if HAS_PLACEHOLDERS
// At a `{`: true when `{{` here is closed by `}}` on this line with no brace
// between, and the token is the whole `{{…}}`. The look stops at the first
// brace, so a line of braces costs its length once. On false the runtime
// rewinds to where the look began.
static bool scan_placeholder(TSLexer *lexer) {
  if (lexer->lookahead != '{') return false;
  lexer->advance(lexer, false);
  if (lexer->lookahead != '{') return false;
  lexer->advance(lexer, false);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (c == '\n' || c == '\r' || c == '{') return false;
    lexer->advance(lexer, false);
    if (c == '}') {
      if (lexer->lookahead != '}') return false;
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      return true;
    }
  }
  return false;
}

static bool is_space(int32_t c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

// At a `<`: true when `<`, or `<@` and a run of non-space characters, is
// followed by spaces or tabs and then a path's first character. The token
// is the opener; the look past it is left for `_ws` and `path`.
static bool scan_file_open(TSLexer *lexer) {
  lexer->advance(lexer, false);
  if (lexer->lookahead == '@') {
    do lexer->advance(lexer, false); while (!lexer->eof(lexer) && !is_space(lexer->lookahead));
  }
  lexer->mark_end(lexer);
  if (lexer->lookahead != ' ' && lexer->lookahead != '\t') return false;
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
  return !lexer->eof(lexer) && !is_space(lexer->lookahead);
}

// The grammar's `identifier`: no whitespace, `.`, brackets, braces or `=`,
// and no `$` first.
static bool is_identifier_char(int32_t c) {
  return !is_space(c) && c != '.' && c != '[' && c != ']' && c != '{' && c != '}' && c != '=';
}

// At a `@`: true when an identifier follows and what follows the identifier
// is the line's end, whitespace or `=`. The end is marked before the look,
// so the token is zero-width and the grammar reads the `@` and the name.
static bool scan_directive_start(TSLexer *lexer) {
  lexer->mark_end(lexer);
  lexer->advance(lexer, false);
  if (lexer->eof(lexer) || !is_identifier_char(lexer->lookahead) || lexer->lookahead == '$') return false;
  do lexer->advance(lexer, false); while (!lexer->eof(lexer) && is_identifier_char(lexer->lookahead));
  return lexer->eof(lexer) || is_space(lexer->lookahead) || lexer->lookahead == '=';
}

// At a line's start inside a body: true when one or more whitespace-only
// lines run to a line the body continues on. The end is marked after each
// blank line, so the token is the run and the line after it is the
// grammar's to read.
static bool scan_body_blank(TSLexer *lexer) {
  bool any = false;
  bool indented = false;
  for (;;) {
    indented = false;
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
      lexer->advance(lexer, false);
      indented = true;
    }
    if (lexer->lookahead == '\r') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '\n') lexer->advance(lexer, false);
    } else if (lexer->lookahead == '\n') {
      lexer->advance(lexer, false);
    } else {
      break;
    }
    any = true;
    lexer->mark_end(lexer);
  }
  if (!any || lexer->eof(lexer)) return false;
  if (indented) return true;
  // At the margin: `###` ends the body, and a version opens the response.
  if (lexer->lookahead == '#') {
    lexer->advance(lexer, false);
    if (lexer->lookahead != '#') return true;
    lexer->advance(lexer, false);
    return lexer->lookahead != '#';
  }
  static const char version[] = "HTTP/";
  for (const char *c = version; *c; c++) {
    if (lexer->lookahead != *c) return true;
    lexer->advance(lexer, false);
  }
  return !((lexer->lookahead >= '0' && lexer->lookahead <= '9') || lexer->lookahead == '.');
}

#endif

bool SCANNER(scan)(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  // A `c` where a header may begin is Content-Type's or nothing of the
  // scanner's: a declined look has moved along the line, and no line end
  // starts at a letter.
  if (valid_symbols[CONTENT_TYPE_START] && (lexer->lookahead == 'c' || lexer->lookahead == 'C')) {
    if (scan_content_type_start(lexer)) {
      lexer->result_symbol = CONTENT_TYPE_START;
      return true;
    }
    return false;
  }
#if HAS_PLACEHOLDERS
  // A brace is a placeholder's opener or nothing of the scanner's: a
  // declined look has moved the lexer along the line, and the line-end
  // check below must not read from there.
  if (lexer->lookahead == '{') {
    if (valid_symbols[PLACEHOLDER] && scan_placeholder(lexer)) {
      lexer->result_symbol = PLACEHOLDER;
      return true;
    }
    return false;
  }
  // A `<` is a file body's opener or nothing of the scanner's, by the same
  // reasoning.
  if (lexer->lookahead == '<') {
    if (valid_symbols[FILE_OPEN] && scan_file_open(lexer)) {
      lexer->result_symbol = FILE_OPEN;
      return true;
    }
    return false;
  }
  // A `@` is a directive's opener or nothing of the scanner's, by the same
  // reasoning.
  if (lexer->lookahead == '@') {
    if (valid_symbols[DIRECTIVE_START] && scan_directive_start(lexer)) {
      lexer->result_symbol = DIRECTIVE_START;
      return true;
    }
    return false;
  }
  // A blank run inside a body is decided where a body line ends, and a
  // declined look has read blank lines and the start of what follows; the
  // runtime rewinds, and `_blank` reads the first of them.
  if (valid_symbols[BODY_BLANK] && (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
                                    lexer->lookahead == '\r' || lexer->lookahead == '\n')) {
    if (scan_body_blank(lexer)) {
      lexer->result_symbol = BODY_BLANK;
      return true;
    }
    return false;
  }
#endif
  if (!valid_symbols[EOL] && !valid_symbols[FOLD]) return false;
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
  if (lexer->eof(lexer)) {
    lexer->result_symbol = EOL;
    return valid_symbols[EOL];
  }
  if (lexer->lookahead == '\r') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == '\n') lexer->advance(lexer, false);
  } else if (lexer->lookahead == '\n') {
    lexer->advance(lexer, false);
  } else {
    return false;
  }
  // Inside a header's value, an indented line that is not blank continues
  // it. The end is marked at the break first, so a look that finds no such
  // line leaves the `_eol` behind it.
  if (valid_symbols[FOLD]) {
    lexer->mark_end(lexer);
    bool indented = false;
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
      lexer->advance(lexer, false);
      indented = true;
    }
    if (indented && !lexer->eof(lexer) && lexer->lookahead != '\r' && lexer->lookahead != '\n') {
      lexer->mark_end(lexer);
      lexer->result_symbol = FOLD;
      return true;
    }
  }
  lexer->result_symbol = EOL;
  return valid_symbols[EOL];
}
