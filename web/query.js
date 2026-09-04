// The query side of the guide: what a `.scm` compiles to, and why a pattern
// that looks like it should have fired did not.
//
// A compiled query gives back less than it took in. Byte offsets per pattern,
// capture names, `#set!` properties — but web-tree-sitter folds `#match?`,
// `#eq?` and `#any-of?` into closures and never names them again, so the media
// types in `queries/http_message/injections.scm` are unrecoverable from the
// object. Every answer here is the compiled query read together with the text
// it came from.
//
// Two numbers are not interchangeable. `startIndexForPattern` and
// `endIndexForPattern` are UTF-8 byte offsets; a `QueryError`'s index is a
// UTF-16 code-unit index; both injection queries carry em dashes in their
// comments, so the distinction moves the underline. And `endIndexForPattern`
// is the start of the *next* pattern, not the end of this one — slicing it
// verbatim hands every section comment to the pattern above — so a pattern's
// end is found by scanning a balanced s-expression and capping there.
//
// A near-miss is found by compiling a second copy of the query with every text
// predicate blanked to spaces — same length, so pattern indices and offsets are
// the same numbers in both copies — running that against the same tree, and
// re-evaluating each blanked predicate by hand. What failed is the answer.

import { CaptureQuantifier } from "tree-sitter-http-web/dist/tree-sitter.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The operators web-tree-sitter tests against capture text. `#set!`, `#is?`
// and `#is-not?` become properties instead and carry `injection.language`, so
// relaxation leaves them alone; anything else it never evaluates at all.
const TEXT_PREDICATES = new Set([
  "eq?", "not-eq?", "any-eq?", "any-not-eq?",
  "match?", "not-match?", "any-match?", "any-not-match?",
  "any-of?", "not-any-of?",
]);

const VERDICT_ORDER = { matched: 0, "near-miss": 1, "no-match": 2 };

/**
 * Compile `scm` against `language`. `Query` is passed in so this module needs
 * no runtime of its own. Returns the query with its pattern records, or the
 * failure located in the source.
 */
export function compile(Query, language, scm) {
  try {
    const query = new Query(language, scm);
    return { ok: true, query, patterns: patterns(query, scm), captureNames: [...query.captureNames] };
  } catch (error) {
    return { ok: false, error: describeError(error, scm) };
  }
}

/**
 * One record per pattern: where it sits in `scm`, its own source text, the
 * captures it uses, its properties, and the predicates the runtime parsed but
 * will never evaluate.
 */
export function patterns(query, scm) {
  const bytes = encoder.encode(scm);
  const records = [];
  for (let index = 0; index < query.patternCount(); index++) {
    const startByte = query.startIndexForPattern(index);
    const capIndex = indexOfByte(bytes, query.endIndexForPattern(index));
    const startIndex = indexOfByte(bytes, startByte);
    const endIndex = Math.min(capIndex, patternEnd(scm, startIndex));
    const quantifiers = query.captureQuantifiers[index];
    records.push({
      index,
      startByte,
      endByte: byteOfIndex(scm, endIndex),
      startIndex,
      endIndex,
      line: locate(scm, startIndex).line,
      source: scm.slice(startIndex, endIndex),
      // whatever sits between this pattern and the next one — usually the
      // comment that introduces the next one, so display it there.
      trailing: scm.slice(endIndex, capIndex),
      captures: query.captureNames.filter((_, id) => quantifiers[id] !== CaptureQuantifier.Zero),
      properties: query.setProperties[index] ?? {},
      asserted: query.assertedProperties[index] ?? {},
      refuted: query.refutedProperties[index] ?? {},
      // an unrecognised operator compiles cleanly and is then ignored: a
      // typo'd `#matches?` silently stops filtering anything.
      unknownPredicates: query.predicatesForPattern(index) ?? [],
      rooted: query.isPatternRooted(index),
      nonLocal: query.isPatternNonLocal(index),
    });
  }
  return records;
}

/**
 * The same query with every text predicate blanked out, so a pattern matches
 * on structure alone, plus each blanked predicate parsed back into the
 * operator, capture and pattern the runtime consumed.
 */
export function relax(scm) {
  const stripped = predicateSpans(scm).filter((span) => TEXT_PREDICATES.has(span.op)).map(strip);
  let source = "";
  let at = 0;
  for (const span of stripped) {
    source += scm.slice(at, span.start) + blank(scm.slice(span.start, span.end));
    at = span.end;
  }
  return { source: source + scm.slice(at), stripped };
}

/**
 * Apply one stripped predicate to a match's captures the way web-tree-sitter
 * would, down to a positive `#match?` over zero captured nodes failing.
 * `captures` are `{name, node}` or `{name, text}`; `source` supplies the text
 * when the node cannot.
 */
export function evaluate(predicate, captures, source) {
  const values = textsFor(predicate.capture, captures, source);
  if (!TEXT_PREDICATES.has(predicate.op)) return { passed: true, values, against: null, evaluated: false };
  if (predicate.error) return { passed: false, values, against: null, evaluated: false, error: predicate.error };

  const positive = !predicate.op.includes("not-");
  const all = !predicate.op.startsWith("any-");

  if (predicate.op.endsWith("of?")) {
    if (values.length === 0) return { passed: !positive, values, against: null, evaluated: true };
    const passed = values.every((text) => predicate.strings.includes(text)) === positive;
    return { passed, values, against: null, evaluated: true };
  }
  if (predicate.op.endsWith("match?")) {
    if (values.length === 0) return { passed: !positive, values, against: null, evaluated: true };
    const test = (text) => predicate.regex.test(text) === positive;
    return { passed: all ? values.every(test) : values.some(test), values, against: null, evaluated: true };
  }
  const against = predicate.against ? textsFor(predicate.against, captures, source) : null;
  const test = against
    ? (text) => against.some((other) => (text === other) === positive)
    : (text) => (text === predicate.strings[0]) === positive;
  return { passed: all ? values.every(test) : values.some(test), values, against, evaluated: true };
}

/**
 * What the injection query did to one text, and what it nearly did. Every
 * `injection.content` range the patterns can reach, strict or not, with the
 * predicate that decided each. `bundle` supplies the parser only — `scm` may
 * be text the reader is editing, which the bundle's own query predates — and
 * `resolved` is left null because which languages loaded is the caller's fact.
 */
export function injections(bundle, language, source, scm, Query) {
  const relaxed = relax(scm);
  const loose = compile(Query, language, relaxed.source);
  if (!loose.ok) return { ok: false, error: loose.error, patterns: [], records: [], counts: counted([]) };

  // A predicate the runtime rejects (wrong arity, a capture where a string
  // belongs) kills the strict query but not the relaxed one, so the lens can
  // still show what the patterns reach. Every record is then non-strict.
  const strict = compile(Query, language, scm);
  const table = patterns(loose.query, scm);
  const tree = bundle.parser.parse(source);

  const struck = new Set();
  if (strict.ok) for (const match of strict.query.matches(tree.rootNode)) struck.add(rangeKey(match));

  const records = [];
  for (const match of loose.query.matches(tree.rootNode)) {
    const pattern = table[match.patternIndex];
    const results = relaxed.stripped
      .filter((span) => span.start >= pattern.startIndex && span.end <= pattern.endIndex)
      .map((span) => ({ ...span, ...evaluate(span, match.captures, source) }));
    const failed = results.filter((result) => !result.passed);
    const captures = match.captures.map(({ name, node }) => ({
      name,
      start: node.startIndex,
      end: node.endIndex,
      text: source.slice(node.startIndex, node.endIndex),
    }));
    const named = captures.find((capture) => capture.name === "injection.language");
    records.push({
      patternIndex: match.patternIndex,
      language: named ? named.text : pattern.properties["injection.language"] ?? null,
      ranges: captures.filter((c) => c.name === "injection.content").map(({ start, end, text }) => ({ start, end, text })),
      resolved: null,
      captures,
      // the `_`-prefixed captures: the header that decided, and the text of it
      supporting: captures.filter((c) => !c.name.startsWith("injection."))
        .map((c) => ({ capture: c.name, text: c.text })),
      verdict: failed.length === 0 ? "matched" : failed.length < results.length ? "near-miss" : "no-match",
      passed: results.filter((result) => result.passed),
      failed,
      strict: struck.has(rangeKey(match)),
      folded: [],
    });
  }

  // Every injection pattern here names `(header …)` unanchored, so a pattern
  // fires once per header in the message and the same body comes back as many
  // rows that differ only in which header was tested. One range and one
  // pattern decide one thing: keep the row that came closest, fold the rest.
  const groups = new Map();
  for (const record of records) {
    const key = `${record.patternIndex} ${record.ranges.map((r) => `${r.start}-${r.end}`).join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const kept = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.failed.length - b.failed.length);
    const [best, ...rest] = group;
    best.folded = rest;
    kept.push(best);
  }
  kept.sort((a, b) =>
    VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
    || a.failed.length - b.failed.length
    || (a.ranges[0]?.start ?? 0) - (b.ranges[0]?.start ?? 0)
    || a.patternIndex - b.patternIndex);

  tree.delete();
  loose.query.delete();
  if (strict.ok) strict.query.delete();

  return { ok: true, error: strict.ok ? null : strict.error, patterns: table, records: kept, counts: counted(kept) };
}

/**
 * Which of a dialect's visible node types a highlight query names and which it
 * never mentions. `query` is a `compile` result: its pattern sources carry the
 * node names, its compiled query the captures. Pass a parsed `root` as well to
 * separate the types that carry their own paint from the ones that take a
 * captured ancestor's and the ones that stay bare.
 */
export function coverage(nodeTypes, query, root = null) {
  const compiled = query.query ?? query;
  const mentioned = new Map();
  for (const pattern of query.patterns ?? []) scanMentions(blankPredicates(pattern.source), mentioned, []);

  const counts = root ? classify(compiled, root) : null;
  const visible = new Map(nodeTypes.map((entry) => [entry.type, Boolean(entry.named)]));
  const names = new Set([...visible.keys(), ...mentioned.keys(), ...(counts?.keys() ?? [])]);

  const types = [...names].sort().map((type) => {
    const mention = mentioned.get(type);
    const count = counts?.get(type);
    return {
      type,
      named: visible.get(type) ?? mention?.named ?? count?.named ?? true,
      visible: visible.has(type),
      mentioned: Boolean(mention),
      captures: mention ? [...mention.captures].sort() : [],
      seen: count?.seen ?? 0,
      self: count?.self ?? 0,
      inherited: count?.inherited ?? 0,
      container: count?.container ?? 0,
      bare: count?.bare ?? 0,
      category: counts ? categoryOf(count) : null,
    };
  });

  const split = (named) => ({
    mentioned: types.filter((t) => t.visible && t.named === named && t.mentioned).map((t) => t.type),
    unmentioned: types.filter((t) => t.visible && t.named === named && !t.mentioned).map((t) => t.type),
  });
  const bucket = (category) => types.filter((t) => t.category === category).map((t) => t.type);

  return {
    captureNames: [...compiled.captureNames],
    types,
    named: split(true),
    anonymous: split(false),
    // `container` is a refinement of bare: the node paints nothing itself but
    // its children do, so it is never a gap on screen.
    categories: counts
      ? { self: bucket("self"), inherited: bucket("inherited"), container: bucket("container"), bare: bucket("bare"), unseen: bucket("unseen") }
      : null,
    classified: Boolean(root),
  };
}

/**
 * The union of capture names across compiled queries, each with the class list
 * `highlight.js` gives it and the queries that ask for it — the vocabulary a
 * stylesheet has to answer. Takes a Map, a plain object, or `[label, query]`
 * pairs; a bundle stands for its highlight query.
 */
export function captureVocabulary(queries) {
  const entries = Symbol.iterator in Object(queries) ? [...queries] : Object.entries(queries);
  const found = new Map();
  for (const [label, value] of entries) {
    const query = value?.captureNames ? value : value?.query;
    for (const name of query?.captureNames ?? []) {
      const entry = found.get(name) ?? { name, classes: name.split("."), sources: [] };
      if (!entry.sources.includes(label)) entry.sources.push(label);
      found.set(name, entry);
    }
  }
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// --- source scanning ---------------------------------------------------------

const WORD = /^[^\s()[\]";]+/;

/** Index just past the quote closing the string literal at `i`. */
function skipString(text, i) {
  i += 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/**
 * Index just past the bracket closing the one at `open`. Comments and string
 * literals are honoured: `[ \t]*(;|$)` inside a media-type regex carries both
 * a `)` and a `;`, and a comment in the file dialect's query quotes `(#match?`.
 */
function balancedEnd(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === ";") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === '"') { i = skipString(text, i); continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return text.length;
}

/** Past any quantifiers and `@capture` names trailing the node that ends at `i`. */
function capturesAfter(text, i) {
  const trailing = /\s*(?:[?*+]|@([A-Za-z0-9_.\-]+))/y;
  const names = [];
  trailing.lastIndex = i;
  let match;
  while ((match = trailing.exec(text))) {
    if (match[1]) names.push(match[1]);
    i = trailing.lastIndex;
  }
  return { names, next: i };
}

/**
 * Where the pattern starting at `start` really ends. A bare token (`"xml"
 * @keyword`) and a top-level alternation (`[ "yes" "no" ] @boolean`) both carry
 * their capture after the closing form, so the scan consumes that too.
 */
function patternEnd(text, start) {
  const head = text[start];
  let i = start;
  if (head === "(" || head === "[") i = balancedEnd(text, i);
  else if (head === '"') i = skipString(text, i);
  else i += WORD.exec(text.slice(i))?.[0].length ?? 1;
  return capturesAfter(text, i).next;
}

/** Every `(#operator …)` in a query, with its span and its operands. */
function predicateSpans(scm) {
  const spans = [];
  let i = 0;
  while (i < scm.length) {
    const c = scm[i];
    if (c === ";") { while (i < scm.length && scm[i] !== "\n") i++; continue; }
    if (c === '"') { i = skipString(scm, i); continue; }
    if (c === "#" && scm[i - 1] === "(") {
      const op = /^[A-Za-z0-9_?!.-]+/.exec(scm.slice(i + 1))?.[0];
      if (op) {
        const start = i - 1;
        const end = balancedEnd(scm, start);
        spans.push({ start, end, op, text: scm.slice(start, end), args: operands(scm, i + 1 + op.length, end - 1) });
        i = end;
        continue;
      }
    }
    i++;
  }
  return spans;
}

/** A predicate's arguments. A bare symbol is a string to the query parser, as a quoted one is. */
function operands(scm, from, to) {
  const args = [];
  let i = from;
  while (i < to) {
    const c = scm[i];
    if (c === ";") { while (i < to && scm[i] !== "\n") i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      const close = skipString(scm, i);
      args.push({ type: "string", value: unescapeLiteral(scm.slice(i + 1, close - 1)) });
      i = close;
      continue;
    }
    const word = WORD.exec(scm.slice(i))?.[0] ?? "";
    if (c === "@") args.push({ type: "capture", name: word.slice(1) });
    else args.push({ type: "string", value: word });
    i += Math.max(1, word.length);
  }
  return args;
}

/**
 * A string literal as the query parser reads it: `\n`, `\r`, `\t` and `\0` are
 * the four escapes it knows, and any other escaped character is itself — so
 * `"[ \t]"` carries a tab and `"\d"` carries a `d`, not a digit class.
 */
function unescapeLiteral(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\") { out += raw[i]; continue; }
    const c = raw[++i];
    out += c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c === "0" ? "\0" : c ?? "";
  }
  return out;
}

/** One stripped predicate, parsed back into what the runtime made of it. */
function strip(span) {
  const captures = span.args.filter((arg) => arg.type === "capture");
  const strings = span.args.filter((arg) => arg.type === "string").map((arg) => arg.value);
  let regex = null;
  let error = null;
  if (span.op.endsWith("match?")) {
    // an empty regex would match everything, which is the opposite of what a
    // predicate the runtime refused to build should report
    if (strings.length === 0) error = `\`#${span.op}\` has no pattern`;
    else try { regex = new RegExp(strings[0]); } catch (bad) { error = bad.message; }
  }
  return {
    start: span.start,
    end: span.end,
    op: span.op,
    text: span.text,
    capture: captures[0]?.name ?? null,
    against: captures[1]?.name ?? null,
    strings,
    regex,
    error,
  };
}

// Spaces, one per code unit, never deletion: the pattern indices and byte
// offsets of the relaxed copy have to be the same numbers as the strict one's
// for the two runs to line up in a single gutter.
const blank = (text) => text.replace(/[^\n\r]/g, " ");

function blankPredicates(text) {
  let out = "";
  let at = 0;
  for (const span of predicateSpans(text)) {
    out += text.slice(at, span.start) + blank(text.slice(span.start, span.end));
    at = span.end;
  }
  return out + text.slice(at);
}

// --- node types --------------------------------------------------------------

/**
 * Every node type a pattern names, with the captures attached to it. Recurses
 * by slice: only names are collected, so offsets do not travel.
 */
function scanMentions(text, into, inherited) {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ";") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      const close = skipString(text, i);
      const { names, next } = capturesAfter(text, close);
      note(into, unescapeLiteral(text.slice(i + 1, close - 1)), false, [...inherited, ...names]);
      i = next;
      continue;
    }
    if (c === "(" || c === "[") {
      const close = balancedEnd(text, i);
      const { names, next } = capturesAfter(text, close);
      const captures = [...inherited, ...names];
      const inner = text.slice(i + 1, close - 1);
      const head = c === "(" ? /^\s*([A-Za-z_]\w*|_)(?!\w*\s*:)/.exec(inner) : null;
      if (head) {
        note(into, head[1], true, captures);
        scanMentions(inner.slice(head[0].length), into, []);
      } else {
        // an alternation paints each of its members with the same capture
        scanMentions(inner, into, captures);
      }
      i = next;
      continue;
    }
    const word = WORD.exec(text.slice(i))?.[0] ?? "";
    // `name:` is a field and `@cap` a capture; neither is a node type
    if (c !== "@" && c !== "!" && c !== "#" && /^[A-Za-z_]\w*$/.test(word)) note(into, word, true, inherited);
    i += Math.max(1, word.length);
  }
}

function note(into, type, named, captures) {
  const entry = into.get(type) ?? { named, captures: new Set() };
  for (const name of captures) entry.captures.add(name);
  into.set(type, entry);
}

/**
 * Every node in the tree sorted by how it gets its colour: captured itself,
 * inside a captured ancestor whose fill it inherits, a container whose children
 * carry the paint, or bare.
 */
function classify(query, root) {
  const captured = new Set(query.captures(root).map((capture) => capture.node.id));
  const counts = new Map();
  const walk = (node, underCaptured) => {
    const self = captured.has(node.id);
    let below = false;
    for (const child of node.children) below = walk(child, underCaptured || self) || below;
    const entry = counts.get(node.type) ?? { named: node.isNamed, seen: 0, self: 0, inherited: 0, container: 0, bare: 0 };
    entry.seen++;
    if (self) entry.self++;
    else if (underCaptured) entry.inherited++;
    else if (below) entry.container++;
    else entry.bare++;
    counts.set(node.type, entry);
    return self || below;
  };
  walk(root, false);
  return counts;
}

const categoryOf = (count) =>
  !count ? "unseen" : count.self ? "self" : count.inherited ? "inherited" : count.container ? "container" : "bare";

// --- errors ------------------------------------------------------------------

/**
 * A query fails in two shapes. The C parser throws a QueryError carrying kind,
 * a UTF-16 index and a length; the JS predicate parser throws a plain Error
 * with no position at all, so the predicate it means is found by re-reading the
 * source for the operator it names.
 */
function describeError(error, scm) {
  const positioned = typeof error.index === "number";
  let index = positioned ? error.index : null;
  let length = positioned ? error.length ?? 0 : 0;
  let inferred = false;
  if (!positioned) {
    const span = predicateFromMessage(scm, String(error.message ?? ""));
    if (span) {
      index = span.start;
      length = span.end - span.start;
      inferred = true;
    }
  }
  return {
    message: String(error.message ?? error),
    kind: error.kind ?? null,
    index,
    length,
    ...(index === null ? { line: null, column: null, excerpt: null } : locate(scm, index)),
    positioned,
    inferred,
  };
}

/** The predicate a positionless message is about, narrowed by what the message says of it. */
function predicateFromMessage(scm, message) {
  const op = /`#([^`]+)`/.exec(message)?.[1];
  if (!op) return null;
  const spans = predicateSpans(scm).filter((span) => span.op === op);
  if (spans.length < 2) return spans[0] ?? null;
  const arity = /\bgot (\d+)/i.exec(message)?.[1];
  const capture = /\bgot @([A-Za-z0-9_.\-]+?)\.?$/i.exec(message)?.[1];
  const narrowed = spans.filter((span) =>
    (arity === undefined || span.args.length === Number(arity))
    && (capture === undefined || span.args.some((arg) => arg.type === "capture" && arg.name === capture)));
  return narrowed[0] ?? spans[0];
}

/** Line (1-based), column (0-based) and the whole line, for an index into `scm`. */
function locate(scm, index) {
  const before = scm.slice(0, index);
  const start = before.lastIndexOf("\n") + 1;
  const end = scm.indexOf("\n", index);
  return {
    line: before.split("\n").length,
    column: index - start,
    excerpt: scm.slice(start, end === -1 ? scm.length : end),
  };
}

// --- offsets -----------------------------------------------------------------

/** UTF-16 index of a UTF-8 byte offset; the query reports bytes, a string is indexed in code units. */
const indexOfByte = (bytes, byte) => decoder.decode(bytes.subarray(0, byte)).length;

const byteOfIndex = (text, index) => encoder.encode(text.slice(0, index)).length;

// --- matches -----------------------------------------------------------------

function textsFor(name, captures, source) {
  if (!name) return [];
  return captures.filter((capture) => capture.name === name).map((capture) =>
    capture.text ?? (source == null ? capture.node.text : source.slice(capture.node.startIndex, capture.node.endIndex)));
}

const rangeKey = (match) => `${match.patternIndex} ${match.captures
  .filter((capture) => capture.name === "injection.content")
  .map((capture) => `${capture.node.startIndex}-${capture.node.endIndex}`)
  .join(",")}`;

const counted = (records) => ({
  matched: records.filter((record) => record.verdict === "matched").length,
  nearMiss: records.filter((record) => record.verdict === "near-miss").length,
  noMatch: records.filter((record) => record.verdict === "no-match").length,
  folded: records.reduce((total, record) => total + record.folded.length, 0),
});
