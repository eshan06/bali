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
      out.appendChild(host);
      ctx.pending.push(() => mount(name, props, host));
      return;
    }
    const el = n.namespaceURI === 'http://www.w3.org/2000/svg' ? document.createElementNS(n.namespaceURI, n.tagName) : document.createElement(n.tagName);
    Array.prototype.forEach.call(n.attributes, (a) => {
      const m = a.value.match(WHOLE);
      if (a.name.indexOf('data-dc-on-') === 0) {
        const fn = m ? get(scope, m[1]) : null;
        if (typeof fn === 'function') el.addEventListener(a.name.slice(11), fn);
        return;
      }
      const v = m ? get(scope, m[1]) : interp(a.value, scope);
      if (v === false || v === null || v === undefined) return;
      el.setAttribute(a.name, v === true ? '' : String(v));
    });
    kids(n, el, scope, ctx);
    out.appendChild(el);
  }

  function mount(name, props, host) {
    const P = parse(name);
    inject(name, P);
    const inst = new P.Cls(props);
    const draw = () => {
      const scope = Object.assign({}, inst.renderVals ? inst.renderVals() : {});
      const frag = document.createDocumentFragment();
      const ctx = { pending: [] };
      kids(P.tpl.content, frag, scope, ctx);
      host.replaceChildren(frag);
      ctx.pending.forEach((f) => f());
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
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
})();
