import { createRequire as __covenCreateRequire } from 'node:module'; const require = __covenCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path6) {
      const ctrl = callVisitor(key, node, visitor, path6);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path6, ctrl);
        return visit_(key, ctrl, visitor, path6);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path6 = Object.freeze(path6.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path6);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path6 = Object.freeze(path6.concat(node));
          const ck = visit_("key", node.key, visitor, path6);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path6);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path6) {
      const ctrl = await callVisitor(key, node, visitor, path6);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path6, ctrl);
        return visitAsync_(key, ctrl, visitor, path6);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path6 = Object.freeze(path6.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path6);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path6 = Object.freeze(path6.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path6);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path6);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path6) {
      if (typeof visitor === "function")
        return visitor(key, node, path6);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path6);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path6);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path6);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path6);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path6);
      return void 0;
    }
    function replaceNode(key, path6, node) {
      const parent = path6[path6.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle2, prefix] = parts;
            this.tags[handle2] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle2, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle2];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle2 === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle2, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle2 + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle2, prefix] of tagEntries) {
          if (handle2 === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle2} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path6, value) {
      let v = value;
      for (let i = path6.length - 1; i >= 0; --i) {
        const k = path6[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path6) => path6 == null || typeof path6 === "object" && !!path6[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path6, value) {
        if (isEmptyPath(path6))
          this.add(value);
        else {
          const [key, ...rest] = path6;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path6) {
        const [key, ...rest] = path6;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path6, keepScalar) {
        const [key, ...rest] = path6;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path6) {
        const [key, ...rest] = path6;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path6, value) {
        const [key, ...rest] = path6;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text3, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text3;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text3.length <= endStep)
        return text3;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text3, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text3[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text3[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text3, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next2 = text3[i + 1];
            if (next2 && next2 !== " " && next2 !== "\n" && next2 !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text3[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text3;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text3;
      if (onFold)
        onFold();
      let res = text3.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text3.length;
        if (fold === 0)
          res = `
${indent}${text3.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text3[fold]}\\`;
          res += `
${indent}${text3.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text3, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text3[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text3[++i];
        } else {
          do {
            ch = text3[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text3[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json2 = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json2;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json2[i]; ch; ch = json2[++i]) {
        if (ch === " " && json2[i + 1] === "\\" && json2[i + 2] === "n") {
          str += json2.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json2[i + 1]) {
            case "u":
              {
                str += json2.slice(start, i);
                const code = json2.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json2.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json2[i + 2] === '"' || json2.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json2.slice(start, i) + "\n\n";
                while (json2[i + 2] === "\\" && json2[i + 3] === "n" && json2[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json2[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json2.slice(start) : json2;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body2 = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body2}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body2 = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body2 += stringifyComment.lineComment(body2, "", commentString(contentComment));
        if ((body2[0] === "|" || body2[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body2}`;
        } else
          lines.push(body2);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path6, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path6, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path6) {
        if (Collection.isEmptyPath(path6)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path6) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path6, keepScalar) {
        if (Collection.isEmptyPath(path6))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path6, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path6) {
        if (Collection.isEmptyPath(path6))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path6) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path6, value) {
        if (Collection.isEmptyPath(path6)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path6), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path6, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json: json2, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json2,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next: next2, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next2?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next2 && next2.type !== "space" && next2.type !== "newline" && next2.type !== "comma" && (next2.type !== "scalar" || next2.source !== "")) {
        onError(next2.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next2?.type === "block-map" || next2?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + match[1];
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next2 = source[++i];
          const cc = escapeCodes[next2];
          if (cc)
            res += cc;
          else if (next2 === "\n") {
            next2 = source[i + 1];
            while (next2 === " " || next2 === "	")
              next2 = source[++i + 1];
          } else if (next2 === "\r" && source[i + 1] === "\n") {
            next2 = source[++i + 1];
            while (next2 === " " || next2 === "	")
              next2 = source[++i + 1];
          } else if (next2 === "x" || next2 === "u" || next2 === "U") {
            const length = next2 === "x" ? 2 : next2 === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next2 = source[i + 1];
          while (next2 === " " || next2 === "	")
            next2 = source[++i + 1];
          if (next2 !== "\n" && !(next2 === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body2 = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body2 };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body2 = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body2;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body2 });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path6) => {
      let item = cst;
      for (const [field, index] of path6) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path6) => {
      const parent = visit.itemAtPath(cst, path6.slice(0, -1));
      const field = path6[path6.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path6, item, visitor) {
      let ctrl = visitor(item, path6);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path6.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path6);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path6) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next2 = this.next ?? "stream";
        while (next2 && (incomplete || this.hasChars(1)))
          next2 = yield* this.parseNext(next2);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next2 = this.buffer[indent + offset + 1];
            if (next2 === "\n" || !next2 && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next2) {
        switch (next2) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next2 = this.charAt(1);
            if (this.flowKey || isEmpty(next2) || next2 === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next2 = this.buffer[i2 + 1];
              if (!next2 && !this.atEnd)
                return this.setNext("block-scalar");
              if (next2 === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next2 = this.buffer[i + 1];
            if (isEmpty(next2) || inFlow && flowIndicatorChars.has(next2))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next2 = this.buffer[i + 1];
            if (ch === "\r") {
              if (next2 === "\n") {
                i += 1;
                ch = "\n";
                next2 = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next2 === "#" || inFlow && flowIndicatorChars.has(next2))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// server.ts
import { execFile as execFile5, execFileSync as execFileSync3 } from "node:child_process";
import {
  createHash as createHash2,
  createHmac,
  randomBytes as randomBytes2,
  randomUUID as randomUUID3
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync as mkdirSync2,
  openSync,
  readFileSync as readFileSync3,
  realpathSync as realpathSync2,
  readdirSync as readdirSync2,
  renameSync as renameSync2,
  rmSync,
  statSync as statSync3,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir as homedir4 } from "node:os";
import { join as join4, resolve as resolve2 } from "node:path";
import { performance as performance2 } from "node:perf_hooks";
import { promisify as promisify4 } from "node:util";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";

// src/lib/server/device-access/store.ts
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join as join2, resolve } from "node:path";

// src/lib/coven-paths.ts
import { homedir as homedir2 } from "node:os";
import path2 from "node:path";

// src/lib/coven-home.ts
import { homedir } from "node:os";
import path from "node:path";

// src/lib/windows-local-path.ts
var WINDOWS_LOCAL_DEVICE_ROOT = /^\\\\[?.]\\(?:pipe\\|[a-z]:\\)/i;
var WINDOWS_PARENT_SEGMENT = /(?:^|\\)\.\.(?:\\|$)/;
var WINDOWS_EDGE_WHITESPACE = /^[\s\x85]+|[\s\x85]+$/g;
function failsToProveLocal(candidate, localRoot) {
  const normalized = candidate.replace(WINDOWS_EDGE_WHITESPACE, "").replaceAll("/", "\\");
  if (!normalized.startsWith("\\\\")) return false;
  if (WINDOWS_PARENT_SEGMENT.test(normalized)) return true;
  return !localRoot.test(normalized);
}
function isRemoteWindowsPath(candidate) {
  return failsToProveLocal(candidate, WINDOWS_LOCAL_DEVICE_ROOT);
}

// src/lib/coven-home.ts
function covenHomePath(env = process.env, homeDir = homedir(), platform = process.platform, onRemoteRefused) {
  const configured = env.COVEN_HOME;
  if (configured) {
    if (!(platform === "win32" && isRemoteWindowsPath(configured))) return configured;
    try {
      onRemoteRefused?.(configured);
    } catch {
    }
  }
  return path.join(homeDir, ".coven");
}

// src/lib/coven-paths.ts
function covenHome() {
  return covenHomePath(process.env, homedir2(), process.platform);
}
function caveHome() {
  return process.env.COVEN_CAVE_HOME || path2.join(
    /* turbopackIgnore: true */
    covenHome(),
    "cave"
  );
}

// src/lib/server/client-v1/path-ownership.ts
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var WINDOWS_SYSTEM_SID = "S-1-5-18";
var WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
var WINDOWS_OWNER_RIGHTS_SID = "S-1-3-4";
var WINDOWS_WRITABLE_RIGHTS_MASK = 1343029590;
var UNVERIFIED_OWNERSHIP_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
var UNVERIFIED_OWNERSHIP_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
var UNVERIFIED_OWNERSHIP_TOKEN = "i-accept-unverified-path-ownership";
var UNVERIFIED_OWNERSHIP_MIN_REASON = 12;
function resolveUnverifiedOwnershipWaiver(env) {
  const requested = env[UNVERIFIED_OWNERSHIP_ENV]?.trim() ?? "";
  if (!requested) {
    return {
      granted: false,
      note: `If the DACL genuinely cannot be read on this host \u2014 PowerShell in Constrained Language Mode, or no powershell.exe under %SystemRoot% \u2014 set ${UNVERIFIED_OWNERSHIP_ENV}=${UNVERIFIED_OWNERSHIP_TOKEN} and ${UNVERIFIED_OWNERSHIP_REASON_ENV} to a sentence naming who accepted that and why. It waives only an unreadable DACL, never one that was read and found shared.`
    };
  }
  if (requested !== UNVERIFIED_OWNERSHIP_TOKEN) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV} is set, but not to the waiver: the only accepted value is the exact string ${UNVERIFIED_OWNERSHIP_TOKEN}. A boolean-shaped value ("1", "true", "yes") never waives this check.`
    };
  }
  const reason = env[UNVERIFIED_OWNERSHIP_REASON_ENV]?.trim() ?? "";
  if (reason.length < UNVERIFIED_OWNERSHIP_MIN_REASON) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV} is set, but ${UNVERIFIED_OWNERSHIP_REASON_ENV} must carry at least ${UNVERIFIED_OWNERSHIP_MIN_REASON} characters naming who accepted an unverified path and why. The waiver stays closed without that attribution.`
    };
  }
  return { granted: true, reason };
}
function unverifiableOwnershipRefusal(subject, path6, cause, note) {
  return `${subject} ownership could not be verified on Windows: ${cause.message}. Refusing ${path6}; inspect it with: icacls "${path6}". ${note}`;
}
function unverifiedOwnershipDisclosure(subject, path6, cause, reason) {
  return `SECURITY WAIVER \u2014 ${subject} is being used UNVERIFIED. Its DACL could not be read on this host (${cause.message}), and ${UNVERIFIED_OWNERSHIP_ENV} is set, so ${path6} is trusted on the operator's word alone: reason given \u2014 ${reason}. Any principal that can write ${path6} can mint credentials or point a paired client at another server. Unset ${UNVERIFIED_OWNERSHIP_ENV} to restore the check.`;
}
function sharedOwnershipRefusal(subject, path6, findings, waiver) {
  return `${subject} is not exclusive to the current user: ${findings.join("; ")}. Refusing ${path6}; inspect it with: icacls "${path6}"` + (waiver.granted ? `. ${UNVERIFIED_OWNERSHIP_ENV} does not cover a DACL that was read: this one was, and it is shared. Repair it with: icacls "${path6}" /reset` : "");
}
var WINDOWS_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('acl-probe:start')
# Cmdlets are off limits in this script. Whichever cmdlet came first (the
# provider item lookup in one release, the object constructor in the next)
# never returned in the stripped probe environment: command discovery is what
# stalls, not the work. Direct .NET member calls, language keywords and
# operators do not wait on it.
$path = $env:COVEN_CAVE_CLIENT_V1_ACL_PATH
$isDirectory = [System.IO.Directory]::Exists($path)
if ($isDirectory) {
  $item = [System.IO.DirectoryInfo]::new($path)
} elseif ([System.IO.File]::Exists($path)) {
  $item = [System.IO.FileInfo]::new($path)
} else {
  throw 'ACL path does not exist.'
}
[Console]::Error.WriteLine('acl-probe:item')
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_SYSTEM_SID}')
$admins = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_ADMINISTRATORS_SID}')
$ownerRights = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_OWNER_RIGHTS_SID}')
$writableRights = [uint32]${WINDOWS_WRITABLE_RIGHTS_MASK}
$trusted = @($me.Value, $system.Value, $admins.Value)
[Console]::Error.WriteLine('acl-probe:identity')

function Read-State {
  param($target)
  [Console]::Error.WriteLine('acl-probe:read-state')
  $acl = $target.GetAccessControl('Access,Owner')
  [Console]::Error.WriteLine('acl-probe:acl')
  # Keep account-name lookup out of the security boundary: orphaned or remote
  # principals can make IdentityReference.Translate block on Windows.
  $aces = @()
  foreach ($entry in @($acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  ))) {
    $aces += [pscustomobject]@{
      sid = $entry.IdentityReference.Value
      type = [string]$entry.AccessControlType
      # FileSystemRights is signed; generic rights can set its sign bit.
      # Reinterpret the bits rather than using a checked numeric conversion.
      rights = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.FileSystemRights), 0)
    }
  }
  [Console]::Error.WriteLine('acl-probe:rules')
  return [pscustomobject]@{
    owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    protected = [bool]$acl.AreAccessRulesProtected
    aces = $aces
  }
}

function Test-Exclusive {
  param($state)
  if (-not $state.protected) { return $false }
  if ($state.owner -ne $me.Value) { return $false }
  foreach ($ace in $state.aces) {
    if ($ace.type -ne 'Allow') { return $false }
    if ($trusted -contains $ace.sid) { continue }
    if ($ace.sid -eq $ownerRights.Value -and
        (([uint32]$ace.rights -band $writableRights) -eq 0)) { continue }
    return $false
  }
  return $true
}

function Format-JsonString {
  param([string]$value)
  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('"')
  foreach ($char in $value.ToCharArray()) {
    $code = [int]$char
    if ($char -eq '"') { [void]$builder.Append('\\"') }
    elseif ($char -eq '\\') { [void]$builder.Append('\\\\') }
    elseif ($code -lt 32) { [void]$builder.Append(('\\u{0:x4}' -f $code)) }
    else { [void]$builder.Append($char) }
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Format-JsonBool {
  param([bool]$value)
  if ($value) { return 'true' } else { return 'false' }
}

$state = Read-State $item
[Console]::Error.WriteLine('acl-probe:initial-state')
$repaired = $false
$removed = @()
if (-not (Test-Exclusive $state)) {
[Console]::Error.WriteLine('acl-probe:repair')
  foreach ($ace in $state.aces) {
    if ($trusted -contains $ace.sid) { continue }
    if ($ace.sid -eq $ownerRights.Value -and
        (([uint32]$ace.rights -band $writableRights) -eq 0)) { continue }
    if ($removed -notcontains $ace.sid) { $removed += $ace.sid }
  }
  $acl = $item.GetAccessControl('Access')
  if ($state.owner -ne $me.Value) {
    $acl.SetOwner($me)
  }
  $acl.SetAccessRuleProtection($true, $false)
  # Enumerate the explicit post-protection rules in the same SID-native form.
  foreach ($rule in @($acl.GetAccessRules(
    $true,
    $false,
    [System.Security.Principal.SecurityIdentifier]
  ))) {
    if (
      $rule.IdentityReference.Value -eq $ownerRights.Value -and
      [string]$rule.AccessControlType -eq 'Allow' -and
      (([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$rule.FileSystemRights), 0) -band $writableRights) -eq 0)
    ) {
      continue
    }
    [void]$acl.RemoveAccessRuleSpecific($rule)
  }
  $inheritance = if ($isDirectory) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($sid in @($me, $system, $admins)) {
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid, 'FullControl', $inheritance, 'None', 'Allow'))
  }
  $item.SetAccessControl($acl)
[Console]::Error.WriteLine('acl-probe:repair-written')
  $repaired = $true
  $state = Read-State $item
}

[Console]::Error.WriteLine('acl-probe:complete')
$aceJson = @()
foreach ($ace in $state.aces) {
  $aceJson += ('{"sid":' + (Format-JsonString $ace.sid) +
    ',"type":' + (Format-JsonString $ace.type) +
    ',"rights":' + ([uint32]$ace.rights).ToString([System.Globalization.CultureInfo]::InvariantCulture) + '}')
}
$removedJson = @()
foreach ($sid in $removed) { $removedJson += (Format-JsonString $sid) }
# Written straight to stdout so nothing travels the output pipeline at all.
[Console]::Out.WriteLine('{"self":' + (Format-JsonString $me.Value) +
  ',"owner":' + (Format-JsonString $state.owner) +
  ',"protected":' + (Format-JsonBool $state.protected) +
  ',"repaired":' + (Format-JsonBool $repaired) +
  ',"removed":[' + ($removedJson -join ',') + ']' +
  ',"aces":[' + ($aceJson -join ',') + ']}')
`;
function windowsSystemRoot() {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}
function windowsPowerShellPath() {
  return join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
var WINDOWS_ACL_PROBE_TIMEOUT_MS = 12e3;
var WINDOWS_ACL_PROBE_MAX_ATTEMPTS = 2;
function windowsAclProbeTimedOut(error) {
  if (!error || typeof error !== "object") return false;
  const failure = error;
  return failure.code === "ETIMEDOUT" || failure.killed === true && failure.signal === "SIGTERM";
}
var WINDOWS_ACL_PROBE_STAGES = /* @__PURE__ */ new Set([
  "start",
  "item",
  "identity",
  "read-state",
  "acl",
  "rules",
  "initial-state",
  "repair",
  "repair-written",
  "complete"
]);
var windowsAclProbeTimeoutStages = /* @__PURE__ */ new WeakMap();
function sanitizedWindowsAclProbeTimeout(error) {
  const stderr = error && typeof error === "object" && "stderr" in error ? Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : typeof error.stderr === "string" ? error.stderr : "" : "";
  let stage = "launch";
  for (const match of stderr.matchAll(/^acl-probe:([a-z-]+)\r?$/gmu)) {
    if (WINDOWS_ACL_PROBE_STAGES.has(match[1])) stage = match[1];
  }
  const sanitized = Object.assign(new Error(`Windows ACL probe timed out at ${stage}.`), {
    code: "ETIMEDOUT",
    killed: true,
    signal: "SIGTERM"
  });
  windowsAclProbeTimeoutStages.set(sanitized, stage);
  return sanitized;
}
function sanitizedWindowsAclProbeFailure(error) {
  const failure = error && typeof error === "object" ? error : {};
  const code = typeof failure.code === "number" && Number.isSafeInteger(failure.code) ? failure.code : typeof failure.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code) ? failure.code : void 0;
  const status = typeof failure.status === "number" && Number.isSafeInteger(failure.status) ? failure.status : void 0;
  const signal = failure.signal === null ? null : typeof failure.signal === "string" && /^SIG[A-Z0-9]{1,20}$/.test(failure.signal) ? failure.signal : void 0;
  const killed = typeof failure.killed === "boolean" ? failure.killed : void 0;
  const bytes = (value) => typeof value === "string" ? Buffer.byteLength(value) : Buffer.isBuffer(value) ? value.length : "unknown";
  const stderr = typeof failure.stderr === "string" ? failure.stderr : Buffer.isBuffer(failure.stderr) ? failure.stderr.toString("utf8") : "";
  let stage = "launch";
  for (const match of stderr.matchAll(/^acl-probe:([a-z-]+)\r?$/gmu)) {
    if (WINDOWS_ACL_PROBE_STAGES.has(match[1])) stage = match[1];
  }
  return Object.assign(new Error(
    `Windows ACL probe failed (code=${code ?? "unknown"}, status=${status ?? "unknown"}, signal=${signal === null ? "null" : signal ?? "unknown"}, killed=${killed ?? "unknown"}, stage=${stage}, stdoutBytes=${bytes(failure.stdout)}, stderrBytes=${bytes(failure.stderr)}).`
  ), { code, status, signal, killed });
}
function windowsProbeEnv(path6) {
  const systemRoot = windowsSystemRoot();
  const system32 = join(systemRoot, "System32");
  return {
    COVEN_CAVE_CLIENT_V1_ACL_PATH: path6,
    // Next augments ProcessEnv to require this. It carries no secret.
    NODE_ENV: process.env.NODE_ENV,
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: system32,
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    TEMP: process.env.TEMP || process.env.TMP || join(systemRoot, "Temp"),
    TMP: process.env.TMP || process.env.TEMP || join(systemRoot, "Temp")
  };
}
function parseClientV1WindowsAclReport(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the ACL probe returned a malformed report");
  }
  const { aces, removed } = parsed;
  if (typeof parsed.self !== "string" || !parsed.self || typeof parsed.owner !== "string" || !parsed.owner || typeof parsed.protected !== "boolean" || typeof parsed.repaired !== "boolean" || !Array.isArray(aces) || !Array.isArray(removed)) {
    throw new Error("the ACL probe returned a malformed report");
  }
  return {
    self: parsed.self,
    owner: parsed.owner,
    protected: parsed.protected,
    repaired: parsed.repaired,
    removed: removed.map((sid) => String(sid)),
    aces: aces.map((ace) => {
      const entry = ace ?? {};
      if (!Number.isInteger(entry.rights) || entry.rights < 0 || entry.rights > 4294967295) {
        throw new Error("the ACL probe returned a malformed report");
      }
      return {
        sid: String(entry.sid ?? ""),
        type: String(entry.type ?? ""),
        rights: entry.rights
      };
    })
  };
}
function createClientV1WindowsAclProbe(execute = execFileAsync) {
  return async (path6) => {
    for (let attempt = 0; attempt < WINDOWS_ACL_PROBE_MAX_ATTEMPTS; attempt += 1) {
      let stdout;
      try {
        ({ stdout } = await execute(
          windowsPowerShellPath(),
          [
            "-NoProfile",
            "-NonInteractive",
            "-NoLogo",
            "-InputFormat",
            "None",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_ACL_SCRIPT
          ],
          {
            env: windowsProbeEnv(path6),
            encoding: "utf8",
            windowsHide: true,
            timeout: WINDOWS_ACL_PROBE_TIMEOUT_MS,
            maxBuffer: 1024 * 1024
          }
        ));
      } catch (error) {
        const timedOut = windowsAclProbeTimedOut(error);
        if (attempt + 1 >= WINDOWS_ACL_PROBE_MAX_ATTEMPTS || !timedOut) {
          if (timedOut) throw sanitizedWindowsAclProbeTimeout(error);
          throw sanitizedWindowsAclProbeFailure(error);
        }
        continue;
      }
      return parseClientV1WindowsAclReport(stdout);
    }
    throw new Error("the ACL probe attempt bound was exhausted");
  };
}
var probeWindowsAcl = createClientV1WindowsAclProbe();
function exclusivityFindings(report) {
  const findings = [];
  const trusted = /* @__PURE__ */ new Set([report.self, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID]);
  if (report.owner !== report.self) {
    findings.push(`owned by ${report.owner}, not ${report.self}`);
  }
  if (!report.protected) findings.push("its DACL still inherits from the parent");
  const foreign = report.aces.filter(
    (ace) => ace.type !== "Allow" || !trusted.has(ace.sid) && !(ace.sid === WINDOWS_OWNER_RIGHTS_SID && Number.isInteger(ace.rights) && (ace.rights & WINDOWS_WRITABLE_RIGHTS_MASK) === 0)
  ).map((ace) => `${ace.type}:${ace.sid}`);
  if (foreign.length > 0) {
    findings.push(`access granted to ${[...new Set(foreign)].join(", ")}`);
  }
  return findings;
}
var ClientV1PathOwnershipError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ClientV1PathOwnershipError";
  }
};
var CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS = 3e4;
var verifiedWindowsPaths = /* @__PURE__ */ new Map();
var waivedWindowsPaths = /* @__PURE__ */ new Map();
var refusedWindowsPaths = /* @__PURE__ */ new Map();
async function assertExclusivePathOwnership(path6, metadata, subject, options = {}) {
  const platform = options.platform ?? process.platform;
  const getuid = options.getuid === void 0 ? process.getuid : options.getuid;
  if (typeof getuid === "function") {
    if (metadata.uid !== getuid()) {
      throw new Error(`${subject} must be owned by the current user.`);
    }
    return;
  }
  if (platform !== "win32") {
    throw new Error(
      `${subject} ownership cannot be verified on ${platform}: this platform exposes neither a uid nor a Windows ACL, so ${path6} is refused.`
    );
  }
  if (verifiedWindowsPaths.has(path6) || waivedWindowsPaths.has(path6)) return;
  const now = options.now ?? Date.now;
  const cachedRefusal = refusedWindowsPaths.get(path6);
  if (cachedRefusal !== void 0) {
    if (cachedRefusal.expiresAt > now()) throw cachedRefusal.error;
    refusedWindowsPaths.delete(path6);
  }
  const warn = options.warn ?? console.warn;
  const waiver = resolveUnverifiedOwnershipWaiver(options.env ?? process.env);
  const probe = options.probeWindowsAcl ?? probeWindowsAcl;
  let report;
  const probeStartedAt = performance.now();
  try {
    report = await probe(path6);
  } catch (cause) {
    if (!waiver.granted) {
      const error = new ClientV1PathOwnershipError(
        unverifiableOwnershipRefusal(subject, path6, cause, waiver.note),
        { cause }
      );
      refusedWindowsPaths.set(path6, {
        expiresAt: now() + CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS,
        error
      });
      warn(error.message);
      throw error;
    }
    waivedWindowsPaths.set(path6, waiver.reason);
    warn(unverifiedOwnershipDisclosure(subject, path6, cause, waiver.reason));
    return;
  }
  const findings = exclusivityFindings(report);
  if (findings.length > 0) {
    const error = new ClientV1PathOwnershipError(
      sharedOwnershipRefusal(subject, path6, findings, waiver)
    );
    refusedWindowsPaths.set(path6, {
      expiresAt: now() + CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS,
      error
    });
    const probeState = {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - probeStartedAt)),
      repairAttempted: report.repaired,
      protected: report.protected,
      ownerMatches: report.owner === report.self,
      aceCount: report.aces.length,
      removedPrincipalCount: report.removed.length
    };
    warn(`${error.message}
[windows-acl-state] ${JSON.stringify(probeState)}`);
    throw error;
  }
  if (report.repaired) {
    const removed = report.removed.length > 0 ? report.removed.join(", ") : "inherited entries";
    warn(
      `${subject} had no enforced access control on Windows; restricted ${path6} to the current user and revoked ${removed}.`
    );
  }
  verifiedWindowsPaths.set(path6, report);
}

// src/lib/server/device-access/contract.ts
var DEVICE_ACCESS_COOKIE = "cave_device_access";
var DEVICE_ACCESS_HEADER = "x-coven-cave-device-access";
var DEVICE_CREDENTIAL_PREFIX = "cave-device-v1.";

// src/lib/server/device-access/store.ts
var PAIRING_TTL_MS = 5 * 6e4;
var REQUEST_WINDOW_MS = 10 * 6e4;
var LAST_SEEN_INTERVAL_MS = 6e4;
var DATABASE_FILE = "device-access.sqlite";
var CREDENTIAL_RE = /^cave-device-v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
var ERROR_STATUS = {
  invalid_request: 400,
  forbidden: 403,
  conflict: 409,
  not_found: 404,
  rate_limited: 429,
  unavailable: 503
};
var DeviceAccessError = class extends Error {
  constructor(code, message, status = ERROR_STATUS[code]) {
    super(message);
    this.name = "DeviceAccessError";
    this.code = code;
    this.status = status;
  }
};
var DeviceAccessInitializationError = class extends DeviceAccessError {
  constructor(message) {
    super("unavailable", message);
    this.name = "DeviceAccessInitializationError";
  }
};
function text(value, field, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || value.includes(DEVICE_CREDENTIAL_PREFIX)) {
    throw new DeviceAccessError("invalid_request", `Invalid ${field}.`);
  }
  return value.trim();
}
function tailnet(value) {
  const normalized = text(value, "tailnet", 253).toLowerCase();
  const labels = normalized.split(".");
  if (labels.length < 3 || !normalized.endsWith(".ts.net") || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new DeviceAccessError("invalid_request", "Tailnets must be exact DNS names ending in .ts.net.");
  }
  return normalized;
}
function normalizePeer(peer) {
  return {
    tailnet: tailnet(peer?.tailnet),
    nodeId: text(peer?.nodeId, "node ID"),
    userId: text(peer?.userId, "user ID"),
    loginName: text(peer?.loginName, "login name"),
    deviceName: text(peer?.deviceName, "device name")
  };
}
function hashCredential(credential) {
  return createHash("sha256").update(credential).digest();
}
function policyEnabled(value) {
  if (value !== 0 && value !== 1) {
    throw new Error("Device access policy mode is missing or invalid.");
  }
  return value === 1;
}
function deviceRecord(row) {
  return {
    id: row.id,
    installationId: row.installationId,
    label: row.label,
    peer: {
      tailnet: row.tailnet,
      nodeId: row.nodeId,
      userId: row.userId,
      loginName: row.loginName,
      deviceName: row.deviceName
    },
    status: row.status,
    createdAt: row.createdAt,
    pairingExpiresAt: row.pairingExpiresAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt
  };
}
var POLICY_SCHEMA = `
  CREATE TABLE policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
  ) STRICT;
  INSERT INTO policy (singleton, enabled)
    SELECT 1, CASE WHEN
      EXISTS(SELECT 1 FROM audit WHERE event = 'policy.updated')
      OR EXISTS(SELECT 1 FROM allowed_tailnets)
      OR EXISTS(SELECT 1 FROM devices)
    THEN 1 ELSE 0 END;
  PRAGMA user_version = 2;
`;
var SCHEMA = `
  CREATE TABLE allowed_tailnets (tailnet TEXT PRIMARY KEY NOT NULL) STRICT;
  CREATE TABLE devices (
    id TEXT PRIMARY KEY NOT NULL,
    installationId TEXT NOT NULL,
    label TEXT NOT NULL,
    tailnet TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    loginName TEXT NOT NULL,
    deviceName TEXT NOT NULL,
    credentialHash TEXT NOT NULL CHECK(length(credentialHash) = 64),
    status TEXT NOT NULL CHECK(status IN ('pending', 'allowed', 'denied', 'revoked', 'expired')),
    createdAt INTEGER NOT NULL,
    pairingExpiresAt INTEGER NOT NULL,
    decidedAt INTEGER,
    decidedBy TEXT,
    lastSeenAt INTEGER,
    revokedAt INTEGER
  ) STRICT;
  CREATE INDEX device_requests ON devices(tailnet, nodeId, createdAt);
  CREATE INDEX device_expiry ON devices(status, pairingExpiresAt);
  CREATE TABLE audit (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    at INTEGER NOT NULL,
    deviceId TEXT REFERENCES devices(id),
    actor TEXT NOT NULL,
    event TEXT NOT NULL,
    requestId TEXT,
    method TEXT,
    path TEXT,
    status INTEGER
  ) STRICT;
  ${POLICY_SCHEMA}
`;
async function secureFile(path6, required = false) {
  let metadata;
  try {
    metadata = await lstat(path6);
  } catch (error) {
    if (!required && error.code === "ENOENT") return;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`Device access database files must be regular files without symlinks or hardlinks: ${path6}.`);
  }
  await assertExclusivePathOwnership(path6, metadata, "Device access database file");
  await chmod(path6, 384);
}
async function initializeLocation(root) {
  const configuredRoot = resolve(root);
  await mkdir(configuredRoot, { recursive: true, mode: 448 });
  const metadata = await lstat(configuredRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Device access root must be a real directory, not a symlink.");
  }
  const physicalRoot = await realpath(configuredRoot);
  await assertExclusivePathOwnership(physicalRoot, metadata, "Device access root");
  await chmod(physicalRoot, 448);
  const file = join2(physicalRoot, DATABASE_FILE);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) await secureFile(file + suffix);
  try {
    const handle2 = await open(file, "wx", 384);
    await handle2.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await secureFile(file, true);
  return file;
}
var SqliteDeviceAccessStore = class {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }
  timestamp() {
    const at = this.now();
    if (!Number.isSafeInteger(at) || at < 0 || at > Number.MAX_SAFE_INTEGER - REQUEST_WINDOW_MS) {
      throw new Error("Device access timestamps must be non-negative safe integer milliseconds.");
    }
    return at;
  }
  transaction(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(at, deviceId, actor, event, access) {
    this.db.prepare(`
      INSERT INTO audit (id, at, deviceId, actor, event, requestId, method, path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      at,
      deviceId,
      actor,
      event,
      access?.requestId ?? null,
      access?.method ?? null,
      access?.path ?? null,
      access?.status ?? null
    );
  }
  find(id) {
    return this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id);
  }
  isEnabled() {
    return policyEnabled(this.db.prepare("SELECT enabled FROM policy WHERE singleton = 1").get()?.enabled);
  }
  isTailnetAllowed(value) {
    return this.isEnabled() && this.db.prepare("SELECT 1 FROM allowed_tailnets WHERE tailnet = ?").get(value) !== void 0;
  }
  transition(row, status, actor, at) {
    this.db.prepare(`
      UPDATE devices SET status = ?, decidedAt = ?, decidedBy = ?, revokedAt = ? WHERE id = ?
    `).run(status, at, actor, status === "revoked" ? at : null, row.id);
    this.audit(at, row.id, actor, `device.${status}`);
  }
  expirePending(at) {
    const expired = this.db.prepare(`
      SELECT * FROM devices WHERE status = 'pending' AND pairingExpiresAt <= ? ORDER BY rowid
    `).all(at);
    for (const row of expired) this.transition(row, "expired", "system:expiry", at);
  }
  readPolicy() {
    const rows = this.db.prepare(`
      SELECT policy.enabled, allowed_tailnets.tailnet FROM policy
      LEFT JOIN allowed_tailnets ON 1 = 1
      WHERE policy.singleton = 1 ORDER BY allowed_tailnets.tailnet
    `).all();
    return {
      enabled: policyEnabled(rows[0]?.enabled),
      allowedTailnets: rows.filter((row) => row.tailnet !== null).map((row) => row.tailnet)
    };
  }
  async policy() {
    return this.readPolicy();
  }
  async snapshot() {
    return this.transaction(() => {
      this.expirePending(this.timestamp());
      return {
        ...this.readPolicy(),
        devices: this.db.prepare("SELECT * FROM devices ORDER BY rowid DESC").all().map(deviceRecord),
        events: this.db.prepare(`
          SELECT id, at, deviceId, actor, event, requestId, method, path, status
          FROM audit ORDER BY sequence DESC LIMIT 200
        `).all()
      };
    });
  }
  async setAllowedTailnets(tailnets, actor) {
    if (!Array.isArray(tailnets) || tailnets.length > 100) {
      throw new DeviceAccessError("invalid_request", "Provide at most 100 exact tailnets.");
    }
    const normalized = [...new Set(tailnets.map(tailnet))].sort();
    const by = text(actor, "actor");
    this.transaction(() => {
      const at = this.timestamp();
      const wasEnabled = this.isEnabled();
      this.expirePending(at);
      const previous = this.db.prepare("SELECT tailnet FROM allowed_tailnets ORDER BY tailnet").all().map((row) => row.tailnet);
      this.db.exec("DELETE FROM allowed_tailnets");
      for (const value of normalized) {
        this.db.prepare("INSERT INTO allowed_tailnets (tailnet) VALUES (?)").run(value);
      }
      this.db.exec("UPDATE policy SET enabled = 1 WHERE singleton = 1");
      if (!wasEnabled) this.audit(at, null, by, "policy.enabled");
      this.audit(at, null, by, "policy.updated");
      for (const value of previous.filter((value2) => !normalized.includes(value2))) {
        this.audit(at, null, by, `policy.tailnet_removed:${value}`);
      }
      for (const value of normalized.filter((value2) => !previous.includes(value2))) {
        this.audit(at, null, by, `policy.tailnet_allowed:${value}`);
      }
      const removed = this.db.prepare(`
        SELECT * FROM devices WHERE status IN ('allowed', 'pending')
        AND tailnet NOT IN (SELECT tailnet FROM allowed_tailnets) ORDER BY rowid
      `).all();
      for (const row of removed) {
        this.transition(row, row.status === "allowed" ? "revoked" : "denied", by, at);
      }
    });
  }
  async request(peer, input) {
    const normalized = normalizePeer(peer);
    const installationId = text(input?.installationId, "installation ID");
    const label = text(input?.label, "device label");
    return this.transaction(() => {
      const at = this.timestamp();
      if (!this.isTailnetAllowed(normalized.tailnet)) {
        throw new DeviceAccessError("forbidden", "This tailnet is not allowed to request access.");
      }
      this.expirePending(at);
      const requests = this.db.prepare(`
        SELECT count(*) AS count FROM devices WHERE tailnet = ? AND nodeId = ? AND createdAt > ?
      `).get(normalized.tailnet, normalized.nodeId, at - REQUEST_WINDOW_MS);
      if (requests.count >= 5) {
        throw new DeviceAccessError("rate_limited", "This device has made too many pairing requests.");
      }
      const pending = this.db.prepare("SELECT count(*) AS count FROM devices WHERE status = 'pending'").get();
      if (pending.count >= 64) {
        throw new DeviceAccessError("rate_limited", "Too many devices are awaiting approval.");
      }
      const id = randomUUID();
      const credential = `${DEVICE_CREDENTIAL_PREFIX}${id}.${randomBytes(32).toString("base64url")}`;
      this.db.prepare(`
        INSERT INTO devices (
          id, installationId, label, tailnet, nodeId, userId, loginName, deviceName,
          credentialHash, status, createdAt, pairingExpiresAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(
        id,
        installationId,
        label,
        normalized.tailnet,
        normalized.nodeId,
        normalized.userId,
        normalized.loginName,
        normalized.deviceName,
        hashCredential(credential).toString("hex"),
        at,
        at + PAIRING_TTL_MS
      );
      this.audit(at, id, `peer:${normalized.tailnet}/${normalized.nodeId}/${normalized.userId}`, "request.created");
      return { device: deviceRecord(this.find(id)), credential };
    });
  }
  authenticate(credential, peer, allowedOnly) {
    if (typeof credential !== "string") return null;
    const match = CREDENTIAL_RE.exec(credential);
    if (!match) return null;
    let normalized;
    try {
      normalized = normalizePeer(peer);
    } catch (error) {
      if (error instanceof DeviceAccessError) return null;
      throw error;
    }
    return this.transaction(() => {
      const row = this.find(match[1]);
      const expected = row ? Buffer.from(row.credentialHash, "hex") : Buffer.alloc(32);
      if (!timingSafeEqual(hashCredential(credential), expected) || !row || row.tailnet !== normalized.tailnet || row.nodeId !== normalized.nodeId || row.userId !== normalized.userId) {
        return null;
      }
      const at = this.timestamp();
      if (row.status === "pending" && row.pairingExpiresAt <= at) {
        this.transition(row, "expired", "system:expiry", at);
      }
      const device = deviceRecord(this.find(match[1]));
      if (!allowedOnly) return device;
      if (device.status !== "allowed" || !this.isTailnetAllowed(device.peer.tailnet)) return null;
      if (device.lastSeenAt === null || at - device.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
        this.db.prepare("UPDATE devices SET lastSeenAt = ? WHERE id = ?").run(at, device.id);
        device.lastSeenAt = at;
      }
      return device;
    });
  }
  async inspect(credential, peer) {
    return this.authenticate(credential, peer, false);
  }
  async verify(credential, peer) {
    return this.authenticate(credential, peer, true);
  }
  async decide(id, decision, actor) {
    const deviceId = text(id, "device ID");
    const by = text(actor, "actor");
    if (!["allowed", "denied", "revoked"].includes(decision)) {
      throw new DeviceAccessError("invalid_request", "Unknown device decision.");
    }
    const result = this.transaction(() => {
      const at = this.timestamp();
      this.expirePending(at);
      const row = this.find(deviceId);
      if (!row) return new DeviceAccessError("not_found", "Device request not found.");
      if (decision === "revoked" && row.status !== "allowed" || decision !== "revoked" && row.status !== "pending") {
        return new DeviceAccessError("conflict", "This device cannot make that transition.");
      }
      if (decision === "allowed" && !this.isTailnetAllowed(row.tailnet)) {
        return new DeviceAccessError("forbidden", "This tailnet is no longer allowed.");
      }
      this.transition(row, decision, by, at);
      return deviceRecord(this.find(deviceId));
    });
    if (result instanceof DeviceAccessError) throw result;
    return result;
  }
  async recordAccess(deviceId, input) {
    const id = text(deviceId, "device ID");
    const requestId = text(input?.requestId, "request ID", 128);
    const method = text(input?.method, "HTTP method", 16);
    if (!/^[A-Z]+$/.test(method) || !Number.isInteger(input?.status) || input.status !== 0 && (input.status < 100 || input.status > 599)) {
      throw new DeviceAccessError("invalid_request", "Invalid HTTP access metadata.");
    }
    if (typeof input.path !== "string" || input.path.length > 16384 || !input.path.startsWith("/") || input.path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(input.path)) {
      throw new DeviceAccessError("invalid_request", "Access paths must be origin-relative request paths.");
    }
    const path6 = text(input.path.split(/[?#]/, 1)[0], "access path", 2048);
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(path6);
    } catch {
      throw new DeviceAccessError("invalid_request", "Invalid access path encoding.");
    }
    if (/[\u0000-\u001f\u007f]/.test(decodedPath) || decodedPath.includes(DEVICE_CREDENTIAL_PREFIX)) {
      throw new DeviceAccessError("invalid_request", "Invalid access path.");
    }
    this.transaction(() => {
      const device = this.find(id);
      if (!device) throw new DeviceAccessError("not_found", "Device request not found.");
      if (input.status === 0 && (device.status !== "allowed" || !this.isTailnetAllowed(device.tailnet))) {
        throw new DeviceAccessError("forbidden", "This device is no longer allowed to access the app.");
      }
      this.audit(this.timestamp(), id, `device:${id}`, "access", { requestId, method, path: path6, status: input.status });
    });
  }
  close() {
    this.db.close();
  }
};
async function createDeviceAccessStore({ root = join2(caveHome(), "device-access"), now = Date.now } = {}) {
  const file = await initializeLocation(root);
  const { DatabaseSync: DatabaseSync2 } = await import("node:sqlite");
  const db = new DatabaseSync2(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
    const journal = db.prepare("PRAGMA journal_mode = WAL").get();
    if (journal?.journal_mode !== "wal") throw new Error("Device access database requires WAL journaling.");
    db.exec("PRAGMA synchronous = FULL; BEGIN IMMEDIATE");
    try {
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version === 0) db.exec(SCHEMA);
      else if (version === 1) db.exec(POLICY_SCHEMA);
      else if (version !== 2) throw new Error("Unsupported device access database schema.");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const suffix of ["", "-wal", "-shm", "-journal"]) await secureFile(file + suffix, suffix === "");
    return new SqliteDeviceAccessStore(db, now);
  } catch (error) {
    db.close();
    throw error;
  }
}

// src/lib/server/device-access/gateway.ts
import { randomUUID as randomUUID2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { userInfo } from "node:os";

// src/lib/server/device-access/peers.ts
import { execFile as execFile4 } from "node:child_process";
import { isIP } from "node:net";
import { promisify as promisify3 } from "node:util";

// src/lib/mobile-handoff.ts
import { execFileSync as execFileSync2, spawn } from "node:child_process";
import { existsSync as existsSync3, statSync as statSync2 } from "node:fs";
import path5 from "node:path";

// scripts/ports.mjs
var CAVE_PORTS = Object.freeze({
  dev: 3e3,
  production: 3020,
  e2e: 3100
});

// src/lib/server/client-v1/authority-contract.ts
var CLIENT_V1_HPKE_MECHANISM = "hpke-bound-v1";
var CLIENT_V1_HPKE_AUTHORITY_MODES = Object.freeze([
  "off",
  "advertise",
  "enforce"
]);
var CLIENT_V1_HPKE_PROTECTED_OPERATIONS = Object.freeze([
  "pairing.poll",
  "pairing.exchange",
  "familiars.list",
  "familiars.contract.read",
  "familiars.analytics.read",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list"
]);
var CLIENT_V1_HPKE_SUITE = Object.freeze({
  kem: "DHKEM(X25519, HKDF-SHA256)",
  kemId: 32,
  kdf: "HKDF-SHA256",
  kdfId: 1,
  aead: "AES-256-GCM",
  aeadId: 2
});
var CLIENT_V1_HPKE_HEADERS = Object.freeze({
  mechanism: "x-coven-client-v1-authority",
  keyId: "x-coven-client-v1-authority-key-id",
  instanceId: "x-coven-client-v1-authority-instance",
  runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
  requestNonce: "x-coven-client-v1-authority-request-nonce",
  issuedAt: "x-coven-client-v1-authority-issued-at",
  enc: "x-coven-client-v1-authority-enc",
  ciphertext: "x-coven-client-v1-authority-ciphertext"
});
var CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE = "application/vnd.opencoven.client-v1.hpke-bound-v1+json";
var CLIENT_V1_HPKE_LIMITS = Object.freeze({
  rawKeyBytes: 32,
  encodedKeyCharacters: 43,
  requestPlaintextBytes: 1024,
  requestCiphertextBytes: 2048,
  requestBodyBytes: 65536,
  responsePlaintextBytes: 8 * 1024 * 1024,
  responseCiphertextBytes: 8388624,
  responseEnvelopeBytes: 11185056,
  canonicalRouteBytes: 2048,
  instanceIdBytes: 256
});
var CLIENT_V1_HPKE_FRESHNESS = Object.freeze({
  maximumAgeMs: 6e4,
  maximumFutureSkewMs: 1e4,
  replayTtlMs: 12e4,
  replayCapacity: 4096
});
var CLIENT_V1_AUTHORITY_CONTRACT = Object.freeze({
  defaultMode: "off",
  modes: CLIENT_V1_HPKE_AUTHORITY_MODES,
  mechanism: Object.freeze({
    id: CLIENT_V1_HPKE_MECHANISM,
    discoveryVersion: 2,
    suite: CLIENT_V1_HPKE_SUITE,
    requestHeaders: CLIENT_V1_HPKE_HEADERS,
    responseMediaType: CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
    requestHpkeMode: "base",
    responseHpkeMode: "auth",
    requestEncoding: "headers-plus-rfc8785-json",
    aadEncoding: "u32be-length-prefixed-v1",
    canonicalRoute: "rfc3986-sorted-query-v1",
    keyIdDerivation: "sha256-domain-separated-public-key-v1",
    requestInfo: "OpenCoven/client-v1/hpke-bound-v1/request",
    responseInfo: "OpenCoven/client-v1/hpke-bound-v1/response",
    limits: CLIENT_V1_HPKE_LIMITS,
    freshness: CLIENT_V1_HPKE_FRESHNESS,
    protectedOperations: CLIENT_V1_HPKE_PROTECTED_OPERATIONS,
    vectorFixture: Object.freeze({
      fileName: "hpke-bound-v1-vectors.json",
      sha256FileName: "hpke-bound-v1-vectors.sha256"
    })
  })
});

// src/lib/server/client-v1/operations.ts
var freezeDefinition = (definition) => Object.freeze({ ...definition, families: Object.freeze([...definition.families]) });
var CLIENT_V1_OPERATION_DEFINITIONS = Object.freeze([
  freezeDefinition({
    id: "health.read",
    method: "GET",
    path: "/api/client/v1/health",
    ingress: "public",
    scope: null,
    credential: "none",
    binding: "none",
    families: ["health"]
  }),
  freezeDefinition({
    id: "pairing.create",
    method: "POST",
    path: "/api/client/v1/pairing/requests",
    ingress: "public",
    scope: null,
    credential: "none",
    binding: "none",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.poll",
    method: "GET",
    path: "/api/client/v1/pairing/requests/:id",
    ingress: "public",
    scope: null,
    credential: "pairing-secret",
    binding: "hpke-bound-v1",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.exchange",
    method: "POST",
    path: "/api/client/v1/pairing/requests/:id/exchange",
    ingress: "public",
    scope: null,
    credential: "pairing-secret",
    binding: "hpke-bound-v1",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.admin.list",
    method: "GET",
    path: "/api/client/v1/admin/pairing-requests",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "pairing.admin.decide",
    method: "POST",
    path: "/api/client/v1/admin/pairing-requests/:id/decision",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["pairing"]
  }),
  freezeDefinition({
    id: "credentials.admin.list",
    method: "GET",
    path: "/api/client/v1/admin/credentials",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["credentials"]
  }),
  freezeDefinition({
    id: "credentials.admin.revoke",
    method: "DELETE",
    path: "/api/client/v1/admin/credentials/:id",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    families: ["credentials"]
  }),
  freezeDefinition({
    id: "status.admin.read",
    method: "GET",
    path: "/api/client/v1/admin/status",
    ingress: "admin",
    scope: null,
    credential: "admin",
    binding: "none",
    // The operational-state family: like health.read, this answers what
    // state the surface is in, never user data. It is administrator-only —
    // the discovery record and the ownership waiver are host configuration —
    // so a paired bearer can never read it.
    families: ["health"]
  }),
  freezeDefinition({
    id: "familiars.list",
    method: "GET",
    path: "/api/client/v1/familiars",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["familiars", "cursors"]
  }),
  freezeDefinition({
    id: "familiars.contract.read",
    method: "GET",
    path: "/api/client/v1/familiars/:id/contract",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    // One record, no paging: like conversations.read it refuses `limit` and
    // `cursor`, so it claims no `cursors`. Its own family rather than
    // `familiars`, because a Cave that lists familiars need not serve their
    // wards, and a client gates its Access tab on exactly this claim.
    families: ["familiar-contract"]
  }),
  freezeDefinition({
    id: "familiars.analytics.read",
    method: "GET",
    path: "/api/client/v1/familiars/:id/analytics",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    // `window` and `recent` are narrowing parameters, not a cursor: the
    // response is one record however it is narrowed.
    families: ["familiar-analytics"]
  }),
  freezeDefinition({
    id: "projects.list",
    method: "GET",
    path: "/api/client/v1/projects",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["projects", "cursors"]
  }),
  freezeDefinition({
    id: "conversations.list",
    method: "GET",
    path: "/api/client/v1/conversations",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["conversations", "cursors"]
  }),
  freezeDefinition({
    id: "conversations.read",
    method: "GET",
    path: "/api/client/v1/conversations/:id",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    // No `cursors`: this route serves one transcript header and refuses
    // `limit` and `cursor` outright. Listing it here would make the family
    // summary claim paging on a route that answers invalid_request for it.
    families: ["conversations"]
  }),
  freezeDefinition({
    id: "messages.list",
    method: "GET",
    path: "/api/client/v1/conversations/:id/messages",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["conversation-messages", "cursors"]
  })
]);
var CLIENT_V1_CAPABILITY_FAMILY_ORDER = Object.freeze([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "familiar-contract",
  "familiar-analytics",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors"
]);

// src/lib/server/client-v1/contract.ts
var freezeReadonlyArray = (value) => Object.freeze([...value]);
var freezeReadonlyObject = (value) => Object.freeze({ ...value });
var CLIENT_V1_SCOPES = freezeReadonlyArray([
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write"
]);
var CLIENT_V1_CAPABILITIES = freezeReadonlyArray([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "familiar-contract",
  "familiar-analytics",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors"
]);
var CLIENT_V1_OPERATIONS = freezeReadonlyArray([
  "health.read",
  "pairing.create",
  "pairing.poll",
  "pairing.exchange",
  "pairing.admin.list",
  "pairing.admin.decide",
  "credentials.admin.list",
  "credentials.admin.revoke",
  "status.admin.read",
  "familiars.list",
  "familiars.contract.read",
  "familiars.analytics.read",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list"
]);
var CLIENT_V1_ERROR_CODES = freezeReadonlyArray([
  "invalid_request",
  "unauthorized",
  "scope_denied",
  "ownership_refused",
  "not_found",
  "conflict",
  "rate_limited",
  "pairing_pending",
  "pairing_denied",
  "pairing_expired",
  "incompatible_version",
  "service_unavailable",
  "reconcile_required",
  "internal_error"
]);
var CLIENT_V1_IDENTITY_KINDS = freezeReadonlyArray([
  "client",
  "credential",
  "familiar",
  "project",
  "conversation",
  "message",
  "event"
]);
var CLIENT_V1_LIMITS = freezeReadonlyObject({
  idempotencyKeyCharacters: 36,
  requestIdCharacters: 64,
  revisionTokenCharacters: 128,
  cursorCharacters: 512,
  errorMessageCharacters: 256,
  errorDetailEntries: 16,
  errorDetailValueCharacters: 256,
  defaultPageSize: 50,
  maxPageSize: 100,
  instanceIdCharacters: 64,
  releaseVersionCharacters: 64,
  /**
   * The ceiling a consumer parser applies to one advertised capability or
   * operation id. Consumers must tolerate ids they do not know (see
   * parseClientV1AdvertisedCapabilities), so "unknown" cannot mean "unbounded"
   * — without a limit, tolerance is an invitation to allocate.
   */
  declarationIdCharacters: 64
});
var CLIENT_V1_PUBLIC_ROUTES = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/client/v1/health" }),
  Object.freeze({ method: "POST", path: "/api/client/v1/pairing/requests" }),
  Object.freeze({ method: "GET", path: "/api/client/v1/pairing/requests/:id" }),
  Object.freeze({
    method: "POST",
    path: "/api/client/v1/pairing/requests/:id/exchange"
  })
]);
var CLIENT_V1_DISCOVERY_CONTRACT = freezeReadonlyObject({
  fileName: "client-v1-discovery.json",
  mode: "0600",
  version: 1,
  hpkeBoundVersion: 2
});
var CLIENT_V1_SCOPE_SET = new Set(CLIENT_V1_SCOPES);
var CLIENT_V1_CAPABILITY_SET = new Set(CLIENT_V1_CAPABILITIES);
var CLIENT_V1_OPERATION_SET = new Set(CLIENT_V1_OPERATIONS);
var CLIENT_V1_ERROR_CODE_SET = new Set(CLIENT_V1_ERROR_CODES);
var CLIENT_V1_IDENTITY_KIND_SET = new Set(CLIENT_V1_IDENTITY_KINDS);

// src/proxy-helpers.ts
var CLIENT_V1_PATH_PARAMETER = /^:[A-Za-z0-9_]+$/;
function clientV1PathPattern(path6) {
  const segments = path6.split("/").map(
    (segment) => CLIENT_V1_PATH_PARAMETER.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(`^${segments.join("/")}$`);
}
var CLIENT_V1_PUBLIC_PATHS = CLIENT_V1_PUBLIC_ROUTES.map(
  (route) => clientV1PathPattern(route.path)
);
var CLIENT_V1_AUTHENTICATED_PATHS = [
  "/api/client/v1/familiars",
  "/api/client/v1/familiars/:id/contract",
  "/api/client/v1/familiars/:id/analytics",
  "/api/client/v1/projects",
  "/api/client/v1/conversations",
  "/api/client/v1/conversations/:id",
  "/api/client/v1/conversations/:id/messages"
].map(clientV1PathPattern);

// src/lib/coven-bin.ts
import { execFile as execFile3, execFileSync } from "node:child_process";
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path4 from "node:path";

// src/lib/child-spawn-env.ts
var FORBIDDEN_SPAWN_ENV_KEYS = [
  "GITHUB_PAT",
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "NODE_OPTIONS",
  "NPM_CONFIG_NODE_OPTIONS",
  "COVEN_BIN",
  "COVEN_VAULT_FILE"
];
var SIDECAR_INTERNAL_ENV_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];
function comparableEnvKey(key, platform) {
  return platform === "win32" ? key.toUpperCase() : key;
}
function isForbiddenSpawnEnvKey(key, platform = process.platform) {
  const comparableKey = comparableEnvKey(key, platform);
  return isSidecarInternalEnvKey(key, platform) || FORBIDDEN_SPAWN_ENV_KEYS.some((forbidden) => comparableKey === forbidden);
}
function isSidecarInternalEnvKey(key, platform = process.platform) {
  const comparableKey = comparableEnvKey(key, platform);
  return SIDECAR_INTERNAL_ENV_PREFIXES.some((prefix) => comparableKey.startsWith(prefix));
}
function scrubSidecarInternalEnv(env, platform = process.platform) {
  for (const key of Object.keys(env)) {
    if (isForbiddenSpawnEnvKey(key, platform)) delete env[key];
  }
  return env;
}
function vaultFreeDiscoveryEnv(source, map, platform = process.platform) {
  const env = scrubSidecarInternalEnv({ ...source }, platform);
  const managedKeys = new Set(
    Object.keys(map).map((key) => comparableEnvKey(key, platform))
  );
  for (const key of Object.keys(env)) {
    if (managedKeys.has(comparableEnvKey(key, platform))) delete env[key];
  }
  return env;
}

// src/lib/server/managed-node-toolchain.ts
import { execFile as execFile2 } from "node:child_process";
import { homedir as homedir3 } from "node:os";
import path3 from "node:path";
import { promisify as promisify2 } from "node:util";

// src/lib/onboarding-prerequisites.ts
var MANAGED_NODE_VERSION = "24.18.0";
var NODE_BASE = `https://nodejs.org/dist/v${MANAGED_NODE_VERSION}`;
var NODE_MAX_BYTES = 128e6;
var managedNodeArtifacts = {
  "win32-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-win-x64.zip`,
    sha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821",
    maxBytes: NODE_MAX_BYTES,
    format: "zip"
  },
  "win32-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-win-arm64.zip`,
    sha256: "f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01",
    maxBytes: NODE_MAX_BYTES,
    format: "zip"
  },
  "darwin-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  },
  "darwin-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  },
  "linux-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-linux-x64.tar.gz`,
    sha256: "783130984963db7ba9cbd01089eaf2c2efb055c7c1693c943174b967b3050cb8",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  },
  "linux-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-linux-arm64.tar.gz`,
    sha256: "6b4484c2190274175df9aa8f28e2d758a819cb1c1fe6ab481e2f95b463ab8508",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz"
  }
};
var npmPackage = (packageName, version, integrity, binary) => ({ packageName, version, integrity, binary });
var PREREQUISITES = [
  {
    id: "windows-webview2",
    label: "Microsoft Edge WebView2 Runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["win32"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Re-run the signed CovenCave MSI while connected to the internet." },
    requiresPrivilege: false,
    restart: "app",
    manualRecovery: "Re-run the signed CovenCave MSI while connected to the internet."
  },
  {
    id: "macos-app-runtime",
    label: "Signed and notarized macOS app runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["darwin"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Move CovenCave to Applications and follow Gatekeeper recovery guidance." },
    requiresPrivilege: false,
    restart: "app",
    manualRecovery: "Move CovenCave to Applications and follow Gatekeeper recovery guidance."
  },
  {
    id: "linux-desktop-runtime",
    label: "Linux desktop runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["linux"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Install the documented GTK/WebKit/FUSE runtime package for this distribution, then relaunch CovenCave." },
    requiresPrivilege: true,
    restart: "app",
    manualRecovery: "Install the documented GTK/WebKit/FUSE runtime package for this distribution, then relaunch CovenCave."
  },
  {
    id: "mobile-remote-daemon",
    label: "Remote Coven daemon",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["ios", "android"],
    probe: "service",
    install: { kind: "manual", manualRecovery: "Pair this device with a reachable daemon through the guided Tailscale flow." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Pair this device with a reachable daemon through the guided Tailscale flow."
  },
  {
    id: "managed-node",
    label: "Coven-managed Node.js and npm",
    tier: "local-runtime",
    capabilities: ["local-familiar", "runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    minimumVersion: MANAGED_NODE_VERSION,
    probe: "managed-node",
    install: { kind: "managed-node", artifacts: managedNodeArtifacts },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Download the matching Node.js 24 archive from nodejs.org and contact support with the verification result."
  },
  {
    id: "coven-cli",
    label: "Coven CLI",
    tier: "local-runtime",
    capabilities: ["local-familiar"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node"],
    minimumVersion: "0.4.0",
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@opencoven/cli", "0.4.0", "sha512-pqC5xE5KbF6zUDUh1IorzbNdtFEokXN3QYrEbeenETh4XwTxLVIOq8gFsEhdUwXLYFOb+X09LSbLUUTyiJen2g==", "coven") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Run the exact documented package version with the Cave-managed Node/npm lane, then re-check."
  },
  {
    id: "runtime-codex",
    label: "Codex",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@openai/codex", "0.145.0", "sha512-/PSPSFujjjmiyVFvG2yu/grOFhsWdokTH8t2KGWhXSo/M5n/dIDsnbsnO82/7bLtIoDuzQf7ATBUMWqPWQINlQ==", "codex") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Codex manually and run codex login, then re-check."
  },
  {
    id: "runtime-claude",
    label: "Claude Code",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@anthropic-ai/claude-code", "2.1.220", "sha512-ogBrvwkqF9f8okmnXKxmRNHuvtFxFEffe5pWdqOV3iQDxlUOKirFqnyWC7NGXXnDA4WkkbPH8pvSbwyCR2Auyw==", "claude") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Claude Code manually and complete claude doctor, then re-check."
  },
  {
    id: "runtime-copilot",
    label: "GitHub Copilot CLI",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@github/copilot", "1.0.75", "sha512-rn7ZQmhydCZ9XRdG6V78QEhXIdYlChlUvOVAtyJ6KHJGt2O9/71si7PCt84amfmg0N7IXBT2UGRYF4GQDQBt+g==", "copilot") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Copilot manually and sign in, then re-check."
  },
  {
    id: "runtime-openclaw",
    label: "OpenClaw",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("openclaw", "2026.7.1-2", "sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==", "openclaw") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install OpenClaw manually and connect or create an agent, then re-check."
  },
  {
    id: "git",
    label: "Git",
    tier: "feature",
    capabilities: ["queue"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install Git through the documented platform flow." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Git through the documented platform flow."
  },
  {
    id: "ripgrep",
    label: "ripgrep",
    tier: "feature",
    capabilities: ["project-search"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install ripgrep with the documented platform package." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install ripgrep with the documented platform package."
  },
  {
    id: "github-cli",
    label: "GitHub CLI",
    tier: "feature",
    capabilities: ["github", "queue"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install GitHub CLI and sign in when GitHub operations or the Queue are enabled." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install GitHub CLI and sign in when GitHub operations or the Queue are enabled."
  },
  {
    id: "openssh",
    label: "OpenSSH client",
    tier: "feature",
    capabilities: ["remote-familiar"],
    platforms: ["win32", "darwin", "linux"],
    probe: "command",
    install: { kind: "manual", manualRecovery: "Install or enable the OpenSSH client, then configure key-based access." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install or enable the OpenSSH client, then configure key-based access."
  },
  {
    id: "tailscale",
    label: "Tailscale",
    tier: "feature",
    capabilities: ["phone-handoff"],
    platforms: ["win32", "darwin", "linux", "ios", "android"],
    probe: "service",
    install: { kind: "manual", manualRecovery: "Install Tailscale and sign in to the required tailnet." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Tailscale and sign in to the required tailnet."
  },
  {
    id: "developer-mobile-tools",
    label: "Mobile developer tools",
    tier: "feature",
    capabilities: ["developer-mobile"],
    platforms: ["win32", "darwin", "linux"],
    probe: "manual",
    install: { kind: "manual", manualRecovery: "Install the documented Xcode, Android SDK, JDK, or platform build tools for the selected development workflow." },
    requiresPrivilege: true,
    restart: "none",
    manualRecovery: "Install the documented Xcode, Android SDK, JDK, or platform build tools for the selected development workflow."
  }
];

// src/lib/server/managed-node-toolchain.ts
var execFileAsync2 = promisify2(execFile2);
var INSTALL_TIMEOUT_MS = 5 * 6e4;
function supportedPlatform(platform) {
  return platform === "win32" || platform === "darwin" || platform === "linux";
}
function supportedArchitecture(architecture) {
  return architecture === "x64" || architecture === "arm64";
}
function pathApi(platform) {
  return platform === "win32" ? path3.win32 : path3.posix;
}
function managedNodeRoot(platform = process.platform, env = process.env, home = homedir3()) {
  const paths = platform === "win32" ? path3.win32 : path3.posix;
  if (platform === "win32") {
    return paths.join(env.LOCALAPPDATA || paths.join(home, "AppData", "Local"), "OpenCoven", "CovenCave", "toolchains");
  }
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "OpenCoven", "CovenCave", "toolchains");
  return paths.join(env.XDG_DATA_HOME || paths.join(home, ".local", "share"), "opencoven", "coven-cave", "toolchains");
}
function managedNodePaths(platform = process.platform, architecture = process.arch, env = process.env, home = homedir3()) {
  if (!supportedPlatform(platform) || !supportedArchitecture(architecture)) return null;
  const pathOps = pathApi(platform);
  const root = managedNodeRoot(platform, env, home);
  const installDir = pathOps.join(root, "node", `v${MANAGED_NODE_VERSION}`, `${platform}-${architecture}`);
  const npmPrefix = pathOps.join(root, "npm");
  const node = platform === "win32" ? pathOps.join(installDir, "node.exe") : pathOps.join(installDir, "bin", "node");
  const npmCli = platform === "win32" ? pathOps.join(installDir, "node_modules", "npm", "bin", "npm-cli.js") : pathOps.join(installDir, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return {
    platform,
    root,
    stagingRoot: pathOps.join(root, "staging"),
    installDir,
    node,
    npmCli,
    npmPrefix,
    npmBin: platform === "win32" ? npmPrefix : pathOps.join(npmPrefix, "bin")
  };
}
function managedNodeSpawnEnv(base, paths = managedNodePaths()) {
  if (!paths) return null;
  const pathOps = pathApi(paths.platform);
  const nodeBin = pathOps.dirname(paths.node);
  const basePath = base.PATH ?? (paths.platform === "win32" ? Object.entries(base).find(([key]) => key.toUpperCase() === "PATH")?.[1] : void 0);
  const parts = [paths.npmBin, nodeBin, basePath].filter(Boolean);
  const env = { ...base };
  if (paths.platform === "win32") {
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH") delete env[key];
    }
  }
  return {
    ...env,
    PATH: parts.join(paths.platform === "win32" ? ";" : ":"),
    NPM_CONFIG_PREFIX: paths.npmPrefix,
    npm_config_prefix: paths.npmPrefix
  };
}

// src/lib/vault.ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
var import_yaml = __toESM(require_dist(), 1);
import { delimiter, dirname, join as join3 } from "node:path";

// src/lib/local-encrypted-vault.ts
import { DatabaseSync } from "node:sqlite";

// src/lib/vault.ts
function isBundle() {
  return process.env.COVEN_CAVE_BUNDLE === "1";
}
function vaultYamlPath() {
  const override = process.env.COVEN_VAULT_FILE?.trim();
  if (override) return override;
  if (isBundle()) return join3(
    /* turbopackIgnore: true */
    caveHome(),
    "vault.yaml"
  );
  return join3(
    /* turbopackIgnore: true */
    process.cwd(),
    "vault.yaml"
  );
}
var _vaultMap = null;
function readVaultMap(strict) {
  const vaultYaml = vaultYamlPath();
  if (!existsSync(
    /* turbopackIgnore: true */
    vaultYaml
  )) return {};
  try {
    const raw = readFileSync(
      /* turbopackIgnore: true */
      vaultYaml,
      "utf8"
    );
    const parsed = (0, import_yaml.parse)(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some(
      (entry) => !entry || typeof entry !== "object" || Array.isArray(entry)
    )) {
      throw new Error("invalid Vault metadata shape");
    }
    return parsed;
  } catch {
    if (strict) {
      throw new Error("Vault metadata is invalid; repair vault.yaml before saving changes");
    }
    return {};
  }
}
function loadVaultMap(force = false) {
  if (_vaultMap && !force) return _vaultMap;
  _vaultMap = readVaultMap(false);
  return _vaultMap;
}

// src/lib/coven-bin.ts
var SPAWN_PATH_STATE = /* @__PURE__ */ Symbol.for("opencoven.cave.spawnPathState");
var pathState = globalThis[SPAWN_PATH_STATE] ??= { cachedPath: null, cachedToolPath: null, pendingPathDiscovery: null, discoveryGeneration: 0 };
function discoveryOptions(options = {}) {
  return {
    env: options.discoveryEnv ?? vaultFreeDiscoveryEnv(process.env, loadVaultMap(true)),
    deadline: options.discoveryDeadline,
    now: options.now ?? Date.now
  };
}
function remainingDiscoveryTimeout(maximum, deadline, now) {
  if (deadline === void 0) return maximum;
  return Math.min(maximum, deadline - now());
}
var HOME = os.homedir();
var execFileProbeAsync = (command, args, options) => new Promise((resolve3, reject) => {
  execFile3(
    /* turbopackIgnore: true */
    command,
    args,
    {
      timeout: options.timeout,
      // Literal on purpose: the Windows console-window scanner reads source text.
      windowsHide: true,
      env: options.env,
      shell: options.shell
    },
    (error) => error ? reject(error) : resolve3(void 0)
  );
});
async function runnableNodeToolchainDirsAsync(directories, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const exists = dependencies.exists ?? existsSync2;
  const probe = dependencies.probe ?? execFileProbeAsync;
  const sourceEnv = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const verdicts = await Promise.all(
    directories.map(async (directory) => {
      const context = toolchainProbeContext(directory, { platform, exists, sourceEnv });
      if (!context) return false;
      const { node, npm, env, npmNeedsShell } = context;
      try {
        const nodeTimeout = remainingDiscoveryTimeout(1500, dependencies.deadline, now);
        if (nodeTimeout <= 0) return false;
        await probe(node, ["--version"], {
          timeout: nodeTimeout,
          stdio: "ignore",
          windowsHide: true,
          env
        });
        const npmTimeout = remainingDiscoveryTimeout(1500, dependencies.deadline, now);
        if (npmTimeout <= 0) return false;
        await probe(npm, ["--version"], {
          timeout: npmTimeout,
          stdio: "ignore",
          windowsHide: true,
          env,
          shell: npmNeedsShell
        });
        return remainingDiscoveryTimeout(
          Number.POSITIVE_INFINITY,
          dependencies.deadline,
          now
        ) > 0;
      } catch {
        return false;
      }
    })
  );
  return directories.filter((_, index) => verdicts[index]);
}
function toolchainProbeContext(directory, dependencies) {
  const { platform, exists, sourceEnv } = dependencies;
  const nodeName = platform === "win32" ? "node.exe" : "node";
  const npmNames = platform === "win32" ? ["npm.cmd", "npm.exe", "npm"] : ["npm"];
  const node = path4.join(
    /* turbopackIgnore: true */
    directory,
    nodeName
  );
  const npmName = npmNames.find((name) => exists(path4.join(
    /* turbopackIgnore: true */
    directory,
    name
  )));
  if (!exists(node) || !npmName) return null;
  const npm = path4.join(
    /* turbopackIgnore: true */
    directory,
    npmName
  );
  const env = scrubSidecarInternalEnv(
    withSearchPath(
      sourceEnv,
      [
        directory,
        environmentValue(sourceEnv, "PATH", platform)
      ].filter(Boolean).join(path4.delimiter),
      platform
    ),
    platform
  );
  return { node, npm, env, npmNeedsShell: platform === "win32" && /\.(cmd|bat)$/i.test(npm) };
}
function versionManagerBinDirs(root, segments) {
  if (!existsSync2(
    /* turbopackIgnore: true */
    root
  )) return [];
  try {
    return readdirSync(
      /* turbopackIgnore: true */
      root
    ).map((v) => path4.join(
      /* turbopackIgnore: true */
      root,
      v,
      ...segments
    )).filter((d) => existsSync2(
      /* turbopackIgnore: true */
      d
    )).sort().reverse();
  } catch {
    return [];
  }
}
var NVM_ROOT = path4.join(
  /* turbopackIgnore: true */
  HOME,
  ".nvm",
  "versions",
  "node"
);
var FNM_ROOT = path4.join(
  /* turbopackIgnore: true */
  HOME,
  ".fnm",
  "node-versions"
);
function nodeNvmBinDirsAsync(discovery) {
  const directories = versionManagerBinDirs(NVM_ROOT, ["bin"]);
  if (directories.length === 0) return Promise.resolve([]);
  return runnableNodeToolchainDirsAsync(directories, {
    env: discovery.env,
    deadline: discovery.deadline,
    now: discovery.now
  });
}
function fnmBinDirsAsync(discovery) {
  const directories = versionManagerBinDirs(FNM_ROOT, ["installation", "bin"]);
  if (directories.length === 0) return Promise.resolve([]);
  return runnableNodeToolchainDirsAsync(directories, {
    env: discovery.env,
    deadline: discovery.deadline,
    now: discovery.now
  });
}
function windowsNpmBinDirs(discovery) {
  if (process.platform === "win32") {
    const dirs = [
      discovery.env.APPDATA ? path4.join(
        /* turbopackIgnore: true */
        discovery.env.APPDATA,
        "npm"
      ) : null,
      discovery.env.npm_config_prefix ?? null
    ].filter((d) => !!d && existsSync2(
      /* turbopackIgnore: true */
      d
    ));
    return Array.from(new Set(dirs));
  }
  return [];
}
async function candidateDirsAsync(discovery) {
  const [nvm, fnm] = await Promise.all([
    nodeNvmBinDirsAsync(discovery),
    fnmBinDirsAsync(discovery)
  ]);
  return assembleCandidateDirs(nvm, fnm, discovery);
}
function assembleCandidateDirs(nvmDirs, fnmDirs, discovery) {
  const managed = managedNodePaths();
  return [
    // Cave's verified user-scoped Node/npm lane precedes opportunistic host
    // managers. It never edits system PATH; this only affects Cave children.
    managed?.npmBin,
    managed ? path4.dirname(managed.node) : null,
    ...nvmDirs,
    ...fnmDirs,
    ...windowsNpmBinDirs(discovery),
    path4.join(
      /* turbopackIgnore: true */
      HOME,
      "Library",
      "pnpm"
    ),
    path4.join(
      /* turbopackIgnore: true */
      HOME,
      ".bun",
      "bin"
    ),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path4.join(
      /* turbopackIgnore: true */
      HOME,
      ".local",
      "bin"
    ),
    // Grok Build's official installer uses ~/.grok/bin on macOS, Linux, and
    // Windows. A desktop app can start without the user's shell PATH, so keep
    // the direct runtime discoverable even when the installer could not add
    // its symlink or profile entry.
    path4.join(
      /* turbopackIgnore: true */
      HOME,
      ".grok",
      "bin"
    ),
    // ~/.cargo/bin last: often holds a stale `cargo install` of coven that's
    // missing flags. Prefer the npm-published binary when both exist.
    path4.join(
      /* turbopackIgnore: true */
      HOME,
      ".cargo",
      "bin"
    )
  ].filter((d) => !!d && existsSync2(
    /* turbopackIgnore: true */
    d
  ));
}
function loginShellPathAsync(discovery) {
  if (process.platform === "win32") return Promise.resolve(null);
  const env = discovery.env;
  const shell = env["SHELL"] ?? ["/bin", "zsh"].join("/");
  const timeout = remainingDiscoveryTimeout(4e3, discovery.deadline, discovery.now);
  if (timeout <= 0) return Promise.resolve(null);
  return new Promise((resolve3) => {
    execFile3(
      /* turbopackIgnore: true */
      shell,
      ["-ilc", "echo $PATH"],
      { windowsHide: true, encoding: "utf-8", timeout, env: discovery.env },
      (error, stdout) => {
        if (error) {
          resolve3(null);
          return;
        }
        const out = String(stdout).trim();
        resolve3(out || null);
      }
    );
  });
}
function windowsPathFromRegQuery(output, env = process.env) {
  const match = /^\s*Path\s+(REG_SZ|REG_EXPAND_SZ)\s+(.+)$/im.exec(output);
  const type = match?.[1];
  const value = match?.[2]?.trim();
  if (!type || !value) return null;
  if (type.toUpperCase() !== "REG_EXPAND_SZ") return value;
  const lookup = new Map(
    Object.entries(env).map(([key, val]) => [key.toUpperCase(), val])
  );
  return value.replace(
    /%([^%;=]+)%/g,
    (whole, name) => lookup.get(name.toUpperCase()) ?? whole
  );
}
function windowsRegistryPath(discovery) {
  const systemRoot = discovery.env.SystemRoot ?? Object.entries(discovery.env).find(
    ([key]) => key.toUpperCase() === "SYSTEMROOT"
  )?.[1];
  const regExecutable = systemRoot ? path4.join(
    /* turbopackIgnore: true */
    systemRoot,
    "System32",
    "reg.exe"
  ) : null;
  if (!regExecutable || !path4.isAbsolute(regExecutable) || !existsSync2(regExecutable)) {
    return null;
  }
  const keys = [
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    "HKCU\\Environment"
  ];
  const parts = [];
  for (const key of keys) {
    const timeout = remainingDiscoveryTimeout(2e3, discovery.deadline, discovery.now);
    if (timeout <= 0) break;
    try {
      const out = execFileSync(regExecutable, ["query", key, "/v", "Path"], {
        windowsHide: true,
        encoding: "utf-8",
        timeout,
        env: discovery.env
      });
      const value = windowsPathFromRegQuery(out, discovery.env);
      if (value) parts.push(value);
    } catch {
    }
  }
  return parts.length > 0 ? parts.join(path4.delimiter) : null;
}
function environmentValue(env, key, platform) {
  if (platform !== "win32") return env[key];
  const wanted = key.toUpperCase();
  return Object.entries(env).find(([name]) => name.toUpperCase() === wanted)?.[1];
}
function withSearchPath(env, pathValue, platform = process.platform) {
  const next2 = { ...env };
  if (platform !== "win32") {
    next2.PATH = pathValue;
    return next2;
  }
  let key = null;
  for (const name of Object.keys(next2)) {
    if (name.toUpperCase() !== "PATH") continue;
    if (key === null) key = name;
    else delete next2[name];
  }
  next2[key ?? "PATH"] = pathValue;
  return next2;
}
function covenAdapterDirsEnvValue(existing, covenHome2) {
  const home = covenHome2?.trim() || path4.join(
    /* turbopackIgnore: true */
    HOME,
    ".coven"
  );
  const adaptersDir = path4.join(
    /* turbopackIgnore: true */
    home,
    "adapters"
  );
  const dirs = (existing ?? "").split(path4.delimiter).filter(Boolean);
  if (dirs.includes(adaptersDir)) return dirs.join(path4.delimiter);
  return [...dirs, adaptersDir].join(path4.delimiter);
}
async function augmentedSpawnPathAsync(preferLaunchPath, discovery) {
  const [fromSystem, candidates] = await Promise.all([
    process.platform === "win32" ? Promise.resolve(windowsRegistryPath(discovery)) : loginShellPathAsync(discovery),
    candidateDirsAsync(discovery)
  ]);
  return composeSpawnPath(fromSystem, candidates, preferLaunchPath, discovery);
}
function composeSpawnPath(fromSystem, candidates, preferLaunchPath, discovery) {
  const launchPathValue = discovery.env.PATH ?? Object.entries(discovery.env).find(
    ([key]) => key.toUpperCase() === "PATH"
  )?.[1];
  const launchPath = launchPathValue ? launchPathValue.split(path4.delimiter) : [];
  const systemPath = fromSystem ? fromSystem.split(path4.delimiter) : [];
  const parts = preferLaunchPath ? [...launchPath, ...systemPath, ...candidates] : [...candidates, ...systemPath, ...launchPath];
  const seen = /* @__PURE__ */ new Set();
  return parts.filter((part) => !!part && !seen.has(part) && (seen.add(part), true)).join(path4.delimiter);
}
var COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV = "COVEN_WINDOWS_HIDE_NATIVE_WINDOW";
function withCovenWrapperWindowPolicy(env, platform = process.platform, appOwnedCovenLaunch = true) {
  const next2 = { ...env };
  for (const key of Object.keys(next2)) {
    if ((platform === "win32" ? key.toUpperCase() : key) === COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV) {
      delete next2[key];
    }
  }
  if (appOwnedCovenLaunch && platform === "win32") {
    next2[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV] = "1";
  }
  return next2;
}
function spawnEnv(pathValue, includeManagedNode = true) {
  let env = withSearchPath(process.env, pathValue);
  if (includeManagedNode) {
    const managed = managedNodeSpawnEnv(env);
    if (managed) {
      env = withSearchPath({ ...env, ...managed }, managed.PATH ?? pathValue);
    }
  }
  env.COVEN_HARNESS_ADAPTER_DIRS = covenAdapterDirsEnvValue(
    process.env.COVEN_HARNESS_ADAPTER_DIRS,
    covenHomePath(process.env, HOME, process.platform)
  );
  if (env.NPM_CONFIG_LOGLEVEL === void 0 && env.npm_config_loglevel === void 0) {
    env.NPM_CONFIG_LOGLEVEL = "error";
  }
  return withCovenWrapperWindowPolicy(
    scrubSidecarInternalEnv(env),
    process.platform,
    false
  );
}
async function covenSpawnEnvAsync(options = {}) {
  if (pathState.cachedPath !== null) return spawnEnv(pathState.cachedPath);
  const shareable = options.discoveryEnv === void 0 && options.discoveryDeadline === void 0 && options.now === void 0;
  let pending = shareable ? pathState.pendingPathDiscovery : null;
  if (pending === null) {
    const discovery = discoveryOptions(options);
    const generation = pathState.discoveryGeneration;
    const started = augmentedSpawnPathAsync(false, discovery).then((pathValue) => {
      const fresh = discovery.deadline === void 0 || discovery.now() < discovery.deadline;
      if (fresh && generation === pathState.discoveryGeneration && pathState.cachedPath === null) {
        pathState.cachedPath = pathValue;
      }
      return pathValue;
    }).finally(() => {
      if (pathState.pendingPathDiscovery === started) pathState.pendingPathDiscovery = null;
    });
    if (shareable) pathState.pendingPathDiscovery = started;
    pending = started;
  }
  return spawnEnv(await pending);
}

// src/lib/mobile-token-refresh.ts
var MOBILE_APP_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1e3;

// src/lib/secret-redaction.ts
var MAX_REDACTION_STRING_BYTES = 256 * 1024;

// src/lib/process-execution.ts
var TRUNCATION_MARKER = "[earlier output truncated]\n";
var TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER);
var REDACTION_CONTEXT_BYTES = 4 * 1024;

// src/lib/mobile-handoff.ts
var MOBILE_INVITE_TTL_MS = 8 * 60 * 60 * 1e3;
var TAILSCALE_APP_DIR = "/Applications/Tailscale.app/Contents/MacOS";
var DEFAULT_TAILSCALE_PATHS = [
  path5.join(TAILSCALE_APP_DIR, "tailscale"),
  path5.join(TAILSCALE_APP_DIR, "Tailscale"),
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
  "/bin/tailscale"
];
var cachedTailscaleBin = null;
var cachedTailscalePath = null;
function executableExists(candidate) {
  try {
    const st = statSync2(candidate);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}
function loginShellPath() {
  if (process.platform === "win32") return null;
  const env = process.env;
  const shell = env["SHELL"] ?? ["/bin", "zsh"].join("/");
  try {
    const out = execFileSync2(shell, ["-ilc", "echo $PATH"], {
      windowsHide: true,
      encoding: "utf-8",
      timeout: 4e3
    });
    const lastLine = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1);
    return lastLine || null;
  } catch {
    return null;
  }
}
function pathCandidates(pathEnv) {
  if (!pathEnv) return [];
  return pathEnv.split(path5.delimiter).filter(Boolean).map((dir) => path5.join(dir, "tailscale"));
}
function resolveTailscaleBin({
  envBin = process.env.TAILSCALE_BIN,
  pathEnv = process.env.PATH,
  exists = executableExists,
  candidatePaths = DEFAULT_TAILSCALE_PATHS
} = {}) {
  if (envBin && exists(envBin)) return envBin;
  for (const candidate of [...candidatePaths, ...pathCandidates(pathEnv)]) {
    if (exists(candidate)) return candidate;
  }
  return "tailscale";
}
function tailscaleBin() {
  if (!cachedTailscaleBin) cachedTailscaleBin = resolveTailscaleBin();
  return cachedTailscaleBin;
}
function tailscaleSpawnEnv() {
  if (cachedTailscalePath === null) {
    const delimiter2 = path5.delimiter;
    const fromShell = loginShellPath();
    const parts = [
      TAILSCALE_APP_DIR,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      ...fromShell ? fromShell.split(delimiter2) : [],
      ...process.env.PATH ? process.env.PATH.split(delimiter2) : []
    ];
    const seen = /* @__PURE__ */ new Set();
    const dedup = [];
    for (const p of parts) {
      if (!p || seen.has(p) || !existsSync3(p)) continue;
      seen.add(p);
      dedup.push(p);
    }
    const joined = dedup.join(delimiter2);
    cachedTailscalePath = joined || process.env.PATH || "";
  }
  const term = process.env.TERM?.trim() ? process.env.TERM : "dumb";
  return scrubSidecarInternalEnv({ ...process.env, PATH: cachedTailscalePath, TERM: term });
}

// src/lib/server/device-access/peers.ts
var exec = promisify3(execFile4);
var DEVICE_PEER_REFRESH_MS = 1e4;
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function identifier(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return text2(value);
}
function tailnetFromDnsName(value) {
  const name = text2(value)?.toLowerCase().replace(/\.$/, "");
  if (!name || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$/.test(name)) {
    return null;
  }
  return name.slice(name.indexOf(".") + 1);
}
function parseDevicePeerInventory(value, now = Date.now()) {
  const status = record(value);
  const self = record(status?.Self);
  const host = text2(self?.DNSName)?.toLowerCase().replace(/\.$/, "");
  const tailnet2 = tailnetFromDnsName(host);
  if (status?.BackendState !== "Running" || !host || !tailnet2) {
    throw new Error("Tailscale must be running with a verified MagicDNS identity.");
  }
  const users = record(status.User);
  const peers = /* @__PURE__ */ new Map();
  for (const raw of Object.values(record(status.Peer) ?? {})) {
    const peer = record(raw);
    const nodeId = text2(peer?.ID);
    const userId = identifier(peer?.UserID);
    const loginName = userId ? text2(record(users?.[userId])?.LoginName) : null;
    const peerTailnet = tailnetFromDnsName(peer?.DNSName);
    const expiry = text2(peer?.KeyExpiry);
    if (!peer || !nodeId || !userId || !loginName || !peerTailnet || peer.Expired === true || Array.isArray(peer.Tags) && peer.Tags.length > 0 || expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now)) continue;
    const identity = {
      nodeId,
      userId,
      loginName,
      tailnet: peerTailnet,
      deviceName: text2(peer.HostName) ?? text2(peer.DNSName) ?? nodeId
    };
    for (const ip of Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : []) {
      if (typeof ip !== "string" || !isIP(ip)) continue;
      if (peers.has(ip)) throw new Error("Tailscale reported an ambiguous device address.");
      peers.set(ip, identity);
    }
  }
  return { host, tailnet: tailnet2, peers };
}
function resolveDevicePeer(req, inventory) {
  const remote = req.socket.remoteAddress;
  if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return null;
  if (req.headers["tailscale-funnel-request"] !== void 0 || req.headers["x-forwarded-proto"] !== "https") return null;
  const address = req.headers["x-forwarded-for"];
  if (typeof address !== "string" || !isIP(address)) return null;
  const host = req.headers["x-forwarded-host"];
  if (typeof host !== "string") return null;
  let url;
  try {
    url = new URL(`https://${host}`);
  } catch {
    return null;
  }
  if (url.hostname !== inventory.host || url.username || url.password || url.pathname !== "/") return null;
  const peer = inventory.peers.get(address);
  if (!peer || req.headers["tailscale-user-login"] !== peer.loginName) return null;
  return peer;
}
function createDevicePeerResolver(load = async () => {
  const { stdout } = await exec(tailscaleBin(), ["status", "--json"], {
    encoding: "utf8",
    timeout: 5e3,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    env: tailscaleSpawnEnv()
  });
  return JSON.parse(stdout);
}, now = Date.now) {
  let cached = null;
  let validUntil = 0;
  let loading = null;
  return async () => {
    if (cached && now() < validUntil) return cached;
    if (loading) return loading;
    cached = null;
    validUntil = 0;
    loading = load().then((raw) => {
      const parsed = parseDevicePeerInventory(raw, now());
      cached = parsed;
      validUntil = now() + DEVICE_PEER_REFRESH_MS;
      return parsed;
    });
    try {
      return await loading;
    } finally {
      loading = null;
    }
  };
}

// src/lib/device-access-markers.ts
var DEVICE_GRANT_HEADER = "x-coven-cave-device-grant";
var DEVICE_PAIRING_PAGE_HEADER = "x-coven-cave-device-pairing-page";
var DEVICE_MANAGED_HEADER = "x-coven-cave-device-managed";

// src/lib/server/device-access/gateway.ts
var API = "/api/device-access";
var BODY_LIMIT = 4096;
var COOKIE_AGE = 3456e4;
function credentialCookie(res, credential) {
  res.setHeader("set-cookie", `${DEVICE_ACCESS_COOKIE}=${credential}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}`);
}
function single(req, name) {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}
function equal(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual2(a, b);
}
function suppliedCredential(req) {
  const explicit = single(req, DEVICE_ACCESS_HEADER);
  if (explicit) return explicit;
  const authorization = single(req, "authorization");
  if (authorization?.startsWith(`Bearer ${DEVICE_CREDENTIAL_PREFIX}`)) return authorization.slice(7);
  const cookie = single(req, "cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEVICE_ACCESS_COOKIE}=`));
  return cookie ? cookie.slice(DEVICE_ACCESS_COOKIE.length + 1) : null;
}
function json(res, status, body2) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body2));
}
function requireOrigin(req, direct) {
  const expected = `${direct ? "http" : "https"}://${single(req, direct ? "host" : "x-forwarded-host") ?? ""}`;
  const origin = single(req, "origin");
  const referer = single(req, "referer");
  if (origin && origin !== expected) throw new DeviceAccessError("forbidden", "Request origin does not match this desktop.", 403);
  if (referer) {
    let source;
    try {
      source = new URL(referer);
    } catch {
      throw new DeviceAccessError("forbidden", "Invalid request source.", 403);
    }
    if (source.origin !== expected) throw new DeviceAccessError("forbidden", "Request source does not match this desktop.", 403);
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !origin && !referer) {
    throw new DeviceAccessError("forbidden", "A same-origin request source is required.", 403);
  }
}
async function body(req) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(single(req, "content-type") ?? "")) {
    throw new DeviceAccessError("invalid_request", "Expected application/json.", 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > BODY_LIMIT) {
      req.resume();
      throw new DeviceAccessError("invalid_request", "Request is too large.", 413);
    }
    chunks.push(bytes);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DeviceAccessError("invalid_request", "Invalid JSON.", 400);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new DeviceAccessError("invalid_request", "Expected an object.", 400);
  }
  return result;
}
function stringField(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new DeviceAccessError("invalid_request", "A valid device identity is required.", 400);
  }
  return value.trim();
}
function createDeviceAccessGateway(options) {
  const { store } = options;
  const inventory = options.inventory ?? createDevicePeerResolver();
  const active = /* @__PURE__ */ new Map();
  const legacy = /* @__PURE__ */ new Set();
  const completionWrites = /* @__PURE__ */ new Set();
  let revalidating = false;
  let managedObserved = false;
  const actor = `desktop:${userInfo().username}`;
  function closeLegacy() {
    for (const response of legacy) response.destroy();
    legacy.clear();
    options.onPolicyChanged?.();
  }
  async function currentPolicy() {
    const policy = await store.policy();
    if (policy.enabled && !managedObserved) {
      managedObserved = true;
      closeLegacy();
    }
    return policy;
  }
  async function eligible(req) {
    const peer = resolveDevicePeer(req, await inventory());
    if (!peer) throw new DeviceAccessError("forbidden", "A verified Tailscale device is required.", 403);
    return peer;
  }
  function closeDevice(id) {
    for (const [res, session] of active) {
      if (session.device.id === id) {
        res.destroy();
      }
    }
  }
  async function revalidateActive() {
    if (revalidating) return;
    revalidating = true;
    try {
      await currentPolicy();
      for (const [res, session] of active) {
        try {
          if (await store.verify(session.credential, await eligible(session.req))) continue;
        } catch (error) {
          console.warn("[device-access] Active connection revalidation failed:", error instanceof Error ? error.message : "unavailable");
        }
        res.destroy();
      }
    } catch (error) {
      console.warn("[device-access] Policy revalidation failed:", error instanceof Error ? error.message : "unavailable");
      closeLegacy();
      for (const res of active.keys()) res.destroy();
      if (error instanceof DeviceAccessInitializationError) clearInterval(timer);
    } finally {
      revalidating = false;
    }
  }
  const timer = setInterval(() => {
    void revalidateActive();
  }, 1e3);
  timer.unref();
  async function handle2(req, res) {
    delete req.headers[DEVICE_GRANT_HEADER];
    delete req.headers[DEVICE_PAIRING_PAGE_HEADER];
    delete req.headers[DEVICE_MANAGED_HEADER];
    const direct = options.isDirectLoopback(req);
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const isApi = pathname === API || pathname.startsWith(`${API}/`);
    const isHandoff = pathname === "/api/mobile-handoff" || pathname.startsWith("/api/mobile-handoff/");
    if (direct && !isApi && !isHandoff) return false;
    try {
      const policy = await currentPolicy();
      if (policy.enabled) req.headers[DEVICE_MANAGED_HEADER] = options.stampSecret;
      if (isApi) {
        requireOrigin(req, direct);
        if (pathname === `${API}/admin` || pathname.startsWith(`${API}/admin/`)) {
          if (!direct || (options.sidecarToken ? !equal(single(req, "x-coven-cave-token"), options.sidecarToken) : options.packaged)) {
            throw new DeviceAccessError("forbidden", "Device access is managed only by this desktop.", 403);
          }
          if (pathname === `${API}/admin` && req.method === "GET") {
            const snapshot = await store.snapshot();
            let network = null;
            let networkError = null;
            try {
              const current = await inventory();
              network = { host: current.host, tailnet: current.tailnet };
            } catch (error) {
              networkError = error instanceof Error ? error.message : "Tailscale is unavailable.";
            }
            json(res, 200, { ok: true, ...snapshot, network, networkError });
            return true;
          }
          if (pathname === `${API}/admin/tailnets` && req.method === "PUT") {
            const input = await body(req);
            if (!Array.isArray(input.tailnets) || !input.tailnets.every((entry) => typeof entry === "string")) {
              throw new DeviceAccessError("invalid_request", "Expected a list of tailnets.", 400);
            }
            await store.setAllowedTailnets(input.tailnets, actor);
            await currentPolicy();
            await revalidateActive();
            json(res, 200, { ok: true });
            return true;
          }
          if (pathname === `${API}/admin/decision` && req.method === "POST") {
            const input = await body(req);
            if (input.decision !== "allowed" && input.decision !== "denied" && input.decision !== "revoked") {
              throw new DeviceAccessError("invalid_request", "Invalid device decision.", 400);
            }
            const device2 = await store.decide(stringField(input.id), input.decision, actor);
            if (device2.status !== "allowed") closeDevice(device2.id);
            json(res, 200, { ok: true, device: device2 });
            return true;
          }
          throw new DeviceAccessError("not_found", "Unknown device management operation.", 404);
        }
        const peer2 = await eligible(req);
        if (pathname === `${API}/requests` && req.method === "POST") {
          if (!policy.enabled) {
            json(res, 409, {
              ok: false,
              error: "disabled",
              message: "Desktop device approval is not enabled. Use the current desktop pairing invite."
            });
            return true;
          }
          const input = await body(req);
          const issued = await store.request(peer2, {
            installationId: stringField(input.installationId),
            label: stringField(input.label)
          });
          credentialCookie(res, issued.credential);
          json(res, 201, { ok: true, device: issued.device });
          return true;
        }
        if (pathname === `${API}/status` && req.method === "GET") {
          const credential2 = suppliedCredential(req);
          const device2 = credential2 ? await store.inspect(credential2, peer2) : null;
          if (!device2) throw new DeviceAccessError("forbidden", "Device pairing is required.", 403);
          json(res, 200, { ok: true, device: device2 });
          return true;
        }
        throw new DeviceAccessError("not_found", "Unknown device pairing operation.", 404);
      }
      if (direct) return false;
      if (!policy.enabled) {
        legacy.add(res);
        res.once("close", () => {
          legacy.delete(res);
        });
        return false;
      }
      res.setHeader("x-coven-device-pairing", "1");
      const peer = await eligible(req);
      if (!policy.allowedTailnets.includes(peer.tailnet)) {
        throw new DeviceAccessError("forbidden", "This tailnet is not allowed by the desktop.", 403);
      }
      if (pathname === "/connect" || pathname.startsWith("/_next/static/") || pathname === "/favicon.ico") {
        req.headers[DEVICE_PAIRING_PAGE_HEADER] = options.stampSecret;
        return false;
      }
      const credential = suppliedCredential(req);
      const device = credential ? await store.verify(credential, peer) : null;
      if (!device || !credential) {
        if (req.method === "GET" && !pathname.startsWith("/api/") && single(req, "accept")?.includes("text/html")) {
          res.writeHead(303, { location: "/connect", "cache-control": "no-store" });
          res.end();
          return true;
        }
        throw new DeviceAccessError("forbidden", "Device approval is required. Open /connect.", 403);
      }
      if (pathname.startsWith("/api/client/") || pathname.startsWith("/api/pty") || pathname.startsWith("/api/passkey/register") || pathname === "/api/mobile-handoff") {
        throw new DeviceAccessError("forbidden", "This operation requires local desktop authority.", 403);
      }
      requireOrigin(req, false);
      const requestId = randomUUID2();
      await store.recordAccess(device.id, { requestId, method: req.method ?? "GET", path: pathname, status: 0 });
      if (single(req, "cookie")?.includes(`${DEVICE_ACCESS_COOKIE}=${credential}`)) {
        credentialCookie(res, credential);
      }
      res.setHeader("x-coven-request-id", requestId);
      req.headers[DEVICE_GRANT_HEADER] = options.stampSecret;
      options.onAuthenticated?.(req, device);
      active.set(res, { req, credential, device });
      const finish = () => {
        active.delete(res);
        const write = store.recordAccess(device.id, {
          requestId,
          method: req.method ?? "GET",
          path: pathname,
          status: res.writableFinished ? res.statusCode : 499
        }).catch((error) => {
          console.error("[device-access] Could not persist request completion:", error instanceof Error ? error.message : "unavailable");
        });
        completionWrites.add(write);
        void write.finally(() => {
          completionWrites.delete(write);
        });
      };
      res.once("close", finish);
      return false;
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : void 0);
      } else if (error instanceof DeviceAccessError) {
        json(res, error.status, { ok: false, error: error.code, message: error.message });
      } else {
        console.error("[device-access] Request refused:", error instanceof Error ? error.message : "unavailable");
        json(res, 503, { ok: false, error: "unavailable", message: "Device access could not be verified." });
      }
      return true;
    }
  }
  return {
    handle: handle2,
    async blocksUpgrade(req) {
      return !options.isDirectLoopback(req) && (await currentPolicy()).enabled;
    },
    async close() {
      clearInterval(timer);
      const closing = [...active.keys()].map((res) => new Promise((resolve3) => {
        res.once("close", resolve3);
        res.destroy();
      }));
      for (const res of legacy) res.destroy();
      await Promise.all(closing);
      await Promise.all(completionWrites);
      active.clear();
      legacy.clear();
    }
  };
}

// src/lib/server/device-access/deferred.ts
function deferDeviceAccessStore(initialize, { warn = console.warn } = {}) {
  let ready = null;
  let failed = null;
  const settled = initialize().then(
    (store2) => {
      ready = store2;
    },
    (error) => {
      failed = error instanceof Error ? error : new Error(String(error));
      warn(
        `[device-access] unavailable \u2014 the server is running and device access is refused. Remote access, pairing, approvals and device credentials will not work until this is fixed: ${failed.message}`
      );
    }
  );
  const live = () => {
    if (ready) return ready;
    throw new DeviceAccessInitializationError(
      failed ? `Device access is unavailable on this host: ${failed.message}` : "Device access is unavailable on this host."
    );
  };
  const store = {
    async policy() {
      await settled;
      return live().policy();
    },
    async snapshot() {
      await settled;
      return live().snapshot();
    },
    async setAllowedTailnets(tailnets, actor) {
      await settled;
      return live().setAllowedTailnets(tailnets, actor);
    },
    async request(peer, input) {
      await settled;
      return live().request(peer, input);
    },
    async inspect(credential, peer) {
      await settled;
      return live().inspect(credential, peer);
    },
    async verify(credential, peer) {
      await settled;
      return live().verify(credential, peer);
    },
    async decide(id, decision, actor) {
      await settled;
      return live().decide(id, decision, actor);
    },
    async recordAccess(deviceId, input) {
      await settled;
      return live().recordAccess(deviceId, input);
    },
    close() {
      if (ready) ready.close();
    }
  };
  return { store, settled, failure: () => failed };
}

// src/lib/github-token-env.ts
var GITHUB_TOKEN_ENV_KEYS = [
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN"
];
var GITHUB_HARNESS_TOKEN_ENV_KEYS = [
  "GITHUB_PAT",
  ...GITHUB_TOKEN_ENV_KEYS
];

// src/lib/harness-spawn-env.ts
var WARM_UP_STATE = /* @__PURE__ */ Symbol.for("opencoven.cave.spawnPathWarmUp");
var warmUpState = globalThis[WARM_UP_STATE] ??= { inFlight: null };
function warmHarnessSpawnPath(dependencies = {}) {
  warmUpState.inFlight ??= (async () => {
    try {
      const map = (dependencies.loadMap ?? (() => loadVaultMap(true)))();
      await (dependencies.spawnEnvAsync ?? covenSpawnEnvAsync)({
        discoveryEnv: vaultFreeDiscoveryEnv(dependencies.sourceEnv ?? process.env, map)
      });
    } catch {
    }
  })().finally(() => {
    warmUpState.inFlight = null;
  });
  return warmUpState.inFlight;
}

// server.ts
var require2 = createRequire(import.meta.url);
var pty = require2("node-pty");
var execFileAsync3 = promisify4(execFile5);
if (process.env.COVEN_CAVE_BUNDLE === "1" && !process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
  try {
    const requiredServerFiles = JSON.parse(
      readFileSync3(new URL(".next/required-server-files.json", import.meta.url), "utf8")
    );
    if (requiredServerFiles.config) {
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);
    }
  } catch {
  }
}
var CAVE_DEV_PORT = 3e3;
var CAVE_PRODUCTION_PORT = 3020;
function parseCavePort(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}
function cavePort() {
  const channelDefault = process.env.COVEN_CAVE_BUNDLE === "1" ? CAVE_PRODUCTION_PORT : CAVE_DEV_PORT;
  return parseCavePort(process.env.COVEN_CAVE_PORT) ?? parseCavePort(process.env.PORT) ?? channelDefault;
}
function persistedMobileAccessSecretFile() {
  const port2 = String(cavePort());
  const stateRoot = process.env.COVEN_CAVE_MOBILE_STATE_ROOT?.trim() || join4(
    process.env.XDG_STATE_HOME?.trim() || join4(homedir4(), ".local", "state"),
    "coven-cave"
  );
  const stateDir = process.env.COVEN_CAVE_MOBILE_STATE_DIR?.trim() || join4(stateRoot, `mobile-tailscale-${port2}`);
  return join4(stateDir, "access-token");
}
if (process.env.COVEN_CAVE_BUNDLE !== "1" && process.env.COVEN_CAVE_E2E !== "1" && !process.env.COVEN_CAVE_ACCESS_TOKEN?.trim()) {
  try {
    const file = persistedMobileAccessSecretFile();
    const stats = lstatSync(file);
    if (stats.isSymbolicLink()) throw new Error("the persisted mobile access secret must not be a symbolic link");
    if (typeof process.getuid === "function") {
      if (stats.uid !== process.getuid()) throw new Error("the persisted mobile access secret must be owned by the current user");
      if ((stats.mode & 18) !== 0) throw new Error("the persisted mobile access secret must not be writable by group or others");
    } else {
      console.warn(
        "[cave] boot re-arm reads the persisted mobile access secret without an ownership check on " + process.platform + "; the pairing route re-verifies it with the async guard (cave-8pd39)."
      );
    }
    const persisted = readFileSync3(file, "utf8").trim();
    if (persisted) process.env.COVEN_CAVE_ACCESS_TOKEN = persisted;
  } catch {
  }
}
function accessToken() {
  return process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
}
var SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN ?? "";
var CLIENT_V1_DISCOVERY_FILE = "client-v1-discovery.json";
var CLIENT_V1_DISCOVERY_STARTED_AT = (/* @__PURE__ */ new Date()).toISOString();
var CLIENT_V1_AUTHORITY_MODE_ENV = "COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE";
function parseStandaloneClientV1AuthorityMode(raw) {
  const value = raw?.trim() || "off";
  if (value === "off" || value === "advertise" || value === "enforce") {
    return value;
  }
  throw new Error(
    `${CLIENT_V1_AUTHORITY_MODE_ENV} must be off, advertise, or enforce.`
  );
}
function standaloneClientV1HpkeKeyId(publicKey) {
  if (publicKey.byteLength !== 32) {
    throw new Error("Client v1 authority public key length is invalid.");
  }
  return new Uint8Array(
    createHash2("sha256").update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8").update(publicKey).digest()
  );
}
async function createStandaloneClientV1AuthorityBootstrap(mode) {
  const [
    { Aes256Gcm, CipherSuite, HkdfSha256 },
    { DhkemX25519HkdfSha256 }
  ] = await Promise.all([
    import("@hpke/core"),
    import("@hpke/dhkem-x25519")
  ]);
  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm()
  });
  const keyPair = await suite.kem.generateKeyPair();
  const publicKey = new Uint8Array(
    await suite.kem.serializePublicKey(keyPair.publicKey)
  );
  return {
    mode,
    suite,
    keyPair,
    publicKey,
    keyId: standaloneClientV1HpkeKeyId(publicKey),
    runtimeNonce: randomBytes2(32)
  };
}
var CLIENT_V1_AUTHORITY_MODE = parseStandaloneClientV1AuthorityMode(
  process.env.COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE
);
var clientV1AuthorityInitializationError = null;
var CLIENT_V1_AUTHORITY_BOOTSTRAP;
if (CLIENT_V1_AUTHORITY_MODE !== "off") {
  try {
    CLIENT_V1_AUTHORITY_BOOTSTRAP = await createStandaloneClientV1AuthorityBootstrap(
      CLIENT_V1_AUTHORITY_MODE
    );
  } catch {
    clientV1AuthorityInitializationError = new Error(
      "Client v1 HPKE authority initialization failed."
    );
    CLIENT_V1_AUTHORITY_BOOTSTRAP = {
      mode: CLIENT_V1_AUTHORITY_MODE,
      unavailable: true
    };
  }
}
globalThis.__covenCaveClientV1AuthorityBootstrap = CLIENT_V1_AUTHORITY_BOOTSTRAP;
var CLIENT_V1_DISCOVERY_NONCE = CLIENT_V1_AUTHORITY_BOOTSTRAP && !("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP) ? Buffer.from(
  CLIENT_V1_AUTHORITY_BOOTSTRAP.runtimeNonce
).toString("base64url") : randomUUID3();
var clientV1DiscoveryPublished = false;
var clientV1DiscoveryEndpoint = "";
function standaloneCaveHome() {
  const covenHome2 = process.env.COVEN_HOME || join4(homedir4(), ".coven");
  return resolve2(process.env.COVEN_CAVE_HOME || join4(covenHome2, "cave"));
}
function clientV1DiscoveryFile() {
  return join4(standaloneCaveHome(), CLIENT_V1_DISCOVERY_FILE);
}
var WINDOWS_SYSTEM_SID2 = "S-1-5-18";
var WINDOWS_ADMINISTRATORS_SID2 = "S-1-5-32-544";
var WINDOWS_OWNER_RIGHTS_SID2 = "S-1-3-4";
var WINDOWS_WRITABLE_RIGHTS_MASK2 = 1343029590;
var WINDOWS_ACL_PROBE_TIMEOUT_MS2 = 12e3;
var WINDOWS_ACL_PROBE_MAX_ATTEMPTS2 = 2;
var WINDOWS_ACL_PUBLICATION_BUDGET_MS = 24e3;
var UNVERIFIED_OWNERSHIP_ENV2 = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
var UNVERIFIED_OWNERSHIP_REASON_ENV2 = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
var UNVERIFIED_OWNERSHIP_TOKEN2 = "i-accept-unverified-path-ownership";
var UNVERIFIED_OWNERSHIP_MIN_REASON2 = 12;
function resolveUnverifiedOwnershipWaiver2(env) {
  const requested = env[UNVERIFIED_OWNERSHIP_ENV2]?.trim() ?? "";
  if (!requested) {
    return {
      granted: false,
      note: `If the DACL genuinely cannot be read on this host \u2014 PowerShell in Constrained Language Mode, or no powershell.exe under %SystemRoot% \u2014 set ${UNVERIFIED_OWNERSHIP_ENV2}=${UNVERIFIED_OWNERSHIP_TOKEN2} and ${UNVERIFIED_OWNERSHIP_REASON_ENV2} to a sentence naming who accepted that and why. It waives only an unreadable DACL, never one that was read and found shared.`
    };
  }
  if (requested !== UNVERIFIED_OWNERSHIP_TOKEN2) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV2} is set, but not to the waiver: the only accepted value is the exact string ${UNVERIFIED_OWNERSHIP_TOKEN2}. A boolean-shaped value ("1", "true", "yes") never waives this check.`
    };
  }
  const reason = env[UNVERIFIED_OWNERSHIP_REASON_ENV2]?.trim() ?? "";
  if (reason.length < UNVERIFIED_OWNERSHIP_MIN_REASON2) {
    return {
      granted: false,
      note: `${UNVERIFIED_OWNERSHIP_ENV2} is set, but ${UNVERIFIED_OWNERSHIP_REASON_ENV2} must carry at least ${UNVERIFIED_OWNERSHIP_MIN_REASON2} characters naming who accepted an unverified path and why. The waiver stays closed without that attribution.`
    };
  }
  return { granted: true, reason };
}
function unverifiableOwnershipRefusal2(subject, path6, cause, note) {
  return `${subject} ownership could not be verified on Windows: ${cause.message}. Refusing ${path6}; inspect it with: icacls "${path6}". ${note}`;
}
function unverifiedOwnershipDisclosure2(subject, path6, cause, reason) {
  return `SECURITY WAIVER \u2014 ${subject} is being used UNVERIFIED. Its DACL could not be read on this host (${cause.message}), and ${UNVERIFIED_OWNERSHIP_ENV2} is set, so ${path6} is trusted on the operator's word alone: reason given \u2014 ${reason}. Any principal that can write ${path6} can mint credentials or point a paired client at another server. Unset ${UNVERIFIED_OWNERSHIP_ENV2} to restore the check.`;
}
function sharedOwnershipRefusal2(subject, path6, findings, waiver) {
  return `${subject} is not exclusive to the current user: ${findings.join("; ")}. Refusing ${path6}; inspect it with: icacls "${path6}"` + (waiver.granted ? `. ${UNVERIFIED_OWNERSHIP_ENV2} does not cover a DACL that was read: this one was, and it is shared. Repair it with: icacls "${path6}" /reset` : "");
}
var WINDOWS_ACL_SCRIPT2 = `
$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('acl-probe:start')
# Cmdlets are off limits in this script. Whichever cmdlet came first (the
# provider item lookup in one release, the object constructor in the next)
# never returned in the stripped probe environment: command discovery is what
# stalls, not the work. Direct .NET member calls, language keywords and
# operators do not wait on it.
$path = $env:COVEN_CAVE_CLIENT_V1_ACL_PATH
$isDirectory = [System.IO.Directory]::Exists($path)
if ($isDirectory) {
  $item = [System.IO.DirectoryInfo]::new($path)
} elseif ([System.IO.File]::Exists($path)) {
  $item = [System.IO.FileInfo]::new($path)
} else {
  throw 'ACL path does not exist.'
}
[Console]::Error.WriteLine('acl-probe:item')
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_SYSTEM_SID2}')
$admins = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_ADMINISTRATORS_SID2}')
$ownerRights = [System.Security.Principal.SecurityIdentifier]::new('${WINDOWS_OWNER_RIGHTS_SID2}')
$writableRights = [uint32]${WINDOWS_WRITABLE_RIGHTS_MASK2}
$trusted = @($me.Value, $system.Value, $admins.Value)
[Console]::Error.WriteLine('acl-probe:identity')

function Read-State {
  param($target)
  [Console]::Error.WriteLine('acl-probe:read-state')
  $acl = $target.GetAccessControl('Access,Owner')
  [Console]::Error.WriteLine('acl-probe:acl')
  # Keep account-name lookup out of the security boundary: orphaned or remote
  # principals can make IdentityReference.Translate block on Windows.
  $aces = @()
  foreach ($entry in @($acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  ))) {
    $aces += [pscustomobject]@{
      sid = $entry.IdentityReference.Value
      type = [string]$entry.AccessControlType
      # FileSystemRights is signed; generic rights can set its sign bit.
      # Reinterpret the bits rather than using a checked numeric conversion.
      rights = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.FileSystemRights), 0)
    }
  }
  [Console]::Error.WriteLine('acl-probe:rules')
  return [pscustomobject]@{
    owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    protected = [bool]$acl.AreAccessRulesProtected
    aces = $aces
  }
}

function Test-Exclusive {
  param($state)
  if (-not $state.protected) { return $false }
  if ($state.owner -ne $me.Value) { return $false }
  foreach ($ace in $state.aces) {
    if ($ace.type -ne 'Allow') { return $false }
    if ($trusted -contains $ace.sid) { continue }
    if ($ace.sid -eq $ownerRights.Value -and
        (([uint32]$ace.rights -band $writableRights) -eq 0)) { continue }
    return $false
  }
  return $true
}

function Format-JsonString {
  param([string]$value)
  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('"')
  foreach ($char in $value.ToCharArray()) {
    $code = [int]$char
    if ($char -eq '"') { [void]$builder.Append('\\"') }
    elseif ($char -eq '\\') { [void]$builder.Append('\\\\') }
    elseif ($code -lt 32) { [void]$builder.Append(('\\u{0:x4}' -f $code)) }
    else { [void]$builder.Append($char) }
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Format-JsonBool {
  param([bool]$value)
  if ($value) { return 'true' } else { return 'false' }
}

$state = Read-State $item
[Console]::Error.WriteLine('acl-probe:initial-state')
$repaired = $false
$removed = @()
if (-not (Test-Exclusive $state)) {
[Console]::Error.WriteLine('acl-probe:repair')
  foreach ($ace in $state.aces) {
    if ($trusted -contains $ace.sid) { continue }
    if ($ace.sid -eq $ownerRights.Value -and
        (([uint32]$ace.rights -band $writableRights) -eq 0)) { continue }
    if ($removed -notcontains $ace.sid) { $removed += $ace.sid }
  }
  $acl = $item.GetAccessControl('Access')
  if ($state.owner -ne $me.Value) {
    $acl.SetOwner($me)
  }
  $acl.SetAccessRuleProtection($true, $false)
  # Enumerate the explicit post-protection rules in the same SID-native form.
  foreach ($rule in @($acl.GetAccessRules(
    $true,
    $false,
    [System.Security.Principal.SecurityIdentifier]
  ))) {
    if (
      $rule.IdentityReference.Value -eq $ownerRights.Value -and
      [string]$rule.AccessControlType -eq 'Allow' -and
      (([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$rule.FileSystemRights), 0) -band $writableRights) -eq 0)
    ) {
      continue
    }
    [void]$acl.RemoveAccessRuleSpecific($rule)
  }
  $inheritance = if ($isDirectory) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($sid in @($me, $system, $admins)) {
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid, 'FullControl', $inheritance, 'None', 'Allow'))
  }
  $item.SetAccessControl($acl)
[Console]::Error.WriteLine('acl-probe:repair-written')
  $repaired = $true
  $state = Read-State $item
}

[Console]::Error.WriteLine('acl-probe:complete')
$aceJson = @()
foreach ($ace in $state.aces) {
  $aceJson += ('{"sid":' + (Format-JsonString $ace.sid) +
    ',"type":' + (Format-JsonString $ace.type) +
    ',"rights":' + ([uint32]$ace.rights).ToString([System.Globalization.CultureInfo]::InvariantCulture) + '}')
}
$removedJson = @()
foreach ($sid in $removed) { $removedJson += (Format-JsonString $sid) }
# Written straight to stdout so nothing travels the output pipeline at all.
[Console]::Out.WriteLine('{"self":' + (Format-JsonString $me.Value) +
  ',"owner":' + (Format-JsonString $state.owner) +
  ',"protected":' + (Format-JsonBool $state.protected) +
  ',"repaired":' + (Format-JsonBool $repaired) +
  ',"removed":[' + ($removedJson -join ',') + ']' +
  ',"aces":[' + ($aceJson -join ',') + ']}')
`;
var standaloneVerifiedWindowsPaths = /* @__PURE__ */ new Set();
var standaloneWaivedWindowsPaths = /* @__PURE__ */ new Set();
var standaloneDiscoveryPublicationFailures = /* @__PURE__ */ new WeakMap();
var standaloneDiscoveryAclProbeTimeoutStages = /* @__PURE__ */ new WeakMap();
function discoveryPublicationFailure(category, error) {
  standaloneDiscoveryPublicationFailures.set(error, category);
  const cause = error.cause;
  const timeoutStage = cause && typeof cause === "object" ? windowsAclProbeTimeoutStages2.get(cause) : void 0;
  if (timeoutStage) standaloneDiscoveryAclProbeTimeoutStages.set(error, timeoutStage);
  return error;
}
function standaloneWindowsAclProbeTimedOut(error) {
  if (!error || typeof error !== "object") return false;
  const failure = error;
  return failure.code === "ETIMEDOUT" || failure.killed === true && failure.signal === "SIGTERM";
}
var WINDOWS_ACL_PROBE_STAGES2 = /* @__PURE__ */ new Set([
  "start",
  "item",
  "identity",
  "read-state",
  "acl",
  "rules",
  "initial-state",
  "repair",
  "repair-written",
  "complete"
]);
var windowsAclProbeTimeoutStages2 = /* @__PURE__ */ new WeakMap();
function sanitizedWindowsAclProbeTimeout2(error) {
  const stderr = error && typeof error === "object" && "stderr" in error ? Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : typeof error.stderr === "string" ? error.stderr : "" : "";
  let stage = "launch";
  for (const match of stderr.matchAll(/^acl-probe:([a-z-]+)\r?$/gmu)) {
    if (WINDOWS_ACL_PROBE_STAGES2.has(match[1])) stage = match[1];
  }
  const sanitized = Object.assign(new Error(`Windows ACL probe timed out at ${stage}.`), {
    code: "ETIMEDOUT",
    killed: true,
    signal: "SIGTERM"
  });
  windowsAclProbeTimeoutStages2.set(sanitized, stage);
  return sanitized;
}
function assertStandaloneWindowsExclusive(path6, label, deadline = performance2.now() + WINDOWS_ACL_PUBLICATION_BUDGET_MS) {
  if (standaloneVerifiedWindowsPaths.has(path6)) return;
  if (standaloneWaivedWindowsPaths.has(path6)) return;
  const subject = `Client v1 discovery ${label}`;
  const probeStartedAt = performance2.now();
  const waiver = resolveUnverifiedOwnershipWaiver2(process.env);
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const probeEnv = {
    COVEN_CAVE_CLIENT_V1_ACL_PATH: path6,
    // Next augments ProcessEnv to require this. It carries no secret.
    NODE_ENV: process.env.NODE_ENV,
    SystemRoot: systemRoot,
    windir: systemRoot,
    PATH: join4(systemRoot, "System32"),
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    TEMP: process.env.TEMP || process.env.TMP || join4(systemRoot, "Temp"),
    TMP: process.env.TMP || process.env.TEMP || join4(systemRoot, "Temp")
  };
  let report;
  try {
    let rawReport;
    for (let attempt = 0; attempt < WINDOWS_ACL_PROBE_MAX_ATTEMPTS2; attempt += 1) {
      try {
        const remaining = Math.floor(deadline - performance2.now());
        if (remaining <= 0) {
          throw Object.assign(new Error("the ACL publication probe budget was exhausted"), {
            code: "ETIMEDOUT"
          });
        }
        rawReport = execFileSync3(
          join4(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          [
            "-NoProfile",
            "-NonInteractive",
            "-NoLogo",
            "-InputFormat",
            "None",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_ACL_SCRIPT2
          ],
          {
            env: probeEnv,
            encoding: "utf8",
            windowsHide: true,
            timeout: Math.min(WINDOWS_ACL_PROBE_TIMEOUT_MS2, remaining),
            maxBuffer: 1024 * 1024
          }
        );
        break;
      } catch (error) {
        const timedOut = standaloneWindowsAclProbeTimedOut(error);
        if (attempt + 1 >= WINDOWS_ACL_PROBE_MAX_ATTEMPTS2 || !timedOut) {
          if (timedOut) throw sanitizedWindowsAclProbeTimeout2(error);
          throw error;
        }
      }
    }
    if (rawReport === void 0) {
      throw new Error("the ACL probe attempt bound was exhausted");
    }
    report = JSON.parse(rawReport);
    if (!report || typeof report !== "object" || typeof report.self !== "string" || !report.self || typeof report.owner !== "string" || !report.owner || typeof report.protected !== "boolean" || typeof report.repaired !== "boolean" || !Array.isArray(report.aces) || !Array.isArray(report.removed) || report.aces.some(
      (ace) => !ace || typeof ace !== "object" || !Number.isInteger(ace.rights) || ace.rights < 0 || ace.rights > 4294967295
    )) {
      throw new Error("the ACL probe returned a malformed report");
    }
  } catch (cause) {
    if (!waiver.granted) {
      throw discoveryPublicationFailure(`${label}-owner-unverified`, new Error(
        unverifiableOwnershipRefusal2(subject, path6, cause, waiver.note),
        { cause }
      ));
    }
    standaloneWaivedWindowsPaths.add(path6);
    console.warn(
      unverifiedOwnershipDisclosure2(subject, path6, cause, waiver.reason)
    );
    return;
  }
  const trusted = /* @__PURE__ */ new Set([report.self, WINDOWS_SYSTEM_SID2, WINDOWS_ADMINISTRATORS_SID2]);
  const findings = [];
  if (report.owner !== report.self) {
    findings.push(`owned by ${report.owner}, not ${report.self}`);
  }
  if (!report.protected) findings.push("its DACL still inherits from the parent");
  const foreign = report.aces.filter(
    (ace) => ace.type !== "Allow" || !trusted.has(ace.sid) && !(ace.sid === WINDOWS_OWNER_RIGHTS_SID2 && Number.isInteger(ace.rights) && (ace.rights & WINDOWS_WRITABLE_RIGHTS_MASK2) === 0)
  ).map((ace) => `${ace.type}:${ace.sid}`);
  if (foreign.length > 0) {
    findings.push(`access granted to ${[...new Set(foreign)].join(", ")}`);
  }
  if (findings.length > 0) {
    console.warn(`[windows-acl-state] ${JSON.stringify({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      discoveryPath: label,
      durationMs: Math.max(0, Math.round(performance2.now() - probeStartedAt)),
      repairAttempted: report.repaired,
      protected: report.protected,
      ownerMatches: report.owner === report.self,
      aceCount: report.aces.length,
      removedPrincipalCount: report.removed.length
    })}`);
    throw discoveryPublicationFailure(
      `${label}-owner-shared`,
      new Error(sharedOwnershipRefusal2(subject, path6, findings, waiver))
    );
  }
  if (report.repaired) {
    console.warn(
      `${subject} had no enforced access control on Windows; restricted ${path6} to the current user and revoked ${report.removed.length > 0 ? report.removed.join(", ") : "inherited entries"}.`
    );
  }
  standaloneVerifiedWindowsPaths.add(path6);
}
function requireStandaloneOwner(path6, metadata, label, windowsAclProbeDeadline) {
  if (typeof process.getuid === "function") {
    if (metadata.uid !== process.getuid()) {
      throw discoveryPublicationFailure(
        `${label}-owner-shared`,
        new Error(`Client v1 discovery ${label} must be owned by the current user.`)
      );
    }
    return;
  }
  if (process.platform !== "win32") {
    throw discoveryPublicationFailure(`${label}-owner-unverified`, new Error(
      `Client v1 discovery ${label} ownership cannot be verified on ${process.platform}: this platform exposes neither a uid nor a Windows ACL, so ${path6} is refused.`
    ));
  }
  assertStandaloneWindowsExclusive(path6, label, windowsAclProbeDeadline);
}
function assertStandaloneDiscoveryTarget(path6, windowsAclProbeDeadline) {
  try {
    const metadata = lstatSync(path6);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw discoveryPublicationFailure(
        "target-not-file",
        new Error(`Client v1 discovery target must be a regular file: ${path6}.`)
      );
    }
    requireStandaloneOwner(path6, metadata, "target", windowsAclProbeDeadline);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}
function publishStandaloneClientV1DiscoveryRecord(endpoint) {
  clientV1DiscoveryEndpoint = endpoint;
  const windowsAclProbeDeadline = performance2.now() + WINDOWS_ACL_PUBLICATION_BUDGET_MS;
  const root = join4(clientV1DiscoveryFile(), "..");
  mkdirSync2(root, { recursive: true, mode: 448 });
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw discoveryPublicationFailure(
      rootMetadata.isSymbolicLink() ? "root-symlink" : "root-not-directory",
      new Error("Client v1 discovery root must be a real directory.")
    );
  }
  requireStandaloneOwner(root, rootMetadata, "root", windowsAclProbeDeadline);
  const physicalRoot = realpathSync2(root);
  if (physicalRoot !== root) {
    throw discoveryPublicationFailure(
      "root-symlink",
      new Error("Client v1 discovery root must not resolve through a symlink.")
    );
  }
  chmodSync(root, 448);
  let url;
  try {
    url = new URL(endpoint);
  } catch (cause) {
    throw discoveryPublicationFailure(
      "endpoint-invalid",
      new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.", { cause })
    );
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "http:" || !loopback || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /%(?:2f|5c)/i.test(endpoint)) {
    throw discoveryPublicationFailure(
      "endpoint-invalid",
      new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.")
    );
  }
  const path6 = clientV1DiscoveryFile();
  assertStandaloneDiscoveryTarget(path6, windowsAclProbeDeadline);
  const occupant = readLiveForeignDiscoveryOccupant(path6);
  if (occupant) {
    throw discoveryPublicationFailure(
      "target-owned-by-live-instance",
      new Error(
        `Another Cave process (pid ${occupant.pid}) already owns ${path6} and points paired clients at ${occupant.endpoint}; this server (${endpoint}) will not replace a live instance's record. Stop that instance and restart this one, or give each instance its own COVEN_CAVE_HOME.`
      )
    );
  }
  let record2;
  if (CLIENT_V1_AUTHORITY_MODE === "off") {
    record2 = {
      version: 1,
      endpoint,
      pid: process.pid,
      nonce: CLIENT_V1_DISCOVERY_NONCE,
      startedAt: CLIENT_V1_DISCOVERY_STARTED_AT
    };
  } else {
    if (CLIENT_V1_AUTHORITY_BOOTSTRAP === void 0) {
      throw discoveryPublicationFailure(
        "authority-init",
        new Error("Client v1 HPKE authority initialization failed.")
      );
    }
    if ("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP) {
      throw discoveryPublicationFailure(
        "authority-init",
        clientV1AuthorityInitializationError ?? new Error("Client v1 HPKE authority initialization failed.")
      );
    }
    const bootstrap = CLIENT_V1_AUTHORITY_BOOTSTRAP;
    record2 = {
      version: 2,
      endpoint,
      pid: process.pid,
      nonce: CLIENT_V1_DISCOVERY_NONCE,
      startedAt: CLIENT_V1_DISCOVERY_STARTED_AT,
      authority: {
        mechanism: "hpke-bound-v1",
        mode: bootstrap.mode,
        keyId: Buffer.from(bootstrap.keyId).toString("base64url"),
        publicKey: Buffer.from(bootstrap.publicKey).toString("base64url"),
        suite: { kemId: 32, kdfId: 1, aeadId: 2 }
      }
    };
  }
  const temporaryPath = `${path6}.${process.pid}.${randomUUID3()}.tmp`;
  let fd = null;
  let ownsTemporaryPath = false;
  try {
    fd = openSync(temporaryPath, "wx", 384);
    ownsTemporaryPath = true;
    writeFileSync2(fd, `${JSON.stringify(record2, null, 2)}
`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    assertStandaloneDiscoveryTarget(path6, windowsAclProbeDeadline);
    renameSync2(temporaryPath, path6);
    ownsTemporaryPath = false;
    chmodSync(path6, 384);
    clientV1DiscoveryPublished = true;
    registerClientV1DiscoveryPublication(endpoint, null);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (ownsTemporaryPath) rmSync(temporaryPath, { force: true });
    throw error;
  }
}
function processIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function readLiveForeignDiscoveryOccupant(path6) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync3(path6, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { pid, nonce, endpoint } = parsed;
  if (nonce === CLIENT_V1_DISCOVERY_NONCE) return null;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if (pid === process.pid || !processIsLive(pid)) return null;
  return {
    pid,
    endpoint: typeof endpoint === "string" ? endpoint : "an unknown endpoint"
  };
}
function describePublicationError(error) {
  if (error instanceof Error) {
    try {
      const message = error.message;
      if (typeof message === "string" && message.length > 0) return message;
    } catch {
    }
  }
  return "no diagnostic text was recorded";
}
function registerClientV1DiscoveryPublication(endpoint, error) {
  const failure = error === null ? void 0 : {
    category: typeof error === "object" && error !== null ? standaloneDiscoveryPublicationFailures.get(error) ?? "disabled-other" : "disabled-other",
    message: describePublicationError(error)
  };
  const publication = {
    path: clientV1DiscoveryFile(),
    endpoint,
    nonce: CLIENT_V1_DISCOVERY_NONCE,
    published: clientV1DiscoveryPublished,
    failure,
    republish: () => republishStandaloneClientV1DiscoveryRecord(endpoint)
  };
  globalThis.__covenCaveClientV1Discovery = publication;
}
function republishStandaloneClientV1DiscoveryRecord(endpoint) {
  if (!clientV1DiscoveryPublished) return false;
  try {
    lstatSync(clientV1DiscoveryFile());
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") return false;
  }
  try {
    publishStandaloneClientV1DiscoveryRecord(endpoint);
    console.warn(
      "[cave] client-v1 discovery record had been removed by another Cave instance sharing this home; republished."
    );
    return true;
  } catch (error) {
    reportClientV1DiscoveryUnavailable(error);
    return false;
  }
}
function removeStandaloneClientV1DiscoveryRecord(nonce) {
  const path6 = clientV1DiscoveryFile();
  let before;
  let parsed;
  try {
    before = lstatSync(path6);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    requireStandaloneOwner(path6, before, "target");
    parsed = JSON.parse(readFileSync3(path6, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.nonce !== nonce) {
    return false;
  }
  const current = lstatSync(path6);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino) {
    return false;
  }
  unlinkSync2(path6);
  clientV1DiscoveryPublished = false;
  return true;
}
function cleanupStandaloneClientV1Discovery() {
  if (!clientV1DiscoveryPublished) return;
  try {
    removeStandaloneClientV1DiscoveryRecord(CLIENT_V1_DISCOVERY_NONCE);
  } catch (error) {
    console.error("[cave] failed to remove client-v1 discovery record", error);
  }
}
var LOCAL_PEER_HEADER = "x-coven-cave-local-peer";
var LOCAL_PEER_SECRET = randomUUID3();
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;
var FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "via"
];
var ACCESS_COOKIE = "coven_cave_access";
var LEGACY_ACCESS_COOKIE = "coven_access_token";
var PRESENCE_COOKIE = "coven_passkey_presence";
var ACCESS_QUERY_PARAM = "coven_access_token";
var SIDECAR_QUERY_PARAM = "covenCaveToken";
var sessions = /* @__PURE__ */ new Map();
var PACKAGED_CHILD_SHUTDOWN_BUDGET_MS = 1200;
function terminatePtySessions() {
  for (const session of sessions.values()) {
    try {
      session.pty.kill();
    } catch {
    }
  }
  sessions.clear();
}
async function terminatePackagedUnixSidecarTree() {
  terminatePtySessions();
  try {
    const terminateDirectRuns = globalThis.__covenCaveTerminateCopilotFlowRuns;
    if (terminateDirectRuns) {
      await Promise.race([
        terminateDirectRuns(),
        new Promise((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("direct Copilot shutdown exceeded its native parent lease")),
            PACKAGED_CHILD_SHUTDOWN_BUDGET_MS
          );
          timer.unref?.();
        })
      ]);
    }
  } catch (error) {
    console.error("[cave] direct Copilot process-tree shutdown could not be proved", error);
  } finally {
    cleanupStandaloneClientV1Discovery();
    terminatePtySessions();
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      process.exit(1);
    }
  }
}
if (process.platform !== "win32" && process.env.COVEN_CAVE_PARENT_WATCHDOG === "stdin-eof") {
  let parentShutdownStarted = false;
  const onParentShutdown = () => {
    if (parentShutdownStarted) return;
    parentShutdownStarted = true;
    void terminatePackagedUnixSidecarTree();
  };
  process.stdin.once("end", onParentShutdown);
  process.stdin.once("error", onParentShutdown);
  process.stdin.resume();
}
var SCROLLBACK_LIMIT_BYTES = 256 * 1024;
var PTY_FRAME_COALESCE_MS = 8;
var PTY_FRAME_MAX_BYTES = 16 * 1024;
var PTY_WS_BUFFERED_AMOUNT_LIMIT = 512 * 1024;
var PTY_SLOW_CONSUMER_CLOSE_CODE = 1013;
var PTY_SLOW_CONSUMER_CLOSE_REASON = "slow terminal consumer; reconnect";
var DETACH_GRACE_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_PTY_DETACH_GRACE_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
function appendScrollback(session, data) {
  const nextEnd = session.streamEnd + data.length;
  if (data.length >= SCROLLBACK_LIMIT_BYTES) {
    session.scrollback = [Buffer.from(data.subarray(data.length - SCROLLBACK_LIMIT_BYTES))];
    session.scrollbackBytes = SCROLLBACK_LIMIT_BYTES;
    session.scrollbackStart = nextEnd - SCROLLBACK_LIMIT_BYTES;
    session.streamEnd = nextEnd;
    return;
  }
  session.scrollback.push(data);
  session.scrollbackBytes += data.length;
  session.streamEnd = nextEnd;
  while (session.scrollbackBytes > SCROLLBACK_LIMIT_BYTES && session.scrollback.length > 1) {
    const dropped = session.scrollback.shift();
    if (dropped) {
      session.scrollbackBytes -= dropped.length;
      session.scrollbackStart += dropped.length;
    }
  }
}
function scrollbackFrom(session, cursor) {
  const output = [];
  let remaining = cursor - session.scrollbackStart;
  for (const chunk of session.scrollback) {
    if (remaining >= chunk.length) {
      remaining -= chunk.length;
      continue;
    }
    output.push(remaining > 0 ? chunk.subarray(remaining) : chunk);
    remaining = 0;
  }
  return output;
}
function parseCookies(header) {
  const map = /* @__PURE__ */ new Map();
  if (!header) return map;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    try {
      map.set(key, decodeURIComponent(rest.join("=")));
    } catch {
    }
  }
  return map;
}
function getTokensFromCookie(header) {
  const cookies = parseCookies(header);
  const tokens = [];
  for (const name of [ACCESS_COOKIE, LEGACY_ACCESS_COOKIE]) {
    const value = cookies.get(name);
    if (value !== void 0) tokens.push(value);
  }
  return tokens;
}
function getCookie(header, name) {
  return parseCookies(header).get(name) ?? null;
}
function timingSafeEqualString2(a, b) {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
function isExpectedAccessToken(value) {
  const secret = accessToken();
  if (!secret || !value) return false;
  if (timingSafeEqualString2(value, secret)) return true;
  return isValidSignedAccessToken(value, secret);
}
function isExpectedSidecarToken(value) {
  return Boolean(SIDECAR_TOKEN && value && timingSafeEqualString2(value, SIDECAR_TOKEN));
}
function isExpectedPtyToken(value) {
  return isExpectedAccessToken(value) || isExpectedSidecarToken(value);
}
function isValidSignedAccessToken(value, secret) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!parts[2] || !parts[3]) return false;
  const expected = createHmac("sha256", secret).update(`v1.${parts[1]}.${parts[2]}`).digest("base64url");
  return timingSafeEqualString2(parts[3], expected);
}
function hasValidPasskeyPresence(req, tailnetNodeId) {
  if (!tailnetNodeId) return false;
  const secret = process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  const token = getCookie(req.headers.cookie, PRESENCE_COOKIE);
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  const field = /^[A-Za-z0-9_-]+$/;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || !field.test(parts[2]) || !field.test(parts[3]) || !parts[4] || !parts[5]) {
    return false;
  }
  const body2 = parts.slice(0, 5).join(".");
  const expected = createHmac("sha256", secret).update(body2).digest("base64url");
  return timingSafeEqualString2(parts[5], expected) && expiresAt > Date.now() && parts[2] === tailnetNodeId;
}
function bearerToken(req) {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}
function isLoopbackHost(host) {
  if (!host) return false;
  const hostname2 = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname2 === "127.0.0.1" || hostname2 === "localhost" || hostname2 === "::1";
}
function isLoopbackAddress(value) {
  if (!value) return false;
  if (value === "::1" || value === "127.0.0.1") return true;
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length) === "127.0.0.1";
  return false;
}
function isTailscaleAddress(value) {
  const address = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  if (address.includes(".")) {
    const parts = address.split(".").map((part) => Number(part));
    return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  }
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}
function normalizeForwardedAddress(value) {
  let address = value.trim();
  if (address.startsWith("[")) {
    const close = address.indexOf("]");
    if (close > 0) return address.slice(1, close).toLowerCase();
  }
  if ((address.match(/:/g) ?? []).length === 1) address = address.split(":")[0];
  if (address.startsWith("::ffff:")) address = address.slice("::ffff:".length);
  return address.toLowerCase();
}
var TAILNET_PEER_HEADER = "x-coven-cave-tailnet-peer";
var TAILNET_PEER_SECRET = randomUUID3();
process.env.COVEN_CAVE_TAILNET_PEER_SECRET = TAILNET_PEER_SECRET;
var TAILNET_STATUS_REFRESH_MS = 3e4;
process.env.COVEN_CAVE_PASSKEY_SESSION_SECRET = randomUUID3();
function allowedTailnetNodeIds() {
  const raw = process.env.COVEN_CAVE_TAILNET_ALLOWED_NODES ?? "";
  return new Set(
    raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  );
}
var tailnetPeerAddresses = /* @__PURE__ */ new Map();
var tailnetRefreshInFlight = false;
async function refreshTailnetPeers() {
  const allowed = allowedTailnetNodeIds();
  if (allowed.size === 0) {
    tailnetPeerAddresses = /* @__PURE__ */ new Map();
    return;
  }
  if (tailnetRefreshInFlight) return;
  tailnetRefreshInFlight = true;
  try {
    const { stdout } = await execFileAsync3(
      process.env.COVEN_CAVE_TAILSCALE_BIN ?? "tailscale",
      ["status", "--json"],
      { timeout: 1e4, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    );
    const status = JSON.parse(stdout);
    const next2 = /* @__PURE__ */ new Map();
    for (const peer of Object.values(status.Peer ?? {})) {
      const nodeId = peer.ID;
      if (!nodeId || !allowed.has(nodeId)) continue;
      for (const ip of peer.TailscaleIPs ?? []) {
        next2.set(normalizeForwardedAddress(ip), nodeId);
      }
    }
    tailnetPeerAddresses = next2;
  } catch (err) {
    tailnetPeerAddresses = /* @__PURE__ */ new Map();
    console.warn("[cave] tailnet peer refresh failed:", err?.message ?? err);
  } finally {
    tailnetRefreshInFlight = false;
  }
}
function resolveTailnetPeer(req) {
  if (tailnetPeerAddresses.size === 0) return null;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return null;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0];
  if (!first) return null;
  const address = normalizeForwardedAddress(first);
  if (!isTailscaleAddress(address)) return null;
  return tailnetPeerAddresses.get(address) ?? null;
}
function isDirectLoopbackRequest(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  for (const header of FORWARDING_HEADERS) {
    if (req.headers[header] !== void 0) return false;
  }
  return isLoopbackHost(req.headers.host);
}
function sameOrigin(value, expectedOrigin) {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.origin === expectedOrigin) return true;
    const expected = new URL(expectedOrigin);
    if (url.host === expected.host) return true;
    return url.protocol === expected.protocol && url.port === expected.port && isLoopbackHost(url.host) && isLoopbackHost(expected.host);
  } catch {
    return false;
  }
}
function isAllowedUpgradeSource(req, tokenAuthenticated = false) {
  const host = req.headers.host;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (!isLoopbackHost(host)) {
    if (!host) return false;
    if (tokenAuthenticated) return sameOrigin(req.headers.origin, `http://${host}`);
    return false;
  }
  return sameOrigin(req.headers.origin, `http://${host}`);
}
function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function parsePtyReplayCursor(value) {
  const raw = firstQueryValue(value);
  if (raw === void 0) return void 0;
  if (raw === "-1") return -1;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) ? cursor : null;
}
var UPGRADE_URL_BASE = "http://localhost";
var MAX_UPGRADE_QUERY_SEGMENTS = 1e3;
var ABSOLUTE_FORM_RE = /^[a-z][a-z\d+.-]*:\/\//i;
function boundedUpgradeQuery(suffix) {
  if (!suffix.startsWith("?")) return "";
  const fragmentStart = suffix.indexOf("#", 1);
  const rawQuery = suffix.slice(1, fragmentStart === -1 ? void 0 : fragmentStart);
  let segmentCount = 1;
  for (let index = 0; index < rawQuery.length; index += 1) {
    if (rawQuery[index] !== "&") continue;
    if (segmentCount >= MAX_UPGRADE_QUERY_SEGMENTS) return rawQuery.slice(0, index);
    segmentCount += 1;
  }
  return rawQuery;
}
function parseUpgradeTarget(rawUrl) {
  const pathEnd = rawUrl.search(/[?#]/);
  const rawPath = pathEnd === -1 ? rawUrl : rawUrl.slice(0, pathEnd);
  const suffix = pathEnd === -1 ? "" : rawUrl.slice(pathEnd);
  const normalizedPath = rawPath.replaceAll("\\", "/");
  const absoluteForm = ABSOLUTE_FORM_RE.exec(normalizedPath);
  const rootedPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  const parsedUrl = absoluteForm ? new URL(normalizedPath) : new URL(`/.${rootedPath}`, UPGRADE_URL_BASE);
  parsedUrl.search = `?${boundedUpgradeQuery(suffix)}`;
  let pathname = normalizedPath;
  if (absoluteForm) {
    const pathStart = normalizedPath.indexOf("/", absoluteForm[0].length);
    pathname = pathStart === -1 ? "/" : normalizedPath.slice(pathStart);
  }
  const query = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of parsedUrl.searchParams) {
    const current = query[key];
    if (current === void 0) query[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else query[key] = [current, value];
  }
  return { pathname, query };
}
function isPtyAuthRequired() {
  return Boolean(accessToken() || SIDECAR_TOKEN);
}
function shouldRejectUnauthenticatedPtyUpgrade({
  sidecarTokenConfigured = false,
  accessTokenConfigured = false,
  tokenAuthenticated = false,
  directLoopback = false
} = {}) {
  if (tokenAuthenticated || directLoopback) return false;
  return sidecarTokenConfigured || accessTokenConfigured;
}
function isAuthorized(req, query) {
  if (!isPtyAuthRequired()) return false;
  const queryToken = firstQueryValue(query[ACCESS_QUERY_PARAM]);
  const sidecarQueryToken = firstQueryValue(query[SIDECAR_QUERY_PARAM]);
  const candidates = [bearerToken(req), queryToken, sidecarQueryToken, ...getTokensFromCookie(req.headers.cookie)];
  return candidates.some(isExpectedPtyToken);
}
function defaultShell() {
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "win32") {
    return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}
function defaultShellArgs() {
  if (process.platform === "win32") return ["-NoLogo"];
  return ["-l"];
}
function augmentedPath() {
  const inherited = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const extras = process.platform === "win32" ? [
    "C:\\Windows\\System32",
    "C:\\Windows",
    "C:\\Program Files\\Git\\cmd",
    "C:\\Program Files\\nodejs"
  ] : [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of inherited.split(sep).concat(extras)) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(sep);
}
function validateCwd(raw) {
  if (!raw) return void 0;
  const stat = statSync3(raw);
  if (!stat.isDirectory()) {
    throw new Error("projectRoot must be a directory");
  }
  return raw;
}
var PTY_ENV_DROPPED = /* @__PURE__ */ new Set(["NODE_ENV", "INIT_CWD", "PNPM_SCRIPT_SRC_DIR"]);
var PTY_ENV_DROPPED_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"];
function sanitizedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === void 0) continue;
    if (/^npm_/i.test(key)) continue;
    if (PTY_ENV_DROPPED.has(key)) continue;
    if (PTY_ENV_DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}
function sendPtyData(ws, data) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(1 + data.length);
  frame[0] = 1;
  data.copy(frame, 1);
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}
function sendPtyReplayCursor(ws, cursor, reset) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const frame = Buffer.allocUnsafe(10);
  frame[0] = 6;
  frame.writeDoubleLE(cursor, 1);
  frame[9] = reset ? 1 : 0;
  try {
    ws.send(frame);
    return true;
  } catch {
    return false;
  }
}
function clearPendingPtyOutput(session) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  session.pendingOutput = [];
  session.pendingOutputBytes = 0;
}
function armPtyDetach(threadId, session) {
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(() => {
    const current = sessions.get(threadId);
    if (current !== session || current.ws) return;
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
    }
  }, DETACH_GRACE_MS);
}
function detachPtyConsumer(threadId, session, ws) {
  if (session.ws !== ws) return;
  session.ws = null;
  clearPendingPtyOutput(session);
  armPtyDetach(threadId, session);
}
function evictSlowPtyConsumer(threadId, session, ws) {
  if (session.ws !== ws) return;
  detachPtyConsumer(threadId, session, ws);
  try {
    ws.close(PTY_SLOW_CONSUMER_CLOSE_CODE, PTY_SLOW_CONSUMER_CLOSE_REASON);
  } catch {
  }
}
function flushPtyOutput(threadId, session) {
  session.flushTimer = null;
  const ws = session.ws;
  if (!ws || session.pendingOutputBytes === 0) return;
  const chunks = session.pendingOutput;
  clearPendingPtyOutput(session);
  const payload = Buffer.concat(chunks);
  if (ws.readyState !== WebSocket.OPEN || session.ws !== ws) return;
  if (ws.bufferedAmount + payload.length + 1 > PTY_WS_BUFFERED_AMOUNT_LIMIT) {
    evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  if (!sendPtyData(ws, payload)) {
    detachPtyConsumer(threadId, session, ws);
  }
}
function queuePtyOutput(threadId, session, data) {
  if (!session.ws || data.length === 0) return;
  let offset = 0;
  while (offset < data.length && session.ws) {
    const room = PTY_FRAME_MAX_BYTES - session.pendingOutputBytes;
    const take = Math.min(room, data.length - offset);
    const chunk = data.subarray(offset, offset + take);
    if (session.pendingOutputBytes + take === PTY_FRAME_MAX_BYTES) {
      session.pendingOutput.push(chunk);
    } else {
      const boundedChunk = Buffer.allocUnsafeSlow(chunk.length);
      chunk.copy(boundedChunk);
      session.pendingOutput.push(boundedChunk);
    }
    session.pendingOutputBytes += take;
    offset += take;
    if (session.pendingOutputBytes === PTY_FRAME_MAX_BYTES) {
      flushPtyOutput(threadId, session);
    }
  }
  if (session.ws && session.pendingOutputBytes > 0 && !session.flushTimer) {
    session.flushTimer = setTimeout(
      () => flushPtyOutput(threadId, session),
      PTY_FRAME_COALESCE_MS
    );
  }
}
function replayPtyOutput(threadId, session, replayCursor) {
  if (!session.ws || session.scrollbackBytes === 0) {
    if (session.ws && replayCursor !== void 0) {
      sendPtyReplayCursor(
        session.ws,
        session.streamEnd,
        replayCursor !== -1 && replayCursor !== session.streamEnd
      );
    }
    return;
  }
  if (replayCursor === void 0) {
    for (const chunk of session.scrollback) queuePtyOutput(threadId, session, chunk);
    return;
  }
  const validCursor = replayCursor >= session.scrollbackStart && replayCursor <= session.streamEnd;
  const start = validCursor && replayCursor !== -1 ? replayCursor : session.scrollbackStart;
  const reset = replayCursor !== -1 && !validCursor;
  const ws = session.ws;
  if (!ws || ws.bufferedAmount + 10 > PTY_WS_BUFFERED_AMOUNT_LIMIT || !sendPtyReplayCursor(ws, start, reset)) {
    if (ws) evictSlowPtyConsumer(threadId, session, ws);
    return;
  }
  for (const chunk of scrollbackFrom(session, start)) queuePtyOutput(threadId, session, chunk);
}
function sendPtyExit(ws, exitCode) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame = Buffer.allocUnsafe(5);
  frame[0] = 2;
  frame.writeInt32LE(exitCode, 1);
  ws.send(frame);
}
function spawnPty(threadId, ws, cols, rows, cwd, replayCursor) {
  const shell = pty.spawn(defaultShell(), defaultShellArgs(), {
    name: "xterm-256color",
    cols: cols > 0 ? cols : 120,
    rows: rows > 0 ? rows : 40,
    cwd: cwd ?? process.env.HOME ?? process.cwd(),
    env: {
      ...sanitizedEnv(),
      PATH: augmentedPath(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COVENCAVE: "1",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8"
    }
  });
  const session = {
    pty: shell,
    ws: null,
    scrollback: [],
    scrollbackBytes: 0,
    scrollbackStart: 0,
    streamEnd: 0,
    pendingOutput: [],
    pendingOutputBytes: 0,
    flushTimer: null,
    detachTimer: null
  };
  sessions.set(threadId, session);
  shell.onData((data) => {
    const bytes = Buffer.from(data, "utf8");
    appendScrollback(session, bytes);
    queuePtyOutput(threadId, session, bytes);
  });
  shell.onExit(({ exitCode }) => {
    const current = sessions.get(threadId);
    if (session.ws) flushPtyOutput(threadId, session);
    if (current?.pty === shell) {
      if (current.detachTimer) clearTimeout(current.detachTimer);
      clearPendingPtyOutput(current);
      sessions.delete(threadId);
    }
    if (session.ws) {
      sendPtyExit(session.ws, exitCode ?? 0);
      session.ws.close(1e3, "pty exit");
    }
  });
  adoptSession(threadId, session, ws, cols, rows, replayCursor);
}
function rawDataToBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
function onWsMessage(threadId, data) {
  const session = sessions.get(threadId);
  if (!session) return;
  const frame = rawDataToBuffer(data);
  const tag = frame[0];
  if (tag === 3) {
    session.pty.write(frame.subarray(1).toString("utf8"));
  } else if (tag === 4 && frame.length >= 5) {
    const cols = frame.readUInt16LE(1);
    const rows = frame.readUInt16LE(3);
    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
    }
  } else if (tag === 5) {
    if (session.detachTimer) clearTimeout(session.detachTimer);
    clearPendingPtyOutput(session);
    sessions.delete(threadId);
    try {
      session.pty.kill();
    } catch {
    }
  }
}
function adoptSession(threadId, session, ws, cols, rows, replayCursor) {
  if (session.detachTimer) {
    clearTimeout(session.detachTimer);
    session.detachTimer = null;
  }
  const previous = session.ws;
  clearPendingPtyOutput(session);
  session.ws = ws;
  if (previous && previous !== ws) {
    try {
      previous.close(1e3, "replaced");
    } catch {
    }
  }
  if (cols > 0 && rows > 0) {
    try {
      session.pty.resize(cols, rows);
    } catch {
    }
  }
  replayPtyOutput(threadId, session, replayCursor);
}
function handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor) {
  const existing = sessions.get(threadId);
  if (existing) {
    adoptSession(threadId, existing, ws, cols, rows, replayCursor);
  } else {
    spawnPty(threadId, ws, cols, rows, cwd, replayCursor);
  }
  ws.on("message", (data) => onWsMessage(threadId, data));
  ws.on("close", () => {
    const session = sessions.get(threadId);
    if (!session || session.ws !== ws) return;
    detachPtyConsumer(threadId, session, ws);
  });
}
function loopbackHostname(raw = process.env.HOSTNAME) {
  if (raw === "127.0.0.1" || raw === "localhost" || raw === "::1") {
    return raw;
  }
  return "127.0.0.1";
}
function loopbackHttpEndpoint(hostname2, port2) {
  const urlHostname = hostname2 === "::1" ? `[${hostname2}]` : hostname2;
  return `http://${urlHostname}:${port2}`;
}
var dev = process.env.NODE_ENV !== "production";
var hostname = loopbackHostname();
var port = cavePort();
var app = next({ dev, hostname, port });
var handle = app.getRequestHandler();
var wss = new WebSocketServer({ noServer: true });
var remotePtyClients = /* @__PURE__ */ new Set();
var deviceAccessSecret = randomUUID3();
process.env.COVEN_CAVE_DEVICE_ACCESS_SECRET = deviceAccessSecret;
var discoveryInitialization = Promise.withResolvers();
var deferredDeviceAccess = deferDeviceAccessStore(async () => {
  await discoveryInitialization.promise;
  return createDeviceAccessStore();
});
var deviceAccessStore = deferredDeviceAccess.store;
var deviceAccess = createDeviceAccessGateway({
  store: deviceAccessStore,
  isDirectLoopback: isDirectLoopbackRequest,
  sidecarToken: SIDECAR_TOKEN,
  packaged: process.env.COVEN_CAVE_BUNDLE === "1",
  stampSecret: deviceAccessSecret,
  onAuthenticated(req, device) {
    req.headers[TAILNET_PEER_HEADER] = `${TAILNET_PEER_SECRET}:${device.peer.nodeId}`;
  },
  onPolicyChanged() {
    for (const client of remotePtyClients) client.terminate();
  }
});
await app.prepare();
var nextUpgradeHandler = app.getUpgradeHandler();
var server = createServer((req, res) => {
  delete req.headers[LOCAL_PEER_HEADER];
  delete req.headers[TAILNET_PEER_HEADER];
  if (isDirectLoopbackRequest(req)) {
    req.headers[LOCAL_PEER_HEADER] = LOCAL_PEER_SECRET;
  }
  const tailnetNodeId = resolveTailnetPeer(req);
  if (tailnetNodeId) {
    req.headers[TAILNET_PEER_HEADER] = `${TAILNET_PEER_SECRET}:${tailnetNodeId}`;
  }
  void deviceAccess.handle(req, res).then((handled) => {
    if (!handled) return handle(req, res);
  }).catch((error) => {
    console.error("[device-access] Request handling failed:", error);
    res.destroy(error instanceof Error ? error : void 0);
  });
});
server.on("close", () => {
  void deviceAccess.close().then(() => deviceAccessStore.close()).catch((error) => {
    console.error("[device-access] Shutdown failed:", error);
  });
});
server.on("upgrade", async (req, socket, head) => {
  try {
    if (await deviceAccess.blocksUpgrade(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
  } catch (error) {
    console.error("[device-access] Upgrade refused:", error);
    socket.destroy();
    return;
  }
  let pathname;
  let query;
  try {
    ({ pathname, query } = parseUpgradeTarget(req.url ?? "/"));
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  if (pathname !== "/api/pty-ws") {
    void nextUpgradeHandler(req, socket, head).catch((err) => {
      console.error(`Failed to handle websocket upgrade for ${req.url ?? "unknown url"}`, err);
      socket.destroy();
    });
    return;
  }
  const tailnetNodeId = resolveTailnetPeer(req);
  const tokenAuthenticated = isPtyAuthRequired() ? isAuthorized(req, query) : false;
  if (!isAllowedUpgradeSource(req, tokenAuthenticated)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  if (shouldRejectUnauthenticatedPtyUpgrade({
    sidecarTokenConfigured: Boolean(SIDECAR_TOKEN),
    accessTokenConfigured: Boolean(accessToken()),
    tokenAuthenticated,
    directLoopback: isDirectLoopbackRequest(req)
  })) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  if (process.env.COVEN_CAVE_PASSKEY_REQUIRED === "1" && !isDirectLoopbackRequest(req) && !hasValidPasskeyPresence(req, tailnetNodeId)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  const threadId = String(query.threadId ?? "");
  if (!threadId) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  const replayCursor = parsePtyReplayCursor(query.ptyReplayCursor);
  if (replayCursor === null) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  let cwd;
  try {
    cwd = validateCwd(query.projectRoot ? String(query.projectRoot) : void 0);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  const cols = Number.parseInt(String(query.cols ?? "120"), 10);
  const rows = Number.parseInt(String(query.rows ?? "40"), 10);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!isDirectLoopbackRequest(req)) {
      remotePtyClients.add(ws);
      ws.once("close", () => {
        remotePtyClients.delete(ws);
      });
    }
    handlePtyConnection(ws, threadId, cols, rows, cwd, replayCursor);
  });
});
server.keepAliveTimeout = 75e3;
server.headersTimeout = 8e4;
function reportClientV1DiscoveryUnavailable(error) {
  clientV1DiscoveryPublished = false;
  registerClientV1DiscoveryPublication(clientV1DiscoveryEndpoint, error);
  const category = typeof error === "object" && error !== null ? standaloneDiscoveryPublicationFailures.get(error) ?? "disabled-other" : "disabled-other";
  console.error("[cave] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 CLIENT V1 DISABLED \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.error(`[cave] client-v1 discovery publication refused: ${category}`);
  const timeoutStage = typeof error === "object" && error !== null ? standaloneDiscoveryAclProbeTimeoutStages.get(error) : void 0;
  if (timeoutStage) {
    console.error(`[cave] Windows ACL probe timed out at stage: ${timeoutStage}`);
  }
  console.error(
    "[cave] The client v1 discovery record was NOT published, so paired clients cannot find this server and every client v1 request stays refused. Everything else on this server is running normally."
  );
  console.error(
    `[cave] Repair the path and restart. If \u2014 and only if \u2014 this host cannot read a DACL at all, ${UNVERIFIED_OWNERSHIP_ENV2}=${UNVERIFIED_OWNERSHIP_TOKEN2} with ${UNVERIFIED_OWNERSHIP_REASON_ENV2} set admits an unreadable one; it never admits a DACL that was read and found shared.`
  );
  console.error("[cave] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
}
server.listen(port, hostname, () => {
  try {
    publishStandaloneClientV1DiscoveryRecord(loopbackHttpEndpoint(hostname, port));
  } catch (error) {
    reportClientV1DiscoveryUnavailable(error);
  } finally {
    discoveryInitialization.resolve();
  }
  logStartupHeapCeiling();
  console.log(`> Ready on ${loopbackHttpEndpoint(hostname, port)}`);
  void warmHarnessSpawnPath();
});
var httpShutdownStarted = false;
function shutdownHttpServer() {
  if (httpShutdownStarted) return;
  httpShutdownStarted = true;
  cleanupStandaloneClientV1Discovery();
  terminatePtySessions();
  const timer = setTimeout(() => process.exit(1), 2e3);
  timer.unref?.();
  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
}
process.once("SIGINT", shutdownHttpServer);
process.once("SIGTERM", shutdownHttpServer);
if (allowedTailnetNodeIds().size > 0) {
  void refreshTailnetPeers();
  setInterval(() => void refreshTailnetPeers(), TAILNET_STATUS_REFRESH_MS).unref();
}
server.once("error", (err) => {
  cleanupStandaloneClientV1Discovery();
  if (err.code === "EADDRINUSE") {
    console.error(
      `> Port ${port} on ${hostname} is already in use (EADDRINUSE); CovenCave cannot serve here.`
    );
  }
  console.error(err);
  process.exit(1);
});
var HEAP_MONITOR_ENABLED = process.env.COVEN_CAVE_HEAP_MONITOR !== "0";
var HEAP_MONITOR_INTERVAL_MS = (() => {
  const env = Number.parseInt(process.env.COVEN_CAVE_HEAP_MONITOR_INTERVAL_MS ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 3e5;
})();
var HEAP_WARN_RATIO = 0.85;
var HEAP_SNAPSHOT_RATIO = 0.95;
var HEAP_SNAPSHOT_KEEP = 2;
var heapSnapshotSeq = 0;
function heapDiagnosticsDir() {
  const covenHome2 = process.env.COVEN_HOME || join4(homedir4(), ".coven");
  const caveHome2 = process.env.COVEN_CAVE_HOME || join4(covenHome2, "cave");
  return join4(caveHome2, "diagnostics");
}
var mb = (bytes) => `${Math.round(bytes / (1024 * 1024))}MB`;
function logStartupHeapCeiling() {
  console.log(`[heap-ceiling] heapLimit=${mb(getHeapStatistics().heap_size_limit)}`);
}
function pruneHeapSnapshots(dir) {
  const snapshots = readdirSync2(dir).filter((name) => name.startsWith("cave-heap-") && name.endsWith(".heapsnapshot")).sort();
  while (snapshots.length > HEAP_SNAPSHOT_KEEP) {
    const oldest = snapshots.shift();
    try {
      unlinkSync2(join4(dir, oldest));
    } catch {
    }
  }
}
function startHeapMonitor() {
  if (!HEAP_MONITOR_ENABLED) return;
  let snapshotWritten = false;
  const tick = () => {
    const heap = getHeapStatistics();
    const ratio = heap.used_heap_size / heap.heap_size_limit;
    if (ratio < HEAP_WARN_RATIO) {
      snapshotWritten = false;
      return;
    }
    const usage = process.memoryUsage();
    console.warn(
      `[heap-monitor] heapUsed=${mb(heap.used_heap_size)} heapLimit=${mb(heap.heap_size_limit)} (${Math.round(ratio * 100)}%) rss=${mb(usage.rss)} external=${mb(usage.external)} ptySessions=${sessions.size} uptimeMin=${Math.round(process.uptime() / 60)}`
    );
    if (ratio < HEAP_SNAPSHOT_RATIO || snapshotWritten) return;
    try {
      const dir = heapDiagnosticsDir();
      mkdirSync2(dir, { recursive: true });
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const seq = String(heapSnapshotSeq += 1).padStart(3, "0");
      const file = join4(dir, `cave-heap-${stamp}-pid${process.pid}-${seq}.heapsnapshot`);
      writeHeapSnapshot(file);
      snapshotWritten = true;
      pruneHeapSnapshots(dir);
      console.warn(`[heap-monitor] wrote heap snapshot ${file}`);
    } catch (err) {
      snapshotWritten = true;
      console.warn(`[heap-monitor] failed to write heap snapshot`, err);
    }
  };
  setInterval(tick, HEAP_MONITOR_INTERVAL_MS).unref();
}
startHeapMonitor();
