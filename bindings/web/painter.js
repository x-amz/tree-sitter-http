// The painter: one dialect's tree painted over the exact text, recursing into
// the ranges its injection query yields. index.js turns the result into HTML;
// the guide paints it and reports what it did; check.js asserts over it under
// node, so what the check exercises is what every consumer runs.
//
// An injected language is parsed over the document with an included range
// — the runtime's own way of reading one language inside another — and
// never sees a placeholder: every one the host grammar found inside the
// body is masked, its bytes replaced by digits of the same length, before
// the range is handed over. Digits are a number in value position and text
// inside a string, so `"count": {{n}}` is JSON to the JSON grammar and the
// tree stays whole; cutting the placeholder out instead left a hole that
// error recovery spread over the object. The mask is never painted: the
// layer's strokes stop at every placeholder, so the host's paint of it
// stands. A body that is nothing but placeholders is not parsed.

import { Parser, Query } from "./dist/tree-sitter.js";

/** How deep a nested injection may go. message/http bodies are legitimately recursive. */
export const MAX_DEPTH = 8;

/**
 * A language bundle: a parser, its highlight query, and — when the language
 * hosts other languages — its injection query. Dialects and injected
 * languages share this shape. Throws if a query does not compile against the
 * language.
 */
export function bundle(language, highlightScm, injectionScm) {
  const parser = new Parser();
  parser.setLanguage(language);
  return {
    parser,
    language,
    query: new Query(language, highlightScm),
    injections: injectionScm ? new Query(language, injectionScm) : null,
  };
}

/** Every language name a bundle's injection query can name by `#set!`. */
export function injectionNames(b) {
  if (!b.injections) return [];
  return b.injections.setProperties
    .map((properties) => properties?.["injection.language"])
    .filter((name) => name !== undefined);
}

/**
 * Analyze `source` with bundle `b`. `languages` maps injection names to
 * bundles. Returns per-character capture classes (dots split into class
 * lists), the injection names the text asked for that no language answered,
 * the parse verdicts, and the injection tree that was walked — every range,
 * the language it named, whether that language was there, how deep it sat,
 * and what its own parser made of it. `maxDepth` of 0 finds the ranges
 * without parsing into them, which is what a caller wants when it is showing
 * the host grammar's own work and has not reached the handover yet. A range
 * handed to another grammar is parsed by that grammar, so its errors are that
 * grammar's to report and this repeats them: a body of broken JSON is not a
 * clean document.
 */
export function analyze(b, languages, source, maxDepth = MAX_DEPTH) {
  const classes = new Array(source.length).fill(null);
  const unresolved = new Set();
  const injections = [];
  const verdict = paint(classes, b, languages, source, null, 0, unresolved, injections, maxDepth);
  // An unclosed brace usually leaves no ERROR node at all — the parser inserts
  // the token it wanted and marks the tree — so a count of error nodes is not
  // enough to say whether a range came out clean.
  let injected = 0;
  let injectedBad = 0;
  const count = (records) => {
    for (const record of records) {
      injected += record.errors ?? 0;
      if (record.hasError) injectedBad += 1;
      count(record.children);
    }
  };
  count(injections);
  return {
    classes, unresolved, injections, ...verdict,
    injected, injectedBad,
    total: verdict.errors + injected,
    anyError: verdict.hasError || injectedBad > 0,
  };
}

/**
 * Paint one tree's captures into the shared per-character class array.
 * Captures sorted by start (outer-first on ties) and painted in order, so a
 * child's paint lands over its parent's. A node captured by several patterns
 * keeps its first, as tree-sitter does.
 */
function paintCaptures(classes, query, root, layer) {
  const seen = new Set();
  const captures = [...query.captures(root)]
    .sort((a, b) => a.node.startIndex - b.node.startIndex
                 || b.node.endIndex - a.node.endIndex);
  for (const { name, node } of captures) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const cls = name.split(".").join(" ");
    if (!layer) {
      classes.fill(cls, node.startIndex, node.endIndex);
      continue;
    }
    // An injected layer's stroke stops at its range and at every masked
    // placeholder: the layer read digits there, and paints none of them.
    let from = Math.max(node.startIndex, layer.range.startIndex);
    const to = Math.min(node.endIndex, layer.range.endIndex);
    for (const hole of layer.holes) {
      if (hole.endIndex <= from) continue;
      if (hole.startIndex >= to) break;
      if (hole.startIndex > from) classes.fill(cls, from, hole.startIndex);
      from = Math.max(from, hole.endIndex);
    }
    if (from < to) classes.fill(cls, from, to);
  }
}

/**
 * What an injected language is handed for a content node: the node's own
 * range, and the placeholders the host grammar found directly inside it,
 * which the text is masked over and the paint stops at. Deeper layers
 * inherit the holes above them.
 */
export function injection(node, inherited = [], source = node.text) {
  const holes = node.namedChildren
    .filter((child) => child.type === "placeholder")
    .map((child) => ({ startIndex: child.startIndex, endIndex: child.endIndex }));
  // What is left once the placeholders are gone: whitespace alone is nothing.
  let rest = "";
  let at = node.startIndex;
  for (const hole of holes) { rest += source.slice(at, hole.startIndex); at = hole.endIndex; }
  rest += source.slice(at, node.endIndex);
  return {
    range: { startIndex: node.startIndex, endIndex: node.endIndex,
             startPosition: node.startPosition, endPosition: node.endPosition },
    holes: [...inherited, ...holes].sort((a, b) => a.startIndex - b.startIndex),
    /** Whether anything but placeholders and whitespace is left to read. */
    empty: /^\s*$/.test(rest),
  };
}

/** `text` with every hole overwritten by digits of the same length. */
function masked(text, holes) {
  let out = text;
  for (const hole of holes) {
    out = out.slice(0, hole.startIndex) + "1".repeat(hole.endIndex - hole.startIndex) + out.slice(hole.endIndex);
  }
  return out;
}

/**
 * Parse the document with a bundle — all of it, or the `layer` an injection
 * handed over: one included range over text already masked at its holes —
 * paint its captures, and recurse into the ranges its own injection query
 * yields. Depth-capped. Returns the parse verdict of this tree, and appends
 * what it injected to `injections`.
 */
function paint(classes, b, languages, source, layer, depth, unresolved, injections, maxDepth) {
  const tree = b.parser.parse(source, null, layer ? { includedRanges: [layer.range] } : undefined);
  paintCaptures(classes, b.query, tree.rootNode, layer);
  if (b.injections && depth < maxDepth) {
    // One language per range. Several patterns may claim the same node — the
    // html opener and the xml node kind both name an xml_body — and the node
    // keeps the earliest pattern in the query, the rule the highlight
    // captures follow. The order of injections.scm is the routing.
    const claims = new Map();
    for (const match of b.injections.matches(tree.rootNode)) {
      // injection.language is a #set! property on the pattern, or a captured
      // node whose own text names the language (the markdown-fence form).
      let name = b.injections.setProperties[match.patternIndex]?.["injection.language"];
      for (const capture of match.captures) {
        if (capture.name === "injection.language") {
          name = source.slice(capture.node.startIndex, capture.node.endIndex);
        }
      }
      for (const capture of match.captures) {
        if (capture.name !== "injection.content") continue;
        const held = claims.get(capture.node.id);
        if (held && held.patternIndex <= match.patternIndex) continue;
        claims.set(capture.node.id, { node: capture.node, name, patternIndex: match.patternIndex });
      }
    }
    const ranges = [...claims.values()].sort((a, b) => a.node.startIndex - b.node.startIndex);
    for (const { node, name, patternIndex } of ranges) {
      const target = name && languages.get(name);
      const record = {
        language: name ?? null,
        patternIndex,
        depth,
        start: node.startIndex,
        end: node.endIndex,
        resolved: Boolean(target),
        errors: 0,
        hasError: false,
        children: [],
      };
      injections.push(record);
      if (!target) {
        if (name) unresolved.add(name);
        continue;
      }
      const inner = injection(node, layer?.holes ?? [], source);
      if (inner.empty) continue;
      const verdict = paint(classes, target, languages, masked(source, inner.holes), inner,
                            depth + 1, unresolved, record.children, maxDepth);
      record.errors = verdict.errors;
      record.hasError = verdict.hasError;
    }
  }
  const errors = tree.rootNode.descendantsOfType("ERROR").length;
  const verdict = { hasError: tree.rootNode.hasError, errors };
  tree.delete();
  return verdict;
}
