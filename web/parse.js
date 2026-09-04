// One parse of one text, and everything it yields: the token stream the lexer
// actually produced, the per-line decision the gutter shows, the LR trace
// behind both, the tree as a renderable model, and what an edit lets the
// parser keep. Nothing here is written down about the grammar — the token
// stream is read back out of the parser's own log, so what the page says a
// line is, is what the parser did with it.
//
// Two units to hold on to. Everything on the tree-sitter JS surface is UTF-16
// code units, matching `String.length`; inside a log message `column`, `col`
// and `size` are the wasm's internal byte offsets, twice that. `row` is a real
// line number. The conversions happen here, once, so nothing downstream has to
// know.

/** The symbol id tree-sitter reserves for an error node. */
const ERROR_ID = 65535;

/** The symbol a log message names, up to whichever key follows it. */
const SYM = /(?:^|[ ,])(?:sym|symbol|lookahead):(.*?)(?=, (?:size|child_count|state|over_symbol|first_leaf_symbol):|$)/;

/** The parse is over; nothing that follows belongs to a token. */
const FINISHED = new Set(["accept", "done"]);

/**
 * Parse `source` with a highlight.js bundle and return everything one parse
 * says about itself: `tree`, `ms`, `bytes`, `events`, `tokens`, `lines`,
 * `errors`, `counts`. The tree is live; the caller deletes it.
 *
 * `options.tokenTable` is grammar.js's `facts(dialect).tokens` — the rows the
 * line and candidate reports join against; without it symbols come back
 * unannotated. `options.characters` keeps a trace entry per consumed
 * character, the lexer's own steps and about two thirds of the log.
 * `options.maxEvents` caps `events` alone: tokens and lines stay complete for
 * a document of any size, because the log is folded as it arrives.
 *
 * `options.previous` is an already-edited old tree to reparse against, and
 * adds `changed`, the ranges that differ. It buys speed at the cost of the
 * report: an incremental parse lexes only what it had to, so the token stream
 * and the line table cover the edit and nothing else. A full parse is what
 * fills the gutter.
 */
export function analyze(bundle, source, options = {}) {
  const { tokenTable = null, characters = false, maxEvents = 20000, previous = null } = options;
  const table = tokenIndex(tokenTable);
  const starts = lineStarts(source);

  const events = [];
  const tokens = [];
  let truncated = false;
  let chars = 0;
  let version = 0;
  let state = 0; // the parse state the current step runs in, which is what the lexer is asked from
  let lex = null; // the lex attempt that produced the token being lexed
  let open = null; // the token waiting to learn whether it was shifted or thrown away

  const record = (event) => {
    if (events.length >= maxEvents) {
      truncated = true;
      return;
    }
    event.index = events.length;
    events.push(event);
  };
  // Every event carries the same slots whether the message filled them or not:
  // one shape for the whole trace, which is what a table wants to render.
  const entry = (kind, raw, isLex, sym, chars) => ({
    index: -1, kind, raw, isLex, sym, state: null, row: null, column: null, size: null, chars,
  });

  const parser = bundle.parser;
  parser.setLogger((message, isLex) => {
    // `consume character` / `skip character` are the only lex-flagged messages
    // and they outnumber everything else, so they get the short path.
    if (isLex) {
      chars += 1;
      if (characters) record(entry(head(message), message, true, tail(message, "character:"), 1));
      return;
    }

    const event = entry(head(message), message, false, null, chars);
    const kind = event.kind;
    chars = 0;

    switch (kind) {
      case "process":
        version = num(message, "version") ?? version;
        state = num(message, "state") ?? state;
        event.state = state;
        event.row = num(message, "row");
        event.column = half(num(message, "col"));
        break;
      case "lex_internal":
      case "lex_external":
        lex = {
          state: num(message, "state"),
          row: num(message, "row"),
          column: half(num(message, "column")),
          external: kind === "lex_external",
        };
        event.state = lex.state;
        event.row = lex.row;
        event.column = lex.column;
        break;
      case "lexed_lookahead": {
        event.sym = symbolIn(message);
        event.size = half(num(message, "size"));
        const row = lex?.row ?? 0;
        const column = lex?.column ?? 0;
        const start = (starts[row] ?? source.length) + column;
        open = {
          symbol: event.sym,
          start,
          end: start + (event.size ?? 0),
          size: event.size ?? 0,
          row,
          column,
          lexState: lex?.state ?? null,
          external: lex?.external ?? false,
          parseState: state,
          shift: null,
          version,
          accepted: false,
          skipped: false,
          recovered: false,
          reduces: [],
          event: events.length < maxEvents ? events.length : -1,
        };
        tokens.push(open);
        lex = null;
        break;
      }
      case "reduce":
        event.sym = symbolIn(message);
        // How many items come off the stack — what makes the stack, and so the
        // derivation, reconstructable from the log alone.
        event.count = num(message, "child_count");
        open?.reduces.push(event.sym);
        break;
      case "shift":
      case "shift_extra":
        event.state = num(message, "state");
        // The first version to take the token is the one that decides where it
        // went; later versions shift the same lookahead from their own stacks.
        if (open && open.shift === null) {
          open.accepted = true;
          open.shift = event.state;
        }
        break;
      case "skip_token":
        event.sym = symbolIn(message);
        if (open) open.skipped = true;
        break;
      case "detect_error":
      case "recover_to_previous":
      case "recover_with_missing":
      case "recover_eof":
        event.sym = symbolIn(message);
        event.state = num(message, "state");
        if (open) open.recovered = true;
        break;
      default:
        event.sym = symbolIn(message);
        event.state = num(message, "state");
        break;
    }

    // A token is the lookahead until the next one is lexed, however many GLR
    // versions act on it — one may skip it while another shifts it, and both
    // are true of the token.
    if (FINISHED.has(kind)) open = null;
    record(event);
  });

  let tree;
  const began = performance.now();
  try {
    tree = parser.parse(source, previous);
  } finally {
    parser.setLogger(null);
  }
  const ms = performance.now() - began;
  if (!tree) throw new Error("the bundle's parser has no language set");

  const root = tree.rootNode;
  const errors = collectErrors(root);
  const result = {
    tree,
    ms,
    bytes: utf8Length(source),
    events,
    tokens,
    lines: lineReport(source, starts, tokens, errors, table),
    errors,
    counts: {
      nodes: root.descendantCount,
      errors: errors.filter((e) => e.kind === "ERROR").length,
      missing: errors.filter((e) => e.kind === "MISSING").length,
      tokens: tokens.length,
      events: events.length,
      truncated,
    },
  };
  if (previous) result.changed = previous.getChangedRanges(tree);
  return result;
}

/**
 * Why a line lexed the way it did: every symbol parse state `state` accepts,
 * joined to the token table and tried against `text` at `offset`. Sorted so
 * the top of the list is the reading that won — what matched first, then by
 * precedence, then by how much it took. Symbols with no token row (a
 * non-terminal, a hidden symbol) come back flagged rather than dropped.
 */
export function candidates(language, tokenTable, state, text, offset) {
  const table = tokenIndex(tokenTable);
  const rows = [];
  // A name can sit at several symbol ids (`method` is two); the vocabulary word
  // is what the explanation is about, so it appears once.
  for (const symbol of new Set(acceptedTokens(language, state))) {
    const found = rowsFor(table, symbol);
    if (!found.length) {
      rows.push({ symbol, rule: null, precedence: null, pattern: null, matched: false, length: 0, resolved: false });
      continue;
    }
    for (const row of found) {
      const length = attempt(row, text, offset);
      rows.push({
        symbol,
        rule: row.rule ?? null,
        precedence: row.precedence ?? null,
        pattern: row.value ?? null,
        matched: length > 0,
        length: Math.max(length, 0),
        // A pattern the table carries but JS will not compile is a row nothing
        // can be asked of, so it is flagged like a symbol with no row at all.
        resolved: length >= 0,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      Number(b.matched) - Number(a.matched) ||
      (b.precedence ?? 0) - (a.precedence ?? 0) ||
      b.length - a.length ||
      a.symbol.localeCompare(b.symbol),
  );
}

/**
 * The tree as nested plain data, one cursor walk. `options.anonymous` keeps
 * unnamed children (default true); `options.limit` caps how many nodes are
 * built, and a node whose children were cut carries `truncated`. Childless
 * nodes carry their `text`; the root also carries `count`.
 */
export function treeModel(tree, source, options = {}) {
  const { anonymous = true, limit = 20000 } = options;
  const cursor = tree.walk();
  let count = 0;

  const build = () => {
    count += 1;
    const node = cursor.currentNode;
    const childCount = node.childCount;
    const model = {
      id: cursor.nodeId,
      typeId: cursor.nodeTypeId,
      type: cursor.nodeType,
      grammarType: node.grammarType,
      named: cursor.nodeIsNamed,
      missing: cursor.nodeIsMissing,
      error: cursor.nodeTypeId === ERROR_ID,
      extra: node.isExtra,
      field: cursor.currentFieldName ?? null,
      start: cursor.startIndex,
      end: cursor.endIndex,
      startPoint: cursor.startPosition,
      endPoint: cursor.endPosition,
      childCount,
      children: [],
      truncated: false,
      text: childCount ? null : source.slice(cursor.startIndex, cursor.endIndex),
    };
    if (cursor.gotoFirstChild()) {
      do {
        if (count >= limit) {
          model.truncated = true;
          continue;
        }
        if (!anonymous && !cursor.nodeIsNamed) continue;
        model.children.push(build());
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
    return model;
  };

  const root = build();
  cursor.delete();
  root.count = count;
  return root;
}

/**
 * The corpus-form S-expression for a node. `options.fields` keeps the
 * `name: ` prefixes tree-sitter prints (default true); corpus.js owns what a
 * comparison does with them.
 */
export function sexp(node, options = {}) {
  const { fields = true } = options;
  const text = node.toString();
  return fields ? text : stripFields(text);
}

/**
 * What an edit costs. The change is the common prefix and suffix of `before`
 * and `after`; the old tree is copied, edited and handed back to the parser,
 * and the result is timed against a parse from scratch. `reused` counts the
 * node ids the new tree shares with the old one — tree-sitter keeps a reused
 * subtree at its address, so a shared id is a subtree that was not rebuilt.
 */
export function incremental(bundle, before, after) {
  const parser = bundle.parser;
  parser.setLogger(null); // the timings are the point; a logger costs about 7x

  const edit = editBetween(before, after);
  const old = parser.parse(before);
  const coldBegan = performance.now();
  const cold = parser.parse(after);
  const coldMs = performance.now() - coldBegan;

  const edited = old.copy();
  edited.edit(edit);
  const warmBegan = performance.now();
  const warm = parser.parse(after, edited);
  const warmMs = performance.now() - warmBegan;

  // Called on the edited old tree with the new one as the argument; the other
  // way round the answer is nonsense.
  const changedRanges = edited.getChangedRanges(warm);
  const was = nodeIds(old);
  let reused = 0;
  let total = 0;
  for (const id of nodeIds(warm)) {
    total += 1;
    if (was.has(id)) reused += 1;
  }

  for (const tree of [old, cold, edited, warm]) tree.delete();
  return { edit, changedRanges, reused, total, coldMs, warmMs };
}

/**
 * The token names a parse state accepts, resolved through `nodeTypeForId` so
 * the grammar's hidden symbols come back by name instead of as `ERROR`.
 */
export function acceptedTokens(language, state) {
  const iterator = language.lookaheadIterator(state);
  if (!iterator) return [];
  const names = [];
  for (const _ of iterator) {
    const name = language.nodeTypeForId(iterator.currentTypeId);
    if (name) names.push(name);
  }
  iterator.delete();
  return names;
}

// --- the log ---------------------------------------------------------------

/** The first word of a log message — its kind. */
function head(message) {
  const space = message.indexOf(" ");
  return space < 0 ? message : message.slice(0, space);
}

/** Everything after `key` in a log message. */
function tail(message, key) {
  const at = message.indexOf(key);
  return at < 0 ? null : message.slice(at + key.length);
}

/** `key:123` in a log message. Keys are matched with their colon, so `col` never reads `column`. */
function num(message, key) {
  const at = message.indexOf(`${key}:`);
  if (at < 0) return null;
  let value = 0;
  let digits = 0;
  for (let i = at + key.length + 1; i < message.length; i += 1) {
    const code = message.charCodeAt(i);
    if (code < 48 || code > 57) break;
    value = value * 10 + (code - 48);
    digits += 1;
  }
  return digits ? value : null;
}

/** A log message's `column`/`col`/`size` is twice the UTF-16 offset it means. */
const half = (value) => (value === null ? null : value / 2);

/** The symbol a message is about. Names may hold a colon (`sym::`), so the terminator decides. */
function symbolIn(message) {
  const match = SYM.exec(message);
  return match ? match[1] : null;
}

// --- lines -----------------------------------------------------------------

/** Where each line begins, including the empty one a trailing newline leaves. */
function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code === 10) starts.push(i + 1);
    else if (code === 13) {
      if (source.charCodeAt(i + 1) === 10) i += 1;
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * One row per source line, whatever else the parse did: the token that opened
 * it, and what the grammar calls that. A line the parser threw away still gets
 * its token — the first one lexed there — with `accepted` false on it.
 */
function lineReport(source, starts, tokens, errors, table) {
  const opener = new Array(starts.length).fill(null);
  const lexed = new Array(starts.length).fill(null);
  const broken = new Array(starts.length).fill(false);
  for (const error of errors) {
    for (let row = rowAt(starts, error.start); row < starts.length && starts[row] <= error.end; row += 1) {
      broken[row] = true;
    }
  }
  for (const token of tokens) {
    if (token.row >= starts.length) continue;
    if (!lexed[token.row]) lexed[token.row] = token;
    if (token.accepted && !opener[token.row]) opener[token.row] = token;
  }

  const lines = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const next = starts[index + 1] ?? source.length;
    const end = trimEol(source, start, next);
    const token = opener[index] ?? lexed[index];
    const rows = token ? rowsFor(table, token.symbol) : [];
    lines.push({
      index,
      start,
      end,
      text: source.slice(start, end),
      token,
      symbol: token?.symbol ?? null,
      precedence: precedenceOf(rows),
      kind: token ? label(token.symbol) : null,
      error: broken[index],
    });
  }
  return lines;
}

/** The line an index falls on, by binary search over the line starts. */
function rowAt(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The highest precedence the table gives a symbol, or null where it gives none. */
function precedenceOf(rows) {
  const declared = rows.map((row) => row.precedence).filter((value) => typeof value === "number");
  return declared.length ? Math.max(...declared) : null;
}

/** The line's content, without the terminator the next line's start counts. */
function trimEol(source, start, next) {
  let end = next;
  if (end > start && source.charCodeAt(end - 1) === 10) end -= 1;
  if (end > start && source.charCodeAt(end - 1) === 13) end -= 1;
  return end;
}

/**
 * The gutter's word for a line: the token's own name, undecorated. It comes
 * from the symbol rather than the table row, because one symbol can carry
 * several rules — `method` is `_bodiless_method` and `_body_method` at once,
 * and neither of those is what the line is.
 */
function label(symbol) {
  return base(symbol).replace(/^_/, "");
}

// --- the token table -------------------------------------------------------

/** The generated parser names an inline token after its rule (`_raw_head` -> `_raw_head_token1`). */
const base = (symbol) => symbol.replace(/_token\d+$/, "");

/** Wrappers that leave a token as its rule's whole right-hand side. */
const LEXICAL = new Set(["TOKEN", "IMMEDIATE_TOKEN", "PREC", "PREC_LEFT", "PREC_RIGHT", "PREC_DYNAMIC"]);

function tokenIndex(tokenTable) {
  const bySymbol = new Map();
  const byRule = new Map();
  const byLiteral = new Map();
  for (const row of tokenTable ?? []) {
    push(bySymbol, row.symbol, row);
    // A rule name stands for a token only when the rule is nothing but that
    // token. `comment` is a rule with an inline pattern inside a `seq`, and the
    // parser's symbol of that name is the non-terminal, not the pattern.
    if ((row.path ?? []).every((type) => LEXICAL.has(type))) push(byRule, row.rule, row);
    // An anonymous token's symbol is its own literal, whatever the rule holding
    // it is called: `token(prec(TRIVIA, "@"))` in `_at` is the symbol `@`.
    if (String(row.kind).toLowerCase() === "string") push(byLiteral, row.value, row);
  }
  return { bySymbol, byRule, byLiteral };
}

function push(map, key, row) {
  if (key === undefined || key === null) return;
  const rows = map.get(key);
  if (rows) rows.push(row);
  else map.set(key, [row]);
}

/** A parser symbol's table rows: by symbol, by rule, by literal, then with the `_tokenN` suffix taken off. */
function rowsFor(table, symbol) {
  if (!symbol) return [];
  return (
    table.bySymbol.get(symbol) ??
    table.byRule.get(symbol) ??
    table.byLiteral.get(symbol) ??
    []
  );
}

const compiled = new Map();

/** How much of `text` at `offset` a table row takes; 0 for no match, -1 for a pattern that will not compile. */
function attempt(row, text, offset) {
  if (row.kind === "string" || row.kind === "STRING") {
    return text.startsWith(row.value, offset) ? row.value.length : 0;
  }
  if (typeof row.value !== "string") return -1;
  if (!compiled.has(row.value)) {
    try {
      compiled.set(row.value, new RegExp(row.value, "y"));
    } catch {
      compiled.set(row.value, null);
    }
  }
  const pattern = compiled.get(row.value);
  if (!pattern) return -1;
  pattern.lastIndex = offset;
  const match = pattern.exec(text);
  return match ? match[0].length : 0;
}

// --- the tree --------------------------------------------------------------

/**
 * Every ERROR and MISSING node, with a parse state that is worth asking about:
 * both kinds report state 0, so the state comes from the node's first leaf.
 */
function collectErrors(root) {
  const found = [];
  const visit = (node) => {
    if (node.isError || node.isMissing) {
      let leaf = node;
      while (leaf.childCount) leaf = leaf.firstChild;
      found.push({
        kind: node.isMissing ? "MISSING" : "ERROR",
        type: node.type,
        start: node.startIndex,
        end: node.endIndex,
        row: node.startPosition.row,
        column: node.startPosition.column,
        state: leaf.parseState,
      });
    }
    if (!node.hasError) return;
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/** Every node id in a tree, in one cursor walk. */
function nodeIds(tree) {
  const ids = new Set();
  const cursor = tree.walk();
  let descending = true;
  for (;;) {
    if (descending) ids.add(cursor.nodeId);
    if (descending && cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) {
      descending = true;
      continue;
    }
    if (!cursor.gotoParent()) break;
    descending = false;
  }
  cursor.delete();
  return ids;
}

/** Quoted anonymous tokens can hold a colon, so only the runs outside quotes lose their fields. */
function stripFields(text) {
  return text
    .split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/)
    .map((part, index) => (index % 2 ? part : part.replace(/\b[A-Za-z_][A-Za-z0-9_]*: (?=\()/g, "")))
    .join("");
}

// --- edits -----------------------------------------------------------------

/**
 * The one change between two texts, as tree-sitter's six-field edit. All six
 * are required: a missing one marshals to 0 and corrupts the reparse silently.
 */
function editBetween(before, after) {
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  // Never cut a surrogate pair in half — the halves are equal but the code point is not.
  if (start > 0 && isHigh(before.charCodeAt(start - 1))) start -= 1;

  let suffix = 0;
  while (
    suffix < shortest - start &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLow(before.charCodeAt(before.length - suffix))) suffix -= 1;

  const oldEndIndex = before.length - suffix;
  const newEndIndex = after.length - suffix;
  const was = lineStarts(before);
  const now = lineStarts(after);
  return {
    startIndex: start,
    oldEndIndex,
    newEndIndex,
    startPosition: point(was, start),
    oldEndPosition: point(was, oldEndIndex),
    newEndPosition: point(now, newEndIndex),
  };
}

const isHigh = (code) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code) => code >= 0xdc00 && code <= 0xdfff;

/** A UTF-16 index as tree-sitter's {row, column}. */
function point(starts, index) {
  const row = rowAt(starts, index);
  return { row, column: index - starts[row] };
}

/** What the document weighs on the wire, which is not what it measures in the parser. */
function utf8Length(source) {
  let bytes = 0;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.codePointAt(i);
    if (code > 0xffff) {
      i += 1;
      bytes += 4;
    } else if (code > 0x7ff) bytes += 3;
    else if (code > 0x7f) bytes += 2;
    else bytes += 1;
  }
  return bytes;
}
