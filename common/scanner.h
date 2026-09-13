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
// the grammar's own `{{` token, which is text. The file dialect alone has
// placeholders; the wire dialect defines HAS_PLACEHOLDERS 0 and never lists
// the token.
//
// Shared by both dialects. External scanner symbols carry the language name,
// so each `<dialect>/src/scanner.c` defines SCANNER(fn) to prefix its own
// and includes this file.

#include "tree_sitter/parser.h"

enum TokenType { EOL, PLACEHOLDER_OPEN };

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
