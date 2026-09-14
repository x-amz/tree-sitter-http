// What the grammar cannot say itself, in two tokens.
//
// `_eol`: a line ends at a newline or at the end of the file — zero-width at
// EOF, so a final line without a trailing newline is still a complete line —
// and takes the spaces and tabs before it. A rule never needs a `_ws` in
// front of its `_eol`: the lexer runs a line's end in a state it shares
// with a line's start, where `_blank` is valid and outlasts `_ws` on
// `  \n`, and a `_ws` written there was lexed as a `_blank` the rule could
// not take.
//
// `_placeholder_open`: a `{{` that opens a placeholder. A placeholder never
// contains a brace, so a `{{` opens one exactly when `}}` follows on the
// same line with no brace between, and that is decided by looking along the
// line as far as the first brace — a grammar rule cannot look past the
// token it is deciding; a scanner can. A `{{` that opens nothing is left to
// the grammar's own `{{` token, which is text.
//
// `_closing_ws`: the spaces and tabs a `}}` follows, inside a placeholder —
// the closer owns them, as `_eol` owns the spaces before a line's end, so no
// rule has to say whether a space after a dynamic's argument is the
// separator before another or the one before the closer. A grammar rule
// cannot tell those apart without reading past the space; the scanner can.
//
// `_form_start`: zero-width at a body's first line when it opens `key=` — a
// first character that is not whitespace, `=`, `&`, a brace, `<` or `[`,
// then key characters, then `=`, then not a space: `a= b` is prose. The
// grammar's `key` token cannot say "followed by `=`", and without that a
// form body's first key would claim every raw body's first word. The token
// is zero-width so the grammar reads the key itself.
//
// `_file_open`: the `<` or `<@name` that opens a file body, which it is only
// when whitespace and a path follow on the line. A token cannot say
// "followed by whitespace" without taking it, and the whitespace is the
// grammar's `_ws`, so the scanner takes the opener and looks past it.
//
// The file dialect alone has placeholders and typed bodies; the wire dialect
// defines HAS_PLACEHOLDERS 0 and lists `_eol` alone.
//
// Shared by both dialects. External scanner symbols carry the language name,
// so each `<dialect>/src/scanner.c` defines SCANNER(fn) to prefix its own
// and includes this file.

#include "tree_sitter/parser.h"

enum TokenType { EOL, PLACEHOLDER_OPEN, CLOSING_WS, FORM_START, FILE_OPEN };

void *SCANNER(create)(void) { return NULL; }
void SCANNER(destroy)(void *payload) {}
unsigned SCANNER(serialize)(void *payload, char *buffer) { return 0; }
void SCANNER(deserialize)(void *payload, const char *buffer, unsigned length) {}

#if HAS_PLACEHOLDERS
// At a `{`: true when `{{` here is closed by `}}` on this line with no brace
// between. The token is the `{{`; what follows is looked at and left, and
// the look stops at the first brace, so a line of braces costs its length
// once. On false the runtime rewinds to where the look began.
static bool scan_placeholder_open(TSLexer *lexer) {
  if (lexer->lookahead != '{') return false;
  lexer->advance(lexer, false);
  if (lexer->lookahead != '{') return false;
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (c == '\n' || c == '\r' || c == '{') return false;
    lexer->advance(lexer, false);
    if (c == '}') return lexer->lookahead == '}';
  }
  return false;
}

// At a space or tab: true when the run of them ends at `}}`. The end is
// marked after the run, so the token is the whitespace and the `}}` is the
// grammar's.
static bool scan_closing_ws(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (lexer->lookahead != '}') return false;
  lexer->advance(lexer, false);
  return lexer->lookahead == '}';
}

static bool is_space(int32_t c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

// At a character that may begin a form key: true when key characters run to
// an `=` that no space follows. The end is marked before the look, so the
// token is zero-width and the grammar's `key` reads what was looked at.
static bool scan_form_start(TSLexer *lexer) {
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (c == '=') {
      lexer->advance(lexer, false);
      return lexer->lookahead != ' ' && lexer->lookahead != '\t';
    }
    if (is_space(c) || c == '&' || c == '{' || c == '}') return false;
    lexer->advance(lexer, false);
  }
  return false;
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

static bool may_begin_key(TSLexer *lexer) {
  int32_t c = lexer->lookahead;
  return !lexer->eof(lexer) && !is_space(c) && c != '=' && c != '&' && c != '{' && c != '}' && c != '<' && c != '[';
}
#endif

bool SCANNER(scan)(void *payload, TSLexer *lexer, const bool *valid_symbols) {
#if HAS_PLACEHOLDERS
  // A brace is a placeholder's opener or nothing of the scanner's: a
  // declined look has moved the lexer along the line, and the line-end
  // check below must not read from there.
  if (lexer->lookahead == '{') {
    if (valid_symbols[PLACEHOLDER_OPEN] && scan_placeholder_open(lexer)) {
      lexer->result_symbol = PLACEHOLDER_OPEN;
      return true;
    }
    return false;
  }
  // Whitespace inside a placeholder is the closer's when a `}}` follows it,
  // and otherwise the grammar's `_ws`; a declined look has moved along the
  // spaces, where no line end can start either.
  if (valid_symbols[CLOSING_WS] && (lexer->lookahead == ' ' || lexer->lookahead == '\t')) {
    if (scan_closing_ws(lexer)) {
      lexer->result_symbol = CLOSING_WS;
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
  // A form start is decided only where a key could begin, so a declined
  // look has read key characters — where no line end can start.
  if (valid_symbols[FORM_START] && may_begin_key(lexer)) {
    if (scan_form_start(lexer)) {
      lexer->result_symbol = FORM_START;
      return true;
    }
    return false;
  }
#endif
  if (!valid_symbols[EOL]) return false;
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, false);
  if (lexer->eof(lexer)) {
    lexer->result_symbol = EOL;
    return true;
  }
  if (lexer->lookahead == '\r') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == '\n') lexer->advance(lexer, false);
    lexer->result_symbol = EOL;
    return true;
  }
  if (lexer->lookahead == '\n') {
    lexer->advance(lexer, false);
    lexer->result_symbol = EOL;
    return true;
  }
  return false;
}
