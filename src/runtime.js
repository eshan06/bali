// Draws a page from the canvas boards that tools/build.mjs bundles into boards.js: {{holes}},
// sc-for, sc-if, dc-import, each board's <helmet> styles, and its component (DCLogic, renderVals,
// setState, componentDidMount). Nothing is evaluated from strings, so the site's security policy
// (script-src 'self') holds.
(function () {
  const B = window.DCB || {};
  const parsed = {};
  const injected = {};
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  // What the drawing itself put on each element: its attributes and handlers, or for an imported
  // board its name and props. A redraw (setState) changes only these and keeps the elements, so what
  // a component set up on them after drawing (observers, animations, data-in, a --k scale) stays.
  const drawn = new WeakMap();

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = null; }
    setState(p) {
      const patch = typeof p === 'function' ? p(this.state, this.props) : p;
      this.state = Object.assign({}, this.state, patch);
      if (this._draw) this._draw();
    }
    forceUpdate() { if (this._draw) this._draw(); }
  }

  function parse(name) {
    if (parsed[name]) return parsed[name];
    const b = B[name];
    if (!b) throw new Error('No board ' + name);
    const tpl = document.createElement('template');
    tpl.innerHTML = b.tpl;
    parsed[name] = { tpl: tpl, helmet: b.helmet, heads: b.heads, Cls: b.make(DCLogic) };
    return parsed[name];
  }

  function inject(name, P) {
    if (injected[name]) return;
    injected[name] = true;
    P.heads.forEach((href) => {
      if (document.querySelector('link[data-src="' + href + '"]')) return;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.setAttribute('data-src', href);
      document.head.appendChild(l);
    });
    if (!P.helmet) return;
    const box = document.createElement('div');
    box.innerHTML = P.helmet;
    Array.prototype.slice.call(box.children).forEach((c) => document.head.appendChild(c));
  }

  function get(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const p of path.split('.')) {
      if (v === null || v === undefined) return undefined;
      v = v[p];
    }
    return v;
  }
  const interp = (s, scope) => s.replace(HOLE, (m, p) => { const v = get(scope, p); return v === null || v === undefined ? '' : String(v); });
  const camel = (s) => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());

  function kids(src, out, scope, ctx) {
    Array.prototype.slice.call(src.childNodes).forEach((n) => node(n, out, scope, ctx));
  }
  function node(n, out, scope, ctx) {
    if (n.nodeType === 3) { out.appendChild(document.createTextNode(interp(n.nodeValue, scope))); return; }
    if (n.nodeType !== 1) return;
    const tag = n.localName;
    if (tag === 'sc-for') {
      const m = (n.getAttribute('list') || '').match(WHOLE);
      const list = m ? get(scope, m[1]) : [];
      const as = n.getAttribute('as') || 'item';
      (list || []).forEach((item, i) => {
        const s = Object.create(scope);
        s[as] = item;
        s.$index = i;
        kids(n, out, s, ctx);
      });
      return;
    }
    if (tag === 'sc-if') {
      const m = (n.getAttribute('value') || '').match(WHOLE);
      if (m && get(scope, m[1])) kids(n, out, scope, ctx);
      return;
    }
    if (tag === 'dc-import') {
      const name = n.getAttribute('name') + '.dc.html';
      const props = {};
      Array.prototype.forEach.call(n.attributes, (a) => {
        if (a.name === 'name' || a.name.indexOf('hint-') === 0) return;
        const m = a.value.match(WHOLE);
        props[camel(a.name)] = m ? get(scope, m[1]) : interp(a.value, scope);
      });
      const host = document.createElement('dc-host');
      host.style.display = 'contents';
      drawn.set(host, { board: name, props: props });
      out.appendChild(host);
      ctx.pending.push({ host: host, run: () => mount(name, props, host) });
      return;
    }
    const el = n.namespaceURI === 'http://www.w3.org/2000/svg' ? document.createElementNS(n.namespaceURI, n.tagName) : document.createElement(n.tagName);
    const attrs = Object.create(null);
    const on = Object.create(null);
    Array.prototype.forEach.call(n.attributes, (a) => {
      const m = a.value.match(WHOLE);
      if (a.name.indexOf('data-dc-on-') === 0) {
        const fn = m ? get(scope, m[1]) : null;
        if (typeof fn === 'function') {
          on[a.name.slice(11)] = fn;
          el.addEventListener(a.name.slice(11), fn);
        }
        return;
      }
      const v = m ? get(scope, m[1]) : interp(a.value, scope);
      if (v === false || v === null || v === undefined) return;
      attrs[a.name] = v === true ? '' : String(v);
      el.setAttribute(a.name, attrs[a.name]);
    });
    drawn.set(el, { attrs: attrs, on: on });
    kids(n, el, scope, ctx);
    out.appendChild(el);
  }

  // A kept node must be the same kind of node; an imported board, the same board with the same props.
  function alike(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    if (a.localName !== b.localName || a.namespaceURI !== b.namespaceURI) return false;
    if (a.localName !== 'dc-host') return true;
    const x = drawn.get(a);
    const y = drawn.get(b);
    if (!x || !y || x.board !== y.board) return false;
    const keys = Object.keys(y.props);
    return keys.length === Object.keys(x.props).length && keys.every((k) => x.props[k] === y.props[k]);
  }

  // Sets on el what the new drawing w changed: the drawn attributes and handlers, nothing else.
  function update(el, w) {
    const was = drawn.get(el) || { attrs: Object.create(null), on: Object.create(null) };
    const now = drawn.get(w);
    Object.keys(was.attrs).forEach((k) => { if (!(k in now.attrs)) el.removeAttribute(k); });
    Object.keys(now.attrs).forEach((k) => { if (was.attrs[k] !== now.attrs[k]) el.setAttribute(k, now.attrs[k]); });
    Object.keys(was.on).forEach((k) => { if (was.on[k] !== now.on[k]) el.removeEventListener(k, was.on[k]); });
    Object.keys(now.on).forEach((k) => { if (was.on[k] !== now.on[k]) el.addEventListener(k, now.on[k]); });
    drawn.set(el, now);
  }

  // Brings live's children in line with next's, a fresh drawing of the same board, keeping each node
  // that is still the same kind of node in the same place. An imported board that stays keeps its own
  // drawing, as it does in the canvas.
  function patch(live, next) {
    const have = Array.prototype.slice.call(live.childNodes);
    const want = Array.prototype.slice.call(next.childNodes);
    want.forEach((w, i) => {
      const n = have[i];
      if (!n) live.appendChild(w);
      else if (!alike(n, w)) live.replaceChild(w, n);
      else if (w.nodeType === 3) { if (n.nodeValue !== w.nodeValue) n.nodeValue = w.nodeValue; }
      else if (w.localName !== 'dc-host') { update(n, w); patch(n, w); }
    });
    for (let i = want.length; i < have.length; i++) live.removeChild(have[i]);
  }

  function mount(name, props, host) {
    const P = parse(name);
    inject(name, P);
    const inst = new P.Cls(props);
    let first = true;
    const draw = () => {
      const scope = Object.assign({}, inst.renderVals ? inst.renderVals() : {});
      const frag = document.createDocumentFragment();
      const ctx = { pending: [] };
      kids(P.tpl.content, frag, scope, ctx);
      if (first) host.replaceChildren(frag);
      else patch(host, frag);
      first = false;
      // Only boards new to the page are mounted; one a redraw kept is already there.
      ctx.pending.forEach((p) => { if (p.host.isConnected) p.run(); });
    };
    inst._draw = draw;
    draw();
    if (inst.componentDidMount) inst.componentDidMount();
    return inst;
  }

  const app = document.getElementById('app');
  if (!app) return;
  try {
    mount(app.getAttribute('data-board'), {}, app);
    document.documentElement.classList.add('is-drawn');
  } catch (e) {
    app.innerHTML = '<p style="font:16px/1.5 system-ui,sans-serif;padding:40px 24px">This page didn\'t load. Refresh to try again, or email eshan.shah@vanderbilt.edu.</p>';
    throw e;
  }
  // The page is drawn after the browser looks for #anchor, so go to it now.
  if (location.hash.length > 1) {
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch (e) { /* a malformed #… is looked up as it is */ }
    const target = document.getElementById(id);
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
})();
