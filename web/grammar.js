// The grammar lens, computed. Everything the guide says about a dialect's
// shape — how many rules there are, which line kind outranks which, what the
// wire dialect switches off — is derived here from the two files
// `tree-sitter generate` wrote (`<dialect>/src/grammar.json` and
// `src/node-types.json`) and the one file a person wrote
// (`common/define-grammar.js`). No parser is loaded and nothing is written
// down twice, so a grammar edit moves the page on the next reload.
//
// Reading is the caller's job, as everywhere in `web/`: a dialect from
// `sources.js` goes in, plain data comes out.

/** Rule nodes that carry a single `content` child. */
const CONTENT_TYPES = new Set([
  "FIELD", "ALIAS", "TOKEN", "IMMEDIATE_TOKEN", "RESERVED",
  "PREC", "PREC_LEFT", "PREC_RIGHT", "PREC_DYNAMIC", "REPEAT", "REPEAT1",
]);
const PREC_TYPES = new Set(["PREC", "PREC_LEFT", "PREC_RIGHT", "PREC_DYNAMIC"]);
const TOKEN_TYPES = new Set(["TOKEN", "IMMEDIATE_TOKEN"]);
const PREC_NAMES = {
  PREC: "prec", PREC_LEFT: "prec.left",
  PREC_RIGHT: "prec.right", PREC_DYNAMIC: "prec.dynamic",
};

/** Column past which a rendered rule breaks onto lines of its own. */
const WIDTH = 78;

/**
 * Everything the grammar lens shows for one dialect: counts, the token
 * inventory, the precedence ladder, rendered rule sources, the normalised
 * node vocabulary, and the method words decoded back out of their regexes.
 * `defineGrammar` is `common/define-grammar.js` as text; supply it and each
 * precedence level carries the PREC constant it came from.
 */
export function facts(dialect, defineGrammar = null) {
  const grammar = dialect.grammarJson;
  const rules = grammar.rules ?? {};
  const names = Object.keys(rules);
  const nodeTypes = (dialect.nodeTypes ?? []).map(nodeType);
  const named = new Set(nodeTypes.filter((n) => n.named).map((n) => n.type));

  const tokens = tokenInventory(rules);
  const prec = defineGrammar ? precConstants(defineGrammar).entries : [];

  return {
    name: dialect.name,
    title: dialect.title ?? dialect.name,
    scope: dialect.scope ?? null,
    fileTypes: dialect.fileTypes ?? [],
    counts: counts(grammar, rules, nodeTypes),
    tokens,
    precedence: ladder(tokens, prec),
    rules: names.map((name) => ({
      name,
      hidden: name.startsWith("_"),
      node: named.has(name),
      source: `${name}: $ => ${renderRule(rules[name])}`,
    })),
    nodeTypes,
    externals: list(grammar.externals).map((e) => (e.type === "SYMBOL" ? e.name : renderRule(e))),
    extras: list(grammar.extras).map(renderRule),
    conflicts: list(grammar.conflicts),
    methods: methods(rules),
    // What `diff` re-reads. The derivations above are lossy on purpose; a
    // rule-for-rule comparison needs the JSON they were derived from.
    grammar,
  };
}

/**
 * One grammar.json rule as readable DSL text — the right-hand side alone,
 * without the `name: $ =>` that `facts().rules[].source` prefixes.
 */
export function renderRule(rule) {
  return render(rule, 0);
}

/**
 * The `const PREC = { … };` statement from `common/define-grammar.js`:
 * `source` verbatim, `entries` as `{name, value, note}` with `note` the `//`
 * lines standing above the entry. Found by brace matching, so a `{` inside a
 * comment or a string cannot move it.
 */
export function precConstants(defineGrammar) {
  const match = /^const\s+PREC\s*=\s*\{/m.exec(defineGrammar);
  if (!match) throw new Error("no `const PREC = {` in define-grammar.js");
  const open = match.index + match[0].length - 1;
  const close = matchBrace(defineGrammar, open);
  const semi = defineGrammar.indexOf(";", close);
  const source = defineGrammar.slice(match.index, (semi < 0 ? close : semi) + 1);

  const entries = [];
  let note = [];
  for (const raw of defineGrammar.slice(open + 1, close).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//")) {
      note.push(line.replace(/^\/\/ ?/, ""));
      continue;
    }
    const pair = /^([A-Za-z_$][\w$]*)\s*:\s*(-?\d+)\s*,?$/.exec(line);
    if (pair) entries.push({ name: pair[1], value: Number(pair[2]), note: note.join(" ") });
    note = [];
  }
  return { source, entries };
}

/**
 * The banner comment at the top of `common/define-grammar.js` as plain text —
 * the `.http` rules the grammar is written to, in the words the grammar
 * states them. The `///` reference and `@ts-check` pragmas are dropped; the
 * first line that is not a comment ends it.
 */
export function headerComment(defineGrammar) {
  const out = [];
  for (const raw of defineGrammar.split("\n")) {
    const line = raw.trimStart();
    if (line.startsWith("///") || line === "// @ts-check") {
      if (!out.length) continue;
    }
    if (line.startsWith("//")) {
      out.push(line.replace(/^\/\/ ?/, ""));
      continue;
    }
    if (line === "") {
      if (out.length) out.push("");
      continue;
    }
    break;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/**
 * The `scan` function from `common/scanner.h` — signature through its
 * matching close brace, so the guide can show the one hand-written C
 * function in the repo verbatim. Brace matching skips comments and character
 * and string literals, which this function is full of.
 */
export function scannerScan(scanner) {
  for (const match of scanner.matchAll(/\bscan\b/g)) {
    const brace = scanner.indexOf("{", match.index);
    const semi = scanner.indexOf(";", match.index);
    // A declaration reaches its `;` first; a definition reaches its body.
    if (brace < 0 || (semi >= 0 && semi < brace)) continue;
    const start = scanner.lastIndexOf("\n", match.index) + 1;
    return scanner.slice(start, matchBrace(scanner, brace) + 1);
  }
  throw new Error("no `scan` definition in scanner.h");
}

/**
 * What the wire dialect switches off, computed: two `facts()` results
 * compared rule by rule over the JSON they were generated from, plus the
 * non-rule sections of each grammar.json side by side.
 */
export function diff(a, b) {
  const sides = [a, b];
  const rules = sides.map((f) => f.grammar.rules ?? {});
  const sources = sides.map((f) => new Map(f.rules.map((r) => [r.name, r.source])));

  const onlyIn = {};
  const identical = [];
  const differing = [];
  for (const [i, own] of rules.entries()) {
    const other = rules[1 - i];
    onlyIn[sides[i].name] = Object.keys(own).filter((name) => !(name in other));
  }
  for (const name of Object.keys(rules[0])) {
    if (!(name in rules[1])) continue;
    if (canonical(rules[0][name]) === canonical(rules[1][name])) identical.push(name);
    else differing.push({
      rule: name,
      sources: Object.fromEntries(sides.map((f, i) => [f.name, sources[i].get(name)])),
    });
  }

  const keys = [...new Set(sides.flatMap((f) => Object.keys(f.grammar)))].filter((k) => k !== "rules");
  const meta = keys.map((key) => {
    const values = Object.fromEntries(
      sides.map((f) => [f.name, key in f.grammar ? canonical(f.grammar[key]) : null]),
    );
    const [first, second] = Object.values(values);
    return { key, values, equal: first === second };
  });

  return { onlyIn, identical, differing, meta };
}

// -- rendering ---------------------------------------------------------------

function render(node, indent) {
  const pad = "  ".repeat(indent);
  const type = node?.type;
  switch (type) {
    case "BLANK": return "blank()";
    case "STRING": return JSON.stringify(node.value);
    case "PATTERN": return `/${escapeSlashes(node.value)}/${node.flags ?? ""}`;
    case "SYMBOL": return `$.${node.name}`;
    case "FIELD":
      return `field(${JSON.stringify(node.name)}, ${render(node.content, indent)})`;
    case "ALIAS":
      return `alias(${render(node.content, indent)}, ${node.named ? `$.${node.value}` : JSON.stringify(node.value)})`;
    case "RESERVED":
      return `reserved(${JSON.stringify(node.context_name)}, ${render(node.content, indent)})`;
    case "TOKEN":
    case "IMMEDIATE_TOKEN":
      return `${type === "TOKEN" ? "token" : "token.immediate"}(${render(node.content, indent)})`;
    case "PREC":
    case "PREC_LEFT":
    case "PREC_RIGHT":
    case "PREC_DYNAMIC": {
      const inner = render(node.content, indent);
      // `prec.left(x)` and `prec.right(x)` serialize with value 0; printing
      // the 0 back would be valid DSL that does not read like the source.
      const bare = node.value === 0 && type !== "PREC" && type !== "PREC_DYNAMIC";
      return bare
        ? `${PREC_NAMES[type]}(${inner})`
        : `${PREC_NAMES[type]}(${JSON.stringify(node.value)}, ${inner})`;
    }
    case "REPEAT": return `repeat(${render(node.content, indent)})`;
    case "REPEAT1": return `repeat1(${render(node.content, indent)})`;
    case "SEQ":
    case "CHOICE": {
      const members = node.members ?? [];
      // `optional(x)` does not survive generation — it lowers to
      // `choice(x, blank())`. Folding it back is what makes a rendered rule
      // read like the rule that was written.
      if (type === "CHOICE" && members.length === 2 && members[1]?.type === "BLANK") {
        return `optional(${render(members[0], indent)})`;
      }
      const fn = type === "SEQ" ? "seq" : "choice";
      const parts = members.map((m) => render(m, indent + 1));
      const line = `${fn}(${parts.join(", ")})`;
      if (line.length + indent * 2 <= WIDTH && !line.includes("\n")) return line;
      return `${fn}(\n${pad}  ${parts.join(`,\n${pad}  `)},\n${pad})`;
    }
    default:
      throw new Error(`unhandled grammar rule type ${JSON.stringify(type)}`);
  }
}

/**
 * A PATTERN value is raw regex source that may already hold `\/` (`HTTP\/…`),
 * so printing it as `/re/` escapes only the slashes that are not escaped yet.
 */
function escapeSlashes(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\") {
      out += c + (value[i + 1] ?? "");
      i++;
    } else out += c === "/" ? "\\/" : c;
  }
  return out;
}

// -- walking -----------------------------------------------------------------

function childNodes(node) {
  if (Array.isArray(node?.members)) return node.members;
  if (node && CONTENT_TYPES.has(node.type) && node.content) return [node.content];
  return [];
}

/** Pre-order walk of one rule; `visit(node, ancestors)`, outermost first. */
function walk(node, visit, ancestors = []) {
  visit(node, ancestors);
  const inner = [...ancestors, node];
  for (const child of childNodes(node)) walk(child, visit, inner);
}

/** Key-sorted JSON, so two rules compare by shape and not by key order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const list = (value) => (Array.isArray(value) ? value : []);

// -- derivations -------------------------------------------------------------

function counts(grammar, rules, nodeTypes) {
  const names = Object.keys(rules);
  let tokens = 0;
  let patterns = 0;
  const fields = new Set();
  for (const body of Object.values(rules)) {
    walk(body, (node) => {
      if (TOKEN_TYPES.has(node.type)) tokens++;
      else if (node.type === "PATTERN") patterns++;
      else if (node.type === "FIELD") fields.add(node.name);
    });
  }
  const named = nodeTypes.filter((n) => n.named).length;
  return {
    rules: names.length,
    hiddenRules: names.filter((n) => n.startsWith("_")).length,
    visibleRules: names.filter((n) => !n.startsWith("_")).length,
    tokens,
    patterns,
    externalTokens: list(grammar.externals).length,
    nodeTypes: { total: nodeTypes.length, named, anonymous: nodeTypes.length - named },
    fields: fields.size,
    extras: list(grammar.extras).length,
    conflicts: list(grammar.conflicts).length,
    precedences: list(grammar.precedences).length,
    inline: list(grammar.inline).length,
    supertypes: list(grammar.supertypes).length,
    // The one non-array section: `reserved` is an object of word sets.
    reserved: Object.keys(grammar.reserved ?? {}).length,
  };
}

/**
 * Every STRING and PATTERN leaf, carrying the symbol its token is published
 * under. That name is in `src/parser.c`'s symbol table and nowhere a page can
 * read it, so it is reconstructed from the JSON by four observed rules:
 *
 *   - a string leaf is an anonymous token, named by its own text (`:`, `{{`);
 *   - identical token subtrees are one symbol, named after the first rule in
 *     declaration order that holds it, so the token `title`, `trailer`,
 *     `status_text` and `path` share is named for `title`;
 *   - that name is the rule name when the token is the rule's whole
 *     right-hand side and no other rule holds it, and `<rule>_token<n>`
 *     otherwise, numbered per rule in appearance order;
 *   - a rule reached only through `alias()` is published under the alias, so
 *     `_bodiless_method` reads `method` and `_continuation_head` `url_text`.
 *
 * `<n>` is the guess — no rule here needs it past 1 — and so is the alias
 * rule, which holds while no rule is referenced both aliased and bare.
 *
 * Joining this against a `LookaheadIterator`: its symbol ids run in the order
 * these groups first appear, but `web-tree-sitter` names only the symbols a
 * tree can show, so every hidden token (`_ws`, `_json_head`, `title_token1`)
 * arrives from `currentType` as `ERROR` — these names are what supply them.
 */
function tokenInventory(rules) {
  const aliases = aliasNames(rules);
  const groups = new Map();
  const tokens = [];

  for (const [rule, body] of Object.entries(rules)) {
    walk(body, (node, ancestors) => {
      if (node.type !== "STRING" && node.type !== "PATTERN") return;
      const wrapper = ancestors.findIndex((a) => TOKEN_TYPES.has(a.type));
      const token = wrapper === -1 ? node : ancestors[wrapper];
      const prec = [...ancestors].reverse().find((a) => PREC_TYPES.has(a.type));
      const entry = {
        rule,
        symbol: null,
        precedence: prec ? prec.value : null,
        kind: node.type === "STRING" ? "string" : "pattern",
        value: node.value,
        path: ancestors.map((a) => a.type),
      };
      tokens.push(entry);

      const key = canonical(token);
      let group = groups.get(key);
      if (!group) {
        // Whole right-hand side: nothing above the token but the rule itself.
        const whole = (wrapper === -1 ? ancestors.length : wrapper) === 0;
        group = { rules: [rule], whole, kind: entry.kind, value: entry.value, entries: [] };
        groups.set(key, group);
      } else if (!group.rules.includes(rule)) group.rules.push(rule);
      group.entries.push(entry);
    });
  }

  const aux = new Map();
  for (const group of groups.values()) {
    const owner = group.rules[0];
    if (group.kind === "string") group.symbol = group.value;
    else if (group.whole && group.rules.length === 1) group.symbol = aliases.get(owner) ?? owner;
    else {
      const n = (aux.get(owner) ?? 0) + 1;
      aux.set(owner, n);
      group.symbol = `${owner}_token${n}`;
    }
    for (const entry of group.entries) entry.symbol = group.symbol;
  }
  return tokens;
}

/** Rules every reference to which is wrapped in the same `alias()`. */
function aliasNames(rules) {
  const seen = new Map();
  for (const body of Object.values(rules)) {
    walk(body, (node, ancestors) => {
      if (node.type !== "SYMBOL") return;
      const parent = ancestors[ancestors.length - 1];
      const via = parent?.type === "ALIAS" ? parent.value : null;
      if (!seen.has(node.name)) seen.set(node.name, new Set());
      seen.get(node.name).add(via);
    });
  }
  const out = new Map();
  for (const [name, values] of seen) {
    const [only] = values;
    if (values.size === 1 && only !== null) out.set(name, only);
  }
  return out;
}

/**
 * The token inventory grouped by precedence, strongest first, each level
 * carrying the PREC constant that set it. This is the ladder that decides
 * what a line is; the tokens with no precedence sit at the foot of it.
 */
function ladder(tokens, entries) {
  const byValue = new Map(entries.map((e) => [e.value, e]));
  const levels = new Map();
  for (const token of tokens) {
    const key = canonical(token.precedence ?? null);
    if (!levels.has(key)) {
      const constant = byValue.get(token.precedence);
      levels.set(key, {
        value: token.precedence ?? null,
        name: constant?.name ?? null,
        note: constant?.note || null,
        tokens: [],
      });
    }
    levels.get(key).tokens.push(token);
  }
  // Numbers descending, then any named precedence, then the implicit level.
  const rank = (v) => (v === null ? 2 : typeof v === "number" ? 0 : 1);
  return [...levels.values()].sort((a, b) =>
    rank(a.value) - rank(b.value) ||
    (typeof a.value === "number" ? b.value - a.value : String(a.value).localeCompare(String(b.value))));
}

/** One node-types.json entry, with `null` kept where the key is absent. */
function nodeType(entry) {
  return {
    type: entry.type,
    named: entry.named === true,
    root: entry.root === true,
    extra: entry.extra === true,
    supertype: Array.isArray(entry.subtypes) ? entry.subtypes.map(childType) : null,
    // A missing `fields` key is a terminal; `fields: {}` is a non-terminal
    // with no fields, which several leaf rules are for lexical reasons.
    fields: entry.fields ? Object.entries(entry.fields).map(([name, spec]) => ({ name, ...childSpec(spec) })) : null,
    children: entry.children ? childSpec(entry.children) : null,
  };
}

function childSpec(spec) {
  return {
    required: spec.required === true,
    multiple: spec.multiple === true,
    types: list(spec.types).map(childType),
  };
}

const childType = (t) => ({ type: t.type, named: t.named === true });

/**
 * `ci("get")` compiles to `/[Gg][Ee][Tt]/`, so the method sets can be read
 * back out of the generated patterns instead of being listed again: any rule
 * whose every pattern decodes that way, keyed by rule name.
 */
function methods(rules) {
  const out = {};
  for (const [name, body] of Object.entries(rules)) {
    const words = [];
    let all = true;
    walk(body, (node) => {
      if (childNodes(node).length) return; // structure, not a leaf
      const word = node.type === "PATTERN" && decodeCaseInsensitive(node.value);
      if (word) words.push(word);
      else all = false;
    });
    if (all && words.length) out[name] = words;
  }
  return out;
}

function decodeCaseInsensitive(pattern) {
  if (!/^(?:\[[A-Za-z][A-Za-z]\])+$/.test(pattern)) return null;
  let word = "";
  for (const [, upper, lower] of pattern.matchAll(/\[([A-Za-z])([A-Za-z])\]/g)) {
    if (upper !== upper.toUpperCase() || lower !== upper.toLowerCase()) return null;
    word += upper;
  }
  return word;
}

/**
 * Index of the `}` closing the `{` at `open`, skipping line and block
 * comments and string, template and character literals — so a brace inside a
 * comment or a `'{'` in the scanner cannot throw the count off.
 */
function matchBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === "\\") i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`unbalanced braces from ${open}`);
}
