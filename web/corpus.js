// The corpus lens: `tree-sitter test`, in the page.
//
// A corpus file has no parser but the CLI's own — it is read with four regexes
// and graded by comparing S-expression strings — so running the suite in a
// browser means porting that reading exactly. This is 0.25.10's `src/test.rs`:
// the same expressions, the same normalisation in the same order, the same raw
// string equality. Each dialect's `<dialect>/test/corpus/*.txt` runs against
// the wasm the same `generate` produced, so a case that is green under the CLI
// is green here, and a disagreement is this port's bug.
//
// Text and a parser bundle come in, results go out: nothing here reads a file
// or loads a grammar.

// The CLI's expressions, transliterated. `^` and Rust's `multi_line` do not
// carry over: JS's `m` flag also breaks a line on a bare `\r`, and a corpus
// records CRLF inputs, so `^===` could anchor between a CR and its LF. Line
// starts are found by hand instead and matched with a sticky expression, which
// is what Rust's `multi_line` means.
const HEADER =
  "(?<equals>(?:=+){3,})(?<suffix1>[^=\\r\\n][^\\r\\n]*)?\\r?\\n" +
  "(?<block>(?:(?:[^=\\r\\n]|\\s+:)[^\\r\\n]*\\r?\\n)+)" +
  "===+(?<suffix2>[^=\\r\\n][^\\r\\n]*)?\\r?\\n";
const DIVIDER = "(?<hyphens>(?:-+){3,})(?<suffix>[^-\\r\\n][^\\r\\n]*)?\\r?\\n";

const COMMENT = /^\s*;.*$/gm;
const FIELD = / \w+: \(/; // ` name: (`, the prefix `to_sexp` writes before a field
const FIELDS = new RegExp(FIELD, "g");
const LINES = /[^\n]*\n|[^\n]+/g; // Rust's `split_inclusive('\n')`

/**
 * Read one corpus file the way `tree-sitter test` reads it: the cases it holds,
 * in file order, each with the input bytes the CLI would parse and the
 * normalised tree it would compare against. `line` is the 1-based line of the
 * case's `===` header, so the page can cite it.
 */
export function parseCorpus(text, path = null) {
  const end = text.length;

  // A file may give its delimiters a suffix, and every later header and divider
  // is then measured against the first header's — which is how an input is
  // allowed to hold bare `===` lines of its own.
  const first = anchored(HEADER, text, 0, end).next();
  const suffix = first.done ? undefined : first.value.groups.suffix1;

  const headers = [];
  for (const match of anchored(HEADER, text, 0, end)) {
    if (match.groups.suffix1 !== suffix || match.groups.suffix2 !== suffix) continue;
    headers.push({ start: match.start, end: match.end, ...readHeader(match.groups.block ?? "") });
  }
  // The sentinel that closes the last case: an empty header at the end.
  headers.push({ start: end, end, name: "", attributes: defaults() });

  const cases = [];
  let previous = null;
  for (const header of headers) {
    const divider = previous && longestDivider(text, previous.end, header.start, suffix);
    // A header with no divider before the next one is not a case at all: the
    // CLI drops it without a word, and a count that disagrees with
    // `tree-sitter test` is the page misreporting the suite.
    if (divider) {
      const expected = normalize(text.slice(divider.end, header.start));
      cases.push({
        name: previous.name,
        attributes: previous.attributes,
        // One byte comes off the end — the newline the divider sits after. A
        // CRLF keeps its CR: the CLI's second pop is Windows-only.
        input: text.slice(previous.end, divider.start).slice(0, -1),
        expected,
        hasFields: FIELD.test(expected),
        path,
        line: lineAt(text, previous.start),
      });
    }
    previous = header;
  }
  return cases;
}

/**
 * The CLI's normalisation of a recorded tree, in its order: drop `;` comment
 * lines, collapse whitespace to single spaces, then close the ` )` a dropped
 * comment line leaves behind.
 */
export function normalize(expected) {
  const collapsed = expected.replace(COMMENT, "").trim().replace(/\s+/g, " ");
  return collapsed.split(" )").join(")"); // one non-overlapping pass, as Rust's `str::replace`
}

/**
 * The string `tree-sitter test` compares a parse against. Field names are
 * opt-in per case: a recorded tree that names none has them stripped from the
 * actual, so a grammar's fields are invisible to a corpus that ignores them.
 */
export function sexp(rootNode, hasFields, showFields = false) {
  // `toString()` is the same `ts_subtree_string` the CLI calls, down to
  // `(MISSING "{")` and `(UNEXPECTED 'c')` — a walk over the visible tree
  // cannot reach the raw subtree those two read.
  const string = rootNode.toString();
  return hasFields || showFields ? string : string.replace(FIELDS, " (");
}

/**
 * Run one case against a language bundle (highlight.js's shape — anything with
 * a `parser`). `os` names the platform a `:platform(...)` case is measured
 * against; a browser has no answer to the CLI's `std::env::consts::OS`, so an
 * unanswered case is reported skipped rather than guessed at.
 */
export function runCase(bundle, testCase, os = null) {
  const { skip, error, platform } = testCase.attributes;
  if (skip || (platform.length > 0 && !platform.includes(os))) {
    return outcome(testCase, "skip", null, null);
  }

  const tree = bundle.parser.parse(testCase.input);
  const actual = sexp(tree.rootNode, testCase.hasFields);
  const errored = tree.rootNode.hasError;
  tree.delete();

  // An `:error` case ignores its recorded tree entirely — it asks only that the
  // parse fail — so there is nothing to diff.
  if (error) return outcome(testCase, errored ? "error-expected" : "fail", actual, null);

  const diff = firstDifference(actual, testCase.expected);
  return outcome(testCase, diff ? "fail" : "pass", actual, diff);
}

/** Run every case in one corpus file (`{ path, text }`, as `sources.js` loads it). */
export function runFile(bundle, file, os = null) {
  const cases = parseCorpus(file.text, file.path).map((testCase) => runCase(bundle, testCase, os));
  return { path: file.path, name: stem(file.path), cases, ...tally(cases) };
}

/** Totals across `runFile` results, and every case that failed. */
export function summarise(results) {
  const cases = results.flatMap((file) => file.cases);
  return {
    files: results.length,
    ...tally(cases),
    failures: cases.filter((one) => one.status === "fail"),
  };
}

/** One case's verdict; `test` carries the case back, so a failure can cite its line. */
const outcome = (testCase, status, actual, diff) => ({
  name: testCase.name,
  status,
  actual,
  expected: testCase.expected,
  diff,
  test: testCase,
});

/** An `:error` case that found its error passed, and the CLI counts it as one. */
const tally = (cases) => ({
  total: cases.length,
  passed: cases.filter((one) => one.status === "pass" || one.status === "error-expected").length,
  failed: cases.filter((one) => one.status === "fail").length,
  skipped: cases.filter((one) => one.status === "skip").length,
});

/** The name and markers between a header's two `===` lines. */
function readHeader(block) {
  const marks = defaults();
  let name = "";
  let seen = false;
  for (const line of block.match(LINES) ?? []) {
    const trimmed = line.trim();
    const open = trimmed.indexOf("(");
    const key = open === -1 ? trimmed : trimmed.slice(0, open);
    // `:platform` and `:language` carry an argument, and a line missing the
    // parenthesised shape is neither a marker nor part of the name.
    const argument = open !== -1 && trimmed.endsWith(")") ? trimmed.slice(open + 1, -1) : null;
    switch (key) {
      case ":skip": seen = marks.skip = true; break;
      case ":fail-fast": seen = marks.failFast = true; break;
      case ":error": seen = marks.error = true; break;
      case ":platform": if (argument !== null) { seen = true; marks.platform.push(argument.trim()); } break;
      case ":language": if (argument !== null) { seen = true; marks.languages.push(argument); } break;
      // Once a marker has been seen the block is markers; a stray line after one
      // belongs to neither the name nor the attributes.
      default: if (!seen) name += line;
    }
  }
  if (marks.skip) marks.error = false; // the two are not held together
  return { name: name.trimEnd(), attributes: marks };
}

/**
 * What a header claims when it claims nothing. `platform` and `languages` hold
 * the names their markers gave; the CLI runs a case once per language named and
 * once when none is, which is the only reading a page with one bundle per
 * dialect can offer.
 */
const defaults = () => ({ skip: false, error: false, failFast: false, platform: [], languages: [] });

/**
 * The divider between input and expected tree: the longest `---` line in the
 * window, so a shorter one inside an input loses. The window spans the expected
 * tree too, and Rust's `max_by_key` keeps the last of equal lengths.
 */
function longestDivider(text, from, to, suffix) {
  let best = null;
  for (const match of anchored(DIVIDER, text, from, to)) {
    if (match.groups.suffix !== suffix) continue;
    if (!best || match.end - match.start >= best.end - best.start) best = match;
  }
  return best;
}

/** Where two strings part, so the page can lay one over the other. */
function firstDifference(actual, expected) {
  if (actual === expected) return null;
  let index = 0;
  while (index < actual.length && index < expected.length && actual[index] === expected[index]) index++;
  return { index, actual: actual[index] ?? "", expected: expected[index] ?? "" };
}

/** Offset 0 and every offset after a newline — Rust's line starts, not JS's. */
function* lineStarts(text, from, to) {
  if (from < to) yield from;
  for (let at = text.indexOf("\n", from); at !== -1 && at + 1 < to; at = text.indexOf("\n", at + 1)) {
    yield at + 1;
  }
}

/** Leftmost, non-overlapping matches of a line-anchored expression in a window. */
function* anchored(source, text, from, to) {
  const sticky = new RegExp(source, "y");
  let cursor = from;
  for (const start of lineStarts(text, from, to)) {
    if (start < cursor) continue;
    sticky.lastIndex = start;
    const match = sticky.exec(text);
    if (match && sticky.lastIndex <= to) {
      yield { start, end: sticky.lastIndex, groups: match.groups };
      cursor = sticky.lastIndex;
    }
  }
}

/** The 1-based line an offset sits on. */
function lineAt(text, offset) {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < offset; at = text.indexOf("\n", at + 1)) line++;
  return line;
}

/** The CLI's group name for a corpus file: its stem. */
const stem = (path) => (path ?? "").split("/").pop().replace(/\.[^.]+$/, "");
