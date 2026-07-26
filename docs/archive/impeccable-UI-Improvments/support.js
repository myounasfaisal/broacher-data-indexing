/*
 * support.js — minimal preview runtime for the ".dc.html" (Design Components) prototypes
 * in this folder. Not part of the product; it exists only so the design files can be
 * opened in a browser and their themes evaluated.
 *
 * Implements just enough of the authoring surface the three prototypes actually use:
 *   <x-dc>                     root template wrapper
 *   <helmet>                   contents hoisted into <head>
 *   <script type="text/x-dc">  component logic, defines `class Component extends DCLogic`
 *   {{ expr }}                 interpolation holes in text and attribute values
 *   <sc-if value="{{ x }}">    conditional block
 *   <sc-for list="{{ a }}" as="r">  repeat block
 *   <dc-import name="Foo" ...> embed another .dc.html as a child component
 *   onClick / onChange         event bindings (function-valued holes)
 *   style / style-hover        object- or string-valued styles, plus a hover overlay
 *   value / checked / disabled bound as properties
 *   hint-*                     authoring-tool hints, stripped
 *
 * Re-render is whole-subtree on setState. That is fine at prototype scale and keeps
 * this file small; focus is preserved for the active input as a special case.
 */
(function () {
  "use strict";

  var IMPORT_CACHE = Object.create(null);

  /* ---------- expression evaluation ---------- */

  var EXPR_CACHE = Object.create(null);
  function compile(expr) {
    var fn = EXPR_CACHE[expr];
    if (!fn) {
      try {
        // `with` gives template expressions direct access to renderVals + loop scope.
        fn = new Function("$s", "with ($s) { return (" + expr + "); }");
      } catch (e) {
        console.warn("[dc] bad expression:", expr, e);
        fn = function () { return undefined; };
      }
      EXPR_CACHE[expr] = fn;
    }
    return fn;
  }

  function evalExpr(expr, scope) {
    try {
      return compile(expr)(scope);
    } catch (e) {
      return undefined;
    }
  }

  var HOLE = /\{\{([\s\S]*?)\}\}/g;
  var ONLY_HOLE = /^\s*\{\{[\s\S]*?\}\}\s*$/;
  function isSingleHole(str) {
    var m = str.match(HOLE);
    return !!m && m.length === 1 && ONLY_HOLE.test(str);
  }

  // Returns the raw value when the string is exactly one hole (so objects/functions
  // survive), otherwise returns an interpolated string.
  function resolve(str, scope) {
    if (str.indexOf("{{") === -1) return str;
    if (isSingleHole(str)) {
      HOLE.lastIndex = 0;
      var m = HOLE.exec(str);
      HOLE.lastIndex = 0;
      return evalExpr(m[1], scope);
    }
    return str.replace(HOLE, function (_, e) {
      var v = evalExpr(e, scope);
      return v == null ? "" : String(v);
    });
  }

  /* ---------- styles ---------- */

  function applyStyle(el, value) {
    if (value == null) return;
    if (typeof value === "string") {
      // Merge rather than replace: static style text may already be present.
      el.setAttribute("style", (el.getAttribute("style") || "") + ";" + value);
      return;
    }
    if (typeof value !== "object") return;
    Object.keys(value).forEach(function (k) {
      var v = value[k];
      if (v == null) return;
      if (k.charAt(0) === "-") el.style.setProperty(k, String(v)); // CSS custom property
      else el.style[k] = typeof v === "number" ? v + "px" : String(v);
    });
  }

  // style-hover is a css text fragment applied on pointer enter and reverted on leave.
  function applyHover(el, css) {
    if (!css || typeof css !== "string") return;
    var base = null;
    el.addEventListener("mouseenter", function () {
      base = el.getAttribute("style") || "";
      el.setAttribute("style", base + ";" + css);
    });
    el.addEventListener("mouseleave", function () {
      if (base !== null) el.setAttribute("style", base);
      base = null;
    });
  }

  /* ---------- rendering ---------- */

  var EVENTS = { onclick: "click", onchange: "change", oninput: "input", onsubmit: "submit" };
  var PROPS = { value: 1, checked: 1, disabled: 1 };

  function renderChildren(src, scope, out, host) {
    for (var n = src.firstChild; n; n = n.nextSibling) renderNode(n, scope, out, host);
  }

  function renderNode(node, scope, out, host) {
    if (node.nodeType === 3) {
      var text = node.nodeValue;
      if (text.indexOf("{{") !== -1) {
        text = text.replace(HOLE, function (_, e) {
          var v = evalExpr(e, scope);
          return v == null ? "" : String(v);
        });
      }
      out.appendChild(document.createTextNode(text));
      return;
    }
    if (node.nodeType !== 1) return; // drop comments

    var tag = node.tagName.toLowerCase();

    if (tag === "sc-if") {
      if (resolve(node.getAttribute("value") || "", scope)) renderChildren(node, scope, out, host);
      return;
    }

    if (tag === "sc-for") {
      var list = resolve(node.getAttribute("list") || "", scope);
      var as = node.getAttribute("as") || "item";
      if (!Array.isArray(list)) return;
      list.forEach(function (item, i) {
        var inner = Object.create(scope);
        inner[as] = item;
        inner[as + "_index"] = i;
        renderChildren(node, inner, out, host);
      });
      return;
    }

    if (tag === "dc-import") {
      renderImport(node, scope, out);
      return;
    }

    var el = document.createElement(tag === "x-dc" ? "div" : tag);
    var attrs = node.attributes;
    var hover = null;

    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name, raw = attrs[i].value;
      var lower = name.toLowerCase();

      if (lower.indexOf("hint-") === 0) continue;

      if (lower === "style-hover") { hover = resolve(raw, scope); continue; }

      var val = raw.indexOf("{{") !== -1 ? resolve(raw, scope) : raw;

      if (lower === "style") { applyStyle(el, val); continue; }

      if (EVENTS[lower]) {
        if (typeof val === "function") el.addEventListener(EVENTS[lower], val);
        continue;
      }

      if (PROPS[lower]) {
        el[lower] = val;
        if (lower !== "value" && !val) continue;
        if (lower === "disabled" || lower === "checked") continue;
      }

      if (val == null || val === false) continue;
      if (val === true) { el.setAttribute(name, ""); continue; }
      if (typeof val === "object" || typeof val === "function") continue;
      el.setAttribute(name, String(val));
    }

    applyHover(el, hover);
    renderChildren(node, scope, el, host);
    out.appendChild(el);
  }

  /* ---------- child components via <dc-import> ---------- */

  function renderImport(node, scope, out) {
    var name = node.getAttribute("name");
    var mount = document.createElement("div");

    var props = {};
    var attrs = node.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i], lower = a.name.toLowerCase();
      if (lower === "name" || lower === "style" || lower.indexOf("hint-") === 0) continue;
      // on-view -> onView
      var key = a.name.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      props[key] = a.value.indexOf("{{") !== -1 ? resolve(a.value, scope) : a.value;
    }

    var style = node.getAttribute("style");
    if (style) mount.setAttribute("style", style);
    out.appendChild(mount);

    loadImport(name).then(function (doc) {
      if (doc) boot(doc, mount, props);
    });
  }

  function loadImport(name) {
    if (IMPORT_CACHE[name]) return IMPORT_CACHE[name];
    // Prototypes reference imports by bare component name.
    var url = encodeURIComponent(name) + ".dc.html";
    IMPORT_CACHE[name] = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + " " + r.statusText);
        return r.text();
      })
      .then(function (html) {
        return new DOMParser().parseFromString(html, "text/html");
      })
      .catch(function (e) {
        console.error("[dc] could not load import '" + name + "' from " + url, e);
        return null;
      });
    return IMPORT_CACHE[name];
  }

  /* ---------- component base ---------- */

  function DCLogic() {}
  DCLogic.prototype.setState = function (patch) {
    Object.assign(this.state, typeof patch === "function" ? patch(this.state) : patch);
    this.$render();
  };
  DCLogic.prototype.renderVals = function () { return {}; };
  DCLogic.prototype.$render = function () {
    if (this.$pending) return;
    this.$pending = true;
    // Coalesce bursts of setState into one paint.
    Promise.resolve().then(function () {
      this.$pending = false;
      var active = document.activeElement;
      var mark = active && this.$mount.contains(active) ? active.getAttribute("data-dc-key") : null;
      var selStart = mark && "selectionStart" in active ? active.selectionStart : null;

      var vals;
      try {
        vals = this.renderVals() || {};
      } catch (e) {
        console.error("[dc] renderVals threw", e);
        return;
      }

      var scope = Object.create(vals);
      scope.props = this.props;
      scope.state = this.state;

      var frag = document.createDocumentFragment();
      renderChildren(this.$template, scope, frag, this);
      this.$mount.textContent = "";
      this.$mount.appendChild(frag);

      if (mark) {
        var again = this.$mount.querySelector('[data-dc-key="' + mark + '"]');
        if (again) {
          again.focus();
          if (selStart != null && "setSelectionRange" in again) {
            try { again.setSelectionRange(selStart, selStart); } catch (e) {}
          }
        }
      }
    }.bind(this));
  };

  /* ---------- boot ---------- */

  function defaultProps(script) {
    var out = {};
    var raw = script && script.getAttribute("data-props");
    if (!raw) return out;
    var spec;
    try { spec = JSON.parse(raw); } catch (e) { return out; }
    Object.keys(spec).forEach(function (k) {
      if (k.charAt(0) === "$") return;
      if (spec[k] && "default" in spec[k]) out[k] = spec[k].default;
    });
    return out;
  }

  function hoistHelmet(doc) {
    var helmets = doc.querySelectorAll("helmet");
    for (var i = 0; i < helmets.length; i++) {
      var h = helmets[i];
      // Detach each child before copying it across documents; importNode alone
      // leaves the original in place and this loop would never terminate.
      while (h.firstChild) {
        var child = h.removeChild(h.firstChild);
        document.head.appendChild(document.importNode(child, true));
      }
      h.parentNode.removeChild(h);
    }
  }

  function boot(doc, mount, propOverrides) {
    var root = doc.querySelector("x-dc");
    var script = doc.querySelector('script[type="text/x-dc"]');
    if (!root) { console.error("[dc] no <x-dc> root found"); return; }

    hoistHelmet(doc);

    var props = Object.assign(defaultProps(script), propOverrides || {});

    var Ctor = null;
    if (script && script.textContent.trim()) {
      try {
        // The prototype scripts end by declaring `class Component extends DCLogic`.
        Ctor = new Function("DCLogic", script.textContent + "\n;return Component;")(DCLogic);
      } catch (e) {
        console.error("[dc] component script failed to evaluate", e);
      }
    }

    var inst = Ctor ? new Ctor() : new DCLogic();
    if (!inst.state) inst.state = {};
    inst.props = props;
    inst.$template = doc.importNode(root, true);
    inst.$mount = mount;
    inst.$render();

    if (typeof inst.componentDidMount === "function") {
      try { inst.componentDidMount(); } catch (e) { console.error("[dc] componentDidMount threw", e); }
    }
    return inst;
  }

  function start() {
    var root = document.querySelector("x-dc");
    if (!root) return;
    var mount = document.createElement("div");
    root.parentNode.insertBefore(mount, root);
    root.parentNode.removeChild(root);
    // Re-parent the live document's own template/script into a detached doc-like holder.
    var holder = document.implementation.createHTMLDocument("");
    holder.body.appendChild(holder.importNode(root, true));
    var script = document.querySelector('script[type="text/x-dc"]');
    if (script) holder.body.appendChild(holder.importNode(script, true));
    boot(holder, mount, null);
  }

  window.DCLogic = DCLogic;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
