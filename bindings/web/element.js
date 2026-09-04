// <http-file>: an .http document, or a wire message, painted — and editable.
//
//   <http-file>GET /</http-file>                       an .http document, highlighted
//   <http-file dialect="http_message">…</http-file>    raw wire octets
//   <http-file editable></http-file>                   an editor
//
// The text is `value`; the light DOM's text is the initial value. Display is
// a <pre> in the shadow root painted by index.js, and the page's `--ts-*`
// custom properties colour it. `editable` lays a <textarea> over the <pre>
// with the same font and metrics, its glyphs hidden by `-webkit-text-fill-color`
// alone — `color` stays inherited, because the caret and the selection are
// `currentColor` and a transparent `color` makes both invisible — so the caret
// sits on coloured text: `value`, `selectionStart`, `selectionEnd`,
// `setSelectionRange`, `scrollTop` and `scrollLeft` forward to it, `input`
// and `select` events reach the host, and focus delegates. The host is the
// box: give it a height and the text scrolls inside; give it none and it
// grows with the text. `--http-file-padding` and `--http-file-selection` are
// the two knobs the inside offers; the font, colour, border and background
// are the host's own styles.
//
// Nothing is awaited before the element is usable: the text shows at once,
// and colour arrives when the grammars have loaded.

import { ready, highlight, escape, CSS } from "./index.js";

const STYLE = `
:host { display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; line-height: 1.5; tab-size: 4; }
:host([hidden]) { display: none; }
pre, textarea { grid-area: 1 / 1; min-width: 0; min-height: 0; margin: 0; padding: var(--http-file-padding, 0.85rem 1rem); border: 0; box-sizing: border-box; font: inherit; letter-spacing: inherit; tab-size: inherit; white-space: pre; overflow-wrap: normal; word-break: normal; background: transparent; color: inherit; }
pre { overflow: auto; }
:host([editable]) pre { overflow: hidden; pointer-events: none; }
textarea { overflow: auto; resize: none; outline: none; -webkit-text-fill-color: transparent; caret-color: currentColor; }
textarea::selection { background: var(--http-file-selection, color-mix(in srgb, currentColor 22%, transparent)); }
${CSS}`;

/** Whether the grammars have loaded; before that every element shows escaped text. */
let painting = false;
const live = new Set();
let loading = null;

function load() {
  loading ??= ready().then(
    () => {
      painting = true;
      for (const element of live) element.paint();
    },
    (e) => console.error("tree-sitter-http: highlighting unavailable:", e),
  );
  return loading;
}

export class HttpFile extends HTMLElement {
  static observedAttributes = ["editable", "dialect"];

  #pre;
  #textarea = null;
  #text = "";

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open", delegatesFocus: true });
    shadow.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
    this.#pre = document.createElement("pre");
    this.#pre.part = "text";
    shadow.append(this.#pre);
  }

  connectedCallback() {
    // The light DOM's text is the initial value, one leading newline dropped
    // as <pre> drops it, so the element can be written like one.
    if (this.#text === "" && this.textContent !== "") this.#text = this.textContent.replace(/^\n/, "");
    this.#layout();
    this.paint();
    live.add(this);
    load();
  }

  disconnectedCallback() {
    live.delete(this);
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === "editable") this.#layout();
    this.paint();
  }

  get editable() { return this.hasAttribute("editable"); }
  set editable(on) { this.toggleAttribute("editable", Boolean(on)); }

  get dialect() { return this.getAttribute("dialect") || "http"; }
  set dialect(name) { this.setAttribute("dialect", name); }

  get value() { return this.#textarea ? this.#textarea.value : this.#text; }
  set value(text) {
    this.#text = String(text);
    if (this.#textarea) this.#textarea.value = this.#text;
    this.paint();
  }

  /** The caret, when editable; 0 otherwise. */
  get selectionStart() { return this.#textarea?.selectionStart ?? 0; }
  set selectionStart(at) { if (this.#textarea) this.#textarea.selectionStart = at; }
  get selectionEnd() { return this.#textarea?.selectionEnd ?? 0; }
  set selectionEnd(at) { if (this.#textarea) this.#textarea.selectionEnd = at; }
  setSelectionRange(start, end, direction) { this.#textarea?.setSelectionRange(start, end, direction); }

  /** The scrolling box: the textarea when editable, else the text itself. */
  get #scroller() { return this.#textarea ?? this.#pre; }
  get scrollTop() { return this.#scroller.scrollTop; }
  set scrollTop(v) { this.#scroller.scrollTop = v; this.#sync(); }
  get scrollLeft() { return this.#scroller.scrollLeft; }
  set scrollLeft(v) { this.#scroller.scrollLeft = v; this.#sync(); }

  /** Repaint from `value`: painted once the grammars are in, escaped until then. */
  paint() {
    const text = this.value;
    let html;
    try {
      html = painting ? highlight(text, this.dialect) : escape(text);
    } catch (e) {
      console.error(`tree-sitter-http: <http-file dialect="${this.dialect}">: ${e.message}`);
      html = escape(text);
    }
    // A trailing space keeps a final empty line the height of a line under the textarea.
    this.#pre.innerHTML = this.#textarea ? html + " " : html;
  }

  #sync() {
    if (!this.#textarea) return;
    this.#pre.scrollTop = this.#textarea.scrollTop;
    this.#pre.scrollLeft = this.#textarea.scrollLeft;
  }

  #layout() {
    if (this.editable && !this.#textarea) {
      const textarea = document.createElement("textarea");
      textarea.part = "textarea";
      for (const [name, value] of Object.entries({ spellcheck: "false", wrap: "off", autocomplete: "off", autocapitalize: "off", autocorrect: "off" })) {
        textarea.setAttribute(name, value);
      }
      textarea.value = this.#text;
      textarea.addEventListener("input", () => this.paint());
      textarea.addEventListener("scroll", () => this.#sync());
      // `select` does not cross the shadow boundary on its own; `input`, keys and clicks do.
      textarea.addEventListener("select", () => this.dispatchEvent(new Event("select", { bubbles: true })));
      this.#pre.setAttribute("aria-hidden", "true");
      this.#textarea = textarea;
      this.shadowRoot.append(textarea);
    } else if (!this.editable && this.#textarea) {
      this.#text = this.#textarea.value;
      this.#textarea.remove();
      this.#textarea = null;
      this.#pre.removeAttribute("aria-hidden");
    }
  }
}

if (!customElements.get("http-file")) customElements.define("http-file", HttpFile);
