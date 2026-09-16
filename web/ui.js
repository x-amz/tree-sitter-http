// The guide. One block of text, editable at every step, and six steps that
// each perform their own operation on whatever is in it: the bytes, the tokens
// the lexer cut them into, the tree those reduced to, the query run over that
// tree, the colours its captures become, and the ranges handed to another
// grammar entirely.
//
// Nothing here states a fact about the grammar. Every number, name, regex and
// table is computed at load from this repo's own files (sources.js says
// which), so the page moves when the grammar moves. And nothing here parses
// or paints on its own: the grammars come in through the package's `ready`,
// the colour through its `analyze` and its `CSS`, and under the editable box
// the same text sits in its `<http-file>` element, so what the page shows is
// what a consumer of `tree-sitter-http-web` gets — the page maps that name in its
// import map, as a consumer does. This is the only module that touches the
// DOM; the logic it shows lives in grammar.js, parse.js, query.js and
// corpus.js, which node runs unchanged in check.js.

import { ready, bundles, highlight, escape, CSS, grammars, analyze, injectionNames } from "tree-sitter-http-web";
import { Query } from "tree-sitter-http-web/dist/tree-sitter.js";
import "tree-sitter-http-web/element";
import { bundled, load } from "./sources.js";
import * as grammar from "./grammar.js";
import * as parse from "./parse.js";
import * as scm from "./query.js";
import * as corpus from "./corpus.js";

// MARK: text

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
/** Mark markup as already safe. Idempotent, so raw(html`…`) is a no-op. */
const raw = (value) => (value && value.html !== undefined ? value : { html: String(value) });
const fmt = (value) =>
  value == null || value === false ? ""
  : Array.isArray(value) ? value.map(fmt).join("")
  : value.html !== undefined ? value.html
  : esc(value);
/** Tagged template that escapes every interpolation unless it is raw(). Its own
    result is raw, so templates nest without a wrapper. */
const html = (strings, ...values) =>
  raw(strings.reduce((out, part, i) => out + part + (i < values.length ? fmt(values[i]) : ""), ""));

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ms = (n) => (n < 0.01 ? "under 0.01 ms" : `${n < 1 ? n.toFixed(3) : n.toFixed(2)} ms`);
const clip = (text, n = 48) => (text.length > n ? `${text.slice(0, n)}…` : text);
/** Make an invisible character visible in a label. */
const show = (text) => text.replace(/\t/g, "⇥").replace(/\r/g, "␍").replace(/\n/g, "␊").replace(/ /g, "·");
const code = (text) => raw(`<code>${esc(text)}</code>`);
/** A lead is facts, not sentences: the chips that are there, one line, a dot between. */
const facts = (...items) => {
  const kept = items.filter((one) => one !== null && one !== undefined && one !== "");
  return html`<p class="now">${kept.map((one, i) => html`${i ? raw(' <span class="sep">·</span> ') : ""}${one}`)}</p>`;
};
const span = (start, end) => html`${start}–${end}`;
const table = (head, rows, caption = null) => html`<div class="scroll"><table>
    ${caption ? html`<caption>${caption}</caption>` : ""}
    ${head ? raw(`<thead><tr>${head}</tr></thead>`) : ""}
    <tbody>${raw(rows.map(fmt).join("") || '<tr><td class="muted">nothing here</td></tr>')}</tbody>
  </table></div>`;

// MARK: steps

const STEPS = [
  { label: "lex", caption: capLex, paint: paintLex, result: seeLex },
  { label: "parse", caption: capParse, paint: paintParse, result: seeParse },
  { label: "query", caption: capQuery, paint: paintQuery, result: seeQuery },
  { label: "paint", caption: capPaint, paint: paintPaint, result: seePaint },
  { label: "inject", caption: capInject, paint: paintInject, result: seeInject },
];

const app = { repo: null, dialects: [], active: null, step: 0, states: null, notes: [], trail: [], stranded: null };

/** What the steps operate on: the document, or a range inside it that another
    grammar owns and that we have gone down into. */
const view = () => app.trail[app.trail.length - 1] ?? app.active;
const dom = {};
const IDS = ["examples", "reset", "trail", "dialects", "steps", "caption", "field", "output", "input",
             "shipped-note", "shipped", "shipped-css", "result", "grammar-ref", "grammar-body",
             "corpus-ref", "corpus-body", "status"];

// MARK: boot

export async function start() {
  for (const id of IDS) {
    dom[id] = document.getElementById(id);
    if (!dom[id]) throw new Error(`the page has no #${id}`);
  }

  // The package's stylesheet, for the mirror; the element
  // carries its own copy inside.
  dom["shipped-css"].textContent = CSS;
  // The grammars and their queries, loaded and compiled by the package — the
  // same call, over the same files, as any page that imports it.
  await ready();
  app.repo = await load(await bundled(fetchText), { optional: (path) => app.notes.push(path) });
  app.dialects = Object.values(app.repo.dialects).map(open);

  wireDialects();
  wireSteps();
  wireEditor();
  wireReference();
  activate(app.dialects[0]);

  fetchText("./states.json")
    .then((text) => { app.states = JSON.parse(text); if (app.step === 1) renderResult(); })
    .catch(() => app.notes.push("states.json"));
}

/** What the build hashed each data file to, by the path the page asks for.
    Empty when the page is served straight from `web/`, where nothing is
    built and nothing should be cached. */
const BUILD = JSON.parse(document.getElementById("build")?.textContent || "{}");

/** Read a path relative to this directory, cached. The URL carries a hash of
    the bytes behind it, so the browser may keep it as long as it likes and a
    rebuild asks for a different URL. The package's files are versioned the
    same way, by the directory the build vendors them into. */
const fetched = async (path) => {
  const url = new URL(path, import.meta.url);
  if (BUILD[path]) url.searchParams.set("v", BUILD[path]);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
};
const fetchText = async (path) => (await fetched(path)).text();

/** A dialect on the page. Its bundle is the package's own, as `ready` left it. */
function open(dialect) {
  return {
    dialect,
    facts: grammar.facts(dialect, app.repo.defineGrammar),
    bundle: bundles.get(dialect.name),
    text: dialect.samples[0]?.text ?? "",
    example: 0,
    query: dialect.highlights ?? "",
    injectionsQuery: dialect.injections ?? "",
    parsed: null,
    painted: null,
    pick: null,
  };
}

// MARK: chrome

function wireDialects() {
  dom.dialects.replaceChildren(...app.dialects.map((entry) => {
    const button = document.createElement("button");
    button.className = "choice";
    button.textContent = entry.dialect.name;
    button.title = entry.dialect.title;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => activate(entry));
    entry.button = button;
    return button;
  }));
}

function wireSteps() {
  const nodes = [];
  STEPS.forEach((step, index) => {
    if (index) {
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "→";
      nodes.push(arrow);
    }
    const button = document.createElement("button");
    button.className = "step";
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === app.step));
    button.innerHTML = fmt(html`<i>${index}</i>${step.label}`);
    button.addEventListener("click", () => setStep(index));
    step.button = button;
    nodes.push(button);
  });
  dom.steps.replaceChildren(...nodes);
}

function setStep(index) {
  app.step = Math.max(0, Math.min(STEPS.length - 1, index));
  view().pick = null;   // a pick belongs to the document a step stands in
  STEPS.forEach((step, i) => step.button?.setAttribute("aria-selected", String(i === app.step)));
  renderText();
  renderCaption();
  renderResult();
}

function wireEditor() {
  dom.input.addEventListener("input", () => { edited(dom.input.value); });
  // The caret in the text asks "what is this?": whatever was picked on the
  // right lets go, and the right answers for the caret.
  for (const event of ["click", "keyup", "select"]) {
    dom.input.addEventListener(event, () => {
      view().pick = null;
      renderText();
      renderResult();
    });
  }
  dom.trail.addEventListener("click", (event) => {
    const target = event.target.closest("[data-level]");
    if (target) leaveTo(Number(target.dataset.level));
  });
  dom.reset.addEventListener("click", () => {
    const entry = app.active;
    // A corpus case loaded from the reference leaves no example selected;
    // reset goes back to the first sample, and the picker says so.
    if (!entry.examples[entry.example]) entry.example = 0;
    dom.examples.selectedIndex = entry.example;
    setText(entry.examples[entry.example].text);
  });
  dom.examples.addEventListener("change", () => {
    const entry = app.active;
    entry.example = dom.examples.selectedIndex;
    setText(entry.examples[entry.example].text);
  });
  // The steps are a sequence, so the arrow keys walk it — except while the
  // caret is in the text, where the arrows belong to the text.
  window.addEventListener("keydown", (event) => {
    const editing = event.target === dom.input || event.target.tagName === "TEXTAREA";
    if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowRight") { setStep(app.step + 1); event.preventDefault(); }
    else if (event.key === "ArrowLeft") { setStep(app.step - 1); event.preventDefault(); }
    else if (/^[0-5]$/.test(event.key)) { setStep(Number(event.key)); event.preventDefault(); }
  });
  // The right side. A row or a range marked selectable moves the caret to it;
  // a pick — a token in the ladder, a rule in the stylesheet — asks "where are
  // these?", and the text marks every range that
  // item produced. Picking it again lets go.
  dom.result.addEventListener("click", (event) => {
    const target = event.target.closest("[data-select],[data-load],[data-pick],[data-enter]");
    if (!target) return;
    if (target.dataset.enter !== undefined) {
      enter(Number(target.dataset.enter));
      if (target.dataset.step !== undefined) setStep(Number(target.dataset.step));
      return;
    }
    const here = view();
    if (target.dataset.select !== undefined) {
      const [start, end] = target.dataset.select.split(":").map(Number);
      select(start, end);
    } else if (target.dataset.load !== undefined) {
      setText(decodeURIComponent(target.dataset.load));
    } else if (target.dataset.pick !== undefined) {
      here.pick = here.pick === target.dataset.pick ? null : target.dataset.pick;
      renderText();
      renderCaption();
      renderResult();
    }
  });
  // The editable documents, the grammar's two queries. The caret in one picks
  // the pattern it is in; a keystroke shows in the mirror
  // at once, or the glyphs drift off the caret, and the analysis follows after
  // a pause. Neither rebuilds the panel, which would take the textarea out
  // from under the caret.
  for (const type of ["click", "keyup", "select"]) {
    dom.result.addEventListener(type, (event) => {
      if (DOCS[event.target.id]) pickFromDoc(event.target);
    });
  }
  dom.result.addEventListener("input", (event) => {
    const slot = DOCS[event.target.id];
    if (!slot) return;
    view()[slot] = event.target.value;
    const mirror = document.getElementById(`${event.target.id}-mirror`);
    if (mirror) mirror.innerHTML = `${escape(event.target.value)}\n`;
    clearTimeout(wireEditor.pending);
    wireEditor.pending = setTimeout(refreshDoc, 150);
  });
}

/** The editable documents, by textarea id — the grammar's two queries — the
    entry field each edits, and the pick a caret in it makes. */
const DOCS = { query: "query", injections: "injectionsQuery" };
const PICKS = { query: "pat", injections: "inj" };

/** The caret in an editable document picks the pattern it sits in — "where
    are these?" — or, between patterns, nothing, which follows the text again. */
function pickFromDoc(textarea) {
  const here = view();
  const found = compiled(here, textarea.value);
  if (!found.ok) return;
  const at = textarea.selectionStart ?? 0;
  const pattern = found.patterns.find((one) => one.startIndex <= at && at <= one.endIndex);
  found.query.delete();
  const key = pattern ? `${PICKS[textarea.id]}:${pattern.index}` : null;
  if (key === here.pick) return;
  here.pick = key;
  renderText();
  renderCaption();
  refreshPanel();
}

function wireReference() {
  dom["grammar-ref"].addEventListener("toggle", () => {
    if (dom["grammar-ref"].open) dom["grammar-body"].innerHTML = fmt(grammarReference(app.active));
  });
  dom["corpus-ref"].addEventListener("toggle", () => {
    if (dom["corpus-ref"].open) dom["corpus-body"].innerHTML = fmt(corpusReference(app.active));
  });
  dom["corpus-body"].addEventListener("click", (event) => {
    const row = event.target.closest("[data-load]");
    if (!row) return;
    setText(decodeURIComponent(row.dataset.load));
    // A corpus case is not one of the samples, so nothing in the picker names
    // it: clear the selection rather than leave it naming something else.
    const at = app.active.examples.findIndex((one) => one.text === app.active.text);
    app.active.example = at;
    dom.examples.selectedIndex = at;
  });
}

function activate(entry) {
  // Whatever is in the box belongs to the document you are standing in, however
  // deep that is. Fold it back before going anywhere else.
  if (app.active) commit();
  app.trail.length = 0;
  app.active = entry;
  for (const other of app.dialects) other.button?.setAttribute("aria-pressed", String(other === entry));
  if (!entry.examples) entry.examples = examplesFor(entry);
  dom.examples.replaceChildren(...entry.examples.map((example) => {
    const option = document.createElement("option");
    option.textContent = example.label;
    return option;
  }));
  dom.examples.selectedIndex = entry.example;
  dom.input.value = entry.text;
  dom.input.setSelectionRange(0, 0);
  entry.loaded = true;
  dom["grammar-ref"].open = false;
  dom["corpus-ref"].open = false;
  draw();
}

/** The dialect's samples — the page's worked examples, and nothing else. The
    corpus is dozens of cases and has its own place on the page, the reference
    below the text, where a case can be read beside its expected tree and
    loaded from there. A picker holding both was a list nobody could scan. */
function examplesFor(entry) {
  return entry.dialect.samples.map((sample) => ({ label: sample.name, text: sample.text }));
}

function setText(text) {
  app.trail.length = 0;
  app.active.pick = null;
  app.active.loaded = true;
  app.active.text = text;
  dom.input.value = text;
  dom.input.setSelectionRange(0, 0);
  draw();
}

const caret = () => dom.input.selectionStart ?? 0;

function select(start, end) {
  view().pick = null;
  dom.input.focus();
  dom.input.setSelectionRange(start, end);
  renderText();
  renderResult();
}

/** The bundle to paint with: the package's own, unless a query on screen has
    been edited into something that still compiles. */
function painterFor(entry) {
  const patch = {};
  const own = entry.dialect;
  if (own.highlights != null && entry.query !== own.highlights) {
    try { patch.query = new Query(entry.bundle.language, entry.query); } catch { /* as shipped */ }
  }
  if (own.injections != null && entry.injectionsQuery !== own.injections) {
    try { patch.injections = new Query(entry.bundle.language, entry.injectionsQuery); } catch { /* as shipped */ }
  }
  return Object.keys(patch).length ? { ...entry.bundle, ...patch } : entry.bundle;
}

/** Whether a query on screen differs from the one the package carries. */
const queriesEdited = (entry) =>
  (entry.dialect.highlights != null && entry.query !== entry.dialect.highlights)
  || (entry.dialect.injections != null && entry.injectionsQuery !== entry.dialect.injections);

// MARK: going down into another grammar

/** Enter one of this view's injected ranges: the same six steps, on those
    characters, run by the grammar that owns them. */
function enter(index) {
  const from = view();
  const record = from.injections[index];
  if (!record?.resolved) return;
  app.trail.push(levelFor(from, record));
  if (app.trail.length === 1) app.returnTo = app.step;
  dom.input.value = view().text;
  dom.input.setSelectionRange(0, 0);
  app.step = 0;
  STEPS.forEach((step, i) => step.button?.setAttribute("aria-selected", String(i === app.step)));
  draw();
}

/** A range another grammar owns, as a level the six steps can stand in: a
    dialect of this repo, or a body language the package ships — the same
    shape either way, its tables for the lexer's candidates and the parser's
    item sets, its queries for the outlines and the colour. `enter` pushes one
    on the trail; the inject step builds one to run the steps inside a range
    without going in. */
function levelFor(from, record) {
  const dialect = app.repo.dialects[record.language] ?? app.repo.languages[record.language];
  return {
    parent: from,
    start: record.start,
    end: record.end,
    language: record.language,
    bundle: bundles.get(record.language),
    dialect,
    facts: factsFor(record.language),
    query: dialect.highlights ?? "",
    injectionsQuery: dialect.injections ?? "",
    text: from.source.slice(record.start, record.end),
    pick: null,
  };
}

/** A grammar's facts, derived once: its tables do not change under the page. */
const FACTS = new Map();
function factsFor(name) {
  if (!FACTS.has(name)) {
    const own = app.repo.dialects[name];
    const dialect = own ?? app.repo.languages[name];
    FACTS.set(name, dialect?.grammarJson ? grammar.facts(dialect, own ? app.repo.defineGrammar : null) : null);
  }
  return FACTS.get(name);
}

/** Back out to a level of the trail; -1 is the whole document. */
function leaveTo(level) {
  commit();
  app.trail.length = Math.max(0, Math.min(app.trail.length, level + 1));
  if (app.step !== app.returnTo && app.returnTo !== undefined && !app.trail.length) setStep(app.returnTo);
  const back = view();
  dom.input.value = back.text;
  dom.input.setSelectionRange(0, 0);
  draw();
}

/** Fold whatever is in the box up through the trail into the document. Any way
    of leaving a range has to do this first, or the document loses the range. */
function commit(text = dom.input.value) {
  view().text = text;
  for (let i = app.trail.length - 1; i >= 0; i -= 1) {
    const level = app.trail[i];
    const above = level.parent;
    above.text = above.text.slice(0, level.start) + level.text + above.text.slice(level.end);
    level.end = level.start + level.text.length;
  }
}

/** An edit inside a range is an edit to the document containing it. */
function edited(text) {
  commit(text);
  draw();
}

/** Where a range sits in the whole document, not in its parent. */
const absolute = (index) =>
  app.trail.slice(0, index + 1).reduce((at, level) => at + level.start, 0);

/** A query edit changes what is painted and what the report says, and nothing
    else. Rebuilding the result panel would take the textarea out from under
    the caret, so this touches everything but that. */
function refreshDoc() {
  analyse(view());
  renderText();
  renderCaption();
  renderStatus();
  renderShipped();
  refreshPanel();
}

/** The parts of a panel around an editable document — the lead above it, the
    marks in its mirror, the report under it — rendered again in place. */
function refreshPanel() {
  const entry = view();
  if (app.step !== 2) return;
  const lead = document.getElementById("query-at");
  if (lead) lead.innerHTML = fmt(queryLead(entry));   // settles the marks
  const mirror = document.getElementById("query-mirror");
  if (mirror) mirror.innerHTML = marked(entry.query, entry.docMarks);
  const injections = document.getElementById("injections-mirror");
  if (injections) injections.innerHTML = marked(entry.injectionsQuery, entry.injectMarks);   // whichever is on screen
  const out = document.getElementById("query-out");
  if (out) out.innerHTML = fmt(queryReport(entry));
}

function renderTrail() {
  dom.trail.hidden = !app.trail.length && !app.stranded;
  if (!app.trail.length) {
    dom.trail.innerHTML = fmt(html`<button data-level="-1" class="here">${app.active.dialect.name}</button>
      <span class="muted">— ${app.stranded
        ? html`the whole document again: that edit means it no longer hands anything to ${app.stranded}`
        : "the whole document"}</span>`);
    app.stranded = null;
    return;
  }
  app.stranded = null;
  const depth = app.trail.length - 1;
  const at = absolute(depth);
  const last = app.trail[depth];
  const crumbs = [app.active.dialect.name, ...app.trail.map((one) => one.language)];
  dom.trail.innerHTML = fmt(html`${crumbs.map((name, i) => html`${i ? raw('<span class="sep">›</span>') : ""}<button
      data-level="${i - 1}" class="${i === crumbs.length - 1 ? "here" : ""}">${name}</button>`)}
    <span class="muted">— characters ${at}–${at + last.text.length} of the document, which
    ${last.language} owns.</span>`);
}

// MARK: the run

function draw() {
  // The document first, then each range inside it, so no level is ever reasoning
  // about a parent that has moved under it.
  const chain = [app.active, ...app.trail];
  chain[chain.length - 1].text = dom.input.value;
  for (let i = 0; i < chain.length; i += 1) {
    analyse(chain[i]);
    const next = chain[i + 1];
    if (!next) break;
    const record = chain[i].injections.find((one) =>
      one.depth === 0 && one.start === next.start && one.language === next.language);
    if (!record) {
      // The edit changed what that range is, so it is not handed over any more.
      app.trail.length = i;
      app.stranded = next.language;
      dom.input.value = chain[i].text;
      break;
    }
    next.end = record.end;
    next.text = chain[i].text.slice(record.start, record.end);
  }
  const deepest = view();
  if (dom.input.value !== deepest.text) {
    const at = Math.min(dom.input.selectionStart ?? 0, deepest.text.length);
    dom.input.value = deepest.text;
    dom.input.setSelectionRange(at, at);
  }

  renderTrail();
  renderText();
  renderShipped();
  renderCaption();
  renderResult();
  renderStatus();
  if (dom["grammar-ref"].open) dom["grammar-body"].innerHTML = fmt(grammarReference(app.active));
  if (dom["corpus-ref"].open) dom["corpus-body"].innerHTML = fmt(corpusReference(app.active));
}

/** Everything one level of the chain knows about its own text. */
function analyse(entry) {
  const source = entry.text;
  entry.parsed?.tree?.delete();
  const started = performance.now();
  const parsed = parse.analyze(entry.bundle, source, { tokenTable: entry.facts?.tokens ?? null });
  const painter = painterFor(entry);
  const host = analyze(painter, bundles, source, 0);
  const painted = analyze(painter, bundles, source);
  entry.elapsed = performance.now() - started;
  entry.step = entry.loaded || entry.source === undefined || entry.source === source
    ? (entry.loaded ? null : entry.step)
    : parse.incremental(entry.bundle, entry.source, source);
  entry.loaded = false;
  entry.parsed = parsed;
  entry.host = host;
  entry.painted = painted;
  entry.source = source;
  entry.injections = flatten(painted.injections);
}

function flatten(injections, out = []) {
  for (const injection of injections) { out.push(injection); flatten(injection.children, out); }
  return out;
}

/** Runs of identical (colour, mark) become one span. Colour comes from the
    highlight query; the mark is what the current step draws over it. The text
    is escaped as the package escapes it, so with no mark drawn this is
    `highlight`'s own output, and check.js holds the two to each other. */
function spanify(source, colour, mark) {
  const at = (i) => (colour[i] && mark[i] ? `${colour[i]} ${mark[i]}` : colour[i] || mark[i] || null);
  let out = "";
  for (let i = 0; i < source.length;) {
    let j = i;
    const cls = at(i);
    while (j < source.length && at(j) === cls) j++;
    const run = escape(source.slice(i, j));
    out += cls === null ? run : `<span class="${cls}">${run}</span>`;
    i = j;
  }
  return out;
}

function renderText() {
  const entry = view();
  const source = entry.source;
  const empty = new Array(source.length).fill(null);
  const drawn = STEPS[app.step].paint(entry, source) ?? {};
  const mark = drawn.mark ?? empty;
  // Whatever else a step draws, text the parser could not place is marked at
  // every one of them.
  for (const error of entry.parsed.errors) {
    mark.fill("bad", error.start, Math.max(error.end, error.start + 1));
  }
  // A range another grammar could not read is wrong text too, wherever the
  // footer counts it.
  if (app.step === 4) {
    for (const record of entry.injections) {
      if (record.hasError) mark.fill("bad", record.start, record.end);
    }
  }
  dom.output.innerHTML = `${spanify(source, drawn.colour ?? empty, mark)}\n`;
}

function renderCaption() {
  dom.caption.innerHTML = fmt(STEPS[app.step].caption(view()));
}

function renderResult() {
  // A selection refresh must not close the reference the reader is using.
  const expanded = new Set(Array.from(dom.result.querySelectorAll?.("details[open][data-panel]") ?? [],
    (one) => one.dataset.panel));
  try {
    dom.result.innerHTML = fmt(STEPS[app.step].result(view()));
  } catch (error) {
    dom.result.innerHTML = fmt(html`<p class="warn">${error.message}</p>`);
    throw error;
  }
  for (const one of dom.result.querySelectorAll?.("details[data-panel]") ?? []) {
    if (expanded.has(one.dataset.panel)) one.open = true;
  }
  // Every box the step stands in is scrolled to what applies — the line the
  // lead names, or the marked row — so it opens on what matters and nothing
  // else has to move.
  for (const to of [view().scrollTo].flat().filter(Boolean)) {
    const scroller = document.getElementById(`${to.id}-scroll`) ?? document.getElementById(to.id);
    if (!scroller) continue;
    if (to.row) {
      const row = scroller.querySelector?.(".on");
      if (row?.getBoundingClientRect && scroller.getBoundingClientRect) {
        const offset = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        scroller.scrollTop = Math.max(0, offset - scroller.clientHeight / 3);
      }
      continue;
    }
    const mirror = document.getElementById(`${to.id}-mirror`);
    if (mirror?.scrollHeight) scroller.scrollTop = Math.max(0, (to.line - 2) * (mirror.scrollHeight / Math.max(1, to.of)));
  }
}

/** The lead answers for the selection. Documents and supporting evidence
    have bounded scroll areas; short results use only the space they need. */
const lead = (id, content) => html`<div class="lead" id="${id}">${content}</div>`;
const pane = (id, content) => html`<div class="pane" id="${id}">${content}</div>`;
const box = (id, content) => html`<div class="doc" id="${id}-scroll">${content}</div>`;

/** A document a step stands in, on the right: `text` as a mirror with `marks`
    — `{start, end, cls, pick?}` ranges in order, not overlapping — under a
    transparent textarea when it is editable, in a box that scrolls to the mark
    the lead named. The document never moves; the marks do. */
function doc(id, text, editable, marks) {
  return box(id, html`<div class="field">
    <pre class="hl" id="${id}-mirror" aria-hidden="${String(editable)}">${raw(marked(text, marks))}</pre>
    ${editable ? html`<textarea id="${id}" spellcheck="false" aria-label="${id}">${text}</textarea>` : ""}
  </div>`);
}

function marked(text, marks) {
  let out = "";
  let at = 0;
  for (const mark of marks ?? []) {
    out += escape(text.slice(at, mark.start));
    const pick = mark.pick ? ` data-pick="${esc(mark.pick)}"` : "";
    out += `<span class="${mark.cls}"${pick}>${escape(text.slice(mark.start, mark.end))}${mark.after ?? ""}</span>`;
    at = mark.end;
  }
  return `${out}${escape(text.slice(at))}\n`;
}

/** Where a document should open: at `line` of its `of` lines, or at its
    marked row. */
const scrollTo = (id, line, text) => (line ? { id, line, of: text.split("\n").length } : null);
const scrollToRow = (id) => ({ id, row: true });

/** The pick of one kind, if that is what is picked: `"tok:method"` -> `"method"`. */
const picked = (entry, kind) =>
  entry.pick?.startsWith(`${kind}:`) ? entry.pick.slice(kind.length + 1) : null;

/** A symbol without the generated `_tokenN` suffix. */
const bare = (symbol) => String(symbol).replace(/_token\d+$/, "");

function renderStatus() {
  const entry = view();
  const painted = entry.painted;
  const cells = [
    !painted.anyError ? html`<b class="ok">no errors</b>`
      : painted.total
        ? html`<b class="warn">${plural(painted.total, "error node")}</b>${painted.injected
            ? html`, ${painted.injected} in an injected language` : ""}`
        : html`<b class="warn">missing tokens</b>${painted.injectedBad && !painted.hasError
            ? html` in an injected language` : ""}`,
    app.notes.length ? html`not built: <b class="warn">${app.notes.join(", ")}</b> — run the build` : null,
  ].filter(Boolean);
  dom.status.innerHTML = cells.map((cell) => `<span>${fmt(cell)}</span>`).join("");
}

/** The same text through the package's own element: `highlight` with the
    queries the package carries, whatever the box above has been edited to
    run. It is the box a consumer gets, beside the page's own painting of the
    same characters. */
function renderShipped() {
  const entry = view();
  dom.shipped.dialect = entry.dialect.name;
  dom.shipped.value = entry.text;
  dom["shipped-note"].innerHTML = fmt(html`<b>as shipped</b> — ${code(`<http-file dialect="${entry.dialect.name}">`)}${
    queriesEdited(entry) ? html`, <b>not</b> running the edited queries` : ""}`)
}

// MARK: lookups

const tokenAt = (entry, at) =>
  entry.parsed.tokens.find((token) => token.accepted && token.start <= at && at < token.end)
  ?? entry.parsed.tokens.findLast((token) => token.accepted && token.end <= at)
  ?? entry.parsed.tokens[0] ?? null;

function nodeAt(entry, at) {
  const root = entry.parsed.tree.rootNode;
  if (!entry.source.length) return root;
  const start = Math.min(at, entry.source.length - 1);
  return root.descendantForIndex(start, Math.min(start + 1, entry.source.length));
}

const ancestry = (node) => {
  const path = [];
  for (let one = node; one; one = one.parent) path.unshift(one);
  return path;
};

const injectionAt = (entry, at) =>
  entry.injections.filter((one) => one.start <= at && at < one.end).at(-1) ?? null;

/** A range another grammar answered for and kept: not opaque, not tried and declined. */
const kept = (one) => one.resolved && !one.declined;

/** The innermost range another grammar answered for that holds the caret, or null. */
const handedAt = (entry, at) =>
  entry.injections.filter((one) => kept(one) && one.start <= at && at < one.end).at(-1) ?? null;

/** The way into the range that holds the caret, as a pill. */
const goIn = (entry, record) =>
  raw(`<span class="pill pick" data-enter="${entry.injections.indexOf(record)}">go in</span>`);

const compiled = (entry, source) => scm.compile(Query, entry.bundle.language, source ?? entry.query);

// MARK: 0 plain

// MARK: 0 lex — the character under the caret, and the token it is in

function capLex(entry) {
  const lines = entry.parsed.lines.length - (entry.source.endsWith("\n") || entry.source === "" ? 1 : 0);
  return html`<b>The lexer cuts text into tokens the parser can accept.</b> ${plural(entry.parsed.bytes, "byte")},
    ${plural(Math.max(lines, 0), "line")}.`;
}

/** The character under the caret: offset, line and column, the character, its code point. */
function characterFacts(entry) {
  const at = caret();
  const source = entry.source;
  const before = source.slice(0, at);
  const row = before.split("\n").length;
  const column = at - (before.lastIndexOf("\n") + 1);
  const character = source[at];
  const point = character?.codePointAt(0);
  return facts(
    html`offset <b>${at}</b>`,
    html`line ${row}, column ${column}`,
    character ? code(show(String.fromCodePoint(point))) : "end of text",
    character ? html`U+${point.toString(16).toUpperCase().padStart(4, "0")}` : null,
    character ? html`<span class="muted">${[...new TextEncoder().encode(String.fromCodePoint(point))].map((b) => b.toString(16).padStart(2, "0")).join(" ")}</span>` : null,
  );
}

function paintLex(entry, source) {
  const mark = new Array(source.length).fill(null);
  const pick = picked(entry, "tok");
  const chosen = pick == null ? tokenAt(entry, caret()) : null;
  let alternate = false;
  for (const token of entry.parsed.tokens) {
    if (!token.accepted) continue;
    const whitespace = /^\s+$/.test(source.slice(token.start, token.end));
    // Every token gets an edge, so the cuts are all visible; alternate ones get
    // a wash as well, so which run belongs to which is legible too. Marked: the
    // token under the caret, or every token of the kind picked in the ladder.
    const lit = pick != null ? bare(token.symbol) === pick : token === chosen;
    const cls = ["tok", alternate ? "alt" : "", whitespace ? "ws" : "", lit ? "sel" : ""].filter(Boolean).join(" ");
    alternate = !alternate;
    mark.fill(cls, token.start, token.end);
  }
  return { mark };
}

function seeLex(entry) {
  const accepted = entry.parsed.tokens.filter((token) => token.accepted);
  const token = tokenAt(entry, caret());
  if (!token) return html`<p>Nothing to lex.</p>`;
  const pick = picked(entry, "tok");
  const options = candidatesFor(entry, token);
  const matched = options.rows.filter((option) => option.matched);
  const ladder = lexicon(entry, options.rows, token);
  const tokenRow = (row) => html`
    <tr class="pick ${(pick != null ? row.symbol === pick : row.won) ? "on" : row.valid ? "" : "muted"}"
        data-pick="tok:${row.symbol}">
      <td>${row.matched ? "✓" : row.valid ? "·" : ""}</td>
      <td>${row.symbol}</td>
      <td class="num">${row.precedence ?? "—"}</td>
      <td class="num">${row.matched ? row.length : ""}</td>
      <td>${row.patterns.length ? code(clip(row.patterns.join(" | "), 40))
        : raw('<span class="muted">external scanner</span>')}</td>
    </tr>`;
  const relevant = ladder.filter((row) => row.valid || row.won || row.symbol === pick);
  const remaining = ladder.filter((row) => !relevant.includes(row));
  const head = '<th></th><th>token</th><th class="num">precedence</th><th class="num">length</th><th>pattern</th>';
  entry.scrollTo = scrollToRow("ladder");
  const at = pick != null ? lexPicked(entry, ladder, accepted, pick) : facts(
    html`<b>${token.symbol}</b> ${span(token.start, token.end)}`,
    code(show(clip(entry.source.slice(token.start, token.end), 34))),
    token.precedence != null ? html`precedence ${token.precedence}` : null,
    token.external ? "external scanner" : null,
    !entry.facts ? html`<span class="warn">tables not built</span>`
      : matched.length ? html`${matched.length} matched` : html`<span class="warn">nothing matched, recovering</span>`,
    entry.facts ? whyItWon(options.rows, token) : null,
  );
  return html`
    ${lead("lex-at", html`${characterFacts(entry)}${at}`)}
    <h3>tokens considered here</h3>
    ${box("ladder", table(head, relevant.map(tokenRow)))}
    ${remaining.length ? html`<details data-panel="lexicon"><summary>Other token kinds (${remaining.length})</summary>
      ${table(head, remaining.map(tokenRow))}</details>` : ""}`;
}


/** A token kind picked in the ladder: where it is in the text, and what it is. */
function lexPicked(entry, ladder, accepted, pick) {
  const row = ladder.find((one) => one.symbol === pick);
  const found = accepted.filter((one) => bare(one.symbol) === pick);
  return facts(
    html`<b>${pick}</b>`,
    found.length ? html`${found.length} of ${plural(accepted.length, "token")}` : "none in this text",
    found.length ? html`first at ${found[0].start}` : null,
    row ? html`precedence ${row.precedence ?? "none"}${row.level ? html` (${row.level})` : ""}` : null,
    row ? (row.patterns.length ? code(clip(row.patterns.join(" | "), 60)) : "external scanner") : null,
  );
}

/** Which of the rules settled it, as a chip: precedence, then length, then
    the order the rules are declared in. Null when nothing else matched. */
function whyItWon(rows, token) {
  const winner = rows.find((row) => bare(row.symbol) === bare(token.symbol));
  const rivals = rows.filter((row) => row.matched && row !== winner);
  if (!winner || !rivals.length) return null;
  const level = (row) => row.precedence ?? 0;
  const tied = rivals.filter((row) => level(row) === level(winner));
  const under = rivals.filter((row) => level(row) < level(winner));
  if (under.length && !tied.length) {
    return html`won on precedence, ${level(winner)} over ${Math.max(...under.map(level)) || "none"}`;
  }
  const shorter = tied.filter((row) => row.length < winner.length);
  if (tied.length && shorter.length === tied.length) {
    return html`won on length, ${winner.length} over ${tied[0].length}`;
  }
  if (tied.length) return html`won on rule order over ${code(tied[0].symbol)}`;
  return null;
}

/** The lexer's whole vocabulary in the ladder's order, lit by the caret: which
    tokens the parser would accept at this position, which matched, which won.
    The rows never move; only the lights do. A candidate the tables do not
    name — a hidden symbol the runtime reports under another name — is
    appended, so nothing the parser accepted goes unlisted. */
function lexicon(entry, candidates, token) {
  const blank = (symbol, precedence, level) =>
    ({ symbol, precedence, level, patterns: [], valid: false, matched: false, length: 0, won: false });
  const rows = [];
  const bySymbol = new Map();
  const byRule = new Map();
  if (entry.facts) {
    for (const level of entry.facts.precedence) {
      for (const one of level.tokens) {
        const key = bare(one.symbol);
        let row = bySymbol.get(key);
        if (!row) {
          row = blank(key, level.value, level.name);
          bySymbol.set(key, row);
          rows.push(row);
        }
        if (!row.patterns.includes(one.value)) row.patterns.push(one.value);
        if (!byRule.has(one.rule)) byRule.set(one.rule, row);
      }
    }
    for (const external of entry.facts.externals) {
      const row = blank(external, null, null);
      bySymbol.set(external, row);
      rows.push(row);
    }
  }
  for (const option of candidates) {
    let row = bySymbol.get(bare(option.symbol)) ?? byRule.get(option.rule);
    if (!row) {
      row = blank(option.symbol, option.precedence, null);
      row.patterns = option.patterns.filter(Boolean);
      bySymbol.set(bare(option.symbol), row);
      rows.push(row);
    }
    row.valid = true;
    row.matched ||= option.matched;
    row.length = Math.max(row.length, option.length);
    row.precedence ??= option.precedence;
  }
  const winner = bySymbol.get(bare(token.symbol)) ?? byRule.get(bare(token.symbol));
  if (winner) winner.won = true;
  return rows;
}

/** One row per token, not per alternative: a method is one token whose regex is
    a choice of nine, and nine rows would read as nine decisions. */
function candidatesFor(entry, token) {
  const all = token.parseState == null ? []
    : parse.candidates(entry.bundle.language, entry.facts?.tokens ?? [], token.parseState,
                       entry.source, token.start);
  const grouped = new Map();
  let goto = 0;
  for (const option of all) {
    if (!option.resolved) { goto += 1; continue; }
    const row = grouped.get(option.symbol);
    if (!row) { grouped.set(option.symbol, { ...option, patterns: [option.pattern] }); continue; }
    if (!row.patterns.includes(option.pattern)) row.patterns.push(option.pattern);
    row.matched ||= option.matched;
    row.length = Math.max(row.length, option.length);
    row.precedence ??= option.precedence;
  }
  // A rule that is nothing but a token appears under both its own name and the
  // generated `_tokenN` one. Two identical rows read as two decisions.
  const rows = [...grouped.values()].filter((row) => {
    const base = bare(row.symbol);
    if (base === row.symbol) return true;
    const twin = grouped.get(base);
    return !twin || twin.patterns.join() !== row.patterns.join();
  });
  return { rows, goto };
}

// MARK: 2 parse

function capParse(entry) {
  const { parsed } = entry;
  const accepted = parsed.tokens.filter((token) => token.accepted).length;
  return html`<b>${plural(accepted, "token")} reduced into ${plural(parsed.counts.nodes, "node")}</b>,
    each tinted a shade darker than the one containing it.${parsed.counts.errors || parsed.counts.missing
      ? html` <b class="warn">${plural(parsed.counts.errors, "error node")}</b> and
        ${plural(parsed.counts.missing, "inserted token")}, shaded red.` : ""}`;
}

/** Nesting, drawn: each named node tints its own characters a shade darker than
    its parent's, so the tree is visible on the text rather than beside it. */
function paintParse(entry, source) {
  const mark = new Array(source.length).fill(null);
  const cursor = entry.parsed.tree.walk();
  let depth = 0;
  const walk = () => {
    if (cursor.nodeIsNamed && depth > 0) {
      mark.fill(`d${Math.min(depth, 5)}`, cursor.startIndex, cursor.endIndex);
    }
    if (cursor.gotoFirstChild()) {
      depth += 1;
      do { walk(); } while (cursor.gotoNextSibling());
      depth -= 1;
      cursor.gotoParent();
    }
  };
  walk();
  cursor.delete();
  const node = nodeAt(entry, caret());
  if (node) mark.fill("sel", node.startIndex, node.endIndex);
  return { mark };
}

function seeParse(entry) {
  const node = nodeAt(entry, caret());
  if (!node) return html`<p>No node here.</p>`;
  const path = ancestry(node);
  const crumbs = path.map((one, i) => html`${i ? raw(' <span class="muted">›</span> ') : ""}<span
    class="pill pick" data-select="${one.startIndex}:${one.endIndex}">${one.isMissing
      ? `MISSING ${one.type}` : one.type}</span>`);
  let leaf = node;
  while (leaf.childCount) leaf = leaf.firstChild;
  entry.scrollTo = scrollToRow("tree");
  return html`
    ${lead("parse-at", html`
      <p class="now">${crumbs}</p>
      ${facts(html`<b>${node.type}</b> ${span(node.startIndex, node.endIndex)}`,
        node.isNamed ? null : "anonymous", node.isMissing ? "missing, zero width" : null)}`)}
    <h3>tree</h3>
    ${box("tree", treeOf(entry, entry.parsed.tree.rootNode, node))}
    <details data-panel="parser"><summary>Parser state and incremental edits</summary>
    ${pane("parse-out", html`
      ${entry.step ? html`
        <p>Your last edit replaced ${plural(entry.step.edit.oldEndIndex - entry.step.edit.startIndex, "character")} at
        ${entry.step.edit.startIndex} with ${plural(entry.step.edit.newEndIndex - entry.step.edit.startIndex, "character")}.
        ${entry.step.coldMs < 0.05 && entry.step.warmMs < 0.05
          ? html`A fresh parse and a reparse of this are too fast to tell apart — the saving shows on a
            large file — and`
          : html`Handed the old tree, the parser reparsed in ${ms(entry.step.warmMs)} against
            ${ms(entry.step.coldMs)} from scratch, and`}
        ${entry.step.changedRanges.length
          ? html`${plural(entry.step.changedRanges.length, "range")} came back changed: ${entry.step.changedRanges.map((range) => html`<span
              class="pill pick" data-select="${range.startIndex}:${range.endIndex}">${range.startIndex}–${range.endIndex}</span> `)}`
          : "no range came back changed — the shape of the tree did not move"}.
        That is what an editor does on every keystroke.</p>` : ""}
      ${itemsFor(entry, leaf.parseState)}
      <details><summary>S-expression</summary>
        <pre class="src">${parse.sexp(entry.parsed.tree.rootNode, { fields: true })}</pre></details>`)}</details>`;
}

/** The subtree under `root`, indented, with `here` marked. */
function treeOf(entry, root, here) {
  const model = parse.treeModel(root, entry.source, { anonymous: true });
  const lines = [];
  const walk = (node, depth) => {
    const bad = node.error || node.missing;
    const on = node.start === here.startIndex && node.end === here.endIndex && node.type === here.type;
    lines.push(html`<tr class="pick ${on ? "on" : ""}" data-select="${node.start}:${node.end}">
      <td>${raw("&nbsp;".repeat(depth * 2))}${node.field ? html`<span class="muted">${node.field}:</span> ` : ""}<span
        class="${bad ? "warn" : node.named ? "" : "muted"}">${node.missing ? `MISSING ${node.type}` : node.type}</span></td>
      <td class="num muted">${node.start}–${node.end}</td></tr>`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(model, 0);
  return table('<th>node</th><th class="num">range</th>', lines);
}

/** The LR item set for a state — the automaton's actual position, which no tree
    can show. */
function itemsFor(entry, state) {
  if (state == null) return "";
  const bank = app.states?.[entry.dialect.name];
  if (!bank) {
    return html`<p class="muted">${app.states
      ? html`No item sets for ${entry.dialect.name} in <code>states.json</code>; run the build.`
      : raw("Item sets load from <code>states.json</code>; run the build.")}</p>`;
  }
  const record = bank.states[String(state)];
  if (!record) {
    return html`<p class="muted">State ${state}: no rule reaches it, so the generator files no items
      for it — the start and the error state are both like that.</p>`;
  }
  const rows = record.items.map((item) => html`<tr><td>${item.rule}</td><td>${
    item.symbols.slice(0, item.dot).join(" ")}${item.dot ? " " : ""}•${
    item.dot < item.symbols.length ? " " : ""}${item.symbols.slice(item.dot).join(" ")}</td></tr>`);
  return html`
    <p class="now">State ${state}, reached by ${record.sequence ? code(record.sequence) : "the start symbol"}:
    ${plural(record.items.length, "item")} still in play, the dot marking how far each has got.</p>
    ${table("<th>rule</th><th>item</th>", rows)}`;
}

// MARK: 3 query

function capQuery(entry) {
  const found = compiled(entry);
  const ok = found.ok;
  if (ok) found.query.delete();
  return html`<b>A query is a search over that tree.</b> ${ok
    ? html`Outlined above is what one pattern of ${entry.dialect.name}'s queries found${
        queriesEdited(entry) ? ", as you have edited them" : ""}.`
    : "The highlight query does not compile as it stands, so nothing is outlined."}`;
}

/** Which pattern of which query answers for the caret — exactly one file at a
    time: the pattern picked in either query; else, for a character in a range
    this grammar handed over, the injection pattern that claimed it — the
    innermost such range, since a placeholder sits inside the body it is in —
    unless a highlight capture reaches deeper; else the highlight pattern that
    paints the character; else none. A node both captured and handed over,
    a placeholder, is the injection's: the capture is the host's own stroke,
    and the lead says so. */
function queryFocus(entry, found) {
  const inj = picked(entry, "inj");
  if (inj != null) return { file: "injections", index: Number(inj) };
  const pat = picked(entry, "pat");
  if (pat != null) return { file: "highlights", index: Number(pat) };
  const at = caret();
  const here = found?.ok ? captureAt(entry, found) : null;
  const outer = entry.injections.filter((one) => one.depth === 0 && one.start <= at && at < one.end).at(-1) ?? null;
  const node = here?.winner.node;
  if (outer && (!node || (node.startIndex <= outer.start && outer.end <= node.endIndex))) {
    const same = node && node.startIndex === outer.start && node.endIndex === outer.end;
    return { file: "injections", index: outer.patternIndex, outer, here: same ? here : null };
  }
  if (here) return { file: "highlights", index: here.winner.patternIndex, here };
  return { file: null, index: null };
}

/** What the query did to the character under the caret: every capture whose
    node spans it, and the one whose paint lands there — the innermost node's
    first capture, which is the rule the painter follows. Null when nothing
    spans it. */
function captureAt(entry, found, at = caret()) {
  const captures = found.query.captures(entry.parsed.tree.rootNode);
  const winners = new Map();
  for (const capture of captures) if (!winners.has(capture.node.id)) winners.set(capture.node.id, capture);
  const spanning = captures.filter((c) => c.node.startIndex <= at && at < c.node.endIndex);
  if (!spanning.length) return null;
  // Captures come in pre-order, so on an equal span the later one is the
  // deeper node — a value that is nothing but a placeholder, and the
  // placeholder.
  const innermost = spanning.reduce((best, one) =>
    one.node.startIndex > best.node.startIndex
    || (one.node.startIndex === best.node.startIndex && one.node.endIndex <= best.node.endIndex) ? one : best);
  return { spanning, winners, winner: winners.get(innermost.node.id) };
}

function paintQuery(entry, source) {
  const mark = new Array(source.length).fill(null);
  const at = caret();
  const found = compiled(entry);
  const focus = queryFocus(entry, found);
  if (focus.file === "injections") {
    // A pattern of the injection query: the ranges it hands over are its captures.
    for (const record of entry.injections) {
      if (record.depth !== 0 || record.patternIndex !== focus.index) continue;
      mark.fill(record.start <= at && at < record.end ? "cap sel" : "cap", record.start, record.end);
    }
  } else if (focus.file === "highlights" && found.ok) {
    const seen = new Set();
    for (const capture of found.query.captures(entry.parsed.tree.rootNode)) {
      if (seen.has(capture.node.id) || capture.patternIndex !== focus.index) continue;
      seen.add(capture.node.id);
      const inside = capture.node.startIndex <= at && at < capture.node.endIndex;
      mark.fill(inside ? "cap sel" : "cap", capture.node.startIndex, capture.node.endIndex);
    }
  }
  if (found.ok) found.query.delete();
  return { mark };
}

function seeQuery(entry) {
  if (!entry.query) {
    return html`<p>${entry.dialect.name} loaded no query here, so there is nothing for this step to
      run.</p>`;
  }
  const at = queryLead(entry);   // first: it settles the marks and where to scroll
  const injectionFocus = entry.scrollTo?.id === "injections" || picked(entry, "inj") != null;
  const highlightDoc = html`<h3>Highlight query</h3>${doc("query", entry.query, true, entry.docMarks)}`;
  const injectionDoc = entry.dialect.injections != null
    ? html`<h3>Injection query</h3>${doc("injections", entry.injectionsQuery, true, entry.injectMarks)}` : "";
  return html`
    ${lead("query-at", at)}
    ${injectionFocus && injectionDoc ? injectionDoc : highlightDoc}
    ${injectionDoc ? html`<details data-panel="${injectionFocus ? "highlight-query" : "injection-query"}"><summary>${injectionFocus ? "Highlight query" : "Injection query"}</summary>
      ${injectionFocus ? highlightDoc : injectionDoc}</details>` : ""}
    <details data-panel="query-diagnostics"><summary>Other captures and query diagnostics</summary>
      ${pane("query-out", queryReport(entry))}</details>`;
}

/** Marks for a query document: the patterns that found nothing dimmed, the one
    on show marked the way the text marks the capture under the caret. */
function docMarks(patterns, hits, shown) {
  return patterns.map((pattern) => ({
    start: pattern.startIndex,
    end: pattern.endIndex,
    cls: pattern === shown ? "cap sel" : hits.get(pattern.index) ? null : "flat",
  })).filter((mark) => mark.cls);
}

/** The step's answer, first: the one pattern, of the one query, that answers
    for the caret — marked in its file, the other file left unmarked. What
    else spans the character goes to the pane below. */
function queryLead(entry) {
  const found = compiled(entry);
  const focus = queryFocus(entry, found);
  const file = code((entry.dialect.paths.injections ?? "injections.scm").split("/").pop());
  const records = entry.injections.filter((one) => one.depth === 0);

  // The injection query: patterns that handed nothing over dimmed; the one
  // in focus marked, when the focus is there.
  const claimed = new Map();
  for (const record of records) claimed.set(record.patternIndex, (claimed.get(record.patternIndex) ?? 0) + 1);
  const injFound = entry.injectionsQuery ? compiled(entry, entry.injectionsQuery) : null;
  const injShown = injFound?.ok && focus.file === "injections" ? injFound.patterns[focus.index] ?? null : null;
  entry.injectMarks = injFound?.ok ? docMarks(injFound.patterns, claimed, injShown) : [];
  if (injFound?.ok) injFound.query.delete();
  entry.spanning = [];

  if (!found.ok) {
    const { error } = found;
    entry.docMarks = [];
    entry.scrollTo = scrollTo("injections", injShown?.line, entry.injectionsQuery);
    return html`<p class="warn">${error.message}${error.positioned
      ? html` — at line ${error.line}, column ${error.column}: a bad node name, field, capture, or
        syntax.`
      : html` — from the predicate parser, after the query itself compiled${error.inferred
        ? "; the offset is inferred from the operator" : ""}.`}</p>`;
  }
  const captures = found.query.captures(entry.parsed.tree.rootNode);
  const hits = new Map();
  for (const capture of captures) hits.set(capture.patternIndex, (hits.get(capture.patternIndex) ?? 0) + 1);
  const shown = focus.file === "highlights" ? found.patterns[focus.index] ?? null : null;
  entry.docMarks = docMarks(found.patterns, hits, shown);
  entry.scrollTo = focus.file === "highlights"
    ? scrollTo("query", shown?.line, entry.query)
    : scrollTo("injections", injShown?.line, entry.injectionsQuery);

  let out;
  if (picked(entry, "inj") != null) {
    // "Where are these?": the ranges the picked injection pattern hands over.
    const mine = records.filter((one) => one.patternIndex === focus.index);
    const to = [...new Set(mine.map((one) => one.language))];
    out = facts(html`${file} <b>#${focus.index}</b>`,
      mine.length ? html`hands over ${plural(mine.length, "range")}` : injShown ? "hands over nothing here" : "no such pattern",
      to.length ? html`→ ${raw(to.map((name) => fmt(code(name))).join(", "))}` : null);
  } else if (picked(entry, "pat") != null) {
    // "Where are these?": the picked highlight pattern's captures, outlined above.
    const mine = captures.filter((capture) => capture.patternIndex === focus.index);
    const names = [...new Set(mine.map((capture) => `@${capture.name}`))];
    out = facts(html`highlights <b>#${focus.index}</b>`,
      mine.length ? plural(mine.length, "capture") : shown ? "captures nothing here" : "no such pattern",
      names.length ? names.join(", ") : null);
  } else if (focus.here && focus.outer) {
    // "What is this?": a node this grammar both captured and handed over — a
    // placeholder. The injection decides its paint; the capture is the
    // host's own stroke, for a consumer that injects nothing.
    const { here, outer } = focus;
    const node = here.winner.node;
    entry.spanning = spanningOf(here);
    out = facts(html`<b>${node.type}</b> ${span(node.startIndex, node.endIndex)}`,
      html`→ <b>${outer.language}</b>, injections #${outer.patternIndex}`,
      outer.resolved ? goIn(entry, outer) : html`<span class="warn">no grammar</span>`,
      html`<b>@${here.winner.name}</b>, highlights #${here.winner.patternIndex}, under ${outer.language}'s paint`);
  } else if (focus.here) {
    // "What is this?": the capture under the caret, and the pattern behind it.
    const { here } = focus;
    const node = here.winner.node;
    entry.spanning = spanningOf(here);
    out = facts(html`<b>${node.type}</b> ${span(node.startIndex, node.endIndex)}`,
      html`<b>@${here.winner.name}</b>, highlights #${here.winner.patternIndex}`);
  } else if (focus.outer) {
    // "What is this?": a character handed to another grammar, and the pattern that did it.
    const { outer } = focus;
    out = facts(html`→ <b>${outer.language}</b> ${span(outer.start, outer.end)}`,
      html`injections #${outer.patternIndex}`,
      outer.resolved ? goIn(entry, outer) : html`<span class="warn">no grammar</span>`);
  } else {
    out = facts("no capture here");
  }
  found.query.delete();
  return out;
}

/** The other captures spanning the caret, for the report. */
const spanningOf = (here) => here.spanning.filter((c) => c !== here.winner).map((capture) => ({
  patternIndex: capture.patternIndex,
  name: capture.name,
  type: capture.node.type,
  start: capture.node.startIndex,
  end: capture.node.endIndex,
  kept: here.winners.get(capture.node.id) === capture,
}));

/** The pane: what else spans the caret, and what the whole query did to the
    whole text. */
function queryReport(entry) {
  const found = compiled(entry);
  if (!found.ok) return "";
  const captures = found.query.captures(entry.parsed.tree.rootNode);
  const hits = new Map();
  for (const capture of captures) hits.set(capture.patternIndex, (hits.get(capture.patternIndex) ?? 0) + 1);
  const dead = found.patterns.filter((pattern) => !hits.get(pattern.index));
  const unknown = found.patterns.filter((pattern) => pattern.unknownPredicates.length);
  found.query.delete();
  const others = (entry.spanning ?? []).map((capture) => html`
    <tr class="pick" data-select="${capture.start}:${capture.end}">
      <td class="num">${capture.patternIndex}</td>
      <td>@${capture.name}</td>
      <td>${capture.type}</td>
      <td class="muted">${capture.kept ? "enclosing node, painted under" : "overruled"}</td>
    </tr>`);
  return html`
    ${others.length ? table('<th class="num">#</th><th>capture</th><th>node</th><th></th>', others) : ""}
    <p class="now">${plural(captures.length, "capture")} over this text, from
    ${found.patterns.length - dead.length} of ${plural(found.patterns.length, "pattern")}${dead.length
      ? html`; ${dead.length} matched nothing, dimmed above` : ""}.</p>
    ${unknown.length ? html`<p class="warn">${unknown.length === 1 ? "Pattern" : "Patterns"}
      ${unknown.map((one) => one.index).join(", ")} use${unknown.length === 1 ? "s" : ""} an
      operator the runtime does not know, so it filters nothing.</p>` : ""}`;
}



// MARK: 4 paint

function capPaint() {
  return html`<b>Capture names become colours through CSS rules.</b>`;
}

/** The colours are this grammar's own paint; marked over them, everywhere the
    picked rule of the stylesheet paints, or — with nothing picked — the run of
    one capture around the caret. */
function paintPaint(entry, source) {
  const mark = new Array(source.length).fill(null);
  const classes = entry.host.classes;
  const rule = picked(entry, "rule");
  if (rule != null) {
    const wanted = RULES[Number(rule)];
    if (wanted) classes.forEach((cls, i) => { if (cls && applies(wanted, cls)) mark[i] = "sel"; });
  } else {
    const at = caret();
    const cls = classes[at];
    if (cls) {
      let start = at;
      while (start > 0 && classes[start - 1] === cls) start -= 1;
      let end = at;
      while (end < classes.length && classes[end] === cls) end += 1;
      mark.fill("sel", start, end);
    }
  }
  return { colour: entry.host.classes, mark };
}

/** A rule applies to a capture when its classes are all among the capture's:
    `.string` and `.string.special` both paint `string.special.key`, the later
    winning. */
const applies = (rule, cls) => rule.classes.every((one) => cls.split(" ").includes(one));

function seePaint(entry) {
  const at = caret();
  const rule = picked(entry, "rule");
  const own = entry.host.classes[at];
  const handed = own ? null : handedAt(entry, at);
  const applying = rule != null ? [RULES[Number(rule)]].filter(Boolean) : rulesFor(own);
  const winning = applying.at(-1);
  entry.scrollTo = scrollTo("css", applying[0]?.line, CSS);

  // Every rule of the stylesheet is a pick, its colour on this page a swatch
  // beside its hex; the ones in question are marked.
  const marks = RULES.flatMap((one) => {
    const cls = !applying.includes(one) ? "pick" : one === winning ? "cap sel pick" : "cap pick";
    const pick = `rule:${one.index}`;
    if (!one.varEnd) return [{ start: one.start, end: one.end, cls, pick }];
    const colour = colourOf(one);
    return [
      { start: one.start, end: one.varEnd, cls, pick,
        after: colour.value ? swatch(colour.value, `${colour.property}: ${colour.value}${colour.set ? " on this page" : ", the rule's own fallback"}`) : "" },
      { start: one.varEnd, end: one.end, cls, pick },
    ];
  });

  const resolved = winning ? colourOf(winning) : null;
  const colour = resolved?.value ? html` → ${raw(swatch(resolved.value, resolved.property ?? "colour"))}${code(resolved.value)}` : "";
  let at4;
  if (rule != null && winning) {
    // "Where are these?": one rule of the stylesheet, everywhere it paints here.
    const total = entry.host.classes.filter((cls) => cls && applies(winning, cls)).length;
    at4 = facts(code(winning.selector), total ? plural(total, "character") : "nothing here", colour || null);
  } else {
    // "What is this?": the character under the caret, as this grammar paints it.
    at4 = own
      ? facts(html`<b>${own.split(" ").join(".")}</b>`, ruleList(applying), colour || null)
      : handed
        ? facts(html`→ <b>${handed.language}</b>, painted at the next step`, goIn(entry, handed))
        : facts("no capture", "plain foreground");
  }

  return html`
    ${lead("paint-at", at4)}
    <details data-panel="css" open><summary>CSS rules</summary>
      ${doc("css", CSS, false, marks)}</details>
    <details><summary>${code(`highlight(text, "${entry.dialect.name}")`)}</summary>
      <pre class="src">${clip(highlight(entry.source, entry.dialect.name), 3000)}</pre></details>`;
}

/** The rules of the stylesheet that paint a capture, in cascade order. */
const rulesFor = (cls) => (cls ? RULES.filter((one) => applies(one, cls)) : []);

/** A rule's colour on this page: the last `--ts-*` property it reads, the
    page's value for it, else the rule's own fallback. */
function colourOf(rule) {
  const property = rule.properties.at(-1) ?? null;
  if (!property) return { property: null, value: null, set: false };
  const style = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
  const set = style?.getPropertyValue(property).trim() || null;
  return { property, value: set ?? rule.fallbacks[property]?.at(-1) ?? null, set: Boolean(set) };
}

const swatch = (colour, title) =>
  `<span class="swatch" style="background: ${esc(colour)}" title="${esc(title)}"></span>`;

/** "— rules `.string`, `.string.special` (the later wins)", or the plain foreground. */
const ruleList = (applying) => (applying.length
  ? html`${raw(applying.map((one) => fmt(code(one.selector))).join(", "))}${
      applying.length > 1 ? " (the later wins)" : ""}`
  : "no rule, plain foreground");

/** The package's stylesheet taken apart: one rule per line, its selector's
    classes, the `--ts-*` properties it reads and the fallback each carries. */
function cssRules(css) {
  const rules = [];
  for (const found of css.matchAll(/^((?:\.[A-Za-z0-9_-]+)+)\s*\{([^}]*)\}/gm)) {
    const [whole, selector, body] = found;
    const fallbacks = {};
    let varEnd = null;
    for (const use of body.matchAll(/var\((--ts-[a-z-]+)(?:,\s*([^)]+))?\)/g)) {
      (fallbacks[use[1]] ??= []).push(use[2]?.trim() ?? null);
      varEnd = found.index + whole.indexOf(body) + use.index + use[0].length;
    }
    rules.push({
      index: rules.length,
      varEnd,
      selector,
      classes: selector.split(".").filter(Boolean),
      start: found.index,
      end: found.index + whole.length,
      line: css.slice(0, found.index).split("\n").length,
      properties: Object.keys(fallbacks),
      fallbacks,
    });
  }
  return rules;
}

/** The package's stylesheet, read once: it is a constant of the package. */
const RULES = cssRules(CSS);

// MARK: 5 inject

function capInject(entry) {
  const records = entry.injections.filter((one) => one.depth === 0);
  const opaque = records.filter((one) => !one.resolved).length;
  const declined = records.filter((one) => one.declined).length;
  return html`${records.length
    ? html`<b>${plural(records.length, "range")} requested another grammar.</b>${opaque
      ? html` <span class="warn">${opaque} unresolved.</span>` : ""}${declined
      ? html` ${declined} tried and declined.` : ""}`
    : html`<b>No range went to another grammar.</b>`}`;
}

/** Only the ranges another grammar touched keep their colour; the rest of the
    file goes flat, so what this step did is visible rather than described. */
function paintInject(entry, source) {
  const mark = new Array(source.length).fill("flat");
  for (const record of entry.injections) {
    mark.fill(kept(record) ? "inject" : "opaque", record.start, record.end);
  }
  return { colour: entry.painted.classes, mark };
}

function seeInject(entry) {
  return html`
    ${lead("inject-at", injectLead(entry))}
    <h3>inside the range</h3>
    ${entry.injections.some(kept) ? box("inject-chain", chainReport(entry))
      : html`<p>${!entry.injections.length ? "No grammar handoff in this text."
        : entry.injections.every((one) => one.declined) ? "Every range was tried as its own grammar and declined; nothing was handed on."
        : "No loaded grammar can read these ranges."}</p>`}`;
}

/** The step's answer, first: the range under the caret and who took it, by
    which pattern of ${paths.injections}. */
function injectLead(entry) {
  const at = caret();
  const here = injectionAt(entry, at);
  const records = entry.injections.filter((one) => one.depth === 0);
  entry.scrollTo = null;
  if (!here) return facts("not in an injected range",
    records.some(kept) ? "the first range below" : null);
  if (!here.resolved) return facts(html`→ <b>${here.language}</b> ${span(here.start, here.end)}`,
    html`injections #${here.patternIndex}`, html`<span class="warn">no grammar, opaque</span>`);
  if (here.declined) return facts(html`→ <b>${here.language}</b> ${span(here.start, here.end)}`,
    html`injections #${here.patternIndex}`,
    html`tried and declined: ${plural(here.errors, "error")}, so the range stays as it is`,
    goIn(entry, here));
  // The route down to the range: its ancestors, innermost last. Ranges from
  // one grammar can sit inside one another — a placeholder in a body — and
  // those are siblings, not a route: the body's grammar read the placeholder
  // masked, and the placeholder went to its own grammar from here.
  const route = [];
  for (let one = here; one; ) {
    route.unshift(one);
    one = one.depth > 0
      ? entry.injections.filter((p) => p.depth === one.depth - 1 && p.start <= one.start && one.end <= p.end).at(-1) ?? null
      : null;
  }
  const masked = records.filter((one) => one !== route[0] && kept(one) && one.start <= here.start && here.end <= one.end).at(-1);
  return facts(
    html`${entry.dialect.name}${route.map((one) => html` → <b>${one.language}</b>`)}`,
    html`${span(here.start, here.end)}`,
    html`${here.depth > 0 ? html`${route[route.length - 2].language}'s ` : ""}injections #${here.patternIndex}`,
    masked ? html`inside ${masked.language} ${span(masked.start, masked.end)}, masked there` : null,
  );
}

/** The five steps before this one, run inside the range under the caret by
    the grammar that took it — one line each, at the caret — and again for any
    range that grammar hands on, under it. Built the way `enter` builds a
    level, from the same tables and queries, so the lines are what the steps
    would show after going in. */
function chainReport(entry) {
  const at = caret();
  const records = entry.injections.filter((one) => one.depth === 0);
  // The innermost range under the caret: a placeholder inside a body is the
  // body's hole and its own range, and its own grammar is the one to run.
  const record = records.filter((one) => kept(one) && one.start <= at && at < one.end).at(-1)
    ?? records.find(kept) ?? null;
  if (!record) {
    return html`<p class="muted">${records.length
      ? "No range here went to a grammar that answers, so there are no steps to run inside one."
      : "No range in this text went to another grammar."}</p>`;
  }
  const blocks = [];
  let from = entry;
  let range = record;   // a record among `from`'s injections, offsets in from's text
  let rel = Math.min(Math.max(at, record.start), record.end - 1) - record.start;
  for (let depth = 0; range && depth < 4; depth += 1) {
    const level = levelFor(from, range);
    analyse(level);
    blocks.push(chainFor(level, rel, depth === 0 ? entry.injections.indexOf(range) : null, range));
    // Down again if this grammar handed the caret's character on.
    const next = level.injections.find((one) => one.depth === 0 && kept(one) && one.start <= rel && rel < one.end);
    level.parsed.tree.delete();
    if (!next) break;
    from = level;
    rel -= next.start;
    range = next;
  }
  return raw(`<div class="chain">${blocks.map(fmt).join("")}</div>`);
}

/** One grammar's five steps at one character of its range, one line each. */
function chainFor(level, rel, index, range) {
  const name = level.language;
  const stage = (step, label, what) => index != null
    ? html`<tr class="pick" data-enter="${index}" data-step="${step}"><td class="muted">${label}</td><td>${what}</td></tr>`
    : html`<tr><td class="muted">${label}</td><td>${what}</td></tr>`;

  // 1 lex
  const token = tokenAt(level, rel);
  const options = token ? candidatesFor(level, token) : { rows: [] };
  const matched = options.rows.filter((one) => one.matched).length;
  const lex = token
    ? html`<b>${token.symbol}</b>${token.precedence != null ? html`, precedence ${token.precedence}` : ""}:
      ${code(show(clip(level.source.slice(token.start, token.end), 24)))} from ${token.start}${level.facts
        ? html`; ${matched === 1 ? "only it matched" : `${matched} matched`} there${whyItWon(options.rows, token)}` : ""}`
    : "nothing to lex";

  // 2 parse
  const node = nodeAt(level, rel);
  const path = node ? ancestry(node) : [];
  const parse2 = path.length
    ? html`${path.map((one, i) => html`${i ? raw(' <span class="muted">›</span> ') : ""}${one.isMissing ? `MISSING ${one.type}` : one.type}`)}`
    : "no node";

  // 3 query
  let query = html`${name} carries no highlight query`;
  if (level.query) {
    const found = compiled(level);
    if (found.ok) {
      const here = captureAt(level, found, rel);
      query = here
        ? html`pattern <b>${here.winner.patternIndex}</b> ${code(found.patterns[here.winner.patternIndex].source.replace(/\s+/g, " "))}
          captures ${code(here.winner.node.type)} as <b>@${here.winner.name}</b>`
        : "no pattern captures this character";
      found.query.delete();
    } else query = html`its query does not compile: ${found.error.message}`;
  }

  // 4 paint
  const cls = level.host.classes[rel];
  const applying = rulesFor(cls);
  const colour = applying.length ? colourOf(applying.at(-1)) : null;
  const paint = cls
    ? html`<b>@${cls.split(" ").join(".")}</b> → ${colour?.value
      ? html`${raw(swatch(colour.value, colour.value))}${code(colour.value)}` : "foreground"}`
    : "no capture: the plain foreground";

  // 5 inject
  const child = level.injections.find((one) => one.depth === 0 && one.start <= rel && rel < one.end);
  const inject = !level.injectionsQuery
    ? html`${name} has no injection query, so nothing goes further`
    : child
      ? html`${child.tentative ? "tries" : "hands"} ${child.start}–${child.end} ${child.tentative ? "as" : "to"} <b>${child.language}</b> by pattern ${child.patternIndex}${
          !child.resolved ? " — opaque: no grammar answers" : child.declined ? ` — declined: ${plural(child.errors, "error")}` : ""}`
      : "hands nothing on here";

  // This describes the whole range, not the narrow stage-name column.
  const caption = html`<b>${name} ${range.start}–${range.end}</b>
    <span>of the ${level.parent === view() ? "text" : `${level.parent.language} range`}, at its character ${rel}</span>`;
  return table(null, [
    stage(0, "lex", lex),
    stage(1, "parse", parse2),
    stage(2, "query", query),
    stage(3, "paint", paint),
    stage(4, "inject", inject),
  ], caption);
}







// MARK: reference

function grammarReference(entry) {
  const { facts } = entry;
  const other = app.dialects.find((one) => one !== entry);
  const ladder = facts.precedence.map((level) => html`
    <tr><td class="num">${level.value ?? "—"}</td><td>${level.name ?? ""}</td>
      <td>${[...new Set(level.tokens.map((token) => token.rule))].join(", ")}</td></tr>`);
  const rules = facts.rules.map((rule) => html`
    <tr><td>${rule.name}</td><td>${rule.hidden ? raw('<span class="pill">hidden</span>') : ""}</td>
      <td><pre class="src">${rule.source.replace(/^[^:]*: \$ => /, "")}</pre></td></tr>`);
  const types = facts.nodeTypes.map((type) => html`
    <tr><td>${type.named ? type.type : `"${type.type}"`}</td>
      <td>${(type.fields ?? []).map((field) => html`<code>${field.name}</code> ${(field.types ?? []).join(" | ")}${field.required ? "" : "?"} `)}</td>
      <td>${(type.children?.types ?? []).join(", ")}</td></tr>`);

  return html`
    ${app.trail.length ? html`<p class="muted">This section is about
      ${app.active.dialect.name}, the grammar the document is written in, not
      ${view().dialect.name}, the one you have gone down into.</p>` : ""}
    <p><code>grammar.js</code> is not a parser. It is a description in tree-sitter's JavaScript DSL,
    and <code>tree-sitter generate</code> evaluates it under node and compiles it into LR parse
    tables — plain C data in <code>src/parser.c</code>. Everything here is read back out of what
    that wrote, so none of it can fall behind the grammar.</p>

    <h3>the precedence ladder</h3>
    <p>From ${code(entry.dialect.paths.grammarJson)}, with each level's name joined from
    <code>PREC</code> in ${code(app.repo.defineGrammarPath)}. The last row is every token that
    declares none.</p>
    ${table('<th class="num">prec</th><th>name</th><th>tokens</th>', ladder)}

    <h3>the external token</h3>
    <p>${facts.externals.length
      ? html`${facts.externals.join(", ")} — declared in the grammar, scanned by hand in
        ${code(app.repo.scannerPath)}. It is the one thing the grammar cannot say itself: a line ends
        at a newline, or at the end of the file.`
      : "This dialect declares no external token."}</p>
    ${app.repo.scanner ? html`<pre class="src">${grammar.scannerScan(app.repo.scanner)}</pre>` : ""}

    ${other ? diffBlock(entry, other) : ""}
    <details><summary>${facts.nodeTypes.length} node types — the vocabulary a query binds to</summary>
      ${table("<th>type</th><th>fields</th><th>children</th>", types)}</details>
    <details><summary>${facts.rules.length} rules, as generated</summary>
      ${table("<th>rule</th><th></th><th>source</th>", rules)}</details>`;
}

function diffBlock(entry, other) {
  const difference = grammar.diff(entry.facts, other.facts);
  const only = Object.entries(difference.onlyIn).map(([name, list]) =>
    html`<tr><td>${name}</td><td class="num">${list.length}</td><td>${list.join(", ")}</td></tr>`);
  const differing = difference.differing.map((row) => html`
    <tr><td>${row.rule}</td>
      <td><pre class="src">${row.sources[entry.dialect.name]}</pre></td>
      <td><pre class="src">${row.sources[other.dialect.name]}</pre></td></tr>`);
  return html`
    <h3>against ${other.dialect.name}</h3>
    <p>Both dialects are generated from one file, ${code(app.repo.defineGrammarPath)}, parameterised
    by one flag. This is that flag's whole effect, computed by comparing the two generated grammars:
    ${difference.identical.length} rules are byte-identical, ${difference.differing.length} differ,
    and the rest exist in only one.</p>
    ${table('<th>only in</th><th class="num">rules</th><th></th>', only)}
    <details><summary>the ${difference.differing.length} rules that differ</summary>
      ${table(`<th>rule</th><th>${esc(entry.dialect.name)}</th><th>${esc(other.dialect.name)}</th>`, differing)}</details>`;
}

function corpusReference(entry) {
  const files = entry.dialect.corpus.map((file) => corpus.runFile(entry.bundle, file));
  const total = corpus.summarise(files);
  const blocks = files.map((file) => {
    const rows = file.cases.map((result) => html`
      <tr class="pick" data-load="${encodeURIComponent(result.test?.input ?? "")}">
        <td>${result.status === "fail" ? raw('<span class="warn">fail</span>')
          : result.status === "skip" ? raw('<span class="muted">skip</span>')
          : raw(`<span class="ok">${esc(result.status === "error-expected" ? "error" : "pass")}</span>`)}</td>
        <td>${result.name}</td>
        <td class="muted">${result.status === "fail" ? clip(String(result.diff ?? ""), 70) : ""}</td>
      </tr>`);
    return html`<h3>${file.name}</h3>${table(null, rows)}`;
  });
  return html`
    <p>A corpus file records an input and the tree it should produce.
    <code>tree-sitter test</code> parses the input, prints the tree as an S-expression and compares
    the string; a case marked <code>:error</code> only asks that the parse fail. This runs the same
    bytes against the wasm build of the same parser, here — ${total.passed} passing, ${total.failed}
    failing, ${total.skipped} skipped. Any row loads its input into the text.</p>
    ${blocks}`;
}
