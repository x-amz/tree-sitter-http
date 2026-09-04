// The LR item sets, keyed by the state number a parse reports.
//
// `tree-sitter generate --report-states-for-rule <rule>` prints, for every
// state that rule reaches, the state's index, the symbol sequence that reaches
// it, and its items with the dot and the lookahead set. A node's `parseState`
// is that same index, so joining the two lets the page show the automaton's
// actual position beside a live parse — the one thing a tree view cannot say.
//
// The report comes one rule at a time, so this asks for every rule and merges.
// Generation goes to a throwaway directory: no `src/` is touched. Lookahead
// sets repeat across nearly every item, so they are interned. build.js calls
// `itemSets` for every grammar the guide can stand in.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUILD = join(tmpdir(), "tree-sitter-http-states");

const STATE = /^state index: (\d+)$/;
const IDENT = /^state id: (\d+)$/;
const SEQUENCE = /^symbol sequence: ?(.*)$/;
const ARROW = "→";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const die = (message) => { console.error(message); process.exit(1); };

/** One rule's states, as the CLI prints them to stderr. */
function report(name, grammarJs, rule) {
  const run = spawnSync("tree-sitter",
    ["generate", "--abi", "14", "-o", join(BUILD, name), "--report-states-for-rule", rule, grammarJs],
    { encoding: "utf8" });
  if (run.status !== 0) die(`states: ${name} ${rule}: ${(run.stderr ?? run.error?.message ?? "").trim()}`);
  return run.stdout + run.stderr;
}

/** Merge one report's state blocks into `states`, interning lookahead sets. */
function parse(text, states, lookaheads) {
  let current = null;
  let fresh = false;
  for (const line of text.split(/\r?\n/)) {
    let found = STATE.exec(line);
    if (found) {
      current = states.get(found[1]);
      if (!current) states.set(found[1], (current = { items: [] }));
      // every rule that reaches a state prints the same items for it
      fresh = current.items.length === 0;
      continue;
    }
    if (current === null) continue;
    if ((found = IDENT.exec(line))) {
      current.id = Number(found[1]);
      continue;
    }
    if ((found = SEQUENCE.exec(line))) {
      current.sequence = found[1];
      continue;
    }
    if (line === "items:" || line.trim() === "") continue;
    if (!line.includes("\t") || !line.includes(ARROW)) {
      current = null;          // back in the rule/state-count table
      continue;
    }
    if (!fresh) continue;
    const tab = line.indexOf("\t");
    const item = line.slice(0, tab);
    const arrow = item.indexOf(ARROW);
    const rule = item.slice(0, arrow);
    const symbols = item.slice(arrow + ARROW.length).split(/\s+/).filter(Boolean);
    const dot = symbols.indexOf("•") === -1 ? symbols.length : symbols.indexOf("•");
    // Exactly one pair of brackets wraps the set. Stripping a *set* of
    // characters instead would eat the token `]]>`, which xml has.
    const follow = line.slice(tab + 1).trim().replace(/^\[/, "").replace(/\]$/, "")
      .split(", ").filter(Boolean);
    const key = follow.join(", ");
    if (!lookaheads.has(key)) lookaheads.set(key, lookaheads.size);
    current.items.push({
      rule: rule.trim(),
      symbols: symbols.filter((symbol) => symbol !== "•"),
      dot,
      follow: lookaheads.get(key),
    });
  }
}

/** Every rule name the grammar declares, plus the generated repeat helpers the
    report names — the state table only lists a state under a rule that reaches
    it, so asking for all of them is what covers the automaton. */
function rules(name, grammarJs, grammarJson) {
  const declared = Object.keys(json(grammarJson).rules);
  const listed = [...report(name, grammarJs, declared[0]).matchAll(/^(\S+)\s+\t\d+$/gm)].map((match) => match[1]);
  return [...new Set([...declared, ...listed])].sort();
}

/** One grammar's item sets: `grammarJs` and `grammarJson` are absolute paths. */
export function itemSets(name, grammarJs, grammarJson) {
  const states = new Map();
  const lookaheads = new Map();
  for (const rule of rules(name, grammarJs, grammarJson)) parse(report(name, grammarJs, rule), states, lookaheads);
  return {
    states: Object.fromEntries(states),
    lookaheads: [...lookaheads.keys()].map((key) => (key ? key.split(", ") : [])),
  };
}
