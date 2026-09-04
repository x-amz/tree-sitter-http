// The painter: one dialect's tree painted over the exact text, recursing into
// the ranges its injection query yields. index.js turns the result into HTML;
// the guide paints it and reports what it did; check.js asserts over it under
// node, so what the check exercises is what every consumer runs.

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
  const verdict = paint(classes, b, languages, source, 0, 0, unresolved, injections, maxDepth);
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
function paintCaptures(classes, query, root, offset) {
  const seen = new Set();
  const captures = [...query.captures(root)]
    .sort((a, b) => a.node.startIndex - b.node.startIndex
                 || b.node.endIndex - a.node.endIndex);
  for (const { name, node } of captures) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    classes.fill(name.split(".").join(" "), offset + node.startIndex, offset + node.endIndex);
  }
}

/**
 * Parse one range with a bundle, paint its captures, and recurse into the
 * ranges its injection query yields. Depth-capped. Returns the parse verdict
 * of this range's tree, and appends what it injected to `injections`.
 */
function paint(classes, b, languages, source, offset, depth, unresolved, injections, maxDepth) {
  const tree = b.parser.parse(source);
  paintCaptures(classes, b.query, tree.rootNode, offset);
  if (b.injections && depth < maxDepth) {
    for (const match of b.injections.matches(tree.rootNode)) {
      // injection.language is a #set! property on the pattern, or a captured
      // node whose own text names the language (the markdown-fence form).
      let name = b.injections.setProperties[match.patternIndex]?.["injection.language"];
      const ranges = [];
      for (const capture of match.captures) {
        if (capture.name === "injection.language") {
          name = source.slice(capture.node.startIndex, capture.node.endIndex);
        } else if (capture.name === "injection.content") {
          ranges.push(capture.node);
        }
      }
      const target = name && languages.get(name);
      for (const node of ranges) {
        const record = {
          language: name ?? null,
          patternIndex: match.patternIndex,
          depth,
          start: offset + node.startIndex,
          end: offset + node.endIndex,
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
        const inner = paint(classes, target, languages, source.slice(node.startIndex, node.endIndex),
                            offset + node.startIndex, depth + 1, unresolved, record.children, maxDepth);
        record.errors = inner.errors;
        record.hasError = inner.hasError;
      }
    }
  }
  const errors = tree.rootNode.descendantsOfType("ERROR").length;
  const verdict = { hasError: tree.rootNode.hasError, errors };
  tree.delete();
  return verdict;
}
