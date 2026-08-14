import { createRequire as __tweetThreadCreateRequire } from "node:module"; const require = __tweetThreadCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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

// node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/interopRequireDefault.js
var require_interopRequireDefault = __commonJS({
  "node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/interopRequireDefault.js"(exports, module) {
    function _interopRequireDefault(e) {
      return e && e.__esModule ? e : {
        "default": e
      };
    }
    module.exports = _interopRequireDefault, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_global.js
var require_global = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_global.js"(exports, module) {
    var global = module.exports = typeof window != "undefined" && window.Math == Math ? window : typeof self != "undefined" && self.Math == Math ? self : Function("return this")();
    if (typeof __g == "number") __g = global;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_core.js
var require_core = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_core.js"(exports, module) {
    var core = module.exports = { version: "2.6.12" };
    if (typeof __e == "number") __e = core;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-object.js
var require_is_object = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-object.js"(exports, module) {
    module.exports = function(it) {
      return typeof it === "object" ? it !== null : typeof it === "function";
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_an-object.js
var require_an_object = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_an-object.js"(exports, module) {
    var isObject = require_is_object();
    module.exports = function(it) {
      if (!isObject(it)) throw TypeError(it + " is not an object!");
      return it;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_fails.js
var require_fails = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_fails.js"(exports, module) {
    module.exports = function(exec) {
      try {
        return !!exec();
      } catch (e) {
        return true;
      }
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_descriptors.js
var require_descriptors = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_descriptors.js"(exports, module) {
    module.exports = !require_fails()(function() {
      return Object.defineProperty({}, "a", { get: function() {
        return 7;
      } }).a != 7;
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_dom-create.js
var require_dom_create = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_dom-create.js"(exports, module) {
    var isObject = require_is_object();
    var document = require_global().document;
    var is = isObject(document) && isObject(document.createElement);
    module.exports = function(it) {
      return is ? document.createElement(it) : {};
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_ie8-dom-define.js
var require_ie8_dom_define = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_ie8-dom-define.js"(exports, module) {
    module.exports = !require_descriptors() && !require_fails()(function() {
      return Object.defineProperty(require_dom_create()("div"), "a", { get: function() {
        return 7;
      } }).a != 7;
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-primitive.js
var require_to_primitive = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-primitive.js"(exports, module) {
    var isObject = require_is_object();
    module.exports = function(it, S) {
      if (!isObject(it)) return it;
      var fn, val;
      if (S && typeof (fn = it.toString) == "function" && !isObject(val = fn.call(it))) return val;
      if (typeof (fn = it.valueOf) == "function" && !isObject(val = fn.call(it))) return val;
      if (!S && typeof (fn = it.toString) == "function" && !isObject(val = fn.call(it))) return val;
      throw TypeError("Can't convert object to primitive value");
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-dp.js
var require_object_dp = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-dp.js"(exports) {
    var anObject = require_an_object();
    var IE8_DOM_DEFINE = require_ie8_dom_define();
    var toPrimitive = require_to_primitive();
    var dP = Object.defineProperty;
    exports.f = require_descriptors() ? Object.defineProperty : function defineProperty(O, P, Attributes) {
      anObject(O);
      P = toPrimitive(P, true);
      anObject(Attributes);
      if (IE8_DOM_DEFINE) try {
        return dP(O, P, Attributes);
      } catch (e) {
      }
      if ("get" in Attributes || "set" in Attributes) throw TypeError("Accessors not supported!");
      if ("value" in Attributes) O[P] = Attributes.value;
      return O;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_property-desc.js
var require_property_desc = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_property-desc.js"(exports, module) {
    module.exports = function(bitmap, value) {
      return {
        enumerable: !(bitmap & 1),
        configurable: !(bitmap & 2),
        writable: !(bitmap & 4),
        value
      };
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_hide.js
var require_hide = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_hide.js"(exports, module) {
    var dP = require_object_dp();
    var createDesc = require_property_desc();
    module.exports = require_descriptors() ? function(object, key, value) {
      return dP.f(object, key, createDesc(1, value));
    } : function(object, key, value) {
      object[key] = value;
      return object;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_has.js
var require_has = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_has.js"(exports, module) {
    var hasOwnProperty = {}.hasOwnProperty;
    module.exports = function(it, key) {
      return hasOwnProperty.call(it, key);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_uid.js
var require_uid = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_uid.js"(exports, module) {
    var id = 0;
    var px = Math.random();
    module.exports = function(key) {
      return "Symbol(".concat(key === void 0 ? "" : key, ")_", (++id + px).toString(36));
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_library.js
var require_library = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_library.js"(exports, module) {
    module.exports = false;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_shared.js
var require_shared = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_shared.js"(exports, module) {
    var core = require_core();
    var global = require_global();
    var SHARED = "__core-js_shared__";
    var store = global[SHARED] || (global[SHARED] = {});
    (module.exports = function(key, value) {
      return store[key] || (store[key] = value !== void 0 ? value : {});
    })("versions", []).push({
      version: core.version,
      mode: require_library() ? "pure" : "global",
      copyright: "© 2020 Denis Pushkarev (zloirock.ru)"
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_function-to-string.js
var require_function_to_string = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_function-to-string.js"(exports, module) {
    module.exports = require_shared()("native-function-to-string", Function.toString);
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_redefine.js
var require_redefine = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_redefine.js"(exports, module) {
    var global = require_global();
    var hide = require_hide();
    var has = require_has();
    var SRC = require_uid()("src");
    var $toString = require_function_to_string();
    var TO_STRING = "toString";
    var TPL = ("" + $toString).split(TO_STRING);
    require_core().inspectSource = function(it) {
      return $toString.call(it);
    };
    (module.exports = function(O, key, val, safe) {
      var isFunction = typeof val == "function";
      if (isFunction) has(val, "name") || hide(val, "name", key);
      if (O[key] === val) return;
      if (isFunction) has(val, SRC) || hide(val, SRC, O[key] ? "" + O[key] : TPL.join(String(key)));
      if (O === global) {
        O[key] = val;
      } else if (!safe) {
        delete O[key];
        hide(O, key, val);
      } else if (O[key]) {
        O[key] = val;
      } else {
        hide(O, key, val);
      }
    })(Function.prototype, TO_STRING, function toString() {
      return typeof this == "function" && this[SRC] || $toString.call(this);
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_a-function.js
var require_a_function = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_a-function.js"(exports, module) {
    module.exports = function(it) {
      if (typeof it != "function") throw TypeError(it + " is not a function!");
      return it;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_ctx.js
var require_ctx = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_ctx.js"(exports, module) {
    var aFunction = require_a_function();
    module.exports = function(fn, that, length) {
      aFunction(fn);
      if (that === void 0) return fn;
      switch (length) {
        case 1:
          return function(a) {
            return fn.call(that, a);
          };
        case 2:
          return function(a, b) {
            return fn.call(that, a, b);
          };
        case 3:
          return function(a, b, c) {
            return fn.call(that, a, b, c);
          };
      }
      return function() {
        return fn.apply(that, arguments);
      };
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_export.js
var require_export = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_export.js"(exports, module) {
    var global = require_global();
    var core = require_core();
    var hide = require_hide();
    var redefine = require_redefine();
    var ctx = require_ctx();
    var PROTOTYPE = "prototype";
    var $export = function(type, name, source) {
      var IS_FORCED = type & $export.F;
      var IS_GLOBAL = type & $export.G;
      var IS_STATIC = type & $export.S;
      var IS_PROTO = type & $export.P;
      var IS_BIND = type & $export.B;
      var target = IS_GLOBAL ? global : IS_STATIC ? global[name] || (global[name] = {}) : (global[name] || {})[PROTOTYPE];
      var exports2 = IS_GLOBAL ? core : core[name] || (core[name] = {});
      var expProto = exports2[PROTOTYPE] || (exports2[PROTOTYPE] = {});
      var key, own, out, exp;
      if (IS_GLOBAL) source = name;
      for (key in source) {
        own = !IS_FORCED && target && target[key] !== void 0;
        out = (own ? target : source)[key];
        exp = IS_BIND && own ? ctx(out, global) : IS_PROTO && typeof out == "function" ? ctx(Function.call, out) : out;
        if (target) redefine(target, key, out, type & $export.U);
        if (exports2[key] != out) hide(exports2, key, exp);
        if (IS_PROTO && expProto[key] != out) expProto[key] = out;
      }
    };
    global.core = core;
    $export.F = 1;
    $export.G = 2;
    $export.S = 4;
    $export.P = 8;
    $export.B = 16;
    $export.W = 32;
    $export.U = 64;
    $export.R = 128;
    module.exports = $export;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.define-property.js
var require_es6_object_define_property = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.define-property.js"() {
    var $export = require_export();
    $export($export.S + $export.F * !require_descriptors(), "Object", { defineProperty: require_object_dp().f });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_defined.js
var require_defined = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_defined.js"(exports, module) {
    module.exports = function(it) {
      if (it == void 0) throw TypeError("Can't call method on  " + it);
      return it;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-object.js
var require_to_object = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-object.js"(exports, module) {
    var defined = require_defined();
    module.exports = function(it) {
      return Object(defined(it));
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-integer.js
var require_to_integer = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-integer.js"(exports, module) {
    var ceil = Math.ceil;
    var floor = Math.floor;
    module.exports = function(it) {
      return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-length.js
var require_to_length = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-length.js"(exports, module) {
    var toInteger = require_to_integer();
    var min = Math.min;
    module.exports = function(it) {
      return it > 0 ? min(toInteger(it), 9007199254740991) : 0;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_string-at.js
var require_string_at = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_string-at.js"(exports, module) {
    var toInteger = require_to_integer();
    var defined = require_defined();
    module.exports = function(TO_STRING) {
      return function(that, pos) {
        var s = String(defined(that));
        var i = toInteger(pos);
        var l = s.length;
        var a, b;
        if (i < 0 || i >= l) return TO_STRING ? "" : void 0;
        a = s.charCodeAt(i);
        return a < 55296 || a > 56319 || i + 1 === l || (b = s.charCodeAt(i + 1)) < 56320 || b > 57343 ? TO_STRING ? s.charAt(i) : a : TO_STRING ? s.slice(i, i + 2) : (a - 55296 << 10) + (b - 56320) + 65536;
      };
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_advance-string-index.js
var require_advance_string_index = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_advance-string-index.js"(exports, module) {
    "use strict";
    var at = require_string_at()(true);
    module.exports = function(S, index, unicode) {
      return index + (unicode ? at(S, index).length : 1);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_cof.js
var require_cof = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_cof.js"(exports, module) {
    var toString = {}.toString;
    module.exports = function(it) {
      return toString.call(it).slice(8, -1);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_wks.js
var require_wks = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_wks.js"(exports, module) {
    var store = require_shared()("wks");
    var uid = require_uid();
    var Symbol3 = require_global().Symbol;
    var USE_SYMBOL = typeof Symbol3 == "function";
    var $exports = module.exports = function(name) {
      return store[name] || (store[name] = USE_SYMBOL && Symbol3[name] || (USE_SYMBOL ? Symbol3 : uid)("Symbol." + name));
    };
    $exports.store = store;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_classof.js
var require_classof = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_classof.js"(exports, module) {
    var cof = require_cof();
    var TAG = require_wks()("toStringTag");
    var ARG = cof(/* @__PURE__ */ (function() {
      return arguments;
    })()) == "Arguments";
    var tryGet = function(it, key) {
      try {
        return it[key];
      } catch (e) {
      }
    };
    module.exports = function(it) {
      var O, T, B;
      return it === void 0 ? "Undefined" : it === null ? "Null" : typeof (T = tryGet(O = Object(it), TAG)) == "string" ? T : ARG ? cof(O) : (B = cof(O)) == "Object" && typeof O.callee == "function" ? "Arguments" : B;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_regexp-exec-abstract.js
var require_regexp_exec_abstract = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_regexp-exec-abstract.js"(exports, module) {
    "use strict";
    var classof = require_classof();
    var builtinExec = RegExp.prototype.exec;
    module.exports = function(R, S) {
      var exec = R.exec;
      if (typeof exec === "function") {
        var result = exec.call(R, S);
        if (typeof result !== "object") {
          throw new TypeError("RegExp exec method returned something other than an Object or null");
        }
        return result;
      }
      if (classof(R) !== "RegExp") {
        throw new TypeError("RegExp#exec called on incompatible receiver");
      }
      return builtinExec.call(R, S);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_flags.js
var require_flags = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_flags.js"(exports, module) {
    "use strict";
    var anObject = require_an_object();
    module.exports = function() {
      var that = anObject(this);
      var result = "";
      if (that.global) result += "g";
      if (that.ignoreCase) result += "i";
      if (that.multiline) result += "m";
      if (that.unicode) result += "u";
      if (that.sticky) result += "y";
      return result;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_regexp-exec.js
var require_regexp_exec = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_regexp-exec.js"(exports, module) {
    "use strict";
    var regexpFlags = require_flags();
    var nativeExec = RegExp.prototype.exec;
    var nativeReplace = String.prototype.replace;
    var patchedExec = nativeExec;
    var LAST_INDEX = "lastIndex";
    var UPDATES_LAST_INDEX_WRONG = (function() {
      var re1 = /a/, re2 = /b*/g;
      nativeExec.call(re1, "a");
      nativeExec.call(re2, "a");
      return re1[LAST_INDEX] !== 0 || re2[LAST_INDEX] !== 0;
    })();
    var NPCG_INCLUDED = /()??/.exec("")[1] !== void 0;
    var PATCH = UPDATES_LAST_INDEX_WRONG || NPCG_INCLUDED;
    if (PATCH) {
      patchedExec = function exec(str) {
        var re = this;
        var lastIndex, reCopy, match, i;
        if (NPCG_INCLUDED) {
          reCopy = new RegExp("^" + re.source + "$(?!\\s)", regexpFlags.call(re));
        }
        if (UPDATES_LAST_INDEX_WRONG) lastIndex = re[LAST_INDEX];
        match = nativeExec.call(re, str);
        if (UPDATES_LAST_INDEX_WRONG && match) {
          re[LAST_INDEX] = re.global ? match.index + match[0].length : lastIndex;
        }
        if (NPCG_INCLUDED && match && match.length > 1) {
          nativeReplace.call(match[0], reCopy, function() {
            for (i = 1; i < arguments.length - 2; i++) {
              if (arguments[i] === void 0) match[i] = void 0;
            }
          });
        }
        return match;
      };
    }
    module.exports = patchedExec;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.exec.js
var require_es6_regexp_exec = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.exec.js"() {
    "use strict";
    var regexpExec = require_regexp_exec();
    require_export()({
      target: "RegExp",
      proto: true,
      forced: regexpExec !== /./.exec
    }, {
      exec: regexpExec
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_fix-re-wks.js
var require_fix_re_wks = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_fix-re-wks.js"(exports, module) {
    "use strict";
    require_es6_regexp_exec();
    var redefine = require_redefine();
    var hide = require_hide();
    var fails = require_fails();
    var defined = require_defined();
    var wks = require_wks();
    var regexpExec = require_regexp_exec();
    var SPECIES = wks("species");
    var REPLACE_SUPPORTS_NAMED_GROUPS = !fails(function() {
      var re = /./;
      re.exec = function() {
        var result = [];
        result.groups = { a: "7" };
        return result;
      };
      return "".replace(re, "$<a>") !== "7";
    });
    var SPLIT_WORKS_WITH_OVERWRITTEN_EXEC = (function() {
      var re = /(?:)/;
      var originalExec = re.exec;
      re.exec = function() {
        return originalExec.apply(this, arguments);
      };
      var result = "ab".split(re);
      return result.length === 2 && result[0] === "a" && result[1] === "b";
    })();
    module.exports = function(KEY, length, exec) {
      var SYMBOL = wks(KEY);
      var DELEGATES_TO_SYMBOL = !fails(function() {
        var O = {};
        O[SYMBOL] = function() {
          return 7;
        };
        return ""[KEY](O) != 7;
      });
      var DELEGATES_TO_EXEC = DELEGATES_TO_SYMBOL ? !fails(function() {
        var execCalled = false;
        var re = /a/;
        re.exec = function() {
          execCalled = true;
          return null;
        };
        if (KEY === "split") {
          re.constructor = {};
          re.constructor[SPECIES] = function() {
            return re;
          };
        }
        re[SYMBOL]("");
        return !execCalled;
      }) : void 0;
      if (!DELEGATES_TO_SYMBOL || !DELEGATES_TO_EXEC || KEY === "replace" && !REPLACE_SUPPORTS_NAMED_GROUPS || KEY === "split" && !SPLIT_WORKS_WITH_OVERWRITTEN_EXEC) {
        var nativeRegExpMethod = /./[SYMBOL];
        var fns = exec(
          defined,
          SYMBOL,
          ""[KEY],
          function maybeCallNative(nativeMethod, regexp, str, arg2, forceStringMethod) {
            if (regexp.exec === regexpExec) {
              if (DELEGATES_TO_SYMBOL && !forceStringMethod) {
                return { done: true, value: nativeRegExpMethod.call(regexp, str, arg2) };
              }
              return { done: true, value: nativeMethod.call(str, regexp, arg2) };
            }
            return { done: false };
          }
        );
        var strfn = fns[0];
        var rxfn = fns[1];
        redefine(String.prototype, KEY, strfn);
        hide(
          RegExp.prototype,
          SYMBOL,
          length == 2 ? function(string, arg) {
            return rxfn.call(string, this, arg);
          } : function(string) {
            return rxfn.call(string, this);
          }
        );
      }
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.replace.js
var require_es6_regexp_replace = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.replace.js"() {
    "use strict";
    var anObject = require_an_object();
    var toObject = require_to_object();
    var toLength = require_to_length();
    var toInteger = require_to_integer();
    var advanceStringIndex = require_advance_string_index();
    var regExpExec = require_regexp_exec_abstract();
    var max = Math.max;
    var min = Math.min;
    var floor = Math.floor;
    var SUBSTITUTION_SYMBOLS = /\$([$&`']|\d\d?|<[^>]*>)/g;
    var SUBSTITUTION_SYMBOLS_NO_NAMED = /\$([$&`']|\d\d?)/g;
    var maybeToString = function(it) {
      return it === void 0 ? it : String(it);
    };
    require_fix_re_wks()("replace", 2, function(defined, REPLACE, $replace, maybeCallNative) {
      return [
        // `String.prototype.replace` method
        // https://tc39.github.io/ecma262/#sec-string.prototype.replace
        function replace(searchValue, replaceValue) {
          var O = defined(this);
          var fn = searchValue == void 0 ? void 0 : searchValue[REPLACE];
          return fn !== void 0 ? fn.call(searchValue, O, replaceValue) : $replace.call(String(O), searchValue, replaceValue);
        },
        // `RegExp.prototype[@@replace]` method
        // https://tc39.github.io/ecma262/#sec-regexp.prototype-@@replace
        function(regexp, replaceValue) {
          var res = maybeCallNative($replace, regexp, this, replaceValue);
          if (res.done) return res.value;
          var rx = anObject(regexp);
          var S = String(this);
          var functionalReplace = typeof replaceValue === "function";
          if (!functionalReplace) replaceValue = String(replaceValue);
          var global = rx.global;
          if (global) {
            var fullUnicode = rx.unicode;
            rx.lastIndex = 0;
          }
          var results = [];
          while (true) {
            var result = regExpExec(rx, S);
            if (result === null) break;
            results.push(result);
            if (!global) break;
            var matchStr = String(result[0]);
            if (matchStr === "") rx.lastIndex = advanceStringIndex(S, toLength(rx.lastIndex), fullUnicode);
          }
          var accumulatedResult = "";
          var nextSourcePosition = 0;
          for (var i = 0; i < results.length; i++) {
            result = results[i];
            var matched = String(result[0]);
            var position = max(min(toInteger(result.index), S.length), 0);
            var captures = [];
            for (var j = 1; j < result.length; j++) captures.push(maybeToString(result[j]));
            var namedCaptures = result.groups;
            if (functionalReplace) {
              var replacerArgs = [matched].concat(captures, position, S);
              if (namedCaptures !== void 0) replacerArgs.push(namedCaptures);
              var replacement = String(replaceValue.apply(void 0, replacerArgs));
            } else {
              replacement = getSubstitution(matched, S, position, captures, namedCaptures, replaceValue);
            }
            if (position >= nextSourcePosition) {
              accumulatedResult += S.slice(nextSourcePosition, position) + replacement;
              nextSourcePosition = position + matched.length;
            }
          }
          return accumulatedResult + S.slice(nextSourcePosition);
        }
      ];
      function getSubstitution(matched, str, position, captures, namedCaptures, replacement) {
        var tailPos = position + matched.length;
        var m = captures.length;
        var symbols = SUBSTITUTION_SYMBOLS_NO_NAMED;
        if (namedCaptures !== void 0) {
          namedCaptures = toObject(namedCaptures);
          symbols = SUBSTITUTION_SYMBOLS;
        }
        return $replace.call(replacement, symbols, function(match, ch) {
          var capture;
          switch (ch.charAt(0)) {
            case "$":
              return "$";
            case "&":
              return matched;
            case "`":
              return str.slice(0, position);
            case "'":
              return str.slice(tailPos);
            case "<":
              capture = namedCaptures[ch.slice(1, -1)];
              break;
            default:
              var n = +ch;
              if (n === 0) return match;
              if (n > m) {
                var f = floor(n / 10);
                if (f === 0) return match;
                if (f <= m) return captures[f - 1] === void 0 ? ch.charAt(1) : captures[f - 1] + ch.charAt(1);
                return match;
              }
              capture = captures[n - 1];
          }
          return capture === void 0 ? "" : capture;
        });
      }
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iobject.js
var require_iobject = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iobject.js"(exports, module) {
    var cof = require_cof();
    module.exports = Object("z").propertyIsEnumerable(0) ? Object : function(it) {
      return cof(it) == "String" ? it.split("") : Object(it);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-iobject.js
var require_to_iobject = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-iobject.js"(exports, module) {
    var IObject = require_iobject();
    var defined = require_defined();
    module.exports = function(it) {
      return IObject(defined(it));
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-absolute-index.js
var require_to_absolute_index = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_to-absolute-index.js"(exports, module) {
    var toInteger = require_to_integer();
    var max = Math.max;
    var min = Math.min;
    module.exports = function(index, length) {
      index = toInteger(index);
      return index < 0 ? max(index + length, 0) : min(index, length);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-includes.js
var require_array_includes = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-includes.js"(exports, module) {
    var toIObject = require_to_iobject();
    var toLength = require_to_length();
    var toAbsoluteIndex = require_to_absolute_index();
    module.exports = function(IS_INCLUDES) {
      return function($this, el, fromIndex) {
        var O = toIObject($this);
        var length = toLength(O.length);
        var index = toAbsoluteIndex(fromIndex, length);
        var value;
        if (IS_INCLUDES && el != el) while (length > index) {
          value = O[index++];
          if (value != value) return true;
        }
        else for (; length > index; index++) if (IS_INCLUDES || index in O) {
          if (O[index] === el) return IS_INCLUDES || index || 0;
        }
        return !IS_INCLUDES && -1;
      };
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_strict-method.js
var require_strict_method = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_strict-method.js"(exports, module) {
    "use strict";
    var fails = require_fails();
    module.exports = function(method, arg) {
      return !!method && fails(function() {
        arg ? method.call(null, function() {
        }, 1) : method.call(null);
      });
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.index-of.js
var require_es6_array_index_of = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.index-of.js"() {
    "use strict";
    var $export = require_export();
    var $indexOf = require_array_includes()(false);
    var $native = [].indexOf;
    var NEGATIVE_ZERO = !!$native && 1 / [1].indexOf(1, -0) < 0;
    $export($export.P + $export.F * (NEGATIVE_ZERO || !require_strict_method()($native)), "Array", {
      // 22.1.3.11 / 15.4.4.14 Array.prototype.indexOf(searchElement [, fromIndex])
      indexOf: function indexOf(searchElement) {
        return NEGATIVE_ZERO ? $native.apply(this, arguments) || 0 : $indexOf(this, searchElement, arguments[1]);
      }
    });
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/cashtag.js
var require_cashtag = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/cashtag.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var cashtag = /[a-z]{1,6}(?:[._][a-z]{1,2})?/i;
    var _default = cashtag;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/punct.js
var require_punct = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/punct.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var punct = /\!'#%&'\(\)*\+,\\\-\.\/:;<=>\?@\[\]\^_{|}~\$/;
    var _default = punct;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-pie.js
var require_object_pie = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-pie.js"(exports) {
    exports.f = {}.propertyIsEnumerable;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gopd.js
var require_object_gopd = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gopd.js"(exports) {
    var pIE = require_object_pie();
    var createDesc = require_property_desc();
    var toIObject = require_to_iobject();
    var toPrimitive = require_to_primitive();
    var has = require_has();
    var IE8_DOM_DEFINE = require_ie8_dom_define();
    var gOPD = Object.getOwnPropertyDescriptor;
    exports.f = require_descriptors() ? gOPD : function getOwnPropertyDescriptor(O, P) {
      O = toIObject(O);
      P = toPrimitive(P, true);
      if (IE8_DOM_DEFINE) try {
        return gOPD(O, P);
      } catch (e) {
      }
      if (has(O, P)) return createDesc(!pIE.f.call(O, P), O[P]);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_set-proto.js
var require_set_proto = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_set-proto.js"(exports, module) {
    var isObject = require_is_object();
    var anObject = require_an_object();
    var check = function(O, proto) {
      anObject(O);
      if (!isObject(proto) && proto !== null) throw TypeError(proto + ": can't set as prototype!");
    };
    module.exports = {
      set: Object.setPrototypeOf || ("__proto__" in {} ? (
        // eslint-disable-line
        (function(test, buggy, set) {
          try {
            set = require_ctx()(Function.call, require_object_gopd().f(Object.prototype, "__proto__").set, 2);
            set(test, []);
            buggy = !(test instanceof Array);
          } catch (e) {
            buggy = true;
          }
          return function setPrototypeOf(O, proto) {
            check(O, proto);
            if (buggy) O.__proto__ = proto;
            else set(O, proto);
            return O;
          };
        })({}, false)
      ) : void 0),
      check
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_inherit-if-required.js
var require_inherit_if_required = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_inherit-if-required.js"(exports, module) {
    var isObject = require_is_object();
    var setPrototypeOf = require_set_proto().set;
    module.exports = function(that, target, C) {
      var S = target.constructor;
      var P;
      if (S !== C && typeof S == "function" && (P = S.prototype) !== C.prototype && isObject(P) && setPrototypeOf) {
        setPrototypeOf(that, P);
      }
      return that;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_shared-key.js
var require_shared_key = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_shared-key.js"(exports, module) {
    var shared = require_shared()("keys");
    var uid = require_uid();
    module.exports = function(key) {
      return shared[key] || (shared[key] = uid(key));
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-keys-internal.js
var require_object_keys_internal = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-keys-internal.js"(exports, module) {
    var has = require_has();
    var toIObject = require_to_iobject();
    var arrayIndexOf = require_array_includes()(false);
    var IE_PROTO = require_shared_key()("IE_PROTO");
    module.exports = function(object, names) {
      var O = toIObject(object);
      var i = 0;
      var result = [];
      var key;
      for (key in O) if (key != IE_PROTO) has(O, key) && result.push(key);
      while (names.length > i) if (has(O, key = names[i++])) {
        ~arrayIndexOf(result, key) || result.push(key);
      }
      return result;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_enum-bug-keys.js
var require_enum_bug_keys = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_enum-bug-keys.js"(exports, module) {
    module.exports = "constructor,hasOwnProperty,isPrototypeOf,propertyIsEnumerable,toLocaleString,toString,valueOf".split(",");
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gopn.js
var require_object_gopn = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gopn.js"(exports) {
    var $keys = require_object_keys_internal();
    var hiddenKeys = require_enum_bug_keys().concat("length", "prototype");
    exports.f = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
      return $keys(O, hiddenKeys);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-regexp.js
var require_is_regexp = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-regexp.js"(exports, module) {
    var isObject = require_is_object();
    var cof = require_cof();
    var MATCH = require_wks()("match");
    module.exports = function(it) {
      var isRegExp;
      return isObject(it) && ((isRegExp = it[MATCH]) !== void 0 ? !!isRegExp : cof(it) == "RegExp");
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_set-species.js
var require_set_species = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_set-species.js"(exports, module) {
    "use strict";
    var global = require_global();
    var dP = require_object_dp();
    var DESCRIPTORS = require_descriptors();
    var SPECIES = require_wks()("species");
    module.exports = function(KEY) {
      var C = global[KEY];
      if (DESCRIPTORS && C && !C[SPECIES]) dP.f(C, SPECIES, {
        configurable: true,
        get: function() {
          return this;
        }
      });
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.constructor.js
var require_es6_regexp_constructor = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.constructor.js"() {
    var global = require_global();
    var inheritIfRequired = require_inherit_if_required();
    var dP = require_object_dp().f;
    var gOPN = require_object_gopn().f;
    var isRegExp = require_is_regexp();
    var $flags = require_flags();
    var $RegExp = global.RegExp;
    var Base2 = $RegExp;
    var proto = $RegExp.prototype;
    var re1 = /a/g;
    var re2 = /a/g;
    var CORRECT_NEW = new $RegExp(re1) !== re1;
    if (require_descriptors() && (!CORRECT_NEW || require_fails()(function() {
      re2[require_wks()("match")] = false;
      return $RegExp(re1) != re1 || $RegExp(re2) == re2 || $RegExp(re1, "i") != "/a/i";
    }))) {
      $RegExp = function RegExp2(p, f) {
        var tiRE = this instanceof $RegExp;
        var piRE = isRegExp(p);
        var fiU = f === void 0;
        return !tiRE && piRE && p.constructor === $RegExp && fiU ? p : inheritIfRequired(
          CORRECT_NEW ? new Base2(piRE && !fiU ? p.source : p, f) : Base2((piRE = p instanceof $RegExp) ? p.source : p, piRE && fiU ? $flags.call(p) : f),
          tiRE ? this : proto,
          $RegExp
        );
      };
      proxy = function(key) {
        key in $RegExp || dP($RegExp, key, {
          configurable: true,
          get: function() {
            return Base2[key];
          },
          set: function(it) {
            Base2[key] = it;
          }
        });
      };
      for (keys = gOPN(Base2), i = 0; keys.length > i; ) proxy(keys[i++]);
      proto.constructor = $RegExp;
      $RegExp.prototype = proto;
      require_redefine()(global, "RegExp", $RegExp);
    }
    var proxy;
    var keys;
    var i;
    require_set_species()("RegExp");
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/regexSupplant.js
var require_regexSupplant = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/regexSupplant.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_replace();
    require_es6_regexp_constructor();
    require_es6_array_index_of();
    function _default(regex, map, flags) {
      flags = flags || "";
      if (typeof regex !== "string") {
        if (regex.global && flags.indexOf("g") < 0) {
          flags += "g";
        }
        if (regex.ignoreCase && flags.indexOf("i") < 0) {
          flags += "i";
        }
        if (regex.multiline && flags.indexOf("m") < 0) {
          flags += "m";
        }
        regex = regex.source;
      }
      return new RegExp(regex.replace(/#\{(\w+)\}/g, function(match, name) {
        var newRegex = map[name] || "";
        if (typeof newRegex !== "string") {
          newRegex = newRegex.source;
        }
        return newRegex;
      }), flags);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/spacesGroup.js
var require_spacesGroup = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/spacesGroup.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var spacesGroup = /\x09-\x0D\x20\x85\xA0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000/;
    var _default = spacesGroup;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/spaces.js
var require_spaces = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/spaces.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _spacesGroup = _interopRequireDefault(require_spacesGroup());
    var _default = (0, _regexSupplant["default"])(/[#{spacesGroup}]/, {
      spacesGroup: _spacesGroup["default"]
    });
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validCashtag.js
var require_validCashtag = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validCashtag.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _cashtag = _interopRequireDefault(require_cashtag());
    var _punct = _interopRequireDefault(require_punct());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _spaces = _interopRequireDefault(require_spaces());
    var validCashtag = (0, _regexSupplant["default"])("(^|#{spaces})(\\$)(#{cashtag})(?=$|\\s|[#{punct}])", {
      cashtag: _cashtag["default"],
      spaces: _spaces["default"],
      punct: _punct["default"]
    }, "gi");
    var _default = validCashtag;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractCashtagsWithIndices.js
var require_extractCashtagsWithIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractCashtagsWithIndices.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_replace();
    require_es6_array_index_of();
    var _validCashtag = _interopRequireDefault(require_validCashtag());
    function _default(text) {
      if (!text || text.indexOf("$") === -1) {
        return [];
      }
      var tags = [];
      text.replace(_validCashtag["default"], function(match, before, dollar, cashtag, offset, chunk) {
        var startPosition = offset + before.length;
        var endPosition = startPosition + cashtag.length + 1;
        tags.push({
          cashtag,
          indices: [startPosition, endPosition]
        });
      });
      return tags;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.match.js
var require_es6_regexp_match = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.match.js"() {
    "use strict";
    var anObject = require_an_object();
    var toLength = require_to_length();
    var advanceStringIndex = require_advance_string_index();
    var regExpExec = require_regexp_exec_abstract();
    require_fix_re_wks()("match", 1, function(defined, MATCH, $match, maybeCallNative) {
      return [
        // `String.prototype.match` method
        // https://tc39.github.io/ecma262/#sec-string.prototype.match
        function match(regexp) {
          var O = defined(this);
          var fn = regexp == void 0 ? void 0 : regexp[MATCH];
          return fn !== void 0 ? fn.call(regexp, O) : new RegExp(regexp)[MATCH](String(O));
        },
        // `RegExp.prototype[@@match]` method
        // https://tc39.github.io/ecma262/#sec-regexp.prototype-@@match
        function(regexp) {
          var res = maybeCallNative($match, regexp, this);
          if (res.done) return res.value;
          var rx = anObject(regexp);
          var S = String(this);
          if (!rx.global) return regExpExec(rx, S);
          var fullUnicode = rx.unicode;
          rx.lastIndex = 0;
          var A = [];
          var n = 0;
          var result;
          while ((result = regExpExec(rx, S)) !== null) {
            var matchStr = String(result[0]);
            A[n] = matchStr;
            if (matchStr === "") rx.lastIndex = advanceStringIndex(S, toLength(rx.lastIndex), fullUnicode);
            n++;
          }
          return n === 0 ? null : A;
        }
      ];
    });
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashSigns.js
var require_hashSigns = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashSigns.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var hashSigns = /[#＃]/;
    var _default = hashSigns;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/endHashtagMatch.js
var require_endHashtagMatch = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/endHashtagMatch.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _hashSigns = _interopRequireDefault(require_hashSigns());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var endHashtagMatch = (0, _regexSupplant["default"])(/^(?:#{hashSigns}|:\/\/)/, {
      hashSigns: _hashSigns["default"]
    });
    var _default = endHashtagMatch;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validCCTLD.js
var require_validCCTLD = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validCCTLD.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_regexp_constructor();
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var validCCTLD = (0, _regexSupplant["default"])(RegExp("(?:(?:한국|香港|澳門|新加坡|台灣|台湾|中國|中国|გე|ລາວ|ไทย|ලංකා|ഭാരതം|ಭಾರತ|భారత్|சிங்கப்பூர்|இலங்கை|இந்தியா|ଭାରତ|ભારત|ਭਾਰਤ|ভাৰত|ভারত|বাংলা|भारोत|भारतम्|भारत|ڀارت|پاکستان|موريتانيا|مليسيا|مصر|قطر|فلسطين|عمان|عراق|سورية|سودان|تونس|بھارت|بارت|ایران|امارات|المغرب|السعودية|الجزائر|البحرين|الاردن|հայ|қаз|укр|срб|рф|мон|мкд|ею|бел|бг|ευ|ελ|zw|zm|za|yt|ye|ws|wf|vu|vn|vi|vg|ve|vc|va|uz|uy|us|um|uk|ug|ua|tz|tw|tv|tt|tr|tp|to|tn|tm|tl|tk|tj|th|tg|tf|td|tc|sz|sy|sx|sv|su|st|ss|sr|so|sn|sm|sl|sk|sj|si|sh|sg|se|sd|sc|sb|sa|rw|ru|rs|ro|re|qa|py|pw|pt|ps|pr|pn|pm|pl|pk|ph|pg|pf|pe|pa|om|nz|nu|nr|np|no|nl|ni|ng|nf|ne|nc|na|mz|my|mx|mw|mv|mu|mt|ms|mr|mq|mp|mo|mn|mm|ml|mk|mh|mg|mf|me|md|mc|ma|ly|lv|lu|lt|ls|lr|lk|li|lc|lb|la|kz|ky|kw|kr|kp|kn|km|ki|kh|kg|ke|jp|jo|jm|je|it|is|ir|iq|io|in|im|il|ie|id|hu|ht|hr|hn|hm|hk|gy|gw|gu|gt|gs|gr|gq|gp|gn|gm|gl|gi|gh|gg|gf|ge|gd|gb|ga|fr|fo|fm|fk|fj|fi|eu|et|es|er|eh|eg|ee|ec|dz|do|dm|dk|dj|de|cz|cy|cx|cw|cv|cu|cr|co|cn|cm|cl|ck|ci|ch|cg|cf|cd|cc|ca|bz|by|bw|bv|bt|bs|br|bq|bo|bn|bm|bl|bj|bi|bh|bg|bf|be|bd|bb|ba|az|ax|aw|au|at|as|ar|aq|ao|an|am|al|ai|ag|af|ae|ad|ac)(?=[^0-9a-zA-Z@+-]|$))"));
    var _default = validCCTLD;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/directionalMarkersGroup.js
var require_directionalMarkersGroup = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/directionalMarkersGroup.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var directionalMarkersGroup = /\u202A-\u202E\u061C\u200E\u200F\u2066\u2067\u2068\u2069/;
    var _default = directionalMarkersGroup;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidCharsGroup.js
var require_invalidCharsGroup = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidCharsGroup.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var invalidCharsGroup = /\uFFFE\uFEFF\uFFFF/;
    var _default = invalidCharsGroup;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/stringSupplant.js
var require_stringSupplant = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/stringSupplant.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_replace();
    function _default(str, map) {
      return str.replace(/#\{(\w+)\}/g, function(match, name) {
        return map[name] || "";
      });
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidDomainChars.js
var require_invalidDomainChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidDomainChars.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _directionalMarkersGroup = _interopRequireDefault(require_directionalMarkersGroup());
    var _invalidCharsGroup = _interopRequireDefault(require_invalidCharsGroup());
    var _punct = _interopRequireDefault(require_punct());
    var _spacesGroup = _interopRequireDefault(require_spacesGroup());
    var _stringSupplant = _interopRequireDefault(require_stringSupplant());
    var invalidDomainChars = (0, _stringSupplant["default"])("#{punct}#{spacesGroup}#{invalidCharsGroup}#{directionalMarkersGroup}", {
      punct: _punct["default"],
      spacesGroup: _spacesGroup["default"],
      invalidCharsGroup: _invalidCharsGroup["default"],
      directionalMarkersGroup: _directionalMarkersGroup["default"]
    });
    var _default = invalidDomainChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validDomainChars.js
var require_validDomainChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validDomainChars.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _invalidDomainChars = _interopRequireDefault(require_invalidDomainChars());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var validDomainChars = (0, _regexSupplant["default"])(/[^#{invalidDomainChars}]/, {
      invalidDomainChars: _invalidDomainChars["default"]
    });
    var _default = validDomainChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validDomainName.js
var require_validDomainName = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validDomainName.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validDomainChars = _interopRequireDefault(require_validDomainChars());
    var validDomainName = (0, _regexSupplant["default"])(/(?:(?:#{validDomainChars}(?:-|#{validDomainChars})*)?#{validDomainChars}\.)/, {
      validDomainChars: _validDomainChars["default"]
    });
    var _default = validDomainName;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validGTLD.js
var require_validGTLD = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validGTLD.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_regexp_constructor();
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var validGTLD = (0, _regexSupplant["default"])(RegExp("(?:(?:삼성|닷컴|닷넷|香格里拉|餐厅|食品|飞利浦|電訊盈科|集团|通販|购物|谷歌|诺基亚|联通|网络|网站|网店|网址|组织机构|移动|珠宝|点看|游戏|淡马锡|机构|書籍|时尚|新闻|政府|政务|招聘|手表|手机|我爱你|慈善|微博|广东|工行|家電|娱乐|天主教|大拿|大众汽车|在线|嘉里大酒店|嘉里|商标|商店|商城|公益|公司|八卦|健康|信息|佛山|企业|中文网|中信|世界|ポイント|ファッション|セール|ストア|コム|グーグル|クラウド|みんな|คอม|संगठन|नेट|कॉम|همراه|موقع|موبايلي|كوم|كاثوليك|عرب|شبكة|بيتك|بازار|العليان|ارامكو|اتصالات|ابوظبي|קום|сайт|рус|орг|онлайн|москва|ком|католик|дети|zuerich|zone|zippo|zip|zero|zara|zappos|yun|youtube|you|yokohama|yoga|yodobashi|yandex|yamaxun|yahoo|yachts|xyz|xxx|xperia|xin|xihuan|xfinity|xerox|xbox|wtf|wtc|wow|world|works|work|woodside|wolterskluwer|wme|winners|wine|windows|win|williamhill|wiki|wien|whoswho|weir|weibo|wedding|wed|website|weber|webcam|weatherchannel|weather|watches|watch|warman|wanggou|wang|walter|walmart|wales|vuelos|voyage|voto|voting|vote|volvo|volkswagen|vodka|vlaanderen|vivo|viva|vistaprint|vista|vision|visa|virgin|vip|vin|villas|viking|vig|video|viajes|vet|versicherung|vermögensberatung|vermögensberater|verisign|ventures|vegas|vanguard|vana|vacations|ups|uol|uno|university|unicom|uconnect|ubs|ubank|tvs|tushu|tunes|tui|tube|trv|trust|travelersinsurance|travelers|travelchannel|travel|training|trading|trade|toys|toyota|town|tours|total|toshiba|toray|top|tools|tokyo|today|tmall|tkmaxx|tjx|tjmaxx|tirol|tires|tips|tiffany|tienda|tickets|tiaa|theatre|theater|thd|teva|tennis|temasek|telefonica|telecity|tel|technology|tech|team|tdk|tci|taxi|tax|tattoo|tatar|tatamotors|target|taobao|talk|taipei|tab|systems|symantec|sydney|swiss|swiftcover|swatch|suzuki|surgery|surf|support|supply|supplies|sucks|style|study|studio|stream|store|storage|stockholm|stcgroup|stc|statoil|statefarm|statebank|starhub|star|staples|stada|srt|srl|spreadbetting|spot|sport|spiegel|space|soy|sony|song|solutions|solar|sohu|software|softbank|social|soccer|sncf|smile|smart|sling|skype|sky|skin|ski|site|singles|sina|silk|shriram|showtime|show|shouji|shopping|shop|shoes|shiksha|shia|shell|shaw|sharp|shangrila|sfr|sexy|sex|sew|seven|ses|services|sener|select|seek|security|secure|seat|search|scot|scor|scjohnson|science|schwarz|schule|school|scholarships|schmidt|schaeffler|scb|sca|sbs|sbi|saxo|save|sas|sarl|sapo|sap|sanofi|sandvikcoromant|sandvik|samsung|samsclub|salon|sale|sakura|safety|safe|saarland|ryukyu|rwe|run|ruhr|rugby|rsvp|room|rogers|rodeo|rocks|rocher|rmit|rip|rio|ril|rightathome|ricoh|richardli|rich|rexroth|reviews|review|restaurant|rest|republican|report|repair|rentals|rent|ren|reliance|reit|reisen|reise|rehab|redumbrella|redstone|red|recipes|realty|realtor|realestate|read|raid|radio|racing|qvc|quest|quebec|qpon|pwc|pub|prudential|pru|protection|property|properties|promo|progressive|prof|productions|prod|pro|prime|press|praxi|pramerica|post|porn|politie|poker|pohl|pnc|plus|plumbing|playstation|play|place|pizza|pioneer|pink|ping|pin|pid|pictures|pictet|pics|piaget|physio|photos|photography|photo|phone|philips|phd|pharmacy|pfizer|pet|pccw|pay|passagens|party|parts|partners|pars|paris|panerai|panasonic|pamperedchef|page|ovh|ott|otsuka|osaka|origins|orientexpress|organic|org|orange|oracle|open|ooo|onyourside|online|onl|ong|one|omega|ollo|oldnavy|olayangroup|olayan|okinawa|office|off|observer|obi|nyc|ntt|nrw|nra|nowtv|nowruz|now|norton|northwesternmutual|nokia|nissay|nissan|ninja|nikon|nike|nico|nhk|ngo|nfl|nexus|nextdirect|next|news|newholland|new|neustar|network|netflix|netbank|net|nec|nba|navy|natura|nationwide|name|nagoya|nadex|nab|mutuelle|mutual|museum|mtr|mtpc|mtn|msd|movistar|movie|mov|motorcycles|moto|moscow|mortgage|mormon|mopar|montblanc|monster|money|monash|mom|moi|moe|moda|mobily|mobile|mobi|mma|mls|mlb|mitsubishi|mit|mint|mini|mil|microsoft|miami|metlife|merckmsd|meo|menu|men|memorial|meme|melbourne|meet|media|med|mckinsey|mcdonalds|mcd|mba|mattel|maserati|marshalls|marriott|markets|marketing|market|map|mango|management|man|makeup|maison|maif|madrid|macys|luxury|luxe|lupin|lundbeck|ltda|ltd|lplfinancial|lpl|love|lotto|lotte|london|lol|loft|locus|locker|loans|loan|llp|llc|lixil|living|live|lipsy|link|linde|lincoln|limo|limited|lilly|like|lighting|lifestyle|lifeinsurance|life|lidl|liaison|lgbt|lexus|lego|legal|lefrak|leclerc|lease|lds|lawyer|law|latrobe|latino|lat|lasalle|lanxess|landrover|land|lancome|lancia|lancaster|lamer|lamborghini|ladbrokes|lacaixa|kyoto|kuokgroup|kred|krd|kpn|kpmg|kosher|komatsu|koeln|kiwi|kitchen|kindle|kinder|kim|kia|kfh|kerryproperties|kerrylogistics|kerryhotels|kddi|kaufen|juniper|juegos|jprs|jpmorgan|joy|jot|joburg|jobs|jnj|jmp|jll|jlc|jio|jewelry|jetzt|jeep|jcp|jcb|java|jaguar|iwc|iveco|itv|itau|istanbul|ist|ismaili|iselect|irish|ipiranga|investments|intuit|international|intel|int|insure|insurance|institute|ink|ing|info|infiniti|industries|inc|immobilien|immo|imdb|imamat|ikano|iinet|ifm|ieee|icu|ice|icbc|ibm|hyundai|hyatt|hughes|htc|hsbc|how|house|hotmail|hotels|hoteles|hot|hosting|host|hospital|horse|honeywell|honda|homesense|homes|homegoods|homedepot|holiday|holdings|hockey|hkt|hiv|hitachi|hisamitsu|hiphop|hgtv|hermes|here|helsinki|help|healthcare|health|hdfcbank|hdfc|hbo|haus|hangout|hamburg|hair|guru|guitars|guide|guge|gucci|guardian|group|grocery|gripe|green|gratis|graphics|grainger|gov|got|gop|google|goog|goodyear|goodhands|goo|golf|goldpoint|gold|godaddy|gmx|gmo|gmbh|gmail|globo|global|gle|glass|glade|giving|gives|gifts|gift|ggee|george|genting|gent|gea|gdn|gbiz|gay|garden|gap|games|game|gallup|gallo|gallery|gal|fyi|futbol|furniture|fund|fun|fujixerox|fujitsu|ftr|frontier|frontdoor|frogans|frl|fresenius|free|fox|foundation|forum|forsale|forex|ford|football|foodnetwork|food|foo|fly|flsmidth|flowers|florist|flir|flights|flickr|fitness|fit|fishing|fish|firmdale|firestone|fire|financial|finance|final|film|fido|fidelity|fiat|ferrero|ferrari|feedback|fedex|fast|fashion|farmers|farm|fans|fan|family|faith|fairwinds|fail|fage|extraspace|express|exposed|expert|exchange|everbank|events|eus|eurovision|etisalat|esurance|estate|esq|erni|ericsson|equipment|epson|epost|enterprises|engineering|engineer|energy|emerck|email|education|edu|edeka|eco|eat|earth|dvr|dvag|durban|dupont|duns|dunlop|duck|dubai|dtv|drive|download|dot|doosan|domains|doha|dog|dodge|doctor|docs|dnp|diy|dish|discover|discount|directory|direct|digital|diet|diamonds|dhl|dev|design|desi|dentist|dental|democrat|delta|deloitte|dell|delivery|degree|deals|dealer|deal|dds|dclk|day|datsun|dating|date|data|dance|dad|dabur|cyou|cymru|cuisinella|csc|cruises|cruise|crs|crown|cricket|creditunion|creditcard|credit|cpa|courses|coupons|coupon|country|corsica|coop|cool|cookingchannel|cooking|contractors|contact|consulting|construction|condos|comsec|computer|compare|company|community|commbank|comcast|com|cologne|college|coffee|codes|coach|clubmed|club|cloud|clothing|clinique|clinic|click|cleaning|claims|cityeats|city|citic|citi|citadel|cisco|circle|cipriani|church|chrysler|chrome|christmas|chloe|chintai|cheap|chat|chase|charity|channel|chanel|cfd|cfa|cern|ceo|center|ceb|cbs|cbre|cbn|cba|catholic|catering|cat|casino|cash|caseih|case|casa|cartier|cars|careers|career|care|cards|caravan|car|capitalone|capital|capetown|canon|cancerresearch|camp|camera|cam|calvinklein|call|cal|cafe|cab|bzh|buzz|buy|business|builders|build|bugatti|budapest|brussels|brother|broker|broadway|bridgestone|bradesco|box|boutique|bot|boston|bostik|bosch|boots|booking|book|boo|bond|bom|bofa|boehringer|boats|bnpparibas|bnl|bmw|bms|blue|bloomberg|blog|blockbuster|blanco|blackfriday|black|biz|bio|bingo|bing|bike|bid|bible|bharti|bet|bestbuy|best|berlin|bentley|beer|beauty|beats|bcn|bcg|bbva|bbt|bbc|bayern|bauhaus|basketball|baseball|bargains|barefoot|barclays|barclaycard|barcelona|bar|bank|band|bananarepublic|banamex|baidu|baby|azure|axa|aws|avianca|autos|auto|author|auspost|audio|audible|audi|auction|attorney|athleta|associates|asia|asda|arte|art|arpa|army|archi|aramco|arab|aquarelle|apple|app|apartments|aol|anz|anquan|android|analytics|amsterdam|amica|amfam|amex|americanfamily|americanexpress|alstom|alsace|ally|allstate|allfinanz|alipay|alibaba|alfaromeo|akdn|airtel|airforce|airbus|aigo|aig|agency|agakhan|africa|afl|afamilycompany|aetna|aero|aeg|adult|ads|adac|actor|active|aco|accountants|accountant|accenture|academy|abudhabi|abogado|able|abc|abbvie|abbott|abb|abarth|aarp|aaa|onion)(?=[^0-9a-zA-Z@+-]|$))"));
    var _default = validGTLD;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validPunycode.js
var require_validPunycode = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validPunycode.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validPunycode = /(?:xn--[\-0-9a-z]+)/;
    var _default = validPunycode;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validSubdomain.js
var require_validSubdomain = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validSubdomain.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validDomainChars = _interopRequireDefault(require_validDomainChars());
    var validSubdomain = (0, _regexSupplant["default"])(/(?:(?:#{validDomainChars}(?:[_-]|#{validDomainChars})*)?#{validDomainChars}\.)/, {
      validDomainChars: _validDomainChars["default"]
    });
    var _default = validSubdomain;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validDomain.js
var require_validDomain = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validDomain.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validCCTLD = _interopRequireDefault(require_validCCTLD());
    var _validDomainName = _interopRequireDefault(require_validDomainName());
    var _validGTLD = _interopRequireDefault(require_validGTLD());
    var _validPunycode = _interopRequireDefault(require_validPunycode());
    var _validSubdomain = _interopRequireDefault(require_validSubdomain());
    var validDomain = (0, _regexSupplant["default"])(/(?:#{validSubdomain}*#{validDomainName}(?:#{validGTLD}|#{validCCTLD}|#{validPunycode}))/, {
      validDomainName: _validDomainName["default"],
      validSubdomain: _validSubdomain["default"],
      validGTLD: _validGTLD["default"],
      validCCTLD: _validCCTLD["default"],
      validPunycode: _validPunycode["default"]
    });
    var _default = validDomain;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validPortNumber.js
var require_validPortNumber = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validPortNumber.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validPortNumber = /[0-9]+/;
    var _default = validPortNumber;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/cyrillicLettersAndMarks.js
var require_cyrillicLettersAndMarks = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/cyrillicLettersAndMarks.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var cyrillicLettersAndMarks = /\u0400-\u04FF/;
    var _default = cyrillicLettersAndMarks;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/latinAccentChars.js
var require_latinAccentChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/latinAccentChars.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var latinAccentChars = /\xC0-\xD6\xD8-\xF6\xF8-\xFF\u0100-\u024F\u0253\u0254\u0256\u0257\u0259\u025B\u0263\u0268\u026F\u0272\u0289\u028B\u02BB\u0300-\u036F\u1E00-\u1EFF/;
    var _default = latinAccentChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validGeneralUrlPathChars.js
var require_validGeneralUrlPathChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validGeneralUrlPathChars.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _cyrillicLettersAndMarks = _interopRequireDefault(require_cyrillicLettersAndMarks());
    var _latinAccentChars = _interopRequireDefault(require_latinAccentChars());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var validGeneralUrlPathChars = (0, _regexSupplant["default"])(/[a-z#{cyrillicLettersAndMarks}0-9!\*';:=\+,\.\$\/%#\[\]\-\u2013_~@\|&#{latinAccentChars}]/i, {
      cyrillicLettersAndMarks: _cyrillicLettersAndMarks["default"],
      latinAccentChars: _latinAccentChars["default"]
    });
    var _default = validGeneralUrlPathChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlBalancedParens.js
var require_validUrlBalancedParens = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlBalancedParens.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validGeneralUrlPathChars = _interopRequireDefault(require_validGeneralUrlPathChars());
    var validUrlBalancedParens = (0, _regexSupplant["default"])("\\((?:#{validGeneralUrlPathChars}+|(?:#{validGeneralUrlPathChars}*\\(#{validGeneralUrlPathChars}+\\)#{validGeneralUrlPathChars}*))\\)", {
      validGeneralUrlPathChars: _validGeneralUrlPathChars["default"]
    }, "i");
    var _default = validUrlBalancedParens;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlPathEndingChars.js
var require_validUrlPathEndingChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlPathEndingChars.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _cyrillicLettersAndMarks = _interopRequireDefault(require_cyrillicLettersAndMarks());
    var _latinAccentChars = _interopRequireDefault(require_latinAccentChars());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validUrlBalancedParens = _interopRequireDefault(require_validUrlBalancedParens());
    var validUrlPathEndingChars = (0, _regexSupplant["default"])(/[\+\-a-z#{cyrillicLettersAndMarks}0-9=_#\/#{latinAccentChars}]|(?:#{validUrlBalancedParens})/i, {
      cyrillicLettersAndMarks: _cyrillicLettersAndMarks["default"],
      latinAccentChars: _latinAccentChars["default"],
      validUrlBalancedParens: _validUrlBalancedParens["default"]
    });
    var _default = validUrlPathEndingChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlPath.js
var require_validUrlPath = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlPath.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validGeneralUrlPathChars = _interopRequireDefault(require_validGeneralUrlPathChars());
    var _validUrlBalancedParens = _interopRequireDefault(require_validUrlBalancedParens());
    var _validUrlPathEndingChars = _interopRequireDefault(require_validUrlPathEndingChars());
    var validUrlPath = (0, _regexSupplant["default"])("(?:(?:#{validGeneralUrlPathChars}*(?:#{validUrlBalancedParens}#{validGeneralUrlPathChars}*)*#{validUrlPathEndingChars})|(?:@#{validGeneralUrlPathChars}+/))", {
      validGeneralUrlPathChars: _validGeneralUrlPathChars["default"],
      validUrlBalancedParens: _validUrlBalancedParens["default"],
      validUrlPathEndingChars: _validUrlPathEndingChars["default"]
    }, "i");
    var _default = validUrlPath;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlPrecedingChars.js
var require_validUrlPrecedingChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlPrecedingChars.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _directionalMarkersGroup = _interopRequireDefault(require_directionalMarkersGroup());
    var _invalidCharsGroup = _interopRequireDefault(require_invalidCharsGroup());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var validUrlPrecedingChars = (0, _regexSupplant["default"])(/(?:[^A-Za-z0-9@＠$#＃#{invalidCharsGroup}]|[#{directionalMarkersGroup}]|^)/, {
      invalidCharsGroup: _invalidCharsGroup["default"],
      directionalMarkersGroup: _directionalMarkersGroup["default"]
    });
    var _default = validUrlPrecedingChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlQueryChars.js
var require_validUrlQueryChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlQueryChars.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validUrlQueryChars = /[a-z0-9!?\*'@\(\);:&=\+\$\/%#\[\]\-_\.,~|]/i;
    var _default = validUrlQueryChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlQueryEndingChars.js
var require_validUrlQueryEndingChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validUrlQueryEndingChars.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validUrlQueryEndingChars = /[a-z0-9\-_&=#\/]/i;
    var _default = validUrlQueryEndingChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/extractUrl.js
var require_extractUrl = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/extractUrl.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validDomain = _interopRequireDefault(require_validDomain());
    var _validPortNumber = _interopRequireDefault(require_validPortNumber());
    var _validUrlPath = _interopRequireDefault(require_validUrlPath());
    var _validUrlPrecedingChars = _interopRequireDefault(require_validUrlPrecedingChars());
    var _validUrlQueryChars = _interopRequireDefault(require_validUrlQueryChars());
    var _validUrlQueryEndingChars = _interopRequireDefault(require_validUrlQueryEndingChars());
    var extractUrl = (0, _regexSupplant["default"])("((#{validUrlPrecedingChars})((https?:\\/\\/)?(#{validDomain})(?::(#{validPortNumber}))?(\\/#{validUrlPath}*)?(\\?#{validUrlQueryChars}*#{validUrlQueryEndingChars})?))", {
      validUrlPrecedingChars: _validUrlPrecedingChars["default"],
      validDomain: _validDomain["default"],
      validPortNumber: _validPortNumber["default"],
      validUrlPath: _validUrlPath["default"],
      validUrlQueryChars: _validUrlQueryChars["default"],
      validUrlQueryEndingChars: _validUrlQueryEndingChars["default"]
    }, "gi");
    var _default = extractUrl;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidUrlWithoutProtocolPrecedingChars.js
var require_invalidUrlWithoutProtocolPrecedingChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidUrlWithoutProtocolPrecedingChars.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var invalidUrlWithoutProtocolPrecedingChars = /[-_.\/]$/;
    var _default = invalidUrlWithoutProtocolPrecedingChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_species-constructor.js
var require_species_constructor = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_species-constructor.js"(exports, module) {
    var anObject = require_an_object();
    var aFunction = require_a_function();
    var SPECIES = require_wks()("species");
    module.exports = function(O, D) {
      var C = anObject(O).constructor;
      var S;
      return C === void 0 || (S = anObject(C)[SPECIES]) == void 0 ? D : aFunction(S);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.split.js
var require_es6_regexp_split = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.split.js"() {
    "use strict";
    var isRegExp = require_is_regexp();
    var anObject = require_an_object();
    var speciesConstructor = require_species_constructor();
    var advanceStringIndex = require_advance_string_index();
    var toLength = require_to_length();
    var callRegExpExec = require_regexp_exec_abstract();
    var regexpExec = require_regexp_exec();
    var fails = require_fails();
    var $min = Math.min;
    var $push = [].push;
    var $SPLIT = "split";
    var LENGTH = "length";
    var LAST_INDEX = "lastIndex";
    var MAX_UINT32 = 4294967295;
    var SUPPORTS_Y = !fails(function() {
      RegExp(MAX_UINT32, "y");
    });
    require_fix_re_wks()("split", 2, function(defined, SPLIT, $split, maybeCallNative) {
      var internalSplit;
      if ("abbc"[$SPLIT](/(b)*/)[1] == "c" || "test"[$SPLIT](/(?:)/, -1)[LENGTH] != 4 || "ab"[$SPLIT](/(?:ab)*/)[LENGTH] != 2 || "."[$SPLIT](/(.?)(.?)/)[LENGTH] != 4 || "."[$SPLIT](/()()/)[LENGTH] > 1 || ""[$SPLIT](/.?/)[LENGTH]) {
        internalSplit = function(separator, limit) {
          var string = String(this);
          if (separator === void 0 && limit === 0) return [];
          if (!isRegExp(separator)) return $split.call(string, separator, limit);
          var output = [];
          var flags = (separator.ignoreCase ? "i" : "") + (separator.multiline ? "m" : "") + (separator.unicode ? "u" : "") + (separator.sticky ? "y" : "");
          var lastLastIndex = 0;
          var splitLimit = limit === void 0 ? MAX_UINT32 : limit >>> 0;
          var separatorCopy = new RegExp(separator.source, flags + "g");
          var match, lastIndex, lastLength;
          while (match = regexpExec.call(separatorCopy, string)) {
            lastIndex = separatorCopy[LAST_INDEX];
            if (lastIndex > lastLastIndex) {
              output.push(string.slice(lastLastIndex, match.index));
              if (match[LENGTH] > 1 && match.index < string[LENGTH]) $push.apply(output, match.slice(1));
              lastLength = match[0][LENGTH];
              lastLastIndex = lastIndex;
              if (output[LENGTH] >= splitLimit) break;
            }
            if (separatorCopy[LAST_INDEX] === match.index) separatorCopy[LAST_INDEX]++;
          }
          if (lastLastIndex === string[LENGTH]) {
            if (lastLength || !separatorCopy.test("")) output.push("");
          } else output.push(string.slice(lastLastIndex));
          return output[LENGTH] > splitLimit ? output.slice(0, splitLimit) : output;
        };
      } else if ("0"[$SPLIT](void 0, 0)[LENGTH]) {
        internalSplit = function(separator, limit) {
          return separator === void 0 && limit === 0 ? [] : $split.call(this, separator, limit);
        };
      } else {
        internalSplit = $split;
      }
      return [
        // `String.prototype.split` method
        // https://tc39.github.io/ecma262/#sec-string.prototype.split
        function split(separator, limit) {
          var O = defined(this);
          var splitter = separator == void 0 ? void 0 : separator[SPLIT];
          return splitter !== void 0 ? splitter.call(separator, O, limit) : internalSplit.call(String(O), separator, limit);
        },
        // `RegExp.prototype[@@split]` method
        // https://tc39.github.io/ecma262/#sec-regexp.prototype-@@split
        //
        // NOTE: This cannot be properly polyfilled in engines that don't support
        // the 'y' flag.
        function(regexp, limit) {
          var res = maybeCallNative(internalSplit, regexp, this, limit, internalSplit !== $split);
          if (res.done) return res.value;
          var rx = anObject(regexp);
          var S = String(this);
          var C = speciesConstructor(rx, RegExp);
          var unicodeMatching = rx.unicode;
          var flags = (rx.ignoreCase ? "i" : "") + (rx.multiline ? "m" : "") + (rx.unicode ? "u" : "") + (SUPPORTS_Y ? "y" : "g");
          var splitter = new C(SUPPORTS_Y ? rx : "^(?:" + rx.source + ")", flags);
          var lim = limit === void 0 ? MAX_UINT32 : limit >>> 0;
          if (lim === 0) return [];
          if (S.length === 0) return callRegExpExec(splitter, S) === null ? [S] : [];
          var p = 0;
          var q = 0;
          var A = [];
          while (q < S.length) {
            splitter.lastIndex = SUPPORTS_Y ? q : 0;
            var z = callRegExpExec(splitter, SUPPORTS_Y ? S : S.slice(q));
            var e;
            if (z === null || (e = $min(toLength(splitter.lastIndex + (SUPPORTS_Y ? 0 : q)), S.length)) === p) {
              q = advanceStringIndex(S, q, unicodeMatching);
            } else {
              A.push(S.slice(p, q));
              if (A.length === lim) return A;
              for (var i = 1; i <= z.length - 1; i++) {
                A.push(z[i]);
                if (A.length === lim) return A;
              }
              q = p = e;
            }
          }
          A.push(S.slice(p));
          return A;
        }
      ];
    });
  }
});

// node_modules/.pnpm/punycode@2.3.1/node_modules/punycode/punycode.js
var require_punycode = __commonJS({
  "node_modules/.pnpm/punycode@2.3.1/node_modules/punycode/punycode.js"(exports, module) {
    "use strict";
    var maxInt = 2147483647;
    var base = 36;
    var tMin = 1;
    var tMax = 26;
    var skew = 38;
    var damp = 700;
    var initialBias = 72;
    var initialN = 128;
    var delimiter = "-";
    var regexPunycode = /^xn--/;
    var regexNonASCII = /[^\0-\x7F]/;
    var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;
    var errors = {
      "overflow": "Overflow: input needs wider integers to process",
      "not-basic": "Illegal input >= 0x80 (not a basic code point)",
      "invalid-input": "Invalid input"
    };
    var baseMinusTMin = base - tMin;
    var floor = Math.floor;
    var stringFromCharCode = String.fromCharCode;
    function error(type) {
      throw new RangeError(errors[type]);
    }
    function map(array, callback) {
      const result = [];
      let length = array.length;
      while (length--) {
        result[length] = callback(array[length]);
      }
      return result;
    }
    function mapDomain(domain, callback) {
      const parts = domain.split("@");
      let result = "";
      if (parts.length > 1) {
        result = parts[0] + "@";
        domain = parts[1];
      }
      domain = domain.replace(regexSeparators, ".");
      const labels = domain.split(".");
      const encoded = map(labels, callback).join(".");
      return result + encoded;
    }
    function ucs2decode(string) {
      const output = [];
      let counter = 0;
      const length = string.length;
      while (counter < length) {
        const value = string.charCodeAt(counter++);
        if (value >= 55296 && value <= 56319 && counter < length) {
          const extra = string.charCodeAt(counter++);
          if ((extra & 64512) == 56320) {
            output.push(((value & 1023) << 10) + (extra & 1023) + 65536);
          } else {
            output.push(value);
            counter--;
          }
        } else {
          output.push(value);
        }
      }
      return output;
    }
    var ucs2encode = (codePoints) => String.fromCodePoint(...codePoints);
    var basicToDigit = function(codePoint) {
      if (codePoint >= 48 && codePoint < 58) {
        return 26 + (codePoint - 48);
      }
      if (codePoint >= 65 && codePoint < 91) {
        return codePoint - 65;
      }
      if (codePoint >= 97 && codePoint < 123) {
        return codePoint - 97;
      }
      return base;
    };
    var digitToBasic = function(digit, flag) {
      return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
    };
    var adapt = function(delta, numPoints, firstTime) {
      let k = 0;
      delta = firstTime ? floor(delta / damp) : delta >> 1;
      delta += floor(delta / numPoints);
      for (; delta > baseMinusTMin * tMax >> 1; k += base) {
        delta = floor(delta / baseMinusTMin);
      }
      return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
    };
    var decode = function(input) {
      const output = [];
      const inputLength = input.length;
      let i = 0;
      let n = initialN;
      let bias = initialBias;
      let basic = input.lastIndexOf(delimiter);
      if (basic < 0) {
        basic = 0;
      }
      for (let j = 0; j < basic; ++j) {
        if (input.charCodeAt(j) >= 128) {
          error("not-basic");
        }
        output.push(input.charCodeAt(j));
      }
      for (let index = basic > 0 ? basic + 1 : 0; index < inputLength; ) {
        const oldi = i;
        for (let w = 1, k = base; ; k += base) {
          if (index >= inputLength) {
            error("invalid-input");
          }
          const digit = basicToDigit(input.charCodeAt(index++));
          if (digit >= base) {
            error("invalid-input");
          }
          if (digit > floor((maxInt - i) / w)) {
            error("overflow");
          }
          i += digit * w;
          const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
          if (digit < t) {
            break;
          }
          const baseMinusT = base - t;
          if (w > floor(maxInt / baseMinusT)) {
            error("overflow");
          }
          w *= baseMinusT;
        }
        const out = output.length + 1;
        bias = adapt(i - oldi, out, oldi == 0);
        if (floor(i / out) > maxInt - n) {
          error("overflow");
        }
        n += floor(i / out);
        i %= out;
        output.splice(i++, 0, n);
      }
      return String.fromCodePoint(...output);
    };
    var encode = function(input) {
      const output = [];
      input = ucs2decode(input);
      const inputLength = input.length;
      let n = initialN;
      let delta = 0;
      let bias = initialBias;
      for (const currentValue of input) {
        if (currentValue < 128) {
          output.push(stringFromCharCode(currentValue));
        }
      }
      const basicLength = output.length;
      let handledCPCount = basicLength;
      if (basicLength) {
        output.push(delimiter);
      }
      while (handledCPCount < inputLength) {
        let m = maxInt;
        for (const currentValue of input) {
          if (currentValue >= n && currentValue < m) {
            m = currentValue;
          }
        }
        const handledCPCountPlusOne = handledCPCount + 1;
        if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
          error("overflow");
        }
        delta += (m - n) * handledCPCountPlusOne;
        n = m;
        for (const currentValue of input) {
          if (currentValue < n && ++delta > maxInt) {
            error("overflow");
          }
          if (currentValue === n) {
            let q = delta;
            for (let k = base; ; k += base) {
              const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
              if (q < t) {
                break;
              }
              const qMinusT = q - t;
              const baseMinusT = base - t;
              output.push(
                stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
              );
              q = floor(qMinusT / baseMinusT);
            }
            output.push(stringFromCharCode(digitToBasic(q, 0)));
            bias = adapt(delta, handledCPCountPlusOne, handledCPCount === basicLength);
            delta = 0;
            ++handledCPCount;
          }
        }
        ++delta;
        ++n;
      }
      return output.join("");
    };
    var toUnicode = function(input) {
      return mapDomain(input, function(string) {
        return regexPunycode.test(string) ? decode(string.slice(4).toLowerCase()) : string;
      });
    };
    var toASCII = function(input) {
      return mapDomain(input, function(string) {
        return regexNonASCII.test(string) ? "xn--" + encode(string) : string;
      });
    };
    var punycode = {
      /**
       * A string representing the current Punycode.js version number.
       * @memberOf punycode
       * @type String
       */
      "version": "2.3.1",
      /**
       * An object of methods to convert from JavaScript's internal character
       * representation (UCS-2) to Unicode code points, and back.
       * @see <https://mathiasbynens.be/notes/javascript-encoding>
       * @memberOf punycode
       * @type Object
       */
      "ucs2": {
        "decode": ucs2decode,
        "encode": ucs2encode
      },
      "decode": decode,
      "encode": encode,
      "toASCII": toASCII,
      "toUnicode": toUnicode
    };
    module.exports = punycode;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validAsciiDomain.js
var require_validAsciiDomain = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validAsciiDomain.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _latinAccentChars = _interopRequireDefault(require_latinAccentChars());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validCCTLD = _interopRequireDefault(require_validCCTLD());
    var _validGTLD = _interopRequireDefault(require_validGTLD());
    var _validPunycode = _interopRequireDefault(require_validPunycode());
    var validAsciiDomain = (0, _regexSupplant["default"])(/(?:(?:[\-a-z0-9#{latinAccentChars}]+)\.)+(?:#{validGTLD}|#{validCCTLD}|#{validPunycode})/gi, {
      latinAccentChars: _latinAccentChars["default"],
      validGTLD: _validGTLD["default"],
      validCCTLD: _validCCTLD["default"],
      validPunycode: _validPunycode["default"]
    });
    var _default = validAsciiDomain;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/idna.js
var require_idna = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/idna.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_regexp_split();
    require_es6_regexp_match();
    var _punycode = _interopRequireDefault(require_punycode());
    var _validAsciiDomain = _interopRequireDefault(require_validAsciiDomain());
    var MAX_DOMAIN_LABEL_LENGTH = 63;
    var PUNYCODE_ENCODED_DOMAIN_PREFIX = "xn--";
    var idna = {
      toAscii: function toAscii(domain) {
        if (domain.substring(0, 4) === PUNYCODE_ENCODED_DOMAIN_PREFIX && !domain.match(_validAsciiDomain["default"])) {
          return;
        }
        var labels = domain.split(".");
        for (var i = 0; i < labels.length; i++) {
          var label = labels[i];
          var punycodeEncodedLabel = _punycode["default"].toASCII(label);
          if (punycodeEncodedLabel.length < 1 || punycodeEncodedLabel.length > MAX_DOMAIN_LABEL_LENGTH) {
            return;
          }
        }
        return labels.join(".");
      }
    };
    var _default = idna;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validTcoUrl.js
var require_validTcoUrl = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validTcoUrl.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validUrlQueryChars = _interopRequireDefault(require_validUrlQueryChars());
    var _validUrlQueryEndingChars = _interopRequireDefault(require_validUrlQueryEndingChars());
    var validTcoUrl = (0, _regexSupplant["default"])(/^https?:\/\/t\.co\/([a-z0-9]+)(?:\?#{validUrlQueryChars}*#{validUrlQueryEndingChars})?/, {
      validUrlQueryChars: _validUrlQueryChars["default"],
      validUrlQueryEndingChars: _validUrlQueryEndingChars["default"]
    }, "i");
    var _default = validTcoUrl;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractUrlsWithIndices.js
var require_extractUrlsWithIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractUrlsWithIndices.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_array_index_of();
    require_es6_regexp_replace();
    require_es6_regexp_constructor();
    require_es6_regexp_match();
    var _extractUrl = _interopRequireDefault(require_extractUrl());
    var _invalidUrlWithoutProtocolPrecedingChars = _interopRequireDefault(require_invalidUrlWithoutProtocolPrecedingChars());
    var _idna = _interopRequireDefault(require_idna());
    var _validAsciiDomain = _interopRequireDefault(require_validAsciiDomain());
    var _validTcoUrl = _interopRequireDefault(require_validTcoUrl());
    var DEFAULT_PROTOCOL = "https://";
    var DEFAULT_PROTOCOL_OPTIONS = {
      extractUrlsWithoutProtocol: true
    };
    var MAX_URL_LENGTH = 4096;
    var MAX_TCO_SLUG_LENGTH = 40;
    var extractUrlsWithIndices = function extractUrlsWithIndices2(text) {
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : DEFAULT_PROTOCOL_OPTIONS;
      if (!text || (options.extractUrlsWithoutProtocol ? !text.match(/\./) : !text.match(/:/))) {
        return [];
      }
      var urls = [];
      var _loop = function _loop2() {
        var before = RegExp.$2;
        var url = RegExp.$3;
        var protocol = RegExp.$4;
        var domain = RegExp.$5;
        var path = RegExp.$7;
        var endPosition = _extractUrl["default"].lastIndex;
        var startPosition = endPosition - url.length;
        if (!isValidUrl(url, protocol || DEFAULT_PROTOCOL, domain)) {
          return "continue";
        }
        if (!protocol) {
          if (!options.extractUrlsWithoutProtocol || before.match(_invalidUrlWithoutProtocolPrecedingChars["default"])) {
            return "continue";
          }
          var lastUrl = null;
          var asciiEndPosition = 0;
          domain.replace(_validAsciiDomain["default"], function(asciiDomain) {
            var asciiStartPosition = domain.indexOf(asciiDomain, asciiEndPosition);
            asciiEndPosition = asciiStartPosition + asciiDomain.length;
            lastUrl = {
              url: asciiDomain,
              indices: [startPosition + asciiStartPosition, startPosition + asciiEndPosition]
            };
            urls.push(lastUrl);
          });
          if (lastUrl == null) {
            return "continue";
          }
          if (path) {
            lastUrl.url = url.replace(domain, lastUrl.url);
            lastUrl.indices[1] = endPosition;
          }
        } else {
          if (url.match(_validTcoUrl["default"])) {
            var tcoUrlSlug = RegExp.$1;
            if (tcoUrlSlug && tcoUrlSlug.length > MAX_TCO_SLUG_LENGTH) {
              return "continue";
            } else {
              url = RegExp.lastMatch;
              endPosition = startPosition + url.length;
            }
          }
          urls.push({
            url,
            indices: [startPosition, endPosition]
          });
        }
      };
      while (_extractUrl["default"].exec(text)) {
        var _ret = _loop();
        if (_ret === "continue") continue;
      }
      return urls;
    };
    var isValidUrl = function isValidUrl2(url, protocol, domain) {
      var urlLength = url.length;
      var punycodeEncodedDomain = _idna["default"].toAscii(domain);
      if (!punycodeEncodedDomain || !punycodeEncodedDomain.length) {
        return false;
      }
      urlLength = urlLength + punycodeEncodedDomain.length - domain.length;
      return protocol.length + urlLength <= MAX_URL_LENGTH;
    };
    var _default = extractUrlsWithIndices;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.sort.js
var require_es6_array_sort = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.sort.js"() {
    "use strict";
    var $export = require_export();
    var aFunction = require_a_function();
    var toObject = require_to_object();
    var fails = require_fails();
    var $sort = [].sort;
    var test = [1, 2, 3];
    $export($export.P + $export.F * (fails(function() {
      test.sort(void 0);
    }) || !fails(function() {
      test.sort(null);
    }) || !require_strict_method()($sort)), "Array", {
      // 22.1.3.25 Array.prototype.sort(comparefn)
      sort: function sort(comparefn) {
        return comparefn === void 0 ? $sort.call(toObject(this)) : $sort.call(toObject(this), aFunction(comparefn));
      }
    });
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/removeOverlappingEntities.js
var require_removeOverlappingEntities = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/removeOverlappingEntities.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_array_sort();
    function _default(entities) {
      entities.sort(function(a, b) {
        return a.indices[0] - b.indices[0];
      });
      var prev = entities[0];
      for (var i = 1; i < entities.length; i++) {
        if (prev.indices[1] > entities[i].indices[0]) {
          entities.splice(i, 1);
          i--;
        } else {
          prev = entities[i];
        }
      }
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/astralLetterAndMarks.js
var require_astralLetterAndMarks = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/astralLetterAndMarks.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var astralLetterAndMarks = /\ud800[\udc00-\udc0b\udc0d-\udc26\udc28-\udc3a\udc3c\udc3d\udc3f-\udc4d\udc50-\udc5d\udc80-\udcfa\uddfd\ude80-\ude9c\udea0-\uded0\udee0\udf00-\udf1f\udf30-\udf40\udf42-\udf49\udf50-\udf7a\udf80-\udf9d\udfa0-\udfc3\udfc8-\udfcf]|\ud801[\udc00-\udc9d\udd00-\udd27\udd30-\udd63\ude00-\udf36\udf40-\udf55\udf60-\udf67]|\ud802[\udc00-\udc05\udc08\udc0a-\udc35\udc37\udc38\udc3c\udc3f-\udc55\udc60-\udc76\udc80-\udc9e\udd00-\udd15\udd20-\udd39\udd80-\uddb7\uddbe\uddbf\ude00-\ude03\ude05\ude06\ude0c-\ude13\ude15-\ude17\ude19-\ude33\ude38-\ude3a\ude3f\ude60-\ude7c\ude80-\ude9c\udec0-\udec7\udec9-\udee6\udf00-\udf35\udf40-\udf55\udf60-\udf72\udf80-\udf91]|\ud803[\udc00-\udc48]|\ud804[\udc00-\udc46\udc7f-\udcba\udcd0-\udce8\udd00-\udd34\udd50-\udd73\udd76\udd80-\uddc4\uddda\ude00-\ude11\ude13-\ude37\udeb0-\udeea\udf01-\udf03\udf05-\udf0c\udf0f\udf10\udf13-\udf28\udf2a-\udf30\udf32\udf33\udf35-\udf39\udf3c-\udf44\udf47\udf48\udf4b-\udf4d\udf57\udf5d-\udf63\udf66-\udf6c\udf70-\udf74]|\ud805[\udc80-\udcc5\udcc7\udd80-\uddb5\uddb8-\uddc0\ude00-\ude40\ude44\ude80-\udeb7]|\ud806[\udca0-\udcdf\udcff\udec0-\udef8]|\ud808[\udc00-\udf98]|\ud80c[\udc00-\udfff]|\ud80d[\udc00-\udc2e]|\ud81a[\udc00-\ude38\ude40-\ude5e\uded0-\udeed\udef0-\udef4\udf00-\udf36\udf40-\udf43\udf63-\udf77\udf7d-\udf8f]|\ud81b[\udf00-\udf44\udf50-\udf7e\udf8f-\udf9f]|\ud82c[\udc00\udc01]|\ud82f[\udc00-\udc6a\udc70-\udc7c\udc80-\udc88\udc90-\udc99\udc9d\udc9e]|\ud834[\udd65-\udd69\udd6d-\udd72\udd7b-\udd82\udd85-\udd8b\uddaa-\uddad\ude42-\ude44]|\ud835[\udc00-\udc54\udc56-\udc9c\udc9e\udc9f\udca2\udca5\udca6\udca9-\udcac\udcae-\udcb9\udcbb\udcbd-\udcc3\udcc5-\udd05\udd07-\udd0a\udd0d-\udd14\udd16-\udd1c\udd1e-\udd39\udd3b-\udd3e\udd40-\udd44\udd46\udd4a-\udd50\udd52-\udea5\udea8-\udec0\udec2-\udeda\udedc-\udefa\udefc-\udf14\udf16-\udf34\udf36-\udf4e\udf50-\udf6e\udf70-\udf88\udf8a-\udfa8\udfaa-\udfc2\udfc4-\udfcb]|\ud83a[\udc00-\udcc4\udcd0-\udcd6]|\ud83b[\ude00-\ude03\ude05-\ude1f\ude21\ude22\ude24\ude27\ude29-\ude32\ude34-\ude37\ude39\ude3b\ude42\ude47\ude49\ude4b\ude4d-\ude4f\ude51\ude52\ude54\ude57\ude59\ude5b\ude5d\ude5f\ude61\ude62\ude64\ude67-\ude6a\ude6c-\ude72\ude74-\ude77\ude79-\ude7c\ude7e\ude80-\ude89\ude8b-\ude9b\udea1-\udea3\udea5-\udea9\udeab-\udebb]|\ud840[\udc00-\udfff]|\ud841[\udc00-\udfff]|\ud842[\udc00-\udfff]|\ud843[\udc00-\udfff]|\ud844[\udc00-\udfff]|\ud845[\udc00-\udfff]|\ud846[\udc00-\udfff]|\ud847[\udc00-\udfff]|\ud848[\udc00-\udfff]|\ud849[\udc00-\udfff]|\ud84a[\udc00-\udfff]|\ud84b[\udc00-\udfff]|\ud84c[\udc00-\udfff]|\ud84d[\udc00-\udfff]|\ud84e[\udc00-\udfff]|\ud84f[\udc00-\udfff]|\ud850[\udc00-\udfff]|\ud851[\udc00-\udfff]|\ud852[\udc00-\udfff]|\ud853[\udc00-\udfff]|\ud854[\udc00-\udfff]|\ud855[\udc00-\udfff]|\ud856[\udc00-\udfff]|\ud857[\udc00-\udfff]|\ud858[\udc00-\udfff]|\ud859[\udc00-\udfff]|\ud85a[\udc00-\udfff]|\ud85b[\udc00-\udfff]|\ud85c[\udc00-\udfff]|\ud85d[\udc00-\udfff]|\ud85e[\udc00-\udfff]|\ud85f[\udc00-\udfff]|\ud860[\udc00-\udfff]|\ud861[\udc00-\udfff]|\ud862[\udc00-\udfff]|\ud863[\udc00-\udfff]|\ud864[\udc00-\udfff]|\ud865[\udc00-\udfff]|\ud866[\udc00-\udfff]|\ud867[\udc00-\udfff]|\ud868[\udc00-\udfff]|\ud869[\udc00-\uded6\udf00-\udfff]|\ud86a[\udc00-\udfff]|\ud86b[\udc00-\udfff]|\ud86c[\udc00-\udfff]|\ud86d[\udc00-\udf34\udf40-\udfff]|\ud86e[\udc00-\udc1d]|\ud87e[\udc00-\ude1d]|\udb40[\udd00-\uddef]/;
    var _default = astralLetterAndMarks;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/bmpLetterAndMarks.js
var require_bmpLetterAndMarks = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/bmpLetterAndMarks.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var bmpLetterAndMarks = /A-Za-z\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0300-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u0483-\u052f\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u05d0-\u05ea\u05f0-\u05f2\u0610-\u061a\u0620-\u065f\u066e-\u06d3\u06d5-\u06dc\u06df-\u06e8\u06ea-\u06ef\u06fa-\u06fc\u06ff\u0710-\u074a\u074d-\u07b1\u07ca-\u07f5\u07fa\u0800-\u082d\u0840-\u085b\u08a0-\u08b2\u08e4-\u0963\u0971-\u0983\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bc-\u09c4\u09c7\u09c8\u09cb-\u09ce\u09d7\u09dc\u09dd\u09df-\u09e3\u09f0\u09f1\u0a01-\u0a03\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a59-\u0a5c\u0a5e\u0a70-\u0a75\u0a81-\u0a83\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abc-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ad0\u0ae0-\u0ae3\u0b01-\u0b03\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3c-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b5c\u0b5d\u0b5f-\u0b63\u0b71\u0b82\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd0\u0bd7\u0c00-\u0c03\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c58\u0c59\u0c60-\u0c63\u0c81-\u0c83\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbc-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0cde\u0ce0-\u0ce3\u0cf1\u0cf2\u0d01-\u0d03\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d-\u0d44\u0d46-\u0d48\u0d4a-\u0d4e\u0d57\u0d60-\u0d63\u0d7a-\u0d7f\u0d82\u0d83\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e01-\u0e3a\u0e40-\u0e4e\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb9\u0ebb-\u0ebd\u0ec0-\u0ec4\u0ec6\u0ec8-\u0ecd\u0edc-\u0edf\u0f00\u0f18\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f47\u0f49-\u0f6c\u0f71-\u0f84\u0f86-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u103f\u1050-\u108f\u109a-\u109d\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u135d-\u135f\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16f1-\u16f8\u1700-\u170c\u170e-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176c\u176e-\u1770\u1772\u1773\u1780-\u17d3\u17d7\u17dc\u17dd\u180b-\u180d\u1820-\u1877\u1880-\u18aa\u18b0-\u18f5\u1900-\u191e\u1920-\u192b\u1930-\u193b\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a1b\u1a20-\u1a5e\u1a60-\u1a7c\u1a7f\u1aa7\u1ab0-\u1abe\u1b00-\u1b4b\u1b6b-\u1b73\u1b80-\u1baf\u1bba-\u1bf3\u1c00-\u1c37\u1c4d-\u1c4f\u1c5a-\u1c7d\u1cd0-\u1cd2\u1cd4-\u1cf6\u1cf8\u1cf9\u1d00-\u1df5\u1dfc-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u20d0-\u20f0\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2183\u2184\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d7f-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2de0-\u2dff\u2e2f\u3005\u3006\u302a-\u302f\u3031-\u3035\u303b\u303c\u3041-\u3096\u3099\u309a\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua672\ua674-\ua67d\ua67f-\ua69d\ua69f-\ua6e5\ua6f0\ua6f1\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua7ad\ua7b0\ua7b1\ua7f7-\ua827\ua840-\ua873\ua880-\ua8c4\ua8e0-\ua8f7\ua8fb\ua90a-\ua92d\ua930-\ua953\ua960-\ua97c\ua980-\ua9c0\ua9cf\ua9e0-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa36\uaa40-\uaa4d\uaa60-\uaa76\uaa7a-\uaac2\uaadb-\uaadd\uaae0-\uaaef\uaaf2-\uaaf6\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab5f\uab64\uab65\uabc0-\uabea\uabec\uabed\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf870-\uf87f\uf882\uf884-\uf89f\uf8b8\uf8c1-\uf8d6\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe00-\ufe0f\ufe20-\ufe2d\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc/;
    var _default = bmpLetterAndMarks;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/nonBmpCodePairs.js
var require_nonBmpCodePairs = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/nonBmpCodePairs.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var nonBmpCodePairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/gm;
    var _default = nonBmpCodePairs;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagAlpha.js
var require_hashtagAlpha = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagAlpha.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _astralLetterAndMarks = _interopRequireDefault(require_astralLetterAndMarks());
    var _bmpLetterAndMarks = _interopRequireDefault(require_bmpLetterAndMarks());
    var _nonBmpCodePairs = _interopRequireDefault(require_nonBmpCodePairs());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var hashtagAlpha = (0, _regexSupplant["default"])(/(?:[#{bmpLetterAndMarks}]|(?=#{nonBmpCodePairs})(?:#{astralLetterAndMarks}))/, {
      bmpLetterAndMarks: _bmpLetterAndMarks["default"],
      nonBmpCodePairs: _nonBmpCodePairs["default"],
      astralLetterAndMarks: _astralLetterAndMarks["default"]
    });
    var _default = hashtagAlpha;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/astralNumerals.js
var require_astralNumerals = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/astralNumerals.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var astralNumerals = /\ud801[\udca0-\udca9]|\ud804[\udc66-\udc6f\udcf0-\udcf9\udd36-\udd3f\uddd0-\uddd9\udef0-\udef9]|\ud805[\udcd0-\udcd9\ude50-\ude59\udec0-\udec9]|\ud806[\udce0-\udce9]|\ud81a[\ude60-\ude69\udf50-\udf59]|\ud835[\udfce-\udfff]/;
    var _default = astralNumerals;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/bmpNumerals.js
var require_bmpNumerals = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/bmpNumerals.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var bmpNumerals = /0-9\u0660-\u0669\u06f0-\u06f9\u07c0-\u07c9\u0966-\u096f\u09e6-\u09ef\u0a66-\u0a6f\u0ae6-\u0aef\u0b66-\u0b6f\u0be6-\u0bef\u0c66-\u0c6f\u0ce6-\u0cef\u0d66-\u0d6f\u0de6-\u0def\u0e50-\u0e59\u0ed0-\u0ed9\u0f20-\u0f29\u1040-\u1049\u1090-\u1099\u17e0-\u17e9\u1810-\u1819\u1946-\u194f\u19d0-\u19d9\u1a80-\u1a89\u1a90-\u1a99\u1b50-\u1b59\u1bb0-\u1bb9\u1c40-\u1c49\u1c50-\u1c59\ua620-\ua629\ua8d0-\ua8d9\ua900-\ua909\ua9d0-\ua9d9\ua9f0-\ua9f9\uaa50-\uaa59\uabf0-\uabf9\uff10-\uff19/;
    var _default = bmpNumerals;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagSpecialChars.js
var require_hashtagSpecialChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagSpecialChars.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var hashtagSpecialChars = /_\u200c\u200d\ua67e\u05be\u05f3\u05f4\uff5e\u301c\u309b\u309c\u30a0\u30fb\u3003\u0f0b\u0f0c\xb7/;
    var _default = hashtagSpecialChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagAlphaNumeric.js
var require_hashtagAlphaNumeric = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagAlphaNumeric.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _astralLetterAndMarks = _interopRequireDefault(require_astralLetterAndMarks());
    var _astralNumerals = _interopRequireDefault(require_astralNumerals());
    var _bmpLetterAndMarks = _interopRequireDefault(require_bmpLetterAndMarks());
    var _bmpNumerals = _interopRequireDefault(require_bmpNumerals());
    var _hashtagSpecialChars = _interopRequireDefault(require_hashtagSpecialChars());
    var _nonBmpCodePairs = _interopRequireDefault(require_nonBmpCodePairs());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var hashtagAlphaNumeric = (0, _regexSupplant["default"])(/(?:[#{bmpLetterAndMarks}#{bmpNumerals}#{hashtagSpecialChars}]|(?=#{nonBmpCodePairs})(?:#{astralLetterAndMarks}|#{astralNumerals}))/, {
      bmpLetterAndMarks: _bmpLetterAndMarks["default"],
      bmpNumerals: _bmpNumerals["default"],
      hashtagSpecialChars: _hashtagSpecialChars["default"],
      nonBmpCodePairs: _nonBmpCodePairs["default"],
      astralLetterAndMarks: _astralLetterAndMarks["default"],
      astralNumerals: _astralNumerals["default"]
    });
    var _default = hashtagAlphaNumeric;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/codePoint.js
var require_codePoint = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/codePoint.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var codePoint = /(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])/;
    var _default = codePoint;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagBoundary.js
var require_hashtagBoundary = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/hashtagBoundary.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _codePoint = _interopRequireDefault(require_codePoint());
    var _hashtagAlphaNumeric = _interopRequireDefault(require_hashtagAlphaNumeric());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var hashtagBoundary = (0, _regexSupplant["default"])(/(?:^|\uFE0E|\uFE0F|$|(?!#{hashtagAlphaNumeric}|&)#{codePoint})/, {
      codePoint: _codePoint["default"],
      hashtagAlphaNumeric: _hashtagAlphaNumeric["default"]
    });
    var _default = hashtagBoundary;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validHashtag.js
var require_validHashtag = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validHashtag.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _hashSigns = _interopRequireDefault(require_hashSigns());
    var _hashtagAlpha = _interopRequireDefault(require_hashtagAlpha());
    var _hashtagAlphaNumeric = _interopRequireDefault(require_hashtagAlphaNumeric());
    var _hashtagBoundary = _interopRequireDefault(require_hashtagBoundary());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var validHashtag = (0, _regexSupplant["default"])(/(#{hashtagBoundary})(#{hashSigns})(?!\uFE0F|\u20E3)(#{hashtagAlphaNumeric}*#{hashtagAlpha}#{hashtagAlphaNumeric}*)/gi, {
      hashtagBoundary: _hashtagBoundary["default"],
      hashSigns: _hashSigns["default"],
      hashtagAlphaNumeric: _hashtagAlphaNumeric["default"],
      hashtagAlpha: _hashtagAlpha["default"]
    });
    var _default = validHashtag;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractHashtagsWithIndices.js
var require_extractHashtagsWithIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractHashtagsWithIndices.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_regexp_replace();
    require_es6_regexp_match();
    var _endHashtagMatch = _interopRequireDefault(require_endHashtagMatch());
    var _extractUrlsWithIndices = _interopRequireDefault(require_extractUrlsWithIndices());
    var _hashSigns = _interopRequireDefault(require_hashSigns());
    var _removeOverlappingEntities = _interopRequireDefault(require_removeOverlappingEntities());
    var _validHashtag = _interopRequireDefault(require_validHashtag());
    var extractHashtagsWithIndices = function extractHashtagsWithIndices2(text, options) {
      if (!options) {
        options = {
          checkUrlOverlap: true
        };
      }
      if (!text || !text.match(_hashSigns["default"])) {
        return [];
      }
      var tags = [];
      text.replace(_validHashtag["default"], function(match, before, hash, hashText, offset, chunk) {
        var after = chunk.slice(offset + match.length);
        if (after.match(_endHashtagMatch["default"])) {
          return;
        }
        var startPosition = offset + before.length;
        var endPosition = startPosition + hashText.length + 1;
        tags.push({
          hashtag: hashText,
          indices: [startPosition, endPosition]
        });
      });
      if (options.checkUrlOverlap) {
        var urls = (0, _extractUrlsWithIndices["default"])(text);
        if (urls.length > 0) {
          var entities = tags.concat(urls);
          (0, _removeOverlappingEntities["default"])(entities);
          tags = [];
          for (var i = 0; i < entities.length; i++) {
            if (entities[i].hashtag) {
              tags.push(entities[i]);
            }
          }
        }
      }
      return tags;
    };
    var _default = extractHashtagsWithIndices;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/atSigns.js
var require_atSigns = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/atSigns.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var atSigns = /[@＠]/;
    var _default = atSigns;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/endMentionMatch.js
var require_endMentionMatch = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/endMentionMatch.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _atSigns = _interopRequireDefault(require_atSigns());
    var _latinAccentChars = _interopRequireDefault(require_latinAccentChars());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var endMentionMatch = (0, _regexSupplant["default"])(/^(?:#{atSigns}|[#{latinAccentChars}]|:\/\/)/, {
      atSigns: _atSigns["default"],
      latinAccentChars: _latinAccentChars["default"]
    });
    var _default = endMentionMatch;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validMentionPrecedingChars.js
var require_validMentionPrecedingChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validMentionPrecedingChars.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validMentionPrecedingChars = /(?:^|[^a-zA-Z0-9_!#$%&*@＠]|(?:^|[^a-zA-Z0-9_+~.-])(?:rt|RT|rT|Rt):?)/;
    var _default = validMentionPrecedingChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validMentionOrList.js
var require_validMentionOrList = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validMentionOrList.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _atSigns = _interopRequireDefault(require_atSigns());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validMentionPrecedingChars = _interopRequireDefault(require_validMentionPrecedingChars());
    var validMentionOrList = (0, _regexSupplant["default"])(
      "(#{validMentionPrecedingChars})(#{atSigns})([a-zA-Z0-9_]{1,20})(/[a-zA-Z][a-zA-Z0-9_-]{0,24})?",
      // $4: List (optional)
      {
        validMentionPrecedingChars: _validMentionPrecedingChars["default"],
        atSigns: _atSigns["default"]
      },
      "g"
    );
    var _default = validMentionOrList;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractMentionsOrListsWithIndices.js
var require_extractMentionsOrListsWithIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractMentionsOrListsWithIndices.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_replace();
    require_es6_regexp_match();
    var _atSigns = _interopRequireDefault(require_atSigns());
    var _endMentionMatch = _interopRequireDefault(require_endMentionMatch());
    var _validMentionOrList = _interopRequireDefault(require_validMentionOrList());
    function _default(text) {
      if (!text || !text.match(_atSigns["default"])) {
        return [];
      }
      var possibleNames = [];
      text.replace(_validMentionOrList["default"], function(match, before, atSign, screenName, slashListname, offset, chunk) {
        var after = chunk.slice(offset + match.length);
        if (!after.match(_endMentionMatch["default"])) {
          slashListname = slashListname || "";
          var startPosition = offset + before.length;
          var endPosition = startPosition + screenName.length + slashListname.length + 1;
          possibleNames.push({
            screenName,
            listSlug: slashListname,
            indices: [startPosition, endPosition]
          });
        }
      });
      return possibleNames;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractEntitiesWithIndices.js
var require_extractEntitiesWithIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractEntitiesWithIndices.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractCashtagsWithIndices = _interopRequireDefault(require_extractCashtagsWithIndices());
    var _extractHashtagsWithIndices = _interopRequireDefault(require_extractHashtagsWithIndices());
    var _extractMentionsOrListsWithIndices = _interopRequireDefault(require_extractMentionsOrListsWithIndices());
    var _extractUrlsWithIndices = _interopRequireDefault(require_extractUrlsWithIndices());
    var _removeOverlappingEntities = _interopRequireDefault(require_removeOverlappingEntities());
    function _default(text, options) {
      var entities = (0, _extractUrlsWithIndices["default"])(text, options).concat((0, _extractMentionsOrListsWithIndices["default"])(text)).concat((0, _extractHashtagsWithIndices["default"])(text, {
        checkUrlOverlap: false
      })).concat((0, _extractCashtagsWithIndices["default"])(text));
      if (entities.length == 0) {
        return [];
      }
      (0, _removeOverlappingEntities["default"])(entities);
      return entities;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/clone.js
var require_clone = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/clone.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    function _default(o) {
      var r = {};
      for (var k in o) {
        if (o.hasOwnProperty(k)) {
          r[k] = o[k];
        }
      }
      return r;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractHtmlAttrsFromOptions.js
var require_extractHtmlAttrsFromOptions = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractHtmlAttrsFromOptions.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var BOOLEAN_ATTRIBUTES = {
      disabled: true,
      readonly: true,
      multiple: true,
      checked: true
    };
    var OPTIONS_NOT_ATTRIBUTES = {
      urlClass: true,
      listClass: true,
      usernameClass: true,
      hashtagClass: true,
      cashtagClass: true,
      usernameUrlBase: true,
      listUrlBase: true,
      hashtagUrlBase: true,
      cashtagUrlBase: true,
      usernameUrlBlock: true,
      listUrlBlock: true,
      hashtagUrlBlock: true,
      linkUrlBlock: true,
      usernameIncludeSymbol: true,
      suppressLists: true,
      suppressNoFollow: true,
      targetBlank: true,
      suppressDataScreenName: true,
      urlEntities: true,
      symbolTag: true,
      textWithSymbolTag: true,
      urlTarget: true,
      invisibleTagAttrs: true,
      linkAttributeBlock: true,
      linkTextBlock: true,
      htmlEscapeNonEntities: true
    };
    function _default(options) {
      var htmlAttrs = {};
      for (var k in options) {
        var v = options[k];
        if (OPTIONS_NOT_ATTRIBUTES[k]) {
          continue;
        }
        if (BOOLEAN_ATTRIBUTES[k]) {
          v = v ? k : null;
        }
        if (v == null) {
          continue;
        }
        htmlAttrs[k] = v;
      }
      return htmlAttrs;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/htmlEscape.js
var require_htmlEscape = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/htmlEscape.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_replace();
    var HTML_ENTITIES = {
      "&": "&amp;",
      ">": "&gt;",
      "<": "&lt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    function _default(text) {
      return text && text.replace(/[&"'><]/g, function(character) {
        return HTML_ENTITIES[character];
      });
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.flags.js
var require_es6_regexp_flags = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.flags.js"() {
    if (require_descriptors() && /./g.flags != "g") require_object_dp().f(RegExp.prototype, "flags", {
      configurable: true,
      get: require_flags()
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.to-string.js
var require_es6_regexp_to_string = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.regexp.to-string.js"() {
    "use strict";
    require_es6_regexp_flags();
    var anObject = require_an_object();
    var $flags = require_flags();
    var DESCRIPTORS = require_descriptors();
    var TO_STRING = "toString";
    var $toString = /./[TO_STRING];
    var define = function(fn) {
      require_redefine()(RegExp.prototype, TO_STRING, fn, true);
    };
    if (require_fails()(function() {
      return $toString.call({ source: "a", flags: "b" }) != "/a/b";
    })) {
      define(function toString() {
        var R = anObject(this);
        return "/".concat(
          R.source,
          "/",
          "flags" in R ? R.flags : !DESCRIPTORS && R instanceof RegExp ? $flags.call(R) : void 0
        );
      });
    } else if ($toString.name != TO_STRING) {
      define(function toString() {
        return $toString.call(this);
      });
    }
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.date.to-string.js
var require_es6_date_to_string = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.date.to-string.js"() {
    var DateProto = Date.prototype;
    var INVALID_DATE = "Invalid Date";
    var TO_STRING = "toString";
    var $toString = DateProto[TO_STRING];
    var getTime = DateProto.getTime;
    if (/* @__PURE__ */ new Date(NaN) + "" != INVALID_DATE) {
      require_redefine()(DateProto, TO_STRING, function toString() {
        var value = getTime.call(this);
        return value === value ? $toString.call(this) : INVALID_DATE;
      });
    }
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.to-string.js
var require_es6_object_to_string = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.to-string.js"() {
    "use strict";
    var classof = require_classof();
    var test = {};
    test[require_wks()("toStringTag")] = "z";
    if (test + "" != "[object z]") {
      require_redefine()(Object.prototype, "toString", function toString() {
        return "[object " + classof(this) + "]";
      }, true);
    }
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/tagAttrs.js
var require_tagAttrs = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/tagAttrs.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_to_string();
    require_es6_date_to_string();
    require_es6_object_to_string();
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var BOOLEAN_ATTRIBUTES = {
      disabled: true,
      readonly: true,
      multiple: true,
      checked: true
    };
    function _default(attributes) {
      var htmlAttrs = "";
      for (var k in attributes) {
        var v = attributes[k];
        if (BOOLEAN_ATTRIBUTES[k]) {
          v = v ? k : null;
        }
        if (v == null) {
          continue;
        }
        htmlAttrs += " ".concat((0, _htmlEscape["default"])(k), '="').concat((0, _htmlEscape["default"])(v.toString()), '"');
      }
      return htmlAttrs;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToText.js
var require_linkToText = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToText.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _stringSupplant = _interopRequireDefault(require_stringSupplant());
    var _tagAttrs = _interopRequireDefault(require_tagAttrs());
    function _default(entity, text, attributes, options) {
      if (!options.suppressNoFollow) {
        attributes.rel = "nofollow";
      }
      if (options.linkAttributeBlock) {
        options.linkAttributeBlock(entity, attributes);
      }
      if (options.linkTextBlock) {
        text = options.linkTextBlock(entity, text);
      }
      var d = {
        text,
        attr: (0, _tagAttrs["default"])(attributes)
      };
      return (0, _stringSupplant["default"])("<a#{attr}>#{text}</a>", d);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToTextWithSymbol.js
var require_linkToTextWithSymbol = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToTextWithSymbol.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_match();
    var _atSigns = _interopRequireDefault(require_atSigns());
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _linkToText = _interopRequireDefault(require_linkToText());
    function _default(entity, symbol, text, attributes, options) {
      var taggedSymbol = options.symbolTag ? "<".concat(options.symbolTag, ">").concat(symbol, "</").concat(options.symbolTag, ">") : symbol;
      text = (0, _htmlEscape["default"])(text);
      var taggedText = options.textWithSymbolTag ? "<".concat(options.textWithSymbolTag, ">").concat(text, "</").concat(options.textWithSymbolTag, ">") : text;
      if (options.usernameIncludeSymbol || !symbol.match(_atSigns["default"])) {
        return (0, _linkToText["default"])(entity, taggedSymbol + taggedText, attributes, options);
      } else {
        return taggedSymbol + (0, _linkToText["default"])(entity, taggedText, attributes, options);
      }
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToCashtag.js
var require_linkToCashtag = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToCashtag.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _clone = _interopRequireDefault(require_clone());
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _linkToTextWithSymbol = _interopRequireDefault(require_linkToTextWithSymbol());
    function _default(entity, text, options) {
      var cashtag = (0, _htmlEscape["default"])(entity.cashtag);
      var attrs = (0, _clone["default"])(options.htmlAttrs || {});
      attrs.href = options.cashtagUrlBase + cashtag;
      attrs.title = "$".concat(cashtag);
      attrs["class"] = options.cashtagClass;
      if (options.targetBlank) {
        attrs.target = "_blank";
      }
      return (0, _linkToTextWithSymbol["default"])(entity, "$", cashtag, attrs, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/rtlChars.js
var require_rtlChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/rtlChars.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var rtlChars = /[\u0600-\u06FF]|[\u0750-\u077F]|[\u0590-\u05FF]|[\uFE70-\uFEFF]/gm;
    var _default = rtlChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToHashtag.js
var require_linkToHashtag = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToHashtag.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_match();
    var _clone = _interopRequireDefault(require_clone());
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _rtlChars = _interopRequireDefault(require_rtlChars());
    var _linkToTextWithSymbol = _interopRequireDefault(require_linkToTextWithSymbol());
    function _default(entity, text, options) {
      var hash = text.substring(entity.indices[0], entity.indices[0] + 1);
      var hashtag = (0, _htmlEscape["default"])(entity.hashtag);
      var attrs = (0, _clone["default"])(options.htmlAttrs || {});
      attrs.href = options.hashtagUrlBase + hashtag;
      attrs.title = "#".concat(hashtag);
      attrs["class"] = options.hashtagClass;
      if (hashtag.charAt(0).match(_rtlChars["default"])) {
        attrs["class"] += " rtl";
      }
      if (options.targetBlank) {
        attrs.target = "_blank";
      }
      return (0, _linkToTextWithSymbol["default"])(entity, hash, hashtag, attrs, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkTextWithEntity.js
var require_linkTextWithEntity = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkTextWithEntity.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_match();
    require_es6_array_index_of();
    require_es6_regexp_replace();
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _stringSupplant = _interopRequireDefault(require_stringSupplant());
    function _default(entity, options) {
      var displayUrl = entity.display_url;
      var expandedUrl = entity.expanded_url;
      var displayUrlSansEllipses = displayUrl.replace(/…/g, "");
      if (expandedUrl.indexOf(displayUrlSansEllipses) != -1) {
        var displayUrlIndex = expandedUrl.indexOf(displayUrlSansEllipses);
        var v = {
          displayUrlSansEllipses,
          // Portion of expandedUrl that precedes the displayUrl substring
          beforeDisplayUrl: expandedUrl.substr(0, displayUrlIndex),
          // Portion of expandedUrl that comes after displayUrl
          afterDisplayUrl: expandedUrl.substr(displayUrlIndex + displayUrlSansEllipses.length),
          precedingEllipsis: displayUrl.match(/^…/) ? "…" : "",
          followingEllipsis: displayUrl.match(/…$/) ? "…" : ""
        };
        for (var k in v) {
          if (v.hasOwnProperty(k)) {
            v[k] = (0, _htmlEscape["default"])(v[k]);
          }
        }
        v["invisible"] = options.invisibleTagAttrs;
        return (0, _stringSupplant["default"])("<span class='tco-ellipsis'>#{precedingEllipsis}<span #{invisible}>&nbsp;</span></span><span #{invisible}>#{beforeDisplayUrl}</span><span class='js-display-url'>#{displayUrlSansEllipses}</span><span #{invisible}>#{afterDisplayUrl}</span><span class='tco-ellipsis'><span #{invisible}>&nbsp;</span>#{followingEllipsis}</span>", v);
      }
      return displayUrl;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/urlHasProtocol.js
var require_urlHasProtocol = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/urlHasProtocol.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var urlHasProtocol = /^https?:\/\//i;
    var _default = urlHasProtocol;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToUrl.js
var require_linkToUrl = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToUrl.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_match();
    var _clone = _interopRequireDefault(require_clone());
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _linkToText = _interopRequireDefault(require_linkToText());
    var _linkTextWithEntity = _interopRequireDefault(require_linkTextWithEntity());
    var _urlHasProtocol = _interopRequireDefault(require_urlHasProtocol());
    function _default(entity, text, options) {
      var url = entity.url;
      var displayUrl = url;
      var linkText = (0, _htmlEscape["default"])(displayUrl);
      var urlEntity = options.urlEntities && options.urlEntities[url] || entity;
      if (urlEntity.display_url) {
        linkText = (0, _linkTextWithEntity["default"])(urlEntity, options);
      }
      var attrs = (0, _clone["default"])(options.htmlAttrs || {});
      if (!url.match(_urlHasProtocol["default"])) {
        url = "http://".concat(url);
      }
      attrs.href = url;
      if (options.targetBlank) {
        attrs.target = "_blank";
      }
      if (options.urlClass) {
        attrs["class"] = options.urlClass;
      }
      if (options.urlTarget) {
        attrs.target = options.urlTarget;
      }
      if (!options.title && urlEntity.display_url) {
        attrs.title = urlEntity.expanded_url;
      }
      return (0, _linkToText["default"])(entity, linkText, attrs, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToMentionAndList.js
var require_linkToMentionAndList = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/linkToMentionAndList.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _clone = _interopRequireDefault(require_clone());
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _linkToTextWithSymbol = _interopRequireDefault(require_linkToTextWithSymbol());
    function _default(entity, text, options) {
      var at = text.substring(entity.indices[0], entity.indices[0] + 1);
      var user = (0, _htmlEscape["default"])(entity.screenName);
      var slashListname = (0, _htmlEscape["default"])(entity.listSlug);
      var isList = entity.listSlug && !options.suppressLists;
      var attrs = (0, _clone["default"])(options.htmlAttrs || {});
      attrs["class"] = isList ? options.listClass : options.usernameClass;
      attrs.href = isList ? options.listUrlBase + user + slashListname : options.usernameUrlBase + user;
      if (!isList && !options.suppressDataScreenName) {
        attrs["data-screen-name"] = user;
      }
      if (options.targetBlank) {
        attrs.target = "_blank";
      }
      return (0, _linkToTextWithSymbol["default"])(entity, at, isList ? user + slashListname : user, attrs, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkEntities.js
var require_autoLinkEntities = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkEntities.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_array_sort();
    var _clone = _interopRequireDefault(require_clone());
    var _extractHtmlAttrsFromOptions = _interopRequireDefault(require_extractHtmlAttrsFromOptions());
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _linkToCashtag = _interopRequireDefault(require_linkToCashtag());
    var _linkToHashtag = _interopRequireDefault(require_linkToHashtag());
    var _linkToUrl = _interopRequireDefault(require_linkToUrl());
    var _linkToMentionAndList = _interopRequireDefault(require_linkToMentionAndList());
    var DEFAULT_LIST_CLASS = "tweet-url list-slug";
    var DEFAULT_USERNAME_CLASS = "tweet-url username";
    var DEFAULT_HASHTAG_CLASS = "tweet-url hashtag";
    var DEFAULT_CASHTAG_CLASS = "tweet-url cashtag";
    function _default(text, entities, options) {
      var options = (0, _clone["default"])(options || {});
      options.hashtagClass = options.hashtagClass || DEFAULT_HASHTAG_CLASS;
      options.hashtagUrlBase = options.hashtagUrlBase || "https://twitter.com/search?q=%23";
      options.cashtagClass = options.cashtagClass || DEFAULT_CASHTAG_CLASS;
      options.cashtagUrlBase = options.cashtagUrlBase || "https://twitter.com/search?q=%24";
      options.listClass = options.listClass || DEFAULT_LIST_CLASS;
      options.usernameClass = options.usernameClass || DEFAULT_USERNAME_CLASS;
      options.usernameUrlBase = options.usernameUrlBase || "https://twitter.com/";
      options.listUrlBase = options.listUrlBase || "https://twitter.com/";
      options.htmlAttrs = (0, _extractHtmlAttrsFromOptions["default"])(options);
      options.invisibleTagAttrs = options.invisibleTagAttrs || "style='position:absolute;left:-9999px;'";
      var urlEntities, i, len;
      if (options.urlEntities) {
        urlEntities = {};
        for (i = 0, len = options.urlEntities.length; i < len; i++) {
          urlEntities[options.urlEntities[i].url] = options.urlEntities[i];
        }
        options.urlEntities = urlEntities;
      }
      var result = "";
      var beginIndex = 0;
      entities.sort(function(a, b) {
        return a.indices[0] - b.indices[0];
      });
      var nonEntity = options.htmlEscapeNonEntities ? _htmlEscape["default"] : function(text2) {
        return text2;
      };
      for (var i = 0; i < entities.length; i++) {
        var entity = entities[i];
        result += nonEntity(text.substring(beginIndex, entity.indices[0]));
        if (entity.url) {
          result += (0, _linkToUrl["default"])(entity, text, options);
        } else if (entity.hashtag) {
          result += (0, _linkToHashtag["default"])(entity, text, options);
        } else if (entity.screenName) {
          result += (0, _linkToMentionAndList["default"])(entity, text, options);
        } else if (entity.cashtag) {
          result += (0, _linkToCashtag["default"])(entity, text, options);
        }
        beginIndex = entity.indices[1];
      }
      result += nonEntity(text.substring(beginIndex, text.length));
      return result;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLink.js
var require_autoLink = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLink.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractEntitiesWithIndices = _interopRequireDefault(require_extractEntitiesWithIndices());
    var _autoLinkEntities = _interopRequireDefault(require_autoLinkEntities());
    function _default(text, options) {
      var entities = (0, _extractEntitiesWithIndices["default"])(text, {
        extractUrlsWithoutProtocol: false
      });
      return (0, _autoLinkEntities["default"])(text, entities, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkCashtags.js
var require_autoLinkCashtags = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkCashtags.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _autoLinkEntities = _interopRequireDefault(require_autoLinkEntities());
    var _extractCashtagsWithIndices = _interopRequireDefault(require_extractCashtagsWithIndices());
    function _default(text, options) {
      var entities = (0, _extractCashtagsWithIndices["default"])(text);
      return (0, _autoLinkEntities["default"])(text, entities, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkHashtags.js
var require_autoLinkHashtags = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkHashtags.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractHashtagsWithIndices = _interopRequireDefault(require_extractHashtagsWithIndices());
    var _autoLinkEntities = _interopRequireDefault(require_autoLinkEntities());
    function _default(text, options) {
      var entities = (0, _extractHashtagsWithIndices["default"])(text);
      return (0, _autoLinkEntities["default"])(text, entities, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkUrlsCustom.js
var require_autoLinkUrlsCustom = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkUrlsCustom.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _autoLinkEntities = _interopRequireDefault(require_autoLinkEntities());
    var _extractUrlsWithIndices = _interopRequireDefault(require_extractUrlsWithIndices());
    function _default(text, options) {
      var entities = (0, _extractUrlsWithIndices["default"])(text, {
        extractUrlsWithoutProtocol: false
      });
      return (0, _autoLinkEntities["default"])(text, entities, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkUsernamesOrLists.js
var require_autoLinkUsernamesOrLists = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkUsernamesOrLists.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractMentionsOrListsWithIndices = _interopRequireDefault(require_extractMentionsOrListsWithIndices());
    var _autoLinkEntities = _interopRequireDefault(require_autoLinkEntities());
    function _default(text, options) {
      var entities = (0, _extractMentionsOrListsWithIndices["default"])(text);
      return (0, _autoLinkEntities["default"])(text, entities, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/convertUnicodeIndices.js
var require_convertUnicodeIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/convertUnicodeIndices.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_array_sort();
    var convertUnicodeIndices = function convertUnicodeIndices2(text, entities, indicesInUTF16) {
      if (entities.length === 0) {
        return;
      }
      var charIndex = 0;
      var codePointIndex = 0;
      entities.sort(function(a, b) {
        return a.indices[0] - b.indices[0];
      });
      var entityIndex = 0;
      var entity = entities[0];
      while (charIndex < text.length) {
        if (entity.indices[0] === (indicesInUTF16 ? charIndex : codePointIndex)) {
          var len = entity.indices[1] - entity.indices[0];
          entity.indices[0] = indicesInUTF16 ? codePointIndex : charIndex;
          entity.indices[1] = entity.indices[0] + len;
          entityIndex++;
          if (entityIndex === entities.length) {
            break;
          }
          entity = entities[entityIndex];
        }
        var c = text.charCodeAt(charIndex);
        if (c >= 55296 && c <= 56319 && charIndex < text.length - 1) {
          c = text.charCodeAt(charIndex + 1);
          if (c >= 56320 && c <= 57343) {
            charIndex++;
          }
        }
        codePointIndex++;
        charIndex++;
      }
    };
    var _default = convertUnicodeIndices;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/modifyIndicesFromUnicodeToUTF16.js
var require_modifyIndicesFromUnicodeToUTF16 = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/modifyIndicesFromUnicodeToUTF16.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _convertUnicodeIndices = _interopRequireDefault(require_convertUnicodeIndices());
    function _default(text, entities) {
      (0, _convertUnicodeIndices["default"])(text, entities, false);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkWithJSON.js
var require_autoLinkWithJSON = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/autoLinkWithJSON.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _autoLinkEntities = _interopRequireDefault(require_autoLinkEntities());
    var _modifyIndicesFromUnicodeToUTF = _interopRequireDefault(require_modifyIndicesFromUnicodeToUTF16());
    function _default(text, json, options) {
      if (json.user_mentions) {
        for (var i = 0; i < json.user_mentions.length; i++) {
          json.user_mentions[i].screenName = json.user_mentions[i].screen_name;
        }
      }
      if (json.hashtags) {
        for (var i = 0; i < json.hashtags.length; i++) {
          json.hashtags[i].hashtag = json.hashtags[i].text;
        }
      }
      if (json.symbols) {
        for (var i = 0; i < json.symbols.length; i++) {
          json.symbols[i].cashtag = json.symbols[i].text;
        }
      }
      var entities = [];
      for (var key in json) {
        entities = entities.concat(json[key]);
      }
      (0, _modifyIndicesFromUnicodeToUTF["default"])(text, entities);
      return (0, _autoLinkEntities["default"])(text, entities, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/configs.js
var require_configs = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/configs.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _default = {
      version1: {
        version: 1,
        maxWeightedTweetLength: 140,
        scale: 1,
        defaultWeight: 1,
        transformedURLLength: 23,
        ranges: []
      },
      version2: {
        version: 2,
        maxWeightedTweetLength: 280,
        scale: 100,
        defaultWeight: 200,
        transformedURLLength: 23,
        ranges: [{
          start: 0,
          end: 4351,
          weight: 100
        }, {
          start: 8192,
          end: 8205,
          weight: 100
        }, {
          start: 8208,
          end: 8223,
          weight: 100
        }, {
          start: 8242,
          end: 8247,
          weight: 100
        }]
      },
      version3: {
        version: 3,
        maxWeightedTweetLength: 280,
        scale: 100,
        defaultWeight: 200,
        emojiParsingEnabled: true,
        transformedURLLength: 23,
        ranges: [{
          start: 0,
          end: 4351,
          weight: 100
        }, {
          start: 8192,
          end: 8205,
          weight: 100
        }, {
          start: 8208,
          end: 8223,
          weight: 100
        }, {
          start: 8242,
          end: 8247,
          weight: 100
        }]
      },
      defaults: {
        version: 3,
        maxWeightedTweetLength: 280,
        scale: 100,
        defaultWeight: 200,
        emojiParsingEnabled: true,
        transformedURLLength: 23,
        ranges: [{
          start: 0,
          end: 4351,
          weight: 100
        }, {
          start: 8192,
          end: 8205,
          weight: 100
        }, {
          start: 8208,
          end: 8223,
          weight: 100
        }, {
          start: 8242,
          end: 8247,
          weight: 100
        }]
      }
    };
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/convertUnicodeIndices.js
var require_convertUnicodeIndices2 = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/convertUnicodeIndices.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_array_sort();
    function _default(text, entities, indicesInUTF16) {
      if (entities.length == 0) {
        return;
      }
      var charIndex = 0;
      var codePointIndex = 0;
      entities.sort(function(a, b) {
        return a.indices[0] - b.indices[0];
      });
      var entityIndex = 0;
      var entity = entities[0];
      while (charIndex < text.length) {
        if (entity.indices[0] == (indicesInUTF16 ? charIndex : codePointIndex)) {
          var len = entity.indices[1] - entity.indices[0];
          entity.indices[0] = indicesInUTF16 ? codePointIndex : charIndex;
          entity.indices[1] = entity.indices[0] + len;
          entityIndex++;
          if (entityIndex == entities.length) {
            break;
          }
          entity = entities[entityIndex];
        }
        var c = text.charCodeAt(charIndex);
        if (c >= 55296 && c <= 56319 && charIndex < text.length - 1) {
          c = text.charCodeAt(charIndex + 1);
          if (c >= 56320 && c <= 57343) {
            charIndex++;
          }
        }
        codePointIndex++;
        charIndex++;
      }
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractCashtags.js
var require_extractCashtags = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractCashtags.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractCashtagsWithIndices = _interopRequireDefault(require_extractCashtagsWithIndices());
    function _default(text) {
      var cashtagsOnly = [], cashtagsWithIndices = (0, _extractCashtagsWithIndices["default"])(text);
      for (var i = 0; i < cashtagsWithIndices.length; i++) {
        cashtagsOnly.push(cashtagsWithIndices[i].cashtag);
      }
      return cashtagsOnly;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractHashtags.js
var require_extractHashtags = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractHashtags.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractHashtagsWithIndices = _interopRequireDefault(require_extractHashtagsWithIndices());
    function _default(text) {
      var hashtagsOnly = [];
      var hashtagsWithIndices = (0, _extractHashtagsWithIndices["default"])(text);
      for (var i = 0; i < hashtagsWithIndices.length; i++) {
        hashtagsOnly.push(hashtagsWithIndices[i].hashtag);
      }
      return hashtagsOnly;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractMentionsWithIndices.js
var require_extractMentionsWithIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractMentionsWithIndices.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractMentionsOrListsWithIndices = _interopRequireDefault(require_extractMentionsOrListsWithIndices());
    function _default(text) {
      var mentions = [];
      var mentionOrList;
      var mentionsOrLists = (0, _extractMentionsOrListsWithIndices["default"])(text);
      for (var i = 0; i < mentionsOrLists.length; i++) {
        mentionOrList = mentionsOrLists[i];
        if (mentionOrList.listSlug === "") {
          mentions.push({
            screenName: mentionOrList.screenName,
            indices: mentionOrList.indices
          });
        }
      }
      return mentions;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractMentions.js
var require_extractMentions = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractMentions.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractMentionsWithIndices = _interopRequireDefault(require_extractMentionsWithIndices());
    function _default(text) {
      var screenNamesOnly = [], screenNamesWithIndices = (0, _extractMentionsWithIndices["default"])(text);
      for (var i = 0; i < screenNamesWithIndices.length; i++) {
        var screenName = screenNamesWithIndices[i].screenName;
        screenNamesOnly.push(screenName);
      }
      return screenNamesOnly;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validReply.js
var require_validReply = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validReply.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _atSigns = _interopRequireDefault(require_atSigns());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _spaces = _interopRequireDefault(require_spaces());
    var validReply = (0, _regexSupplant["default"])(/^(?:#{spaces})*#{atSigns}([a-zA-Z0-9_]{1,20})/, {
      atSigns: _atSigns["default"],
      spaces: _spaces["default"]
    });
    var _default = validReply;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractReplies.js
var require_extractReplies = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractReplies.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_constructor();
    require_es6_regexp_match();
    var _endMentionMatch = _interopRequireDefault(require_endMentionMatch());
    var _validReply = _interopRequireDefault(require_validReply());
    function _default(text) {
      if (!text) {
        return null;
      }
      var possibleScreenName = text.match(_validReply["default"]);
      if (!possibleScreenName || RegExp.rightContext.match(_endMentionMatch["default"])) {
        return null;
      }
      return possibleScreenName[1];
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractUrls.js
var require_extractUrls = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/extractUrls.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractUrlsWithIndices = _interopRequireDefault(require_extractUrlsWithIndices());
    function _default(text, options) {
      var urlsOnly = [];
      var urlsWithIndices = (0, _extractUrlsWithIndices["default"])(text, options);
      for (var i = 0; i < urlsWithIndices.length; i++) {
        urlsOnly.push(urlsWithIndices[i].url);
      }
      return urlsOnly;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-array.js
var require_is_array = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-array.js"(exports, module) {
    var cof = require_cof();
    module.exports = Array.isArray || function isArray(arg) {
      return cof(arg) == "Array";
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.is-array.js
var require_es6_array_is_array = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.is-array.js"() {
    var $export = require_export();
    $export($export.S, "Array", { isArray: require_is_array() });
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/getCharacterWeight.js
var require_getCharacterWeight = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/lib/getCharacterWeight.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_array_is_array();
    var getCharacterWeight = function getCharacterWeight2(ch, options) {
      var defaultWeight = options.defaultWeight, ranges = options.ranges;
      var weight = defaultWeight;
      var chCodePoint = ch.charCodeAt(0);
      if (Array.isArray(ranges)) {
        for (var i = 0, length = ranges.length; i < length; i++) {
          var currRange = ranges[i];
          if (chCodePoint >= currRange.start && chCodePoint <= currRange.end) {
            weight = currRange.weight;
            break;
          }
        }
      }
      return weight;
    };
    var _default = getCharacterWeight;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/modifyIndicesFromUTF16ToUnicode.js
var require_modifyIndicesFromUTF16ToUnicode = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/modifyIndicesFromUTF16ToUnicode.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _convertUnicodeIndices = _interopRequireDefault(require_convertUnicodeIndices());
    function _default(text, entities) {
      (0, _convertUnicodeIndices["default"])(text, entities, true);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-reduce.js
var require_array_reduce = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-reduce.js"(exports, module) {
    var aFunction = require_a_function();
    var toObject = require_to_object();
    var IObject = require_iobject();
    var toLength = require_to_length();
    module.exports = function(that, callbackfn, aLen, memo, isRight) {
      aFunction(callbackfn);
      var O = toObject(that);
      var self2 = IObject(O);
      var length = toLength(O.length);
      var index = isRight ? length - 1 : 0;
      var i = isRight ? -1 : 1;
      if (aLen < 2) for (; ; ) {
        if (index in self2) {
          memo = self2[index];
          index += i;
          break;
        }
        index += i;
        if (isRight ? index < 0 : length <= index) {
          throw TypeError("Reduce of empty array with no initial value");
        }
      }
      for (; isRight ? index >= 0 : length > index; index += i) if (index in self2) {
        memo = callbackfn(memo, self2[index], index, O);
      }
      return memo;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.reduce.js
var require_es6_array_reduce = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.reduce.js"() {
    "use strict";
    var $export = require_export();
    var $reduce = require_array_reduce();
    $export($export.P + $export.F * !require_strict_method()([].reduce, true), "Array", {
      // 22.1.3.18 / 15.4.4.21 Array.prototype.reduce(callbackfn [, initialValue])
      reduce: function reduce(callbackfn) {
        return $reduce(this, callbackfn, arguments.length, arguments[1], false);
      }
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_add-to-unscopables.js
var require_add_to_unscopables = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_add-to-unscopables.js"(exports, module) {
    var UNSCOPABLES = require_wks()("unscopables");
    var ArrayProto = Array.prototype;
    if (ArrayProto[UNSCOPABLES] == void 0) require_hide()(ArrayProto, UNSCOPABLES, {});
    module.exports = function(key) {
      ArrayProto[UNSCOPABLES][key] = true;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-step.js
var require_iter_step = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-step.js"(exports, module) {
    module.exports = function(done, value) {
      return { value, done: !!done };
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iterators.js
var require_iterators = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iterators.js"(exports, module) {
    module.exports = {};
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-keys.js
var require_object_keys = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-keys.js"(exports, module) {
    var $keys = require_object_keys_internal();
    var enumBugKeys = require_enum_bug_keys();
    module.exports = Object.keys || function keys(O) {
      return $keys(O, enumBugKeys);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-dps.js
var require_object_dps = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-dps.js"(exports, module) {
    var dP = require_object_dp();
    var anObject = require_an_object();
    var getKeys = require_object_keys();
    module.exports = require_descriptors() ? Object.defineProperties : function defineProperties(O, Properties2) {
      anObject(O);
      var keys = getKeys(Properties2);
      var length = keys.length;
      var i = 0;
      var P;
      while (length > i) dP.f(O, P = keys[i++], Properties2[P]);
      return O;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_html.js
var require_html = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_html.js"(exports, module) {
    var document = require_global().document;
    module.exports = document && document.documentElement;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-create.js
var require_object_create = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-create.js"(exports, module) {
    var anObject = require_an_object();
    var dPs = require_object_dps();
    var enumBugKeys = require_enum_bug_keys();
    var IE_PROTO = require_shared_key()("IE_PROTO");
    var Empty = function() {
    };
    var PROTOTYPE = "prototype";
    var createDict = function() {
      var iframe = require_dom_create()("iframe");
      var i = enumBugKeys.length;
      var lt = "<";
      var gt = ">";
      var iframeDocument;
      iframe.style.display = "none";
      require_html().appendChild(iframe);
      iframe.src = "javascript:";
      iframeDocument = iframe.contentWindow.document;
      iframeDocument.open();
      iframeDocument.write(lt + "script" + gt + "document.F=Object" + lt + "/script" + gt);
      iframeDocument.close();
      createDict = iframeDocument.F;
      while (i--) delete createDict[PROTOTYPE][enumBugKeys[i]];
      return createDict();
    };
    module.exports = Object.create || function create(O, Properties2) {
      var result;
      if (O !== null) {
        Empty[PROTOTYPE] = anObject(O);
        result = new Empty();
        Empty[PROTOTYPE] = null;
        result[IE_PROTO] = O;
      } else result = createDict();
      return Properties2 === void 0 ? result : dPs(result, Properties2);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_set-to-string-tag.js
var require_set_to_string_tag = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_set-to-string-tag.js"(exports, module) {
    var def = require_object_dp().f;
    var has = require_has();
    var TAG = require_wks()("toStringTag");
    module.exports = function(it, tag, stat) {
      if (it && !has(it = stat ? it : it.prototype, TAG)) def(it, TAG, { configurable: true, value: tag });
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-create.js
var require_iter_create = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-create.js"(exports, module) {
    "use strict";
    var create = require_object_create();
    var descriptor = require_property_desc();
    var setToStringTag = require_set_to_string_tag();
    var IteratorPrototype = {};
    require_hide()(IteratorPrototype, require_wks()("iterator"), function() {
      return this;
    });
    module.exports = function(Constructor2, NAME, next) {
      Constructor2.prototype = create(IteratorPrototype, { next: descriptor(1, next) });
      setToStringTag(Constructor2, NAME + " Iterator");
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gpo.js
var require_object_gpo = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gpo.js"(exports, module) {
    var has = require_has();
    var toObject = require_to_object();
    var IE_PROTO = require_shared_key()("IE_PROTO");
    var ObjectProto = Object.prototype;
    module.exports = Object.getPrototypeOf || function(O) {
      O = toObject(O);
      if (has(O, IE_PROTO)) return O[IE_PROTO];
      if (typeof O.constructor == "function" && O instanceof O.constructor) {
        return O.constructor.prototype;
      }
      return O instanceof Object ? ObjectProto : null;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-define.js
var require_iter_define = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-define.js"(exports, module) {
    "use strict";
    var LIBRARY = require_library();
    var $export = require_export();
    var redefine = require_redefine();
    var hide = require_hide();
    var Iterators = require_iterators();
    var $iterCreate = require_iter_create();
    var setToStringTag = require_set_to_string_tag();
    var getPrototypeOf = require_object_gpo();
    var ITERATOR = require_wks()("iterator");
    var BUGGY = !([].keys && "next" in [].keys());
    var FF_ITERATOR = "@@iterator";
    var KEYS = "keys";
    var VALUES = "values";
    var returnThis = function() {
      return this;
    };
    module.exports = function(Base2, NAME, Constructor2, next, DEFAULT, IS_SET, FORCED) {
      $iterCreate(Constructor2, NAME, next);
      var getMethod = function(kind) {
        if (!BUGGY && kind in proto) return proto[kind];
        switch (kind) {
          case KEYS:
            return function keys() {
              return new Constructor2(this, kind);
            };
          case VALUES:
            return function values() {
              return new Constructor2(this, kind);
            };
        }
        return function entries() {
          return new Constructor2(this, kind);
        };
      };
      var TAG = NAME + " Iterator";
      var DEF_VALUES = DEFAULT == VALUES;
      var VALUES_BUG = false;
      var proto = Base2.prototype;
      var $native = proto[ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT];
      var $default = $native || getMethod(DEFAULT);
      var $entries = DEFAULT ? !DEF_VALUES ? $default : getMethod("entries") : void 0;
      var $anyNative = NAME == "Array" ? proto.entries || $native : $native;
      var methods, key, IteratorPrototype;
      if ($anyNative) {
        IteratorPrototype = getPrototypeOf($anyNative.call(new Base2()));
        if (IteratorPrototype !== Object.prototype && IteratorPrototype.next) {
          setToStringTag(IteratorPrototype, TAG, true);
          if (!LIBRARY && typeof IteratorPrototype[ITERATOR] != "function") hide(IteratorPrototype, ITERATOR, returnThis);
        }
      }
      if (DEF_VALUES && $native && $native.name !== VALUES) {
        VALUES_BUG = true;
        $default = function values() {
          return $native.call(this);
        };
      }
      if ((!LIBRARY || FORCED) && (BUGGY || VALUES_BUG || !proto[ITERATOR])) {
        hide(proto, ITERATOR, $default);
      }
      Iterators[NAME] = $default;
      Iterators[TAG] = returnThis;
      if (DEFAULT) {
        methods = {
          values: DEF_VALUES ? $default : getMethod(VALUES),
          keys: IS_SET ? $default : getMethod(KEYS),
          entries: $entries
        };
        if (FORCED) for (key in methods) {
          if (!(key in proto)) redefine(proto, key, methods[key]);
        }
        else $export($export.P + $export.F * (BUGGY || VALUES_BUG), NAME, methods);
      }
      return methods;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.iterator.js
var require_es6_array_iterator = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.iterator.js"(exports, module) {
    "use strict";
    var addToUnscopables = require_add_to_unscopables();
    var step = require_iter_step();
    var Iterators = require_iterators();
    var toIObject = require_to_iobject();
    module.exports = require_iter_define()(Array, "Array", function(iterated, kind) {
      this._t = toIObject(iterated);
      this._i = 0;
      this._k = kind;
    }, function() {
      var O = this._t;
      var kind = this._k;
      var index = this._i++;
      if (!O || index >= O.length) {
        this._t = void 0;
        return step(1);
      }
      if (kind == "keys") return step(0, index);
      if (kind == "values") return step(0, O[index]);
      return step(0, [index, O[index]]);
    }, "values");
    Iterators.Arguments = Iterators.Array;
    addToUnscopables("keys");
    addToUnscopables("values");
    addToUnscopables("entries");
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/web.dom.iterable.js
var require_web_dom_iterable = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/web.dom.iterable.js"() {
    var $iterators = require_es6_array_iterator();
    var getKeys = require_object_keys();
    var redefine = require_redefine();
    var global = require_global();
    var hide = require_hide();
    var Iterators = require_iterators();
    var wks = require_wks();
    var ITERATOR = wks("iterator");
    var TO_STRING_TAG = wks("toStringTag");
    var ArrayValues = Iterators.Array;
    var DOMIterables = {
      CSSRuleList: true,
      // TODO: Not spec compliant, should be false.
      CSSStyleDeclaration: false,
      CSSValueList: false,
      ClientRectList: false,
      DOMRectList: false,
      DOMStringList: false,
      DOMTokenList: true,
      DataTransferItemList: false,
      FileList: false,
      HTMLAllCollection: false,
      HTMLCollection: false,
      HTMLFormElement: false,
      HTMLSelectElement: false,
      MediaList: true,
      // TODO: Not spec compliant, should be false.
      MimeTypeArray: false,
      NamedNodeMap: false,
      NodeList: true,
      PaintRequestList: false,
      Plugin: false,
      PluginArray: false,
      SVGLengthList: false,
      SVGNumberList: false,
      SVGPathSegList: false,
      SVGPointList: false,
      SVGStringList: false,
      SVGTransformList: false,
      SourceBufferList: false,
      StyleSheetList: true,
      // TODO: Not spec compliant, should be false.
      TextTrackCueList: false,
      TextTrackList: false,
      TouchList: false
    };
    for (collections = getKeys(DOMIterables), i = 0; i < collections.length; i++) {
      NAME = collections[i];
      explicit = DOMIterables[NAME];
      Collection = global[NAME];
      proto = Collection && Collection.prototype;
      if (proto) {
        if (!proto[ITERATOR]) hide(proto, ITERATOR, ArrayValues);
        if (!proto[TO_STRING_TAG]) hide(proto, TO_STRING_TAG, NAME);
        Iterators[NAME] = ArrayValues;
        if (explicit) {
          for (key in $iterators) if (!proto[key]) redefine(proto, key, $iterators[key], true);
        }
      }
    }
    var NAME;
    var explicit;
    var Collection;
    var proto;
    var key;
    var collections;
    var i;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-sap.js
var require_object_sap = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-sap.js"(exports, module) {
    var $export = require_export();
    var core = require_core();
    var fails = require_fails();
    module.exports = function(KEY, exec) {
      var fn = (core.Object || {})[KEY] || Object[KEY];
      var exp = {};
      exp[KEY] = exec(fn);
      $export($export.S + $export.F * fails(function() {
        fn(1);
      }), "Object", exp);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.keys.js
var require_es6_object_keys = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.keys.js"() {
    var toObject = require_to_object();
    var $keys = require_object_keys();
    require_object_sap()("keys", function() {
      return function keys(it) {
        return $keys(toObject(it));
      };
    });
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidChars.js
var require_invalidChars = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/invalidChars.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _invalidCharsGroup = _interopRequireDefault(require_invalidCharsGroup());
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var invalidChars = (0, _regexSupplant["default"])(/[#{invalidCharsGroup}]/, {
      invalidCharsGroup: _invalidCharsGroup["default"]
    });
    var _default = invalidChars;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/hasInvalidCharacters.js
var require_hasInvalidCharacters = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/hasInvalidCharacters.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _invalidChars = _interopRequireDefault(require_invalidChars());
    function _default(text) {
      return _invalidChars["default"].test(text);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twemoji-parser@11.0.2/node_modules/twemoji-parser/dist/lib/regex.js
var require_regex = __commonJS({
  "node_modules/.pnpm/twemoji-parser@11.0.2/node_modules/twemoji-parser/dist/lib/regex.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.default = /(?:\ud83d[\udc68\udc69])(?:\ud83c[\udffb-\udfff])?\u200d(?:\u2695\ufe0f|\u2696\ufe0f|\u2708\ufe0f|\ud83c[\udf3e\udf73\udf93\udfa4\udfa8\udfeb\udfed]|\ud83d[\udcbb\udcbc\udd27\udd2c\ude80\ude92]|\ud83e[\uddb0-\uddb3])|(?:\ud83c[\udfcb\udfcc]|\ud83d[\udd74\udd75]|\u26f9)((?:\ud83c[\udffb-\udfff]|\ufe0f)\u200d[\u2640\u2642]\ufe0f)|(?:\ud83c[\udfc3\udfc4\udfca]|\ud83d[\udc6e\udc71\udc73\udc77\udc81\udc82\udc86\udc87\ude45-\ude47\ude4b\ude4d\ude4e\udea3\udeb4-\udeb6]|\ud83e[\udd26\udd35\udd37-\udd39\udd3d\udd3e\uddb8\uddb9\uddd6-\udddd])(?:\ud83c[\udffb-\udfff])?\u200d[\u2640\u2642]\ufe0f|(?:\ud83d\udc68\u200d\u2764\ufe0f\u200d\ud83d\udc8b\u200d\ud83d\udc68|\ud83d\udc68\u200d\ud83d\udc68\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc68\u200d\ud83d\udc68\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\u2764\ufe0f\u200d\ud83d\udc8b\u200d\ud83d[\udc68\udc69]|\ud83d\udc69\u200d\ud83d\udc69\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc69\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\u2764\ufe0f\u200d\ud83d\udc68|\ud83d\udc68\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc68\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\ud83d\udc68\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\u2764\ufe0f\u200d\ud83d[\udc68\udc69]|\ud83d\udc69\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\ud83d\udc69\u200d\ud83d[\udc66\udc67]|\ud83c\udff3\ufe0f\u200d\ud83c\udf08|\ud83c\udff4\u200d\u2620\ufe0f|\ud83d\udc41\u200d\ud83d\udde8|\ud83d\udc68\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\ud83d[\udc66\udc67]|\ud83d\udc6f\u200d\u2640\ufe0f|\ud83d\udc6f\u200d\u2642\ufe0f|\ud83e\udd3c\u200d\u2640\ufe0f|\ud83e\udd3c\u200d\u2642\ufe0f|\ud83e\uddde\u200d\u2640\ufe0f|\ud83e\uddde\u200d\u2642\ufe0f|\ud83e\udddf\u200d\u2640\ufe0f|\ud83e\udddf\u200d\u2642\ufe0f)|[#*0-9]\ufe0f?\u20e3|(?:[©®\u2122\u265f]\ufe0f)|(?:\ud83c[\udc04\udd70\udd71\udd7e\udd7f\ude02\ude1a\ude2f\ude37\udf21\udf24-\udf2c\udf36\udf7d\udf96\udf97\udf99-\udf9b\udf9e\udf9f\udfcd\udfce\udfd4-\udfdf\udff3\udff5\udff7]|\ud83d[\udc3f\udc41\udcfd\udd49\udd4a\udd6f\udd70\udd73\udd76-\udd79\udd87\udd8a-\udd8d\udda5\udda8\uddb1\uddb2\uddbc\uddc2-\uddc4\uddd1-\uddd3\udddc-\uddde\udde1\udde3\udde8\uddef\uddf3\uddfa\udecb\udecd-\udecf\udee0-\udee5\udee9\udef0\udef3]|[\u203c\u2049\u2139\u2194-\u2199\u21a9\u21aa\u231a\u231b\u2328\u23cf\u23ed-\u23ef\u23f1\u23f2\u23f8-\u23fa\u24c2\u25aa\u25ab\u25b6\u25c0\u25fb-\u25fe\u2600-\u2604\u260e\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262a\u262e\u262f\u2638-\u263a\u2640\u2642\u2648-\u2653\u2660\u2663\u2665\u2666\u2668\u267b\u267f\u2692-\u2697\u2699\u269b\u269c\u26a0\u26a1\u26aa\u26ab\u26b0\u26b1\u26bd\u26be\u26c4\u26c5\u26c8\u26cf\u26d1\u26d3\u26d4\u26e9\u26ea\u26f0-\u26f5\u26f8\u26fa\u26fd\u2702\u2708\u2709\u270f\u2712\u2714\u2716\u271d\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u2764\u27a1\u2934\u2935\u2b05-\u2b07\u2b1b\u2b1c\u2b50\u2b55\u3030\u303d\u3297\u3299])(?:\ufe0f|(?!\ufe0e))|(?:(?:\ud83c[\udfcb\udfcc]|\ud83d[\udd74\udd75\udd90]|[\u261d\u26f7\u26f9\u270c\u270d])(?:\ufe0f|(?!\ufe0e))|(?:\ud83c[\udf85\udfc2-\udfc4\udfc7\udfca]|\ud83d[\udc42\udc43\udc46-\udc50\udc66-\udc69\udc6e\udc70-\udc78\udc7c\udc81-\udc83\udc85-\udc87\udcaa\udd7a\udd95\udd96\ude45-\ude47\ude4b-\ude4f\udea3\udeb4-\udeb6\udec0\udecc]|\ud83e[\udd18-\udd1c\udd1e\udd1f\udd26\udd30-\udd39\udd3d\udd3e\uddb5\uddb6\uddb8\uddb9\uddd1-\udddd]|[\u270a\u270b]))(?:\ud83c[\udffb-\udfff])?|(?:\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc65\udb40\udc6e\udb40\udc67\udb40\udc7f|\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc73\udb40\udc63\udb40\udc74\udb40\udc7f|\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc77\udb40\udc6c\udb40\udc73\udb40\udc7f|\ud83c\udde6\ud83c[\udde8-\uddec\uddee\uddf1\uddf2\uddf4\uddf6-\uddfa\uddfc\uddfd\uddff]|\ud83c\udde7\ud83c[\udde6\udde7\udde9-\uddef\uddf1-\uddf4\uddf6-\uddf9\uddfb\uddfc\uddfe\uddff]|\ud83c\udde8\ud83c[\udde6\udde8\udde9\uddeb-\uddee\uddf0-\uddf5\uddf7\uddfa-\uddff]|\ud83c\udde9\ud83c[\uddea\uddec\uddef\uddf0\uddf2\uddf4\uddff]|\ud83c\uddea\ud83c[\udde6\udde8\uddea\uddec\udded\uddf7-\uddfa]|\ud83c\uddeb\ud83c[\uddee-\uddf0\uddf2\uddf4\uddf7]|\ud83c\uddec\ud83c[\udde6\udde7\udde9-\uddee\uddf1-\uddf3\uddf5-\uddfa\uddfc\uddfe]|\ud83c\udded\ud83c[\uddf0\uddf2\uddf3\uddf7\uddf9\uddfa]|\ud83c\uddee\ud83c[\udde8-\uddea\uddf1-\uddf4\uddf6-\uddf9]|\ud83c\uddef\ud83c[\uddea\uddf2\uddf4\uddf5]|\ud83c\uddf0\ud83c[\uddea\uddec-\uddee\uddf2\uddf3\uddf5\uddf7\uddfc\uddfe\uddff]|\ud83c\uddf1\ud83c[\udde6-\udde8\uddee\uddf0\uddf7-\uddfb\uddfe]|\ud83c\uddf2\ud83c[\udde6\udde8-\udded\uddf0-\uddff]|\ud83c\uddf3\ud83c[\udde6\udde8\uddea-\uddec\uddee\uddf1\uddf4\uddf5\uddf7\uddfa\uddff]|\ud83c\uddf4\ud83c\uddf2|\ud83c\uddf5\ud83c[\udde6\uddea-\udded\uddf0-\uddf3\uddf7-\uddf9\uddfc\uddfe]|\ud83c\uddf6\ud83c\udde6|\ud83c\uddf7\ud83c[\uddea\uddf4\uddf8\uddfa\uddfc]|\ud83c\uddf8\ud83c[\udde6-\uddea\uddec-\uddf4\uddf7-\uddf9\uddfb\uddfd-\uddff]|\ud83c\uddf9\ud83c[\udde6\udde8\udde9\uddeb-\udded\uddef-\uddf4\uddf7\uddf9\uddfb\uddfc\uddff]|\ud83c\uddfa\ud83c[\udde6\uddec\uddf2\uddf3\uddf8\uddfe\uddff]|\ud83c\uddfb\ud83c[\udde6\udde8\uddea\uddec\uddee\uddf3\uddfa]|\ud83c\uddfc\ud83c[\uddeb\uddf8]|\ud83c\uddfd\ud83c\uddf0|\ud83c\uddfe\ud83c[\uddea\uddf9]|\ud83c\uddff\ud83c[\udde6\uddf2\uddfc]|\ud83c[\udccf\udd8e\udd91-\udd9a\udde6-\uddff\ude01\ude32-\ude36\ude38-\ude3a\ude50\ude51\udf00-\udf20\udf2d-\udf35\udf37-\udf7c\udf7e-\udf84\udf86-\udf93\udfa0-\udfc1\udfc5\udfc6\udfc8\udfc9\udfcf-\udfd3\udfe0-\udff0\udff4\udff8-\udfff]|\ud83d[\udc00-\udc3e\udc40\udc44\udc45\udc51-\udc65\udc6a-\udc6d\udc6f\udc79-\udc7b\udc7d-\udc80\udc84\udc88-\udca9\udcab-\udcfc\udcff-\udd3d\udd4b-\udd4e\udd50-\udd67\udda4\uddfb-\ude44\ude48-\ude4a\ude80-\udea2\udea4-\udeb3\udeb7-\udebf\udec1-\udec5\uded0-\uded2\udeeb\udeec\udef4-\udef9]|\ud83e[\udd10-\udd17\udd1d\udd20-\udd25\udd27-\udd2f\udd3a\udd3c\udd40-\udd45\udd47-\udd70\udd73-\udd76\udd7a\udd7c-\udda2\uddb4\uddb7\uddc0-\uddc2\uddd0\uddde-\uddff]|[\u23e9-\u23ec\u23f0\u23f3\u267e\u26ce\u2705\u2728\u274c\u274e\u2753-\u2755\u2795-\u2797\u27b0\u27bf\ue50a])|\ufe0f/g;
  }
});

// node_modules/.pnpm/twemoji-parser@11.0.2/node_modules/twemoji-parser/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/twemoji-parser@11.0.2/node_modules/twemoji-parser/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.TypeName = void 0;
    exports.parse = parse;
    exports.toCodePoints = toCodePoints;
    var _regex = require_regex();
    var _regex2 = _interopRequireDefault(_regex);
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { default: obj };
    }
    var TypeName = exports.TypeName = "emoji";
    function parse(text, options) {
      var assetType = options && options.assetType ? options.assetType : "svg";
      var getTwemojiUrl = options && options.buildUrl ? options.buildUrl : function(codepoints2, assetType2) {
        return assetType2 === "png" ? "https://twemoji.maxcdn.com/2/72x72/" + codepoints2 + ".png" : "https://twemoji.maxcdn.com/2/svg/" + codepoints2 + ".svg";
      };
      var entities = [];
      _regex2.default.lastIndex = 0;
      while (true) {
        var result = _regex2.default.exec(text);
        if (!result) {
          break;
        }
        var emojiText = result[0];
        var codepoints = toCodePoints(removeVS16s(emojiText)).join("-");
        entities.push({
          url: codepoints ? getTwemojiUrl(codepoints, assetType) : "",
          indices: [result.index, _regex2.default.lastIndex],
          text: emojiText,
          type: TypeName
        });
      }
      return entities;
    }
    var vs16RegExp = /\uFE0F/g;
    var zeroWidthJoiner = String.fromCharCode(8205);
    var removeVS16s = function removeVS16s2(rawEmoji) {
      return rawEmoji.indexOf(zeroWidthJoiner) < 0 ? rawEmoji.replace(vs16RegExp, "") : rawEmoji;
    };
    function toCodePoints(unicodeSurrogates) {
      var points = [];
      var char = 0;
      var previous = 0;
      var i = 0;
      while (i < unicodeSurrogates.length) {
        char = unicodeSurrogates.charCodeAt(i++);
        if (previous) {
          points.push((65536 + (previous - 55296 << 10) + (char - 56320)).toString(16));
          previous = 0;
        } else if (char > 55296 && char <= 56319) {
          previous = char;
        } else {
          points.push(char.toString(16));
        }
      }
      return points;
    }
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/urlHasHttps.js
var require_urlHasHttps = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/urlHasHttps.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var urlHasHttps = /^https:\/\//i;
    var _default = urlHasHttps;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/parseTweet.js
var require_parseTweet = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/parseTweet.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    require_es6_array_reduce();
    require_web_dom_iterable();
    require_es6_array_iterator();
    require_es6_object_to_string();
    require_es6_object_keys();
    var _configs = _interopRequireDefault(require_configs());
    var _extractUrlsWithIndices = _interopRequireDefault(require_extractUrlsWithIndices());
    var _getCharacterWeight = _interopRequireDefault(require_getCharacterWeight());
    var _hasInvalidCharacters = _interopRequireDefault(require_hasInvalidCharacters());
    var _modifyIndicesFromUTF16ToUnicode = _interopRequireDefault(require_modifyIndicesFromUTF16ToUnicode());
    var _twemojiParser = require_dist();
    var _urlHasHttps = _interopRequireDefault(require_urlHasHttps());
    var parseTweet2 = function parseTweet3() {
      var text = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "";
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : _configs["default"].defaults;
      var mergedOptions = Object.keys(options).length ? options : _configs["default"].defaults;
      var defaultWeight = mergedOptions.defaultWeight, emojiParsingEnabled = mergedOptions.emojiParsingEnabled, scale = mergedOptions.scale, maxWeightedTweetLength = mergedOptions.maxWeightedTweetLength, transformedURLLength = mergedOptions.transformedURLLength;
      var normalizedText = typeof String.prototype.normalize === "function" ? text.normalize() : text;
      var urlEntitiesMap = transformEntitiesToHash((0, _extractUrlsWithIndices["default"])(normalizedText));
      var emojiEntitiesMap = emojiParsingEnabled ? transformEntitiesToHash((0, _twemojiParser.parse)(normalizedText)) : [];
      var tweetLength = normalizedText.length;
      var weightedLength = 0;
      var validDisplayIndex = 0;
      var valid = true;
      for (var charIndex = 0; charIndex < tweetLength; charIndex++) {
        if (urlEntitiesMap[charIndex]) {
          var _urlEntitiesMap$charI = urlEntitiesMap[charIndex], url = _urlEntitiesMap$charI.url, indices = _urlEntitiesMap$charI.indices;
          weightedLength += transformedURLLength * scale;
          charIndex += url.length - 1;
        } else if (emojiParsingEnabled && emojiEntitiesMap[charIndex]) {
          var _emojiEntitiesMap$cha = emojiEntitiesMap[charIndex], emoji = _emojiEntitiesMap$cha.text, _indices = _emojiEntitiesMap$cha.indices;
          weightedLength += defaultWeight;
          charIndex += emoji.length - 1;
        } else {
          charIndex += isSurrogatePair(normalizedText, charIndex) ? 1 : 0;
          weightedLength += (0, _getCharacterWeight["default"])(normalizedText.charAt(charIndex), mergedOptions);
        }
        if (valid) {
          valid = !(0, _hasInvalidCharacters["default"])(normalizedText.substring(charIndex, charIndex + 1));
        }
        if (valid && weightedLength <= maxWeightedTweetLength * scale) {
          validDisplayIndex = charIndex;
        }
      }
      weightedLength = weightedLength / scale;
      valid = valid && weightedLength > 0 && weightedLength <= maxWeightedTweetLength;
      var permillage = Math.floor(weightedLength / maxWeightedTweetLength * 1e3);
      var normalizationOffset = text.length - normalizedText.length;
      validDisplayIndex += normalizationOffset;
      return {
        weightedLength,
        valid,
        permillage,
        validRangeStart: 0,
        validRangeEnd: validDisplayIndex,
        displayRangeStart: 0,
        displayRangeEnd: text.length > 0 ? text.length - 1 : 0
      };
    };
    var transformEntitiesToHash = function transformEntitiesToHash2(entities) {
      return entities.reduce(function(map, entity) {
        map[entity.indices[0]] = entity;
        return map;
      }, {});
    };
    var isSurrogatePair = function isSurrogatePair2(text, cIndex) {
      if (cIndex < text.length - 1) {
        var c = text.charCodeAt(cIndex);
        var cNext = text.charCodeAt(cIndex + 1);
        return 55296 <= c && c <= 56319 && 56320 <= cNext && cNext <= 57343;
      }
      return false;
    };
    var _default = parseTweet2;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/getTweetLength.js
var require_getTweetLength = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/getTweetLength.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _configs = _interopRequireDefault(require_configs());
    var _extractUrlsWithIndices = _interopRequireDefault(require_extractUrlsWithIndices());
    var _getCharacterWeight = _interopRequireDefault(require_getCharacterWeight());
    var _modifyIndicesFromUTF16ToUnicode = _interopRequireDefault(require_modifyIndicesFromUTF16ToUnicode());
    var _nonBmpCodePairs = _interopRequireDefault(require_nonBmpCodePairs());
    var _parseTweet = _interopRequireDefault(require_parseTweet());
    var _urlHasHttps = _interopRequireDefault(require_urlHasHttps());
    var getTweetLength = function getTweetLength2(text) {
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : _configs["default"].defaults;
      return (0, _parseTweet["default"])(text, options).weightedLength;
    };
    var _default = getTweetLength;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/getUnicodeTextLength.js
var require_getUnicodeTextLength = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/getUnicodeTextLength.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_replace();
    var _nonBmpCodePairs = _interopRequireDefault(require_nonBmpCodePairs());
    function _default(text) {
      return text.replace(_nonBmpCodePairs["default"], " ").length;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/splitTags.js
var require_splitTags = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/splitTags.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_split();
    function _default(text) {
      var firstSplits = text.split("<"), secondSplits, allSplits = [], split;
      for (var i = 0; i < firstSplits.length; i += 1) {
        split = firstSplits[i];
        if (!split) {
          allSplits.push("");
        } else {
          secondSplits = split.split(">");
          for (var j = 0; j < secondSplits.length; j += 1) {
            allSplits.push(secondSplits[j]);
          }
        }
      }
      return allSplits;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/hitHighlight.js
var require_hitHighlight = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/hitHighlight.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _splitTags = _interopRequireDefault(require_splitTags());
    function _default(text, hits, options) {
      var defaultHighlightTag = "em";
      hits = hits || [];
      options = options || {};
      if (hits.length === 0) {
        return text;
      }
      var tagName = options.tag || defaultHighlightTag, tags = ["<".concat(tagName, ">"), "</".concat(tagName, ">")], chunks = (0, _splitTags["default"])(text), i, j, result = "", chunkIndex = 0, chunk = chunks[0], prevChunksLen = 0, chunkCursor = 0, startInChunk = false, chunkChars = chunk, flatHits = [], index, hit, tag, placed, hitSpot;
      for (i = 0; i < hits.length; i += 1) {
        for (j = 0; j < hits[i].length; j += 1) {
          flatHits.push(hits[i][j]);
        }
      }
      for (index = 0; index < flatHits.length; index += 1) {
        hit = flatHits[index];
        tag = tags[index % 2];
        placed = false;
        while (chunk != null && hit >= prevChunksLen + chunk.length) {
          result += chunkChars.slice(chunkCursor);
          if (startInChunk && hit === prevChunksLen + chunkChars.length) {
            result += tag;
            placed = true;
          }
          if (chunks[chunkIndex + 1]) {
            result += "<".concat(chunks[chunkIndex + 1], ">");
          }
          prevChunksLen += chunkChars.length;
          chunkCursor = 0;
          chunkIndex += 2;
          chunk = chunks[chunkIndex];
          chunkChars = chunk;
          startInChunk = false;
        }
        if (!placed && chunk != null) {
          hitSpot = hit - prevChunksLen;
          result += chunkChars.slice(chunkCursor, hitSpot) + tag;
          chunkCursor = hitSpot;
          if (index % 2 === 0) {
            startInChunk = true;
          } else {
            startInChunk = false;
          }
        } else if (!placed) {
          placed = true;
          result += tag;
        }
      }
      if (chunk != null) {
        if (chunkCursor < chunkChars.length) {
          result += chunkChars.slice(chunkCursor);
        }
        for (index = chunkIndex + 1; index < chunks.length; index += 1) {
          result += index % 2 === 0 ? chunks[index] : "<".concat(chunks[index], ">");
        }
      }
      return result;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.define-properties.js
var require_es6_object_define_properties = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.object.define-properties.js"() {
    var $export = require_export();
    $export($export.S + $export.F * !require_descriptors(), "Object", { defineProperties: require_object_dps() });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gops.js
var require_object_gops = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gops.js"(exports) {
    exports.f = Object.getOwnPropertySymbols;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_own-keys.js
var require_own_keys = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_own-keys.js"(exports, module) {
    var gOPN = require_object_gopn();
    var gOPS = require_object_gops();
    var anObject = require_an_object();
    var Reflect2 = require_global().Reflect;
    module.exports = Reflect2 && Reflect2.ownKeys || function ownKeys(it) {
      var keys = gOPN.f(anObject(it));
      var getSymbols = gOPS.f;
      return getSymbols ? keys.concat(getSymbols(it)) : keys;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_create-property.js
var require_create_property = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_create-property.js"(exports, module) {
    "use strict";
    var $defineProperty = require_object_dp();
    var createDesc = require_property_desc();
    module.exports = function(object, index, value) {
      if (index in object) $defineProperty.f(object, index, createDesc(0, value));
      else object[index] = value;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es7.object.get-own-property-descriptors.js
var require_es7_object_get_own_property_descriptors = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es7.object.get-own-property-descriptors.js"() {
    var $export = require_export();
    var ownKeys = require_own_keys();
    var toIObject = require_to_iobject();
    var gOPD = require_object_gopd();
    var createProperty = require_create_property();
    $export($export.S, "Object", {
      getOwnPropertyDescriptors: function getOwnPropertyDescriptors(object) {
        var O = toIObject(object);
        var getDesc = gOPD.f;
        var keys = ownKeys(O);
        var result = {};
        var i = 0;
        var key, desc;
        while (keys.length > i) {
          desc = getDesc(O, key = keys[i++]);
          if (desc !== void 0) createProperty(result, key, desc);
        }
        return result;
      }
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-species-constructor.js
var require_array_species_constructor = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-species-constructor.js"(exports, module) {
    var isObject = require_is_object();
    var isArray = require_is_array();
    var SPECIES = require_wks()("species");
    module.exports = function(original) {
      var C;
      if (isArray(original)) {
        C = original.constructor;
        if (typeof C == "function" && (C === Array || isArray(C.prototype))) C = void 0;
        if (isObject(C)) {
          C = C[SPECIES];
          if (C === null) C = void 0;
        }
      }
      return C === void 0 ? Array : C;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-species-create.js
var require_array_species_create = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-species-create.js"(exports, module) {
    var speciesConstructor = require_array_species_constructor();
    module.exports = function(original, length) {
      return new (speciesConstructor(original))(length);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-methods.js
var require_array_methods = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_array-methods.js"(exports, module) {
    var ctx = require_ctx();
    var IObject = require_iobject();
    var toObject = require_to_object();
    var toLength = require_to_length();
    var asc = require_array_species_create();
    module.exports = function(TYPE, $create) {
      var IS_MAP = TYPE == 1;
      var IS_FILTER = TYPE == 2;
      var IS_SOME = TYPE == 3;
      var IS_EVERY = TYPE == 4;
      var IS_FIND_INDEX = TYPE == 6;
      var NO_HOLES = TYPE == 5 || IS_FIND_INDEX;
      var create = $create || asc;
      return function($this, callbackfn, that) {
        var O = toObject($this);
        var self2 = IObject(O);
        var f = ctx(callbackfn, that, 3);
        var length = toLength(self2.length);
        var index = 0;
        var result = IS_MAP ? create($this, length) : IS_FILTER ? create($this, 0) : void 0;
        var val, res;
        for (; length > index; index++) if (NO_HOLES || index in self2) {
          val = self2[index];
          res = f(val, index, O);
          if (TYPE) {
            if (IS_MAP) result[index] = res;
            else if (res) switch (TYPE) {
              case 3:
                return true;
              // some
              case 5:
                return val;
              // find
              case 6:
                return index;
              // findIndex
              case 2:
                result.push(val);
            }
            else if (IS_EVERY) return false;
          }
        }
        return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : result;
      };
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.for-each.js
var require_es6_array_for_each = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.for-each.js"() {
    "use strict";
    var $export = require_export();
    var $forEach = require_array_methods()(0);
    var STRICT = require_strict_method()([].forEach, true);
    $export($export.P + $export.F * !STRICT, "Array", {
      // 22.1.3.10 / 15.4.4.18 Array.prototype.forEach(callbackfn [, thisArg])
      forEach: function forEach(callbackfn) {
        return $forEach(this, callbackfn, arguments[1]);
      }
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.filter.js
var require_es6_array_filter = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.filter.js"() {
    "use strict";
    var $export = require_export();
    var $filter = require_array_methods()(2);
    $export($export.P + $export.F * !require_strict_method()([].filter, true), "Array", {
      // 22.1.3.7 / 15.4.4.20 Array.prototype.filter(callbackfn [, thisArg])
      filter: function filter(callbackfn) {
        return $filter(this, callbackfn, arguments[1]);
      }
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_meta.js
var require_meta = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_meta.js"(exports, module) {
    var META = require_uid()("meta");
    var isObject = require_is_object();
    var has = require_has();
    var setDesc = require_object_dp().f;
    var id = 0;
    var isExtensible = Object.isExtensible || function() {
      return true;
    };
    var FREEZE = !require_fails()(function() {
      return isExtensible(Object.preventExtensions({}));
    });
    var setMeta = function(it) {
      setDesc(it, META, { value: {
        i: "O" + ++id,
        // object ID
        w: {}
        // weak collections IDs
      } });
    };
    var fastKey = function(it, create) {
      if (!isObject(it)) return typeof it == "symbol" ? it : (typeof it == "string" ? "S" : "P") + it;
      if (!has(it, META)) {
        if (!isExtensible(it)) return "F";
        if (!create) return "E";
        setMeta(it);
      }
      return it[META].i;
    };
    var getWeak = function(it, create) {
      if (!has(it, META)) {
        if (!isExtensible(it)) return true;
        if (!create) return false;
        setMeta(it);
      }
      return it[META].w;
    };
    var onFreeze = function(it) {
      if (FREEZE && meta.NEED && isExtensible(it) && !has(it, META)) setMeta(it);
      return it;
    };
    var meta = module.exports = {
      KEY: META,
      NEED: false,
      fastKey,
      getWeak,
      onFreeze
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_wks-ext.js
var require_wks_ext = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_wks-ext.js"(exports) {
    exports.f = require_wks();
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_wks-define.js
var require_wks_define = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_wks-define.js"(exports, module) {
    var global = require_global();
    var core = require_core();
    var LIBRARY = require_library();
    var wksExt = require_wks_ext();
    var defineProperty = require_object_dp().f;
    module.exports = function(name) {
      var $Symbol = core.Symbol || (core.Symbol = LIBRARY ? {} : global.Symbol || {});
      if (name.charAt(0) != "_" && !(name in $Symbol)) defineProperty($Symbol, name, { value: wksExt.f(name) });
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_enum-keys.js
var require_enum_keys = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_enum-keys.js"(exports, module) {
    var getKeys = require_object_keys();
    var gOPS = require_object_gops();
    var pIE = require_object_pie();
    module.exports = function(it) {
      var result = getKeys(it);
      var getSymbols = gOPS.f;
      if (getSymbols) {
        var symbols = getSymbols(it);
        var isEnum = pIE.f;
        var i = 0;
        var key;
        while (symbols.length > i) if (isEnum.call(it, key = symbols[i++])) result.push(key);
      }
      return result;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gopn-ext.js
var require_object_gopn_ext = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_object-gopn-ext.js"(exports, module) {
    var toIObject = require_to_iobject();
    var gOPN = require_object_gopn().f;
    var toString = {}.toString;
    var windowNames = typeof window == "object" && window && Object.getOwnPropertyNames ? Object.getOwnPropertyNames(window) : [];
    var getWindowNames = function(it) {
      try {
        return gOPN(it);
      } catch (e) {
        return windowNames.slice();
      }
    };
    module.exports.f = function getOwnPropertyNames(it) {
      return windowNames && toString.call(it) == "[object Window]" ? getWindowNames(it) : gOPN(toIObject(it));
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.symbol.js
var require_es6_symbol = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.symbol.js"() {
    "use strict";
    var global = require_global();
    var has = require_has();
    var DESCRIPTORS = require_descriptors();
    var $export = require_export();
    var redefine = require_redefine();
    var META = require_meta().KEY;
    var $fails = require_fails();
    var shared = require_shared();
    var setToStringTag = require_set_to_string_tag();
    var uid = require_uid();
    var wks = require_wks();
    var wksExt = require_wks_ext();
    var wksDefine = require_wks_define();
    var enumKeys = require_enum_keys();
    var isArray = require_is_array();
    var anObject = require_an_object();
    var isObject = require_is_object();
    var toObject = require_to_object();
    var toIObject = require_to_iobject();
    var toPrimitive = require_to_primitive();
    var createDesc = require_property_desc();
    var _create = require_object_create();
    var gOPNExt = require_object_gopn_ext();
    var $GOPD = require_object_gopd();
    var $GOPS = require_object_gops();
    var $DP = require_object_dp();
    var $keys = require_object_keys();
    var gOPD = $GOPD.f;
    var dP = $DP.f;
    var gOPN = gOPNExt.f;
    var $Symbol = global.Symbol;
    var $JSON = global.JSON;
    var _stringify = $JSON && $JSON.stringify;
    var PROTOTYPE = "prototype";
    var HIDDEN = wks("_hidden");
    var TO_PRIMITIVE = wks("toPrimitive");
    var isEnum = {}.propertyIsEnumerable;
    var SymbolRegistry = shared("symbol-registry");
    var AllSymbols = shared("symbols");
    var OPSymbols = shared("op-symbols");
    var ObjectProto = Object[PROTOTYPE];
    var USE_NATIVE = typeof $Symbol == "function" && !!$GOPS.f;
    var QObject = global.QObject;
    var setter = !QObject || !QObject[PROTOTYPE] || !QObject[PROTOTYPE].findChild;
    var setSymbolDesc = DESCRIPTORS && $fails(function() {
      return _create(dP({}, "a", {
        get: function() {
          return dP(this, "a", { value: 7 }).a;
        }
      })).a != 7;
    }) ? function(it, key, D) {
      var protoDesc = gOPD(ObjectProto, key);
      if (protoDesc) delete ObjectProto[key];
      dP(it, key, D);
      if (protoDesc && it !== ObjectProto) dP(ObjectProto, key, protoDesc);
    } : dP;
    var wrap = function(tag) {
      var sym = AllSymbols[tag] = _create($Symbol[PROTOTYPE]);
      sym._k = tag;
      return sym;
    };
    var isSymbol = USE_NATIVE && typeof $Symbol.iterator == "symbol" ? function(it) {
      return typeof it == "symbol";
    } : function(it) {
      return it instanceof $Symbol;
    };
    var $defineProperty = function defineProperty(it, key, D) {
      if (it === ObjectProto) $defineProperty(OPSymbols, key, D);
      anObject(it);
      key = toPrimitive(key, true);
      anObject(D);
      if (has(AllSymbols, key)) {
        if (!D.enumerable) {
          if (!has(it, HIDDEN)) dP(it, HIDDEN, createDesc(1, {}));
          it[HIDDEN][key] = true;
        } else {
          if (has(it, HIDDEN) && it[HIDDEN][key]) it[HIDDEN][key] = false;
          D = _create(D, { enumerable: createDesc(0, false) });
        }
        return setSymbolDesc(it, key, D);
      }
      return dP(it, key, D);
    };
    var $defineProperties = function defineProperties(it, P) {
      anObject(it);
      var keys = enumKeys(P = toIObject(P));
      var i = 0;
      var l = keys.length;
      var key;
      while (l > i) $defineProperty(it, key = keys[i++], P[key]);
      return it;
    };
    var $create = function create(it, P) {
      return P === void 0 ? _create(it) : $defineProperties(_create(it), P);
    };
    var $propertyIsEnumerable = function propertyIsEnumerable(key) {
      var E = isEnum.call(this, key = toPrimitive(key, true));
      if (this === ObjectProto && has(AllSymbols, key) && !has(OPSymbols, key)) return false;
      return E || !has(this, key) || !has(AllSymbols, key) || has(this, HIDDEN) && this[HIDDEN][key] ? E : true;
    };
    var $getOwnPropertyDescriptor = function getOwnPropertyDescriptor(it, key) {
      it = toIObject(it);
      key = toPrimitive(key, true);
      if (it === ObjectProto && has(AllSymbols, key) && !has(OPSymbols, key)) return;
      var D = gOPD(it, key);
      if (D && has(AllSymbols, key) && !(has(it, HIDDEN) && it[HIDDEN][key])) D.enumerable = true;
      return D;
    };
    var $getOwnPropertyNames = function getOwnPropertyNames(it) {
      var names = gOPN(toIObject(it));
      var result = [];
      var i = 0;
      var key;
      while (names.length > i) {
        if (!has(AllSymbols, key = names[i++]) && key != HIDDEN && key != META) result.push(key);
      }
      return result;
    };
    var $getOwnPropertySymbols = function getOwnPropertySymbols(it) {
      var IS_OP = it === ObjectProto;
      var names = gOPN(IS_OP ? OPSymbols : toIObject(it));
      var result = [];
      var i = 0;
      var key;
      while (names.length > i) {
        if (has(AllSymbols, key = names[i++]) && (IS_OP ? has(ObjectProto, key) : true)) result.push(AllSymbols[key]);
      }
      return result;
    };
    if (!USE_NATIVE) {
      $Symbol = function Symbol3() {
        if (this instanceof $Symbol) throw TypeError("Symbol is not a constructor!");
        var tag = uid(arguments.length > 0 ? arguments[0] : void 0);
        var $set = function(value) {
          if (this === ObjectProto) $set.call(OPSymbols, value);
          if (has(this, HIDDEN) && has(this[HIDDEN], tag)) this[HIDDEN][tag] = false;
          setSymbolDesc(this, tag, createDesc(1, value));
        };
        if (DESCRIPTORS && setter) setSymbolDesc(ObjectProto, tag, { configurable: true, set: $set });
        return wrap(tag);
      };
      redefine($Symbol[PROTOTYPE], "toString", function toString() {
        return this._k;
      });
      $GOPD.f = $getOwnPropertyDescriptor;
      $DP.f = $defineProperty;
      require_object_gopn().f = gOPNExt.f = $getOwnPropertyNames;
      require_object_pie().f = $propertyIsEnumerable;
      $GOPS.f = $getOwnPropertySymbols;
      if (DESCRIPTORS && !require_library()) {
        redefine(ObjectProto, "propertyIsEnumerable", $propertyIsEnumerable, true);
      }
      wksExt.f = function(name) {
        return wrap(wks(name));
      };
    }
    $export($export.G + $export.W + $export.F * !USE_NATIVE, { Symbol: $Symbol });
    for (es6Symbols = // 19.4.2.2, 19.4.2.3, 19.4.2.4, 19.4.2.6, 19.4.2.8, 19.4.2.9, 19.4.2.10, 19.4.2.11, 19.4.2.12, 19.4.2.13, 19.4.2.14
    "hasInstance,isConcatSpreadable,iterator,match,replace,search,species,split,toPrimitive,toStringTag,unscopables".split(","), j = 0; es6Symbols.length > j; ) wks(es6Symbols[j++]);
    var es6Symbols;
    var j;
    for (wellKnownSymbols = $keys(wks.store), k = 0; wellKnownSymbols.length > k; ) wksDefine(wellKnownSymbols[k++]);
    var wellKnownSymbols;
    var k;
    $export($export.S + $export.F * !USE_NATIVE, "Symbol", {
      // 19.4.2.1 Symbol.for(key)
      "for": function(key) {
        return has(SymbolRegistry, key += "") ? SymbolRegistry[key] : SymbolRegistry[key] = $Symbol(key);
      },
      // 19.4.2.5 Symbol.keyFor(sym)
      keyFor: function keyFor(sym) {
        if (!isSymbol(sym)) throw TypeError(sym + " is not a symbol!");
        for (var key in SymbolRegistry) if (SymbolRegistry[key] === sym) return key;
      },
      useSetter: function() {
        setter = true;
      },
      useSimple: function() {
        setter = false;
      }
    });
    $export($export.S + $export.F * !USE_NATIVE, "Object", {
      // 19.1.2.2 Object.create(O [, Properties])
      create: $create,
      // 19.1.2.4 Object.defineProperty(O, P, Attributes)
      defineProperty: $defineProperty,
      // 19.1.2.3 Object.defineProperties(O, Properties)
      defineProperties: $defineProperties,
      // 19.1.2.6 Object.getOwnPropertyDescriptor(O, P)
      getOwnPropertyDescriptor: $getOwnPropertyDescriptor,
      // 19.1.2.7 Object.getOwnPropertyNames(O)
      getOwnPropertyNames: $getOwnPropertyNames,
      // 19.1.2.8 Object.getOwnPropertySymbols(O)
      getOwnPropertySymbols: $getOwnPropertySymbols
    });
    var FAILS_ON_PRIMITIVES = $fails(function() {
      $GOPS.f(1);
    });
    $export($export.S + $export.F * FAILS_ON_PRIMITIVES, "Object", {
      getOwnPropertySymbols: function getOwnPropertySymbols(it) {
        return $GOPS.f(toObject(it));
      }
    });
    $JSON && $export($export.S + $export.F * (!USE_NATIVE || $fails(function() {
      var S = $Symbol();
      return _stringify([S]) != "[null]" || _stringify({ a: S }) != "{}" || _stringify(Object(S)) != "{}";
    })), "JSON", {
      stringify: function stringify(it) {
        var args = [it];
        var i = 1;
        var replacer, $replacer;
        while (arguments.length > i) args.push(arguments[i++]);
        $replacer = replacer = args[1];
        if (!isObject(replacer) && it === void 0 || isSymbol(it)) return;
        if (!isArray(replacer)) replacer = function(key, value) {
          if (typeof $replacer == "function") value = $replacer.call(this, key, value);
          if (!isSymbol(value)) return value;
        };
        args[1] = replacer;
        return _stringify.apply($JSON, args);
      }
    });
    $Symbol[PROTOTYPE][TO_PRIMITIVE] || require_hide()($Symbol[PROTOTYPE], TO_PRIMITIVE, $Symbol[PROTOTYPE].valueOf);
    setToStringTag($Symbol, "Symbol");
    setToStringTag(Math, "Math", true);
    setToStringTag(global.JSON, "JSON", true);
  }
});

// node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/typeof.js
var require_typeof = __commonJS({
  "node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/typeof.js"(exports, module) {
    function _typeof(o) {
      "@babel/helpers - typeof";
      return module.exports = _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, module.exports.__esModule = true, module.exports["default"] = module.exports, _typeof(o);
    }
    module.exports = _typeof, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/toPrimitive.js
var require_toPrimitive = __commonJS({
  "node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/toPrimitive.js"(exports, module) {
    var _typeof = require_typeof()["default"];
    function toPrimitive(t, r) {
      if ("object" != _typeof(t) || !t) return t;
      var e = t[Symbol.toPrimitive];
      if (void 0 !== e) {
        var i = e.call(t, r || "default");
        if ("object" != _typeof(i)) return i;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return ("string" === r ? String : Number)(t);
    }
    module.exports = toPrimitive, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/toPropertyKey.js
var require_toPropertyKey = __commonJS({
  "node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/toPropertyKey.js"(exports, module) {
    var _typeof = require_typeof()["default"];
    var toPrimitive = require_toPrimitive();
    function toPropertyKey(t) {
      var i = toPrimitive(t, "string");
      return "symbol" == _typeof(i) ? i : i + "";
    }
    module.exports = toPropertyKey, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/defineProperty.js
var require_defineProperty = __commonJS({
  "node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/helpers/defineProperty.js"(exports, module) {
    var toPropertyKey = require_toPropertyKey();
    function _defineProperty(e, r, t) {
      return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
        value: t,
        enumerable: true,
        configurable: true,
        writable: true
      }) : e[r] = t, e;
    }
    module.exports = _defineProperty, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isInvalidTweet.js
var require_isInvalidTweet = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isInvalidTweet.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_object_define_property();
    require_es6_object_define_properties();
    require_es7_object_get_own_property_descriptors();
    require_es6_array_for_each();
    require_es6_array_filter();
    require_es6_symbol();
    require_web_dom_iterable();
    require_es6_array_iterator();
    require_es6_object_to_string();
    require_es6_object_keys();
    var _defineProperty2 = _interopRequireDefault(require_defineProperty());
    var _configs = _interopRequireDefault(require_configs());
    var _getTweetLength = _interopRequireDefault(require_getTweetLength());
    var _hasInvalidCharacters = _interopRequireDefault(require_hasInvalidCharacters());
    function ownKeys(object, enumerableOnly) {
      var keys = Object.keys(object);
      if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        if (enumerableOnly) symbols = symbols.filter(function(sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        });
        keys.push.apply(keys, symbols);
      }
      return keys;
    }
    function _objectSpread(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i] != null ? arguments[i] : {};
        if (i % 2) {
          ownKeys(source, true).forEach(function(key) {
            (0, _defineProperty2["default"])(target, key, source[key]);
          });
        } else if (Object.getOwnPropertyDescriptors) {
          Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
        } else {
          ownKeys(source).forEach(function(key) {
            Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
          });
        }
      }
      return target;
    }
    function _default(text) {
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : _configs["default"].defaults;
      if (!text) {
        return "empty";
      }
      var mergedOptions = _objectSpread({}, _configs["default"].defaults, {}, options);
      var maxLength = mergedOptions.maxWeightedTweetLength;
      if ((0, _getTweetLength["default"])(text, mergedOptions) > maxLength) {
        return "too_long";
      }
      if ((0, _hasInvalidCharacters["default"])(text)) {
        return "invalid_characters";
      }
      return false;
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidHashtag.js
var require_isValidHashtag = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidHashtag.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractHashtags = _interopRequireDefault(require_extractHashtags());
    function _default(hashtag) {
      if (!hashtag) {
        return false;
      }
      var extracted = (0, _extractHashtags["default"])(hashtag);
      return extracted.length === 1 && extracted[0] === hashtag.slice(1);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidList.js
var require_isValidList = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidList.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_match();
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validMentionOrList = _interopRequireDefault(require_validMentionOrList());
    var VALID_LIST_RE = (0, _regexSupplant["default"])(/^#{validMentionOrList}$/, {
      validMentionOrList: _validMentionOrList["default"]
    });
    function _default(usernameList) {
      var match = usernameList.match(VALID_LIST_RE);
      return !!(match && match[1] == "" && match[4]);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidTweetText.js
var require_isValidTweetText = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidTweetText.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _isInvalidTweet = _interopRequireDefault(require_isInvalidTweet());
    function _default(text, options) {
      return !(0, _isInvalidTweet["default"])(text, options);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnreserved.js
var require_validateUrlUnreserved = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnreserved.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlUnreserved = /[a-z\u0400-\u04FF0-9\-._~]/i;
    var _default = validateUrlUnreserved;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPctEncoded.js
var require_validateUrlPctEncoded = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPctEncoded.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlPctEncoded = /(?:%[0-9a-f]{2})/i;
    var _default = validateUrlPctEncoded;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlSubDelims.js
var require_validateUrlSubDelims = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlSubDelims.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlSubDelims = /[!$&'()*+,;=]/i;
    var _default = validateUrlSubDelims;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUserinfo.js
var require_validateUrlUserinfo = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUserinfo.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlUnreserved = _interopRequireDefault(require_validateUrlUnreserved());
    var _validateUrlPctEncoded = _interopRequireDefault(require_validateUrlPctEncoded());
    var _validateUrlSubDelims = _interopRequireDefault(require_validateUrlSubDelims());
    var validateUrlUserinfo = (0, _regexSupplant["default"])("(?:#{validateUrlUnreserved}|#{validateUrlPctEncoded}|#{validateUrlSubDelims}|:)*", {
      validateUrlUnreserved: _validateUrlUnreserved["default"],
      validateUrlPctEncoded: _validateUrlPctEncoded["default"],
      validateUrlSubDelims: _validateUrlSubDelims["default"]
    }, "i");
    var _default = validateUrlUserinfo;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDomainSegment.js
var require_validateUrlDomainSegment = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDomainSegment.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlDomainSegment = /(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)/i;
    var _default = validateUrlDomainSegment;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDomainTld.js
var require_validateUrlDomainTld = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDomainTld.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlDomainTld = /(?:[a-z](?:[a-z0-9\-]*[a-z0-9])?)/i;
    var _default = validateUrlDomainTld;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlSubDomainSegment.js
var require_validateUrlSubDomainSegment = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlSubDomainSegment.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlSubDomainSegment = /(?:[a-z0-9](?:[a-z0-9_\-]*[a-z0-9])?)/i;
    var _default = validateUrlSubDomainSegment;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDomain.js
var require_validateUrlDomain = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDomain.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlDomainSegment = _interopRequireDefault(require_validateUrlDomainSegment());
    var _validateUrlDomainTld = _interopRequireDefault(require_validateUrlDomainTld());
    var _validateUrlSubDomainSegment = _interopRequireDefault(require_validateUrlSubDomainSegment());
    var validateUrlDomain = (0, _regexSupplant["default"])(/(?:(?:#{validateUrlSubDomainSegment}\.)*(?:#{validateUrlDomainSegment}\.)#{validateUrlDomainTld})/i, {
      validateUrlSubDomainSegment: _validateUrlSubDomainSegment["default"],
      validateUrlDomainSegment: _validateUrlDomainSegment["default"],
      validateUrlDomainTld: _validateUrlDomainTld["default"]
    });
    var _default = validateUrlDomain;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDecOctet.js
var require_validateUrlDecOctet = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlDecOctet.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlDecOctet = /(?:[0-9]|(?:[1-9][0-9])|(?:1[0-9]{2})|(?:2[0-4][0-9])|(?:25[0-5]))/i;
    var _default = validateUrlDecOctet;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlIpv4.js
var require_validateUrlIpv4 = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlIpv4.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlDecOctet = _interopRequireDefault(require_validateUrlDecOctet());
    var validateUrlIpv4 = (0, _regexSupplant["default"])(/(?:#{validateUrlDecOctet}(?:\.#{validateUrlDecOctet}){3})/i, {
      validateUrlDecOctet: _validateUrlDecOctet["default"]
    });
    var _default = validateUrlIpv4;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlIpv6.js
var require_validateUrlIpv6 = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlIpv6.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlIpv6 = /(?:\[[a-f0-9:\.]+\])/i;
    var _default = validateUrlIpv6;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlIp.js
var require_validateUrlIp = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlIp.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlIpv = _interopRequireDefault(require_validateUrlIpv4());
    var _validateUrlIpv2 = _interopRequireDefault(require_validateUrlIpv6());
    var validateUrlIp = (0, _regexSupplant["default"])("(?:#{validateUrlIpv4}|#{validateUrlIpv6})", {
      validateUrlIpv4: _validateUrlIpv["default"],
      validateUrlIpv6: _validateUrlIpv2["default"]
    }, "i");
    var _default = validateUrlIp;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlHost.js
var require_validateUrlHost = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlHost.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlDomain = _interopRequireDefault(require_validateUrlDomain());
    var _validateUrlIp = _interopRequireDefault(require_validateUrlIp());
    var validateUrlHost = (0, _regexSupplant["default"])("(?:#{validateUrlIp}|#{validateUrlDomain})", {
      validateUrlIp: _validateUrlIp["default"],
      validateUrlDomain: _validateUrlDomain["default"]
    }, "i");
    var _default = validateUrlHost;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPort.js
var require_validateUrlPort = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPort.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlPort = /[0-9]{1,5}/;
    var _default = validateUrlPort;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlAuthority.js
var require_validateUrlAuthority = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlAuthority.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlUserinfo = _interopRequireDefault(require_validateUrlUserinfo());
    var _validateUrlHost = _interopRequireDefault(require_validateUrlHost());
    var _validateUrlPort = _interopRequireDefault(require_validateUrlPort());
    var validateUrlAuthority = (0, _regexSupplant["default"])(
      // $1 userinfo
      "(?:(#{validateUrlUserinfo})@)?(#{validateUrlHost})(?::(#{validateUrlPort}))?",
      {
        validateUrlUserinfo: _validateUrlUserinfo["default"],
        validateUrlHost: _validateUrlHost["default"],
        validateUrlPort: _validateUrlPort["default"]
      },
      "i"
    );
    var _default = validateUrlAuthority;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPchar.js
var require_validateUrlPchar = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPchar.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlUnreserved = _interopRequireDefault(require_validateUrlUnreserved());
    var _validateUrlPctEncoded = _interopRequireDefault(require_validateUrlPctEncoded());
    var _validateUrlSubDelims = _interopRequireDefault(require_validateUrlSubDelims());
    var validateUrlPchar = (0, _regexSupplant["default"])("(?:#{validateUrlUnreserved}|#{validateUrlPctEncoded}|#{validateUrlSubDelims}|[:|@])", {
      validateUrlUnreserved: _validateUrlUnreserved["default"],
      validateUrlPctEncoded: _validateUrlPctEncoded["default"],
      validateUrlSubDelims: _validateUrlSubDelims["default"]
    }, "i");
    var _default = validateUrlPchar;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlFragment.js
var require_validateUrlFragment = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlFragment.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlPchar = _interopRequireDefault(require_validateUrlPchar());
    var validateUrlFragment = (0, _regexSupplant["default"])(/(#{validateUrlPchar}|\/|\?)*/i, {
      validateUrlPchar: _validateUrlPchar["default"]
    });
    var _default = validateUrlFragment;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPath.js
var require_validateUrlPath = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlPath.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlPchar = _interopRequireDefault(require_validateUrlPchar());
    var validateUrlPath = (0, _regexSupplant["default"])(/(\/#{validateUrlPchar}*)*/i, {
      validateUrlPchar: _validateUrlPchar["default"]
    });
    var _default = validateUrlPath;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlQuery.js
var require_validateUrlQuery = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlQuery.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlPchar = _interopRequireDefault(require_validateUrlPchar());
    var validateUrlQuery = (0, _regexSupplant["default"])(/(#{validateUrlPchar}|\/|\?)*/i, {
      validateUrlPchar: _validateUrlPchar["default"]
    });
    var _default = validateUrlQuery;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlScheme.js
var require_validateUrlScheme = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlScheme.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlScheme = /(?:[a-z][a-z0-9+\-.]*)/i;
    var _default = validateUrlScheme;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnencoded.js
var require_validateUrlUnencoded = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnencoded.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var validateUrlUnencoded = (0, _regexSupplant["default"])("^(?:([^:/?#]+):\\/\\/)?([^/?#]*)([^?#]*)(?:\\?([^#]*))?(?:#(.*))?$", "i");
    var _default = validateUrlUnencoded;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeSubDomainSegment.js
var require_validateUrlUnicodeSubDomainSegment = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeSubDomainSegment.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlUnicodeSubDomainSegment = /(?:(?:[a-z0-9]|[^\u0000-\u007f])(?:(?:[a-z0-9_\-]|[^\u0000-\u007f])*(?:[a-z0-9]|[^\u0000-\u007f]))?)/i;
    var _default = validateUrlUnicodeSubDomainSegment;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeDomainSegment.js
var require_validateUrlUnicodeDomainSegment = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeDomainSegment.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlUnicodeDomainSegment = /(?:(?:[a-z0-9]|[^\u0000-\u007f])(?:(?:[a-z0-9\-]|[^\u0000-\u007f])*(?:[a-z0-9]|[^\u0000-\u007f]))?)/i;
    var _default = validateUrlUnicodeDomainSegment;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeDomainTld.js
var require_validateUrlUnicodeDomainTld = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeDomainTld.js"(exports, module) {
    "use strict";
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var validateUrlUnicodeDomainTld = /(?:(?:[a-z]|[^\u0000-\u007f])(?:(?:[a-z0-9\-]|[^\u0000-\u007f])*(?:[a-z0-9]|[^\u0000-\u007f]))?)/i;
    var _default = validateUrlUnicodeDomainTld;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeDomain.js
var require_validateUrlUnicodeDomain = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeDomain.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlUnicodeSubDomainSegment = _interopRequireDefault(require_validateUrlUnicodeSubDomainSegment());
    var _validateUrlUnicodeDomainSegment = _interopRequireDefault(require_validateUrlUnicodeDomainSegment());
    var _validateUrlUnicodeDomainTld = _interopRequireDefault(require_validateUrlUnicodeDomainTld());
    var validateUrlUnicodeDomain = (0, _regexSupplant["default"])(/(?:(?:#{validateUrlUnicodeSubDomainSegment}\.)*(?:#{validateUrlUnicodeDomainSegment}\.)#{validateUrlUnicodeDomainTld})/i, {
      validateUrlUnicodeSubDomainSegment: _validateUrlUnicodeSubDomainSegment["default"],
      validateUrlUnicodeDomainSegment: _validateUrlUnicodeDomainSegment["default"],
      validateUrlUnicodeDomainTld: _validateUrlUnicodeDomainTld["default"]
    });
    var _default = validateUrlUnicodeDomain;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeHost.js
var require_validateUrlUnicodeHost = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeHost.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlIp = _interopRequireDefault(require_validateUrlIp());
    var _validateUrlUnicodeDomain = _interopRequireDefault(require_validateUrlUnicodeDomain());
    var validateUrlUnicodeHost = (0, _regexSupplant["default"])("(?:#{validateUrlIp}|#{validateUrlUnicodeDomain})", {
      validateUrlIp: _validateUrlIp["default"],
      validateUrlUnicodeDomain: _validateUrlUnicodeDomain["default"]
    }, "i");
    var _default = validateUrlUnicodeHost;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeAuthority.js
var require_validateUrlUnicodeAuthority = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/validateUrlUnicodeAuthority.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _regexSupplant = _interopRequireDefault(require_regexSupplant());
    var _validateUrlUserinfo = _interopRequireDefault(require_validateUrlUserinfo());
    var _validateUrlUnicodeHost = _interopRequireDefault(require_validateUrlUnicodeHost());
    var _validateUrlPort = _interopRequireDefault(require_validateUrlPort());
    var validateUrlUnicodeAuthority = (0, _regexSupplant["default"])(
      // $1 userinfo
      "(?:(#{validateUrlUserinfo})@)?(#{validateUrlUnicodeHost})(?::(#{validateUrlPort}))?",
      {
        validateUrlUserinfo: _validateUrlUserinfo["default"],
        validateUrlUnicodeHost: _validateUrlUnicodeHost["default"],
        validateUrlPort: _validateUrlPort["default"]
      },
      "i"
    );
    var _default = validateUrlUnicodeAuthority;
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidUrl.js
var require_isValidUrl = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidUrl.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    require_es6_regexp_constructor();
    require_es6_regexp_match();
    var _validateUrlAuthority = _interopRequireDefault(require_validateUrlAuthority());
    var _validateUrlFragment = _interopRequireDefault(require_validateUrlFragment());
    var _validateUrlPath = _interopRequireDefault(require_validateUrlPath());
    var _validateUrlQuery = _interopRequireDefault(require_validateUrlQuery());
    var _validateUrlScheme = _interopRequireDefault(require_validateUrlScheme());
    var _validateUrlUnencoded = _interopRequireDefault(require_validateUrlUnencoded());
    var _validateUrlUnicodeAuthority = _interopRequireDefault(require_validateUrlUnicodeAuthority());
    function isValidMatch(string, regex, optional) {
      if (!optional) {
        return typeof string === "string" && string.match(regex) && RegExp["$&"] === string;
      }
      return !string || string.match(regex) && RegExp["$&"] === string;
    }
    function _default(url, unicodeDomains, requireProtocol) {
      if (unicodeDomains == null) {
        unicodeDomains = true;
      }
      if (requireProtocol == null) {
        requireProtocol = true;
      }
      if (!url) {
        return false;
      }
      var urlParts = url.match(_validateUrlUnencoded["default"]);
      if (!urlParts || urlParts[0] !== url) {
        return false;
      }
      var scheme = urlParts[1], authority = urlParts[2], path = urlParts[3], query = urlParts[4], fragment = urlParts[5];
      if (!((!requireProtocol || isValidMatch(scheme, _validateUrlScheme["default"]) && scheme.match(/^https?$/i)) && isValidMatch(path, _validateUrlPath["default"]) && isValidMatch(query, _validateUrlQuery["default"], true) && isValidMatch(fragment, _validateUrlFragment["default"], true))) {
        return false;
      }
      return unicodeDomains && isValidMatch(authority, _validateUrlUnicodeAuthority["default"]) || !unicodeDomains && isValidMatch(authority, _validateUrlAuthority["default"]);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidUsername.js
var require_isValidUsername = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/isValidUsername.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = _default;
    var _extractMentions = _interopRequireDefault(require_extractMentions());
    function _default(username) {
      if (!username) {
        return false;
      }
      var extracted = (0, _extractMentions["default"])(username);
      return extracted.length === 1 && extracted[0] === username.slice(1);
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/index.js
var require_regexp = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/regexp/index.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _astralLetterAndMarks = _interopRequireDefault(require_astralLetterAndMarks());
    var _astralNumerals = _interopRequireDefault(require_astralNumerals());
    var _atSigns = _interopRequireDefault(require_atSigns());
    var _bmpLetterAndMarks = _interopRequireDefault(require_bmpLetterAndMarks());
    var _bmpNumerals = _interopRequireDefault(require_bmpNumerals());
    var _cashtag = _interopRequireDefault(require_cashtag());
    var _codePoint = _interopRequireDefault(require_codePoint());
    var _cyrillicLettersAndMarks = _interopRequireDefault(require_cyrillicLettersAndMarks());
    var _endHashtagMatch = _interopRequireDefault(require_endHashtagMatch());
    var _endMentionMatch = _interopRequireDefault(require_endMentionMatch());
    var _extractUrl = _interopRequireDefault(require_extractUrl());
    var _hashSigns = _interopRequireDefault(require_hashSigns());
    var _hashtagAlpha = _interopRequireDefault(require_hashtagAlpha());
    var _hashtagAlphaNumeric = _interopRequireDefault(require_hashtagAlphaNumeric());
    var _hashtagBoundary = _interopRequireDefault(require_hashtagBoundary());
    var _hashtagSpecialChars = _interopRequireDefault(require_hashtagSpecialChars());
    var _invalidChars = _interopRequireDefault(require_invalidChars());
    var _invalidCharsGroup = _interopRequireDefault(require_invalidCharsGroup());
    var _invalidDomainChars = _interopRequireDefault(require_invalidDomainChars());
    var _invalidUrlWithoutProtocolPrecedingChars = _interopRequireDefault(require_invalidUrlWithoutProtocolPrecedingChars());
    var _latinAccentChars = _interopRequireDefault(require_latinAccentChars());
    var _nonBmpCodePairs = _interopRequireDefault(require_nonBmpCodePairs());
    var _punct = _interopRequireDefault(require_punct());
    var _rtlChars = _interopRequireDefault(require_rtlChars());
    var _spaces = _interopRequireDefault(require_spaces());
    var _spacesGroup = _interopRequireDefault(require_spacesGroup());
    var _urlHasHttps = _interopRequireDefault(require_urlHasHttps());
    var _urlHasProtocol = _interopRequireDefault(require_urlHasProtocol());
    var _validAsciiDomain = _interopRequireDefault(require_validAsciiDomain());
    var _validateUrlAuthority = _interopRequireDefault(require_validateUrlAuthority());
    var _validateUrlDecOctet = _interopRequireDefault(require_validateUrlDecOctet());
    var _validateUrlDomain = _interopRequireDefault(require_validateUrlDomain());
    var _validateUrlDomainSegment = _interopRequireDefault(require_validateUrlDomainSegment());
    var _validateUrlDomainTld = _interopRequireDefault(require_validateUrlDomainTld());
    var _validateUrlFragment = _interopRequireDefault(require_validateUrlFragment());
    var _validateUrlHost = _interopRequireDefault(require_validateUrlHost());
    var _validateUrlIp = _interopRequireDefault(require_validateUrlIp());
    var _validateUrlIpv = _interopRequireDefault(require_validateUrlIpv4());
    var _validateUrlIpv2 = _interopRequireDefault(require_validateUrlIpv6());
    var _validateUrlPath = _interopRequireDefault(require_validateUrlPath());
    var _validateUrlPchar = _interopRequireDefault(require_validateUrlPchar());
    var _validateUrlPctEncoded = _interopRequireDefault(require_validateUrlPctEncoded());
    var _validateUrlPort = _interopRequireDefault(require_validateUrlPort());
    var _validateUrlQuery = _interopRequireDefault(require_validateUrlQuery());
    var _validateUrlScheme = _interopRequireDefault(require_validateUrlScheme());
    var _validateUrlSubDelims = _interopRequireDefault(require_validateUrlSubDelims());
    var _validateUrlSubDomainSegment = _interopRequireDefault(require_validateUrlSubDomainSegment());
    var _validateUrlUnencoded = _interopRequireDefault(require_validateUrlUnencoded());
    var _validateUrlUnicodeAuthority = _interopRequireDefault(require_validateUrlUnicodeAuthority());
    var _validateUrlUnicodeDomain = _interopRequireDefault(require_validateUrlUnicodeDomain());
    var _validateUrlUnicodeDomainSegment = _interopRequireDefault(require_validateUrlUnicodeDomainSegment());
    var _validateUrlUnicodeDomainTld = _interopRequireDefault(require_validateUrlUnicodeDomainTld());
    var _validateUrlUnicodeHost = _interopRequireDefault(require_validateUrlUnicodeHost());
    var _validateUrlUnicodeSubDomainSegment = _interopRequireDefault(require_validateUrlUnicodeSubDomainSegment());
    var _validateUrlUnreserved = _interopRequireDefault(require_validateUrlUnreserved());
    var _validateUrlUserinfo = _interopRequireDefault(require_validateUrlUserinfo());
    var _validCashtag = _interopRequireDefault(require_validCashtag());
    var _validCCTLD = _interopRequireDefault(require_validCCTLD());
    var _validDomain = _interopRequireDefault(require_validDomain());
    var _validDomainChars = _interopRequireDefault(require_validDomainChars());
    var _validDomainName = _interopRequireDefault(require_validDomainName());
    var _validGeneralUrlPathChars = _interopRequireDefault(require_validGeneralUrlPathChars());
    var _validGTLD = _interopRequireDefault(require_validGTLD());
    var _validHashtag = _interopRequireDefault(require_validHashtag());
    var _validMentionOrList = _interopRequireDefault(require_validMentionOrList());
    var _validMentionPrecedingChars = _interopRequireDefault(require_validMentionPrecedingChars());
    var _validPortNumber = _interopRequireDefault(require_validPortNumber());
    var _validPunycode = _interopRequireDefault(require_validPunycode());
    var _validReply = _interopRequireDefault(require_validReply());
    var _validSubdomain = _interopRequireDefault(require_validSubdomain());
    var _validTcoUrl = _interopRequireDefault(require_validTcoUrl());
    var _validUrlBalancedParens = _interopRequireDefault(require_validUrlBalancedParens());
    var _validUrlPath = _interopRequireDefault(require_validUrlPath());
    var _validUrlPathEndingChars = _interopRequireDefault(require_validUrlPathEndingChars());
    var _validUrlPrecedingChars = _interopRequireDefault(require_validUrlPrecedingChars());
    var _validUrlQueryChars = _interopRequireDefault(require_validUrlQueryChars());
    var _validUrlQueryEndingChars = _interopRequireDefault(require_validUrlQueryEndingChars());
    var _default = {
      astralLetterAndMarks: _astralLetterAndMarks["default"],
      astralNumerals: _astralNumerals["default"],
      atSigns: _atSigns["default"],
      bmpLetterAndMarks: _bmpLetterAndMarks["default"],
      bmpNumerals: _bmpNumerals["default"],
      cashtag: _cashtag["default"],
      codePoint: _codePoint["default"],
      cyrillicLettersAndMarks: _cyrillicLettersAndMarks["default"],
      endHashtagMatch: _endHashtagMatch["default"],
      endMentionMatch: _endMentionMatch["default"],
      extractUrl: _extractUrl["default"],
      hashSigns: _hashSigns["default"],
      hashtagAlpha: _hashtagAlpha["default"],
      hashtagAlphaNumeric: _hashtagAlphaNumeric["default"],
      hashtagBoundary: _hashtagBoundary["default"],
      hashtagSpecialChars: _hashtagSpecialChars["default"],
      invalidChars: _invalidChars["default"],
      invalidCharsGroup: _invalidCharsGroup["default"],
      invalidDomainChars: _invalidDomainChars["default"],
      invalidUrlWithoutProtocolPrecedingChars: _invalidUrlWithoutProtocolPrecedingChars["default"],
      latinAccentChars: _latinAccentChars["default"],
      nonBmpCodePairs: _nonBmpCodePairs["default"],
      punct: _punct["default"],
      rtlChars: _rtlChars["default"],
      spaces: _spaces["default"],
      spacesGroup: _spacesGroup["default"],
      urlHasHttps: _urlHasHttps["default"],
      urlHasProtocol: _urlHasProtocol["default"],
      validAsciiDomain: _validAsciiDomain["default"],
      validateUrlAuthority: _validateUrlAuthority["default"],
      validateUrlDecOctet: _validateUrlDecOctet["default"],
      validateUrlDomain: _validateUrlDomain["default"],
      validateUrlDomainSegment: _validateUrlDomainSegment["default"],
      validateUrlDomainTld: _validateUrlDomainTld["default"],
      validateUrlFragment: _validateUrlFragment["default"],
      validateUrlHost: _validateUrlHost["default"],
      validateUrlIp: _validateUrlIp["default"],
      validateUrlIpv4: _validateUrlIpv["default"],
      validateUrlIpv6: _validateUrlIpv2["default"],
      validateUrlPath: _validateUrlPath["default"],
      validateUrlPchar: _validateUrlPchar["default"],
      validateUrlPctEncoded: _validateUrlPctEncoded["default"],
      validateUrlPort: _validateUrlPort["default"],
      validateUrlQuery: _validateUrlQuery["default"],
      validateUrlScheme: _validateUrlScheme["default"],
      validateUrlSubDelims: _validateUrlSubDelims["default"],
      validateUrlSubDomainSegment: _validateUrlSubDomainSegment["default"],
      validateUrlUnencoded: _validateUrlUnencoded["default"],
      validateUrlUnicodeAuthority: _validateUrlUnicodeAuthority["default"],
      validateUrlUnicodeDomain: _validateUrlUnicodeDomain["default"],
      validateUrlUnicodeDomainSegment: _validateUrlUnicodeDomainSegment["default"],
      validateUrlUnicodeDomainTld: _validateUrlUnicodeDomainTld["default"],
      validateUrlUnicodeHost: _validateUrlUnicodeHost["default"],
      validateUrlUnicodeSubDomainSegment: _validateUrlUnicodeSubDomainSegment["default"],
      validateUrlUnreserved: _validateUrlUnreserved["default"],
      validateUrlUserinfo: _validateUrlUserinfo["default"],
      validCashtag: _validCashtag["default"],
      validCCTLD: _validCCTLD["default"],
      validDomain: _validDomain["default"],
      validDomainChars: _validDomainChars["default"],
      validDomainName: _validDomainName["default"],
      validGeneralUrlPathChars: _validGeneralUrlPathChars["default"],
      validGTLD: _validGTLD["default"],
      validHashtag: _validHashtag["default"],
      validMentionOrList: _validMentionOrList["default"],
      validMentionPrecedingChars: _validMentionPrecedingChars["default"],
      validPortNumber: _validPortNumber["default"],
      validPunycode: _validPunycode["default"],
      validReply: _validReply["default"],
      validSubdomain: _validSubdomain["default"],
      validTcoUrl: _validTcoUrl["default"],
      validUrlBalancedParens: _validUrlBalancedParens["default"],
      validUrlPath: _validUrlPath["default"],
      validUrlPathEndingChars: _validUrlPathEndingChars["default"],
      validUrlPrecedingChars: _validUrlPrecedingChars["default"],
      validUrlQueryChars: _validUrlQueryChars["default"],
      validUrlQueryEndingChars: _validUrlQueryEndingChars["default"]
    };
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.string.iterator.js
var require_es6_string_iterator = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.string.iterator.js"() {
    "use strict";
    var $at = require_string_at()(true);
    require_iter_define()(String, "String", function(iterated) {
      this._t = String(iterated);
      this._i = 0;
    }, function() {
      var O = this._t;
      var index = this._i;
      var point;
      if (index >= O.length) return { value: void 0, done: true };
      point = $at(O, index);
      this._i += point.length;
      return { value: point, done: false };
    });
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-call.js
var require_iter_call = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-call.js"(exports, module) {
    var anObject = require_an_object();
    module.exports = function(iterator, fn, value, entries) {
      try {
        return entries ? fn(anObject(value)[0], value[1]) : fn(value);
      } catch (e) {
        var ret = iterator["return"];
        if (ret !== void 0) anObject(ret.call(iterator));
        throw e;
      }
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-array-iter.js
var require_is_array_iter = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_is-array-iter.js"(exports, module) {
    var Iterators = require_iterators();
    var ITERATOR = require_wks()("iterator");
    var ArrayProto = Array.prototype;
    module.exports = function(it) {
      return it !== void 0 && (Iterators.Array === it || ArrayProto[ITERATOR] === it);
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/core.get-iterator-method.js
var require_core_get_iterator_method = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/core.get-iterator-method.js"(exports, module) {
    var classof = require_classof();
    var ITERATOR = require_wks()("iterator");
    var Iterators = require_iterators();
    module.exports = require_core().getIteratorMethod = function(it) {
      if (it != void 0) return it[ITERATOR] || it["@@iterator"] || Iterators[classof(it)];
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-detect.js
var require_iter_detect = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/_iter-detect.js"(exports, module) {
    var ITERATOR = require_wks()("iterator");
    var SAFE_CLOSING = false;
    try {
      riter = [7][ITERATOR]();
      riter["return"] = function() {
        SAFE_CLOSING = true;
      };
      Array.from(riter, function() {
        throw 2;
      });
    } catch (e) {
    }
    var riter;
    module.exports = function(exec, skipClosing) {
      if (!skipClosing && !SAFE_CLOSING) return false;
      var safe = false;
      try {
        var arr = [7];
        var iter = arr[ITERATOR]();
        iter.next = function() {
          return { done: safe = true };
        };
        arr[ITERATOR] = function() {
          return iter;
        };
        exec(arr);
      } catch (e) {
      }
      return safe;
    };
  }
});

// node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.from.js
var require_es6_array_from = __commonJS({
  "node_modules/.pnpm/core-js@2.6.12/node_modules/core-js/modules/es6.array.from.js"() {
    "use strict";
    var ctx = require_ctx();
    var $export = require_export();
    var toObject = require_to_object();
    var call = require_iter_call();
    var isArrayIter = require_is_array_iter();
    var toLength = require_to_length();
    var createProperty = require_create_property();
    var getIterFn = require_core_get_iterator_method();
    $export($export.S + $export.F * !require_iter_detect()(function(iter) {
      Array.from(iter);
    }), "Array", {
      // 22.1.2.1 Array.from(arrayLike, mapfn = undefined, thisArg = undefined)
      from: function from(arrayLike) {
        var O = toObject(arrayLike);
        var C = typeof this == "function" ? this : Array;
        var aLen = arguments.length;
        var mapfn = aLen > 1 ? arguments[1] : void 0;
        var mapping = mapfn !== void 0;
        var index = 0;
        var iterFn = getIterFn(O);
        var length, result, step, iterator;
        if (mapping) mapfn = ctx(mapfn, aLen > 2 ? arguments[2] : void 0, 2);
        if (iterFn != void 0 && !(C == Array && isArrayIter(iterFn))) {
          for (iterator = iterFn.call(O), result = new C(); !(step = iterator.next()).done; index++) {
            createProperty(result, index, mapping ? call(iterator, mapfn, [step.value, index], true) : step.value);
          }
        } else {
          length = toLength(O.length);
          for (result = new C(length); length > index; index++) {
            createProperty(result, index, mapping ? mapfn(O[index], index) : O[index]);
          }
        }
        result.length = index;
        return result;
      }
    });
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/standardizeIndices.js
var require_standardizeIndices = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/standardizeIndices.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = standardizeIndices;
    require_es6_string_iterator();
    require_es6_array_from();
    var _getUnicodeTextLength = _interopRequireDefault(require_getUnicodeTextLength());
    function standardizeIndices(text, startIndex, endIndex) {
      var totalUnicodeTextLength = (0, _getUnicodeTextLength["default"])(text);
      var encodingDiff = text.length - totalUnicodeTextLength;
      if (encodingDiff > 0) {
        var byCodePair = Array.from(text);
        var beforeText = startIndex === 0 ? "" : byCodePair.slice(0, startIndex).join("");
        var actualText = byCodePair.slice(startIndex, endIndex).join("");
        return [beforeText.length, beforeText.length + actualText.length];
      }
      return [startIndex, endIndex];
    }
    module.exports = exports.default;
  }
});

// node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/.pnpm/twitter-text@3.1.0/node_modules/twitter-text/dist/index.js"(exports, module) {
    "use strict";
    var _interopRequireDefault = require_interopRequireDefault();
    require_es6_object_define_property();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports["default"] = void 0;
    var _autoLink = _interopRequireDefault(require_autoLink());
    var _autoLinkCashtags = _interopRequireDefault(require_autoLinkCashtags());
    var _autoLinkEntities = _interopRequireDefault(require_autoLinkEntities());
    var _autoLinkHashtags = _interopRequireDefault(require_autoLinkHashtags());
    var _autoLinkUrlsCustom = _interopRequireDefault(require_autoLinkUrlsCustom());
    var _autoLinkUsernamesOrLists = _interopRequireDefault(require_autoLinkUsernamesOrLists());
    var _autoLinkWithJSON = _interopRequireDefault(require_autoLinkWithJSON());
    var _configs = _interopRequireDefault(require_configs());
    var _convertUnicodeIndices = _interopRequireDefault(require_convertUnicodeIndices2());
    var _extractCashtags = _interopRequireDefault(require_extractCashtags());
    var _extractCashtagsWithIndices = _interopRequireDefault(require_extractCashtagsWithIndices());
    var _extractEntitiesWithIndices = _interopRequireDefault(require_extractEntitiesWithIndices());
    var _extractHashtags = _interopRequireDefault(require_extractHashtags());
    var _extractHashtagsWithIndices = _interopRequireDefault(require_extractHashtagsWithIndices());
    var _extractHtmlAttrsFromOptions = _interopRequireDefault(require_extractHtmlAttrsFromOptions());
    var _extractMentions = _interopRequireDefault(require_extractMentions());
    var _extractMentionsOrListsWithIndices = _interopRequireDefault(require_extractMentionsOrListsWithIndices());
    var _extractMentionsWithIndices = _interopRequireDefault(require_extractMentionsWithIndices());
    var _extractReplies = _interopRequireDefault(require_extractReplies());
    var _extractUrls = _interopRequireDefault(require_extractUrls());
    var _extractUrlsWithIndices = _interopRequireDefault(require_extractUrlsWithIndices());
    var _getTweetLength = _interopRequireDefault(require_getTweetLength());
    var _getUnicodeTextLength = _interopRequireDefault(require_getUnicodeTextLength());
    var _hasInvalidCharacters = _interopRequireDefault(require_hasInvalidCharacters());
    var _hitHighlight = _interopRequireDefault(require_hitHighlight());
    var _htmlEscape = _interopRequireDefault(require_htmlEscape());
    var _isInvalidTweet = _interopRequireDefault(require_isInvalidTweet());
    var _isValidHashtag = _interopRequireDefault(require_isValidHashtag());
    var _isValidList = _interopRequireDefault(require_isValidList());
    var _isValidTweetText = _interopRequireDefault(require_isValidTweetText());
    var _isValidUrl = _interopRequireDefault(require_isValidUrl());
    var _isValidUsername = _interopRequireDefault(require_isValidUsername());
    var _linkTextWithEntity = _interopRequireDefault(require_linkTextWithEntity());
    var _linkToCashtag = _interopRequireDefault(require_linkToCashtag());
    var _linkToHashtag = _interopRequireDefault(require_linkToHashtag());
    var _linkToMentionAndList = _interopRequireDefault(require_linkToMentionAndList());
    var _linkToText = _interopRequireDefault(require_linkToText());
    var _linkToTextWithSymbol = _interopRequireDefault(require_linkToTextWithSymbol());
    var _linkToUrl = _interopRequireDefault(require_linkToUrl());
    var _modifyIndicesFromUTF16ToUnicode = _interopRequireDefault(require_modifyIndicesFromUTF16ToUnicode());
    var _modifyIndicesFromUnicodeToUTF = _interopRequireDefault(require_modifyIndicesFromUnicodeToUTF16());
    var _index = _interopRequireDefault(require_regexp());
    var _removeOverlappingEntities = _interopRequireDefault(require_removeOverlappingEntities());
    var _parseTweet = _interopRequireDefault(require_parseTweet());
    var _splitTags = _interopRequireDefault(require_splitTags());
    var _standardizeIndices = _interopRequireDefault(require_standardizeIndices());
    var _tagAttrs = _interopRequireDefault(require_tagAttrs());
    var _default = {
      autoLink: _autoLink["default"],
      autoLinkCashtags: _autoLinkCashtags["default"],
      autoLinkEntities: _autoLinkEntities["default"],
      autoLinkHashtags: _autoLinkHashtags["default"],
      autoLinkUrlsCustom: _autoLinkUrlsCustom["default"],
      autoLinkUsernamesOrLists: _autoLinkUsernamesOrLists["default"],
      autoLinkWithJSON: _autoLinkWithJSON["default"],
      configs: _configs["default"],
      convertUnicodeIndices: _convertUnicodeIndices["default"],
      extractCashtags: _extractCashtags["default"],
      extractCashtagsWithIndices: _extractCashtagsWithIndices["default"],
      extractEntitiesWithIndices: _extractEntitiesWithIndices["default"],
      extractHashtags: _extractHashtags["default"],
      extractHashtagsWithIndices: _extractHashtagsWithIndices["default"],
      extractHtmlAttrsFromOptions: _extractHtmlAttrsFromOptions["default"],
      extractMentions: _extractMentions["default"],
      extractMentionsOrListsWithIndices: _extractMentionsOrListsWithIndices["default"],
      extractMentionsWithIndices: _extractMentionsWithIndices["default"],
      extractReplies: _extractReplies["default"],
      extractUrls: _extractUrls["default"],
      extractUrlsWithIndices: _extractUrlsWithIndices["default"],
      getTweetLength: _getTweetLength["default"],
      getUnicodeTextLength: _getUnicodeTextLength["default"],
      hasInvalidCharacters: _hasInvalidCharacters["default"],
      hitHighlight: _hitHighlight["default"],
      htmlEscape: _htmlEscape["default"],
      isInvalidTweet: _isInvalidTweet["default"],
      isValidHashtag: _isValidHashtag["default"],
      isValidList: _isValidList["default"],
      isValidTweetText: _isValidTweetText["default"],
      isValidUrl: _isValidUrl["default"],
      isValidUsername: _isValidUsername["default"],
      linkTextWithEntity: _linkTextWithEntity["default"],
      linkToCashtag: _linkToCashtag["default"],
      linkToHashtag: _linkToHashtag["default"],
      linkToMentionAndList: _linkToMentionAndList["default"],
      linkToText: _linkToText["default"],
      linkToTextWithSymbol: _linkToTextWithSymbol["default"],
      linkToUrl: _linkToUrl["default"],
      modifyIndicesFromUTF16ToUnicode: _modifyIndicesFromUTF16ToUnicode["default"],
      modifyIndicesFromUnicodeToUTF16: _modifyIndicesFromUnicodeToUTF["default"],
      regexen: _index["default"],
      removeOverlappingEntities: _removeOverlappingEntities["default"],
      parseTweet: _parseTweet["default"],
      splitTags: _splitTags["default"],
      standardizeIndices: _standardizeIndices["default"],
      tagAttrs: _tagAttrs["default"]
    };
    exports["default"] = _default;
    module.exports = exports.default;
  }
});

// scripts/tweet-thread-validator-cli.ts
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync
} from "node:fs";

// node_modules/.pnpm/canonicalize@3.0.0/node_modules/canonicalize/lib/canonicalize.js
function canonicalize(object, seen = /* @__PURE__ */ new Set()) {
  if (typeof object === "number" && isNaN(object)) {
    throw new Error("NaN is not allowed");
  }
  if (typeof object === "number" && !isFinite(object)) {
    throw new Error("Infinity is not allowed");
  }
  if (object === null || typeof object !== "object") {
    return JSON.stringify(object);
  }
  if (typeof object.toJSON === "function") {
    if (seen.has(object)) {
      throw new Error("Circular reference detected");
    }
    seen.add(object);
    const result2 = canonicalize(object.toJSON(), seen);
    seen.delete(object);
    return result2;
  }
  if (seen.has(object)) {
    throw new Error("Circular reference detected");
  }
  seen.add(object);
  let result;
  if (Array.isArray(object)) {
    const values = object.map((cv) => {
      const value = cv === void 0 || typeof cv === "symbol" ? null : cv;
      return canonicalize(value, seen);
    });
    result = `[${values.join(",")}]`;
  } else {
    const parts = [];
    for (const key of Object.keys(object).sort()) {
      if (object[key] === void 0 || typeof object[key] === "symbol") {
        continue;
      }
      parts.push(`${canonicalize(key)}:${canonicalize(object[key], seen)}`);
    }
    result = `{${parts.join(",")}}`;
  }
  seen.delete(object);
  return result;
}

// src/lib/tweet-thread-protocol.ts
import { createHash as createHash2 } from "node:crypto";

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return { ...left, ...right };
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  Counted: () => Counted,
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Some: () => Some,
  SomeAll: () => SomeAll,
  Symbols: () => Symbols,
  Values: () => Values
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/string.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsHighSurrogate(value) {
  return IsBetween(value, 55296, 56319);
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && value[clusterEnd] === "‍") {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function IsGraphemeCodePoint(value) {
  return IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value);
}
function GraphemeCount(value) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
  }
  return count;
}
function IsMinLength(value, minLength) {
  if (minLength === 0)
    return true;
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count >= minLength)
      return true;
  }
  return false;
}
function IsMaxLength(value, maxLength) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count > maxLength)
      return false;
  }
  return true;
}
function IsMinLengthFast(value, minLength) {
  if (minLength === 0)
    return true;
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMinLength(value, minLength);
    }
    index++;
    if (index >= minLength)
      return true;
  }
  return false;
}
function IsMaxLengthFast(value, maxLength) {
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMaxLength(value, maxLength);
    }
    index++;
    if (index > maxLength)
      return false;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function IsMaxLength2(value, length) {
  return IsMaxLengthFast(value, length);
}
function IsMinLength2(value, length) {
  return IsMinLengthFast(value, length);
}
function Every(value, offset, callback) {
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      return false;
  }
  return true;
}
function EveryAll(value, offset, callback) {
  let result = true;
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      result = false;
  }
  return result;
}
function Some(value, callback) {
  for (let index = 0; index < value.length; index++) {
    if (callback(value[index], index))
      return true;
  }
  return false;
}
function SomeAll(value, callback) {
  let result = false;
  for (let index = 0; index < value.length; index++) {
    if (callback(value[index], index))
      result = true;
  }
  return result;
}
function Counted(value, callback) {
  return value.reduce((result, value2, index) => callback(value2, index) ? ++result : result, 0);
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/index.mjs
var guard_default = guard_exports;

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsTypeObject(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromTypeObject(value) {
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor = descriptors[key];
    if (guard_exports.HasPropertyKey(descriptor, "value")) {
      Object.defineProperty(result, key, { ...descriptor, value: FromValue(descriptor.value) });
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue(value[key]);
  }
  return result;
}
function FromObject(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsTypeObject(value) ? FromTypeObject(value) : FromPlainObject(value);
}
function FromArray(value) {
  return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsObject(value) ? FromObject(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get,
  Reset: () => Reset,
  Set: () => Set2
});
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Reset() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set2(options) {
  for (const key of guard_exports.Keys(options)) {
    const value = options[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get() {
  return settings;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const settings2 = settings_exports.Get();
  const withOptions = Merge(enumerable, options);
  const withHidden = settings2.enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return settings2.immutableTypes ? Object.freeze(withHidden) : withHidden;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(Clone(value));
  const keysToDiscard = new Set(propertyKeys);
  for (const key of Object.keys(descriptors)) {
    if (keysToDiscard.has(key))
      continue;
    Object.defineProperty(result, key, descriptors[key]);
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema(value) {
  return guard_exports.IsObject(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options);
  return result;
}
function AddReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddReadonlyAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options);
  return result;
}
function AddOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddOptionalAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/array.mjs
function _Array_(items, options) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items }, options);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/ref.mjs
function Ref(ref, options) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
}
function IsRef(value) {
  return IsKind(value, "Ref");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/any.mjs
function Any(options) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
}
function IsAny(value) {
  return IsKind(value, "Any");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/never.mjs
var NeverPattern = "(?!)";
function Never(options) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
}
function IsNever(value) {
  return IsKind(value, "Never");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptionalDeferred(type, options = {}) {
  return Deferred("AddOptional", [type], options);
}
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~optional");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/unsafe.mjs
function Unsafe(schema) {
  return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
}
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/infer.mjs
function Infer(...args) {
  const [name, extends_] = arguments_exports.Match(args, {
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
}
function IsInfer(value) {
  return IsKind(value, "Infer");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs
function IsTypeScriptEnumLike(value) {
  return guard_exports.IsObjectNotArray(value);
}
function TypeScriptEnumToEnumValues(type) {
  const keys = guard_exports.Keys(type).filter((key) => isNaN(key));
  return keys.reduce((result, key) => [...result, type[key]], []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/enum.mjs
function IsEnumValue(value) {
  return guard_exports.IsString(value) || guard_exports.IsNumber(value);
}
function Enum(value, options) {
  const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
  return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options);
}
function IsEnum(value) {
  return IsKind(value, "Enum");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types, options = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types }, options);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/hashing/hash.mjs
var hash_exports = {};
__export(hash_exports, {
  Hash: () => Hash,
  HashCode: () => HashCode
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/hashing/hash.mjs
function InstanceKeys(value) {
  const propertyKeys = /* @__PURE__ */ new Set();
  let current = value;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key !== "constructor" && typeof key !== "symbol")
        propertyKeys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return [...propertyKeys];
}
function IsIEEE754(value) {
  return typeof value === "number";
}
var ByteMarker;
(function(ByteMarker2) {
  ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
  ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
  ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
  ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
  ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
  ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
  ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
  ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
  ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
  ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
  ByteMarker2[ByteMarker2["String"] = 10] = "String";
  ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
  ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
  ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
function FNV1A64_OP(byte) {
  Accumulator = Accumulator ^ Bytes[byte];
  Accumulator = Accumulator * Prime % Size;
}
function FromArray2(value) {
  FNV1A64_OP(ByteMarker.Array);
  for (const item of value) {
    FromValue2(item);
  }
}
function FromBigInt(value) {
  FNV1A64_OP(ByteMarker.BigInt);
  F64In.setBigInt64(0, value);
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromBoolean(value) {
  FNV1A64_OP(ByteMarker.Boolean);
  FNV1A64_OP(value ? 1 : 0);
}
function FromConstructor(value) {
  FNV1A64_OP(ByteMarker.Constructor);
  FromValue2(value.toString());
}
function FromDate(value) {
  FNV1A64_OP(ByteMarker.Date);
  FromValue2(value.getTime());
}
function FromFunction(value) {
  FNV1A64_OP(ByteMarker.Function);
  FromValue2(value.toString());
}
function FromNull(_value) {
  FNV1A64_OP(ByteMarker.Null);
}
function FromNumber(value) {
  FNV1A64_OP(ByteMarker.Number);
  F64In.setFloat64(
    0,
    value,
    true
    /* little-endian */
  );
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromObject2(value) {
  FNV1A64_OP(ByteMarker.Object);
  for (const key of InstanceKeys(value).sort()) {
    FromValue2(key);
    FromValue2(value[key]);
  }
}
function FromRegExp2(value) {
  FNV1A64_OP(ByteMarker.RegExp);
  FromString(value.toString());
}
var encoder = new TextEncoder();
function FromString(value) {
  FNV1A64_OP(ByteMarker.String);
  for (const byte of encoder.encode(value)) {
    FNV1A64_OP(byte);
  }
}
function FromSymbol(value) {
  FNV1A64_OP(ByteMarker.Symbol);
  FromValue2(value.toString());
}
function FromTypeArray(value) {
  FNV1A64_OP(ByteMarker.TypeArray);
  const buffer = new Uint8Array(value.buffer);
  for (let i = 0; i < buffer.length; i++) {
    FNV1A64_OP(buffer[i]);
  }
}
function FromUndefined(_value) {
  return FNV1A64_OP(ByteMarker.Undefined);
}
function FromValue2(value) {
  return globals_exports.IsTypeArray(value) ? FromTypeArray(value) : globals_exports.IsDate(value) ? FromDate(value) : globals_exports.IsRegExp(value) ? FromRegExp2(value) : globals_exports.IsBoolean(value) ? FromBoolean(value.valueOf()) : globals_exports.IsString(value) ? FromString(value.valueOf()) : globals_exports.IsNumber(value) ? FromNumber(value.valueOf()) : IsIEEE754(value) ? FromNumber(value) : guard_exports.IsArray(value) ? FromArray2(value) : guard_exports.IsBoolean(value) ? FromBoolean(value) : guard_exports.IsBigInt(value) ? FromBigInt(value) : guard_exports.IsConstructor(value) ? FromConstructor(value) : guard_exports.IsNull(value) ? FromNull(value) : guard_exports.IsObject(value) ? FromObject2(value) : guard_exports.IsString(value) ? FromString(value) : guard_exports.IsSymbol(value) ? FromSymbol(value) : guard_exports.IsUndefined(value) ? FromUndefined(value) : guard_exports.IsFunction(value) ? FromFunction(value) : Unreachable();
}
function HashCode(value) {
  Accumulator = BigInt("14695981039346656037");
  FromValue2(value);
  return Accumulator;
}
function Hash(value) {
  return HashCode(value).toString(16).padStart(16, "0");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/locale/en_US.mjs
function en_US(error) {
  switch (error.keyword) {
    case "additionalProperties":
      return "must not have additional properties";
    case "anyOf":
      return "must match a schema in anyOf";
    case "boolean":
      return "schema is false";
    case "const":
      return "must be equal to constant";
    case "contains":
      return "must contain at least 1 valid item";
    case "dependencies":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "dependentRequired":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "enum":
      return "must be equal to one of the allowed values";
    case "exclusiveMaximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "exclusiveMinimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "format":
      return `must match format "${error.params.format}"`;
    case "if":
      return `must match "${error.params.failingKeyword}" schema`;
    case "maxItems":
      return `must not have more than ${error.params.limit} items`;
    case "maxLength":
      return `must not have more than ${error.params.limit} characters`;
    case "maxProperties":
      return `must not have more than ${error.params.limit} properties`;
    case "maximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "minItems":
      return `must not have fewer than ${error.params.limit} items`;
    case "minLength":
      return `must not have fewer than ${error.params.limit} characters`;
    case "minProperties":
      return `must not have fewer than ${error.params.limit} properties`;
    case "minimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "multipleOf":
      return `must be multiple of ${error.params.multipleOf}`;
    case "not":
      return "must not be valid";
    case "oneOf":
      return "must match exactly one schema in oneOf";
    case "pattern":
      return `must match pattern "${error.params.pattern}"`;
    case "propertyNames":
      return `property names ${error.params.propertyNames.join(", ")} are invalid`;
    case "required":
      return `must have required properties ${error.params.requiredProperties.join(", ")}`;
    case "type":
      return typeof error.params.type === "string" ? `must be ${error.params.type}` : `must be either ${error.params.type.join(" or ")}`;
    case "unevaluatedItems":
      return "must not have unevaluated items";
    case "unevaluatedProperties":
      return "must not have unevaluated properties";
    case "uniqueItems":
      return `must not have duplicate items`;
    case "~refine":
      return error.params.message;
    // deno-coverage-ignore - unreachable
    default:
      return "an unknown validation error occurred";
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/locale/_config.mjs
var locale = en_US;
function Get2() {
  return locale;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_codec.mjs
var EncodeBuilder = class {
  constructor(type, decode) {
    this.type = type;
    this.decode = decode;
  }
  Encode(callback) {
    const type = this.type;
    const decode = IsCodec(type) ? (value) => this.decode(type["~codec"].decode(value)) : this.decode;
    const encode = IsCodec(type) ? (value) => type["~codec"].encode(callback(value)) : callback;
    const codec = { decode, encode };
    return memory_exports.Update(this.type, { "~codec": codec }, {});
  }
};
var DecodeBuilder = class {
  constructor(type) {
    this.type = type;
  }
  Decode(callback) {
    return new EncodeBuilder(this.type, callback);
  }
};
function Codec(type) {
  return new DecodeBuilder(type);
}
function Decode(type, callback) {
  return Codec(type).Decode(callback).Encode(() => {
    throw Error("Encode not implemented");
  });
}
function Encode(type, callback) {
  return Codec(type).Decode(() => {
    throw Error("Decode not implemented");
  }).Encode(callback);
}
function IsCodec(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_immutable.mjs
function Immutable(type) {
  return AddImmutable(type);
}
function IsImmutable(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~immutable");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonlyDeferred(type, options = {}) {
  return Deferred("AddReadonly", [type], options);
}
function AddReadonly(type, options = {}) {
  return AddReadonlyAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_readonly.mjs
function Readonly(type) {
  return AddReadonly(type);
}
function IsReadonly(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~readonly");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_refine.mjs
function RefineAdd(type, refinement) {
  const refinements = IsRefine(type) ? [...type["~refine"], refinement] : [refinement];
  return memory_exports.Update(type, { "~refine": refinements }, {});
}
function Refine(...args) {
  const [type, check, error] = arguments_exports.Match(args, {
    3: (type2, check2, error2) => [type2, check2, error2],
    2: (type2, check2) => [type2, check2, () => "Refine Error"]
  });
  return RefineAdd(type, { check, error });
}
function IsRefinement(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
}
function IsRefine(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/bigint.mjs
var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
function BigInt2(options) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/boolean.mjs
function Boolean2(options) {
  return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
}
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/identifier.mjs
function Identifier(name) {
  return memory_exports.Create({ "~kind": "Identifier" }, { name });
}
function IsIdentifier(value) {
  return IsKind(value, "Identifier");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
function Integer(options) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/literal.mjs
var InvalidLiteralValue = class extends Error {
  constructor(value) {
    super(`Invalid Literal value`);
    Object.defineProperty(this, "cause", {
      value: { value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralBigInt(value) {
  return IsLiteral(value) && guard_exports.IsBigInt(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral(value) && guard_exports.IsBoolean(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/null.mjs
function Null(options) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
function Number2(options) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/parameter.mjs
function Parameter(...args) {
  const [name, extends_, equals] = arguments_exports.Match(args, {
    3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
}
function IsParameter(value) {
  return IsKind(value, "Parameter");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
}
function IsString3(value) {
  return IsKind(value, "String");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types) {
  const result = guard_exports.IsEqual(types.length, 0) ? false : FromTypesReduce(types);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types) {
  const result = FromTypes(types);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types) {
  return guard_exports.ShiftLeft(types, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant) => Literal(variant));
}
function DecodeTypesAsUnion(types) {
  const variants = DecodeFromSpan([], types);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types) {
  return guard_exports.IsEqual(types.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types.length, 1) && IsLiteral(types[0]) ? types[0] : DecodeTypesAsUnion(types)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types.length, 0) ? String2() : IsTemplateLiteralFinite(types) ? DecodeTypes(types) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types, options = {}) {
  const [items, minItems, additionalItems] = [types, types.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items, minItems }, options);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options);
  return result;
}
function RemoveReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveReadonlyAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonlyDeferred(type, options = {}) {
  return Deferred("RemoveReadonly", [type], options);
}
function RemoveReadonly(type, options = {}) {
  return RemoveReadonlyAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options);
  return result;
}
function RemoveOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveOptionalAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptionalDeferred(type, options = {}) {
  return Deferred("RemoveOptional", [type], options);
}
function RemoveOptional(type, options = {}) {
  return RemoveOptionalAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types) {
  const result = types.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/composite.mjs
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(right), ...guard_exports.Keys(left)]);
  return [...keys].reduce((result, key) => {
    return { ...result, [key]: CompositePropertyKey(left, right, key) };
  }, {});
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : Unreachable();
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  return _Object_(properties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function Narrow(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, ResultLeftInside) ? left : guard_exports.IsEqual(result, ResultRightInside) ? right : guard_exports.IsEqual(result, ResultEqual) ? right : Never();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function IsObjectLike(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsUnionOperand(left, right) {
  const isUnionLeft = IsUnion(left);
  const isUnionRight = IsUnion(right);
  const result = isUnionLeft || isUnionRight;
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const isUnionOperand = IsUnionOperand(evaluatedLeft, evaluatedRight);
  const isObjectLeft = IsObjectLike(evaluatedLeft);
  const IsObjectRight = IsObjectLike(evaluatedRight);
  const result = isUnionOperand ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : isObjectLeft && IsObjectRight ? Composite(evaluatedLeft, evaluatedRight) : isObjectLeft && !IsObjectRight ? evaluatedLeft : !isObjectLeft && IsObjectRight ? evaluatedRight : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeType(type, right, [...result, DistributeOperation(type, left)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types, distribution, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExcludeType(head, right)];
  }, []);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersect = Intersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersect, excluded]);
  return result;
}
function EvaluateEnum(values) {
  const result = values.map((value) => Literal(value));
  return EvaluateUnion(result);
}
function EvaluateIntersect(types) {
  const distribution = Distribute(types);
  const broadend = Broaden(distribution);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types) {
  const broadend = Broaden(types);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  return IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
}
function EvaluateUnionFast(types) {
  const result = guard_exports.IsEqual(types.length, 1) ? types[0] : guard_exports.IsEqual(types.length, 0) ? Never() : Union(types);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types, value) {
  const evaluatedKey = EvaluateIntersect(types);
  const result = FromKey(evaluatedKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types) {
  return types.reduce((result, type) => {
    return [...result, ...FlattenType(type)];
  }, []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types) {
  return types.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types, value) {
  return types.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types, value) {
  const properties = CreateProperties(types, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types, value) {
  const flattened = Flatten(types);
  const record = TryBuildRecord(flattened, value);
  return IsSchema(record) ? record : CreateObject(flattened, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
  return result;
}
function RecordInstantiate(context, state, key, value, options) {
  const instantiatedKey = InstantiateType(context, state, key);
  const instantiatedValue = InstantiateType(context, state, value);
  return RecordAction(instantiatedKey, instantiatedValue, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
function RecordDeferred(key, value, options = {}) {
  return Deferred("Record", [key, value], options);
}
function Record(key, value, options = {}) {
  return RecordAction(key, value, options);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/this.mjs
function This(options) {
  return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options);
}
function IsThis(value) {
  return IsKind(value, "This");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/void.mjs
function Void(options) {
  return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options);
}
function IsVoid(value) {
  return IsKind(value, "Void");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/mapping.mjs
function IntrinsicOrCall(ref, parameters) {
  return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref(ref), parameters);
}
function Unreachable2() {
  throw Error("Unreachable");
}
var DelimitedDecode = (input, result = []) => {
  return input.reduce((result2, left) => {
    return guard_exports.IsArray(left) && guard_exports.IsEqual(left.length, 2) ? [...result2, left[0]] : [...result2, left];
  }, []);
};
var Delimited = (input) => {
  const [left, right] = input;
  return DelimitedDecode([...left, ...right]);
};
function GenericParameterExtendsEqualsMapping(input) {
  return Parameter(input[0], input[2], input[4]);
}
function GenericParameterExtendsMapping(input) {
  return Parameter(input[0], input[2], input[2]);
}
function GenericParameterEqualsMapping(input) {
  return Parameter(input[0], Unknown(), input[2]);
}
function GenericParameterIdentifierMapping(input) {
  return Parameter(input, Unknown(), Unknown());
}
function GenericParameterMapping(input) {
  return input;
}
function GenericParameterListMapping(input) {
  return Delimited(input);
}
function GenericParametersMapping(input) {
  return input[1];
}
function GenericCallArgumentListMapping(input) {
  return Delimited(input);
}
function GenericCallArgumentsMapping(input) {
  return input[1];
}
function GenericCallMapping(input) {
  return IntrinsicOrCall(input[0], input[1]);
}
function OptionalSemiColonMapping(input) {
  return null;
}
function KeywordStringMapping(input) {
  return String2();
}
function KeywordNumberMapping(input) {
  return Number2();
}
function KeywordBooleanMapping(input) {
  return Boolean2();
}
function KeywordUndefinedMapping(input) {
  return Undefined();
}
function KeywordNullMapping(input) {
  return Null();
}
function KeywordIntegerMapping(input) {
  return Integer();
}
function KeywordBigIntMapping(input) {
  return BigInt2();
}
function KeywordUnknownMapping(input) {
  return Unknown();
}
function KeywordAnyMapping(input) {
  return Any();
}
function KeywordObjectMapping(input) {
  return _Object_({});
}
function KeywordNeverMapping(input) {
  return Never();
}
function KeywordSymbolMapping(input) {
  return Symbol2();
}
function KeywordVoidMapping(input) {
  return Void();
}
function KeywordThisMapping(input) {
  return This();
}
function LiteralBigIntMapping(input) {
  return Literal(BigInt(input));
}
function LiteralBooleanMapping(input) {
  return Literal(guard_exports.IsEqual(input, "true"));
}
function LiteralNumberMapping(input) {
  return Literal(parseFloat(input));
}
function LiteralStringMapping(input) {
  return Literal(input);
}
function TemplateInterpolateMapping(input) {
  return input[1];
}
function TemplateSpanMapping(input) {
  return Literal(input);
}
function TemplateBodyMapping(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
}
function TemplateLiteralTypesMapping(input) {
  return input[1];
}
function TemplateLiteralMapping(input) {
  return TemplateLiteralDeferred(input);
}
function DependentMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
}
function KeyOfMapping(input) {
  return input.length > 0;
}
function IndexArrayMapping(input) {
  return input.reduce((result, current) => {
    return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
  }, []);
}
function ExtendsMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
}
function BaseMapping(input) {
  return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
}
function WithMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function FactorIndexArray(Type2, indexArray) {
  return indexArray.reduce((result, left) => {
    const _left = left;
    return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
  }, Type2);
}
function FactorExtends(type, extend) {
  return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type, extend[0], extend[1], extend[2]) : type;
}
function FactorWith(type, withClause) {
  return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type : WithDeferred(type, withClause);
}
function FactorMapping(input) {
  const [keyOf, type, indexArray, extend, withClause] = input;
  return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type, indexArray)), extend) : FactorExtends(FactorIndexArray(type, indexArray), extend), withClause);
}
function ExprBinaryMapping(left, rest) {
  return guard_exports.IsEqual(rest.length, 3) ? (() => {
    const [operator, right, next] = rest;
    const Schema = ExprBinaryMapping(right, next);
    if (guard_exports.IsEqual(operator, "&")) {
      return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
    }
    if (guard_exports.IsEqual(operator, "|")) {
      return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
    }
    Unreachable2();
  })() : left;
}
function ExprTermTailMapping(input) {
  return input;
}
function ExprTermMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprTailMapping(input) {
  return input;
}
function ExprMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprReadonlyMapping(input) {
  return AddImmutableDeferred(input[1]);
}
function ExprPipeMapping(input) {
  return input[1];
}
function GenericTypeMapping(input) {
  return Generic(input[0], input[2]);
}
function InferTypeMapping(input) {
  return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
}
function TypeMapping(input) {
  return input;
}
function PropertyKeyNumberMapping(input) {
  return `${input}`;
}
function PropertyKeyIdentMapping(input) {
  return input;
}
function PropertyKeyQuotedMapping(input) {
  return input;
}
function PropertyKeyIndexMapping(input) {
  return IsInteger2(input[3]) ? IntegerKey : IsNumber3(input[3]) ? NumberKey : IsSymbol2(input[3]) ? StringKey : IsString3(input[3]) ? StringKey : Unreachable2();
}
function PropertyKeyMapping(input) {
  return input;
}
function ReadonlyMapping(input) {
  return input.length > 0;
}
function OptionalMapping(input) {
  return input.length > 0;
}
function PropertyMapping(input) {
  const [isReadonly, key, isOptional, _colon, type] = input;
  return {
    [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type
  };
}
function PropertyDelimiterMapping(input) {
  return input;
}
function PropertyListMapping(input) {
  return Delimited(input);
}
function PropertiesReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
    return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
  }, [{}, {}]);
}
function PropertiesMapping(input) {
  return PropertiesReduce(input[1]);
}
function _Object_Mapping(input) {
  const [properties, patternProperties] = input;
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return _Object_(properties, options);
}
function ElementNamedMapping(input) {
  return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
}
function ElementReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[1]));
}
function ElementReadonlyMapping(input) {
  return AddReadonlyDeferred(input[1]);
}
function ElementOptionalMapping(input) {
  return AddOptionalDeferred(input[0]);
}
function ElementBaseMapping(input) {
  return input;
}
function ElementMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ElementListMapping(input) {
  return Delimited(input);
}
function _Tuple_Mapping(input) {
  return Tuple(input[1]);
}
function ParameterReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
}
function ParameterReadonlyMapping(input) {
  return AddReadonlyDeferred(input[3]);
}
function ParameterOptionalMapping(input) {
  return AddOptionalDeferred(input[3]);
}
function ParameterTypeMapping(input) {
  return input[2];
}
function ParameterBaseMapping(input) {
  return input;
}
function ParameterMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ParameterListMapping(input) {
  return Delimited(input);
}
function _Function_Mapping(input) {
  return _Function_(input[1], input[4]);
}
function _Constructor_Mapping(input) {
  return Constructor(input[2], input[5]);
}
function ApplyReadonly(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveReadonlyDeferred(type) : guard_exports.IsEqual(state, "add") ? AddReadonlyDeferred(type) : type;
}
function MappedReadonlyMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function ApplyOptional(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveOptionalDeferred(type) : guard_exports.IsEqual(state, "add") ? AddOptionalDeferred(type) : type;
}
function MappedOptionalMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function MappedAsMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
}
function _Mapped_Mapping(input) {
  return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
}
function ReferenceMapping(input) {
  return Ref(input);
}
function WithBigIntMapping(input) {
  return BigInt(input);
}
function WithNumberMapping(input) {
  return parseFloat(input);
}
function WithBooleanMapping(input) {
  return guard_exports.IsEqual(input, "true");
}
function WithStringMapping(input) {
  return input;
}
function WithNullMapping(input) {
  return null;
}
function WithUndefinedMapping(input) {
  return void 0;
}
function WithPropertyMapping(input) {
  return { [input[0]]: input[2] };
}
function WithPropertyListMapping(input) {
  return Delimited(input);
}
function WithObjectMappingReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    return memory_exports.Assign(result, left);
  }, {});
}
function WithObjectMapping(input) {
  return WithObjectMappingReduce(input[1]);
}
function WithElementListMapping(input) {
  return Delimited(input);
}
function WithArrayMapping(input) {
  return input[1];
}
function WithValueMapping(input) {
  return input;
}
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}
function InterfaceDeclarationHeritageListMapping(input) {
  return Delimited(input);
}
function InterfaceDeclarationHeritageMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function InterfaceDeclarationGenericMapping(input) {
  const parameters = input[2];
  const heritage = input[3];
  const [properties, patternProperties] = input[4];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options)) };
}
function InterfaceDeclarationMapping(input) {
  const heritage = input[2];
  const [properties, patternProperties] = input[3];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: InterfaceDeferred(heritage, properties, options) };
}
function TypeAliasDeclarationGenericMapping(input) {
  return { [input[1]]: Generic(input[2], input[4]) };
}
function TypeAliasDeclarationMapping(input) {
  return { [input[1]]: input[3] };
}
function ExportKeywordMapping(input) {
  return null;
}
function ModuleDeclarationDelimiterMapping(input) {
  return input;
}
function ModuleDeclarationListMapping(input) {
  return PropertiesReduce(Delimited(input));
}
function ModuleDeclarationMapping(input) {
  return input[1];
}
function ModuleMapping(input) {
  const moduleDeclaration = input[0];
  const moduleDeclarationList = input[1];
  return ModuleDeferred(memory_exports.Assign(moduleDeclaration, moduleDeclarationList[0]));
}
function ScriptMapping(input) {
  return input;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match2(input, ok, fail2) {
  return IsMatch(input) ? ok(input[0], input[1]) : fail2();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant, input) {
  return IsEqual(input.indexOf(variant), 0) ? [variant, input.slice(variant.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  // Lowercase
  ...Range(65, 90)
  // Uppercase
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var WhiteSpace = " ";
var NewLine = "\n";
var UnderScore = "_";
var Dot = ".";
var DollarSign = "$";
var Hyphen = "-";

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/trim.mjs
var LineComment = "//";
var OpenComment = "/*";
var CloseComment = "*/";
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/optional.mjs
function Optional2(value, input) {
  return Match2(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/many.mjs
function IsDiscard(discard, input) {
  return discard.includes(input);
}
function Many(allowed, discard, input, result = "") {
  return Match2(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/unsigned_integer.mjs
function TakeNonZero(input) {
  return Take(NonZero, input);
}
var AllowedDigits = [...Digit, UnderScore];
function TakeDigits(input) {
  return Many(AllowedDigits, [UnderScore], input);
}
function TakeUnsignedInteger(input) {
  return Match2(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match2(
    TakeNonZero(input),
    (NonZero2, NonZeroRest) => Match2(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
    // fail: did not match Digits
    () => []
  ));
}
function UnsignedInteger(input) {
  return TakeUnsignedInteger(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/integer.mjs
function TakeSign(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedInteger(input) {
  return Match2(
    TakeSign(input),
    (Sign, SignRest) => Match2(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Integer2(input) {
  return TakeSignedInteger(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/bigint.mjs
function TakeBigInt(input) {
  return Match2(
    Integer2(input),
    (Integer3, IntegerRest) => Match2(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
    // fail: did not match 'n'
    () => []
  );
}
function BigInt3(input) {
  return TakeBigInt(input);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
function TakeInitial(input) {
  return Take(Initial, input);
}
var Remaining = [...Initial, ...Digit];
function TakeRemaining(input, result = "") {
  return Match2(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
}
function TakeIdent(input) {
  return Match2(
    TakeInitial(input),
    (Initial2, InitialRest) => Match2(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
    // fail: did not match Remaining
    () => []
  );
}
function Ident(input) {
  return TakeIdent(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];
function IsLeadingDot(input) {
  return IsMatch(Take([Dot], input));
}
function TakeFractional(input) {
  return Match2(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
}
function LeadingDot(input) {
  return Match2(
    Take([Dot], input),
    (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
    // fail: did not match Fractional
    () => []
  );
}
function LeadingInteger(input) {
  return Match2(
    UnsignedInteger(input),
    (Integer3, IntegerRest) => Match2(
      Take([Dot], IntegerRest),
      (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
      // fail: did not match Fractional, use Integer
      () => [`${Integer3}`, IntegerRest]
    ),
    // fail: did not match Dot, use Integer
    () => []
  );
}
function TakeUnsignedNumber(input) {
  return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
}
function UnsignedNumber(input) {
  return TakeUnsignedNumber(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/number.mjs
function TakeSign2(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedNumber(input) {
  return Match2(
    TakeSign2(input),
    (Sign, SignRest) => Match2(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Number3(input) {
  return TakeSignedNumber(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match2(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/span.mjs
function MultiLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function SingleLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([NewLine, end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function Span(start, end, multiLine, input) {
  return multiLine ? MultiLine(start, end, Trim(input)) : SingleLine(start, end, Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/string.mjs
function TakeInitial2(quotes, input) {
  return Take(quotes, input);
}
function TakeSpan(quote, input) {
  return Span(quote, quote, false, input);
}
function TakeString(quotes, input) {
  return Match2(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
}
function String3(quotes, input) {
  return TakeString(quotes, Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match2(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/parser.mjs
var If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
var GenericParameterExtendsEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
var GenericParameterExtends = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
var GenericParameterEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
var GenericParameterIdentifier = (input) => If(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
var GenericParameter = (input) => If(If(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
var GenericParameterList_0 = (input, result = []) => If(If(GenericParameter(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
var GenericParameterList = (input) => If(If(GenericParameterList_0(input), ([_0, input2]) => If(If(If(GenericParameter(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
var GenericParameters = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericParameterList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
var GenericCallArgumentList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
var GenericCallArgumentList = (input) => If(If(GenericCallArgumentList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
var GenericCallArguments = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericCallArgumentList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
var GenericCall = (input) => If(If(Ident(input), ([_0, input2]) => If(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
var OptionalSemiColon = (input) => If(If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
var KeywordString = (input) => If(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
var KeywordNumber = (input) => If(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
var KeywordBoolean = (input) => If(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
var KeywordUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
var KeywordNull = (input) => If(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
var KeywordInteger = (input) => If(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
var KeywordBigInt = (input) => If(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
var KeywordUnknown = (input) => If(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
var KeywordAny = (input) => If(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
var KeywordObject = (input) => If(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
var KeywordNever = (input) => If(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
var KeywordSymbol = (input) => If(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
var KeywordVoid = (input) => If(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
var KeywordThis = (input) => If(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
var TemplateInterpolate = (input) => If(If(Const("${", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
var TemplateSpan = (input) => If(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
var TemplateBody = (input) => If(If(If(TemplateSpan(input), ([_0, input2]) => If(TemplateInterpolate(input2), ([_1, input3]) => If(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
var TemplateLiteralTypes = (input) => If(If(Const("`", input), ([_0, input2]) => If(TemplateBody(input2), ([_1, input3]) => If(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
var TemplateLiteral = (input) => If(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
var Dependent2 = (input) => If(If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const("else", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
var LiteralBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
var LiteralBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
var LiteralNumber = (input) => If(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
var LiteralString = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
var KeyOf = (input) => If(If(If(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
var IndexArray_0 = (input, result = []) => If(If(If(Const("[", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(Const("[", input), ([_0, input2]) => If(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
var IndexArray = (input) => If(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
var Extends2 = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const(":", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
var Base = (input) => If(If(If(Const("(", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(KeywordString(input), ([_0, input2]) => [_0, input2], () => If(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If(LiteralString(input), ([_0, input2]) => [_0, input2], () => If(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If(Dependent2(input), ([_0, input2]) => [_0, input2], () => If(_Object_2(input), ([_0, input2]) => [_0, input2], () => If(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If(_Function_2(input), ([_0, input2]) => [_0, input2], () => If(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If(GenericCall(input), ([_0, input2]) => [_0, input2], () => If(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
var With = (input) => If(If(If(Const("with", input), ([_0, input2]) => If(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
var Factor = (input) => If(If(KeyOf(input), ([_0, input2]) => If(Base(input2), ([_1, input3]) => If(IndexArray(input3), ([_2, input4]) => If(Extends2(input4), ([_3, input5]) => If(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
var ExprTermTail = (input) => If(If(If(Const("&", input), ([_0, input2]) => If(Factor(input2), ([_1, input3]) => If(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
var ExprTerm = (input) => If(If(Factor(input), ([_0, input2]) => If(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
var ExprTail = (input) => If(If(If(Const("|", input), ([_0, input2]) => If(ExprTerm(input2), ([_1, input3]) => If(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
var Expr = (input) => If(If(ExprTerm(input), ([_0, input2]) => If(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
var ExprReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
var ExprPipe = (input) => If(If(Const("|", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
var GenericType = (input) => If(If(GenericParameters(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
var InferType = (input) => If(If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("extends", input3), ([_2, input4]) => If(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
var Type = (input) => If(If(InferType(input), ([_0, input2]) => [_0, input2], () => If(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
var PropertyKeyNumber = (input) => If(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
var PropertyKeyIdent = (input) => If(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
var PropertyKeyQuoted = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
var PropertyKeyIndex = (input) => If(If(Const("[", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(If(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
var PropertyKey = (input) => If(If(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
var Readonly2 = (input) => If(If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
var Optional3 = (input) => If(If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
var Property = (input) => If(If(Readonly2(input), ([_0, input2]) => If(PropertyKey(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => If(Const(":", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
var PropertyDelimiter = (input) => If(If(If(Const(",", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
var PropertyList_0 = (input, result = []) => If(If(Property(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
var PropertyList = (input) => If(If(PropertyList_0(input), ([_0, input2]) => If(If(If(Property(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
var Properties = (input) => If(If(Const("{", input), ([_0, input2]) => If(PropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
var _Object_2 = (input) => If(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
var ElementNamed = (input) => If(If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
var ElementReadonlyOptional = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ElementReadonlyOptionalMapping(_0), input2]);
var ElementReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementReadonlyMapping(_0), input2]);
var ElementOptional = (input) => If(If(Type(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementOptionalMapping(_0), input2]);
var ElementBase = (input) => If(If(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonly(input), ([_0, input2]) => [_0, input2], () => If(ElementOptional(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
var Element = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
var ElementList_0 = (input, result = []) => If(If(Element(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
var ElementList = (input) => If(If(ElementList_0(input), ([_0, input2]) => If(If(If(Element(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementListMapping(_0), input2]);
var _Tuple_ = (input) => If(If(Const("[", input), ([_0, input2]) => If(ElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
var ParameterReadonlyOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
var ParameterReadonly = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
var ParameterOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
var ParameterType = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
var ParameterBase = (input) => If(If(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
var Parameter2 = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
var ParameterList_0 = (input, result = []) => If(If(Parameter2(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
var ParameterList = (input) => If(If(ParameterList_0(input), ([_0, input2]) => If(If(If(Parameter2(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
var _Function_2 = (input) => If(If(Const("(", input), ([_0, input2]) => If(ParameterList(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => If(Const("=>", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
var _Constructor_ = (input) => If(If(Const("new", input), ([_0, input2]) => If(Const("(", input2), ([_1, input3]) => If(ParameterList(input3), ([_2, input4]) => If(Const(")", input4), ([_3, input5]) => If(Const("=>", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
var MappedReadonly = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
var MappedOptional = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
var MappedAs = (input) => If(If(If(Const("as", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
var _Mapped_ = (input) => If(If(Const("{", input), ([_0, input2]) => If(MappedReadonly(input2), ([_1, input3]) => If(Const("[", input3), ([_2, input4]) => If(Ident(input4), ([_3, input5]) => If(Const("in", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => If(MappedAs(input7), ([_6, input8]) => If(Const("]", input8), ([_7, input9]) => If(MappedOptional(input9), ([_8, input10]) => If(Const(":", input10), ([_9, input11]) => If(Type(input11), ([_10, input12]) => If(OptionalSemiColon(input12), ([_11, input13]) => If(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
var Reference = (input) => If(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
var WithBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
var WithNumber = (input) => If(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
var WithBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
var WithString = (input) => If(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
var WithNull = (input) => If(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
var WithUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
var WithProperty = (input) => If(If(PropertyKey(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
var WithPropertyList_0 = (input, result = []) => If(If(WithProperty(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
var WithPropertyList = (input) => If(If(WithPropertyList_0(input), ([_0, input2]) => If(If(If(WithProperty(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
var WithObject = (input) => If(If(Const("{", input), ([_0, input2]) => If(WithPropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
var WithElementList_0 = (input, result = []) => If(If(WithValue(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
var WithElementList = (input) => If(If(WithElementList_0(input), ([_0, input2]) => If(If(If(WithValue(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
var WithArray = (input) => If(If(Const("[", input), ([_0, input2]) => If(WithElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
var WithValue = (input) => If(If(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If(WithNumber(input), ([_0, input2]) => [_0, input2], () => If(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If(WithString(input), ([_0, input2]) => [_0, input2], () => If(WithNull(input), ([_0, input2]) => [_0, input2], () => If(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If(WithObject(input), ([_0, input2]) => [_0, input2], () => If(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
var PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
var PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
var PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
var PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
var PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
var PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
var PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
var PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
var PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
var PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
var PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
var Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
var InterfaceDeclarationHeritageList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
var InterfaceDeclarationHeritageList = (input) => If(If(InterfaceDeclarationHeritageList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
var InterfaceDeclarationHeritage = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
var InterfaceDeclarationGeneric = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
var InterfaceDeclaration = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
var TypeAliasDeclarationGeneric = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
var TypeAliasDeclaration = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("=", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
var ExportKeyword = (input) => If(If(If(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
var ModuleDeclarationDelimiter = (input) => If(If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
var ModuleDeclarationList_0 = (input, result = []) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
var ModuleDeclarationList = (input) => If(If(ModuleDeclarationList_0(input), ([_0, input2]) => If(If(If(ModuleDeclaration(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
var ModuleDeclaration = (input) => If(If(ExportKeyword(input), ([_0, input2]) => If(If(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
var Module = (input) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
var Script = (input) => If(If(Module(input), ([_0, input2]) => [_0, input2], () => If(GenericType(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/patterns/template.mjs
function ParseTemplateIntoTypes(template) {
  const parsed = TemplateLiteralTypes(`\`${template}\``);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types, pattern) {
  return guard_exports.ShiftLeft(types, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types) {
  const encoded = EncodeTypes(types, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types) {
  const pattern = EncodePattern(types);
  const result = TemplateLiteralCreate(pattern);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types, options) {
  const result = CanInstantiate(types) ? memory_exports.Update(TemplateLiteralEncode(types), {}, options) : TemplateLiteralDeferred(types, options);
  return result;
}
function TemplateLiteralInstantiate(context, state, types, options) {
  const instantiatedTypes = InstantiateTypes(context, state, types);
  return TemplateLiteralAction(instantiatedTypes, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types, options = {}) {
  return Deferred("TemplateLiteral", [types], options);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function TemplateLiteralFromTypes(types) {
  return TemplateLiteralAction(types, {});
}
function TemplateLiteralFromString(template) {
  const types = ParseTemplateIntoTypes(template);
  return TemplateLiteralFromTypes(types);
}
function TemplateLiteral2(input, options = {}) {
  const type = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
  return memory_exports.Update(type, {}, options);
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match3
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match3(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match3(ExtendsLeft(inferred, left, if_), (inferred2) => Match3(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match3(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match3(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match3(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match3(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match3(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/record.mjs
function FromObject3(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject3(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right, result = []) {
  return guard_exports.ShiftLeft(rest, (head, tail) => Match3(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types) {
  return [...types].reverse();
}
function ApplyReverse(types, reversed) {
  return reversed ? Reverse(types) : types;
}
function Reversed(types) {
  const first = types.length > 0 ? types[0] : void 0;
  const inferrable = IsSchema(first) ? TryRestInferable(first) : void 0;
  return IsSchema(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match3(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
  return result;
}
function InterfaceInstantiate(context, state, heritage, properties, options) {
  const instantiatedHeritage = InstantiateTypes(context, state, heritage);
  const instantiatedProperties = InstantiateProperties(context, state, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options = {}) {
  return Deferred("Interface", [heritage, properties], options);
}
function IsInterfaceDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}
function Interface(heritage, properties, options = {}) {
  return InterfaceAction(heritage, properties, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
}
function FromProperties(stack, context, properties) {
  const types = PropertyValues(properties);
  return FromTypes2(stack, context, types);
}
function FromTypes2(stack, context, types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
}
function FromType3(stack, context, type) {
  return IsRef(type) ? FromRef(stack, context, type.$ref) : IsArray2(type) ? FromType3(stack, context, type.items) : IsConstructor2(type) ? FromTypes2(stack, context, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context, type.allOf) : IsObject2(type) ? FromProperties(stack, context, type.properties) : IsUnion(type) ? FromTypes2(stack, context, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context, type.items) : IsRecord(type) ? FromType3(stack, context, RecordValue(type)) : false;
}
function CyclicCheck(stack, context, type) {
  const result = FromType3(stack, context, type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context) {
  const keys = PropertyKeys(context);
  const result = ResolveCandidateKeys(context, keys);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context, ref, result) {
  return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context, properties, result) {
  const types = PropertyValues(properties);
  return FromTypes3(context, types, result);
}
function FromTypes3(context, types, result) {
  return types.reduce((result2, left) => {
    return FromType4(context, left, result2);
  }, result);
}
function FromType4(context, type, result) {
  return IsRef(type) ? FromRef2(context, type.$ref, result) : IsArray2(type) ? FromType4(context, type.items, result) : IsConstructor2(type) ? FromTypes3(context, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context, type.allOf, result) : IsObject2(type) ? FromProperties2(context, type.properties, result) : IsUnion(type) ? FromTypes3(context, type.anyOf, result) : IsTuple(type) ? FromTypes3(context, type.items, result) : IsRecord(type) ? FromType4(context, RecordValue(type), result) : result;
}
function CyclicDependencies(context, key, type) {
  const result = FromType4(context, type, [key]);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types) {
  return types.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context, dependencies) {
  const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context, ref, type) {
  const dependencies = CyclicDependencies(context, ref, type);
  const definitions = CyclicDefinitions(context, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/compare.mjs
var ResultEqual = "equal";
var ResultDisjoint = "disjoint";
var ResultLeftInside = "left-inside";
var ResultRightInside = "right-inside";
function Compare(left, right) {
  const extendsCheck = [
    IsUnknown(left) ? result_exports.ExtendsFalse() : Extends({}, left, right),
    IsUnknown(left) ? result_exports.ExtendsTrue({}) : Extends({}, right, left)
  ];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? ResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultRightInside : ResultDisjoint;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadFilter(type, types) {
  return types.filter((left) => {
    return Compare(type, left) === ResultRightInside ? false : true;
  });
}
function IsBroadestType(type, types) {
  const result = types.some((left) => {
    const result2 = Compare(type, left);
    return guard_exports.IsEqual(result2, ResultLeftInside) || guard_exports.IsEqual(result2, ResultEqual);
  });
  return guard_exports.IsEqual(result, false);
}
function BroadenType(type, types) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : IsBroadestType(evaluated, types) ? [...BroadFilter(evaluated, types), evaluated] : types;
}
function BroadenTypes(types) {
  return types.reduce((result, left) => {
    return IsObject2(left) ? [...result, left] : (
      // push
      IsNever(left) ? result : (
        // ignore
        BroadenType(left, result)
      )
    );
  }, []);
}
function Broaden(types) {
  const broadened = BroadenTypes(types);
  const flattened = Flatten(broadened);
  return flattened;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options) {
  const result = memory_exports.Update(EvaluateType(type), {}, options);
  return result;
}
function EvaluateInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return EvaluateAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function Expand(type) {
  return IsUnion(type) ? [...type.anyOf] : [type];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context, ref, arguments_) {
  return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
}
function FromType6(context, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context, target, arguments_) {
  return FromType6(context, "(anonymous)", target, arguments_);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context, state, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context, state, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context, { [name]: instantiatedArgument });
}
function BindArguments(context, state, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context, state, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context, state, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, left), state, parameterRight, right), () => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state, parameterRight, []));
}
function BindParameters(context, state, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state, left, right, arguments_), () => context);
}
function ResolveArgumentsContext(context, state, parameters, arguments_) {
  return BindParameters(context, state, parameters, arguments_);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/instantiate.mjs
function Peek(state) {
  const result = guard_exports.IsGreaterThan(state.callstack.length, 0) ? state.callstack[state.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state, name) {
  const result = guard_exports.IsEqual(Peek(state), name);
  return result;
}
function CallDispatch(context, state, target, parameters, expression, arguments_) {
  const argumentsContext = ResolveArgumentsContext(context, state, parameters, arguments_);
  const returnType = InstantiateType(argumentsContext, State([...state["callstack"], target["$ref"]], state["visited"]), expression);
  return InstantiateType(argumentsContext, State([], []), returnType);
}
function CallDistributed(context, state, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => [...result, CallDispatch(context, state, target, parameters, expression, arguments_)], []);
}
function CallImmediate(context, state, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context, state, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context, state, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context, state, arguments_);
  const resolved = ResolveTarget(context, target, arguments_);
  const name = resolved[0];
  const type = resolved[1];
  const result = IsGeneric(type) ? IsTailCall(state, name) ? CallConstruct(Ref(name), instantiatedArguments) : CallImmediate(context, state, Ref(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function Call(target, arguments_) {
  return CallInstantiate({}, State([], []), target, arguments_);
}
function IsCall(value) {
  return IsKind(value, "Call");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options);
  return result;
}
function RemoveImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveImmutableAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types) {
  const result = types.map((type) => FromType7(mapping, type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options = {}) {
  return Deferred("Capitalize", [type], options);
}
function Capitalize(type, options = {}) {
  return CapitalizeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options = {}) {
  return Deferred("Lowercase", [type], options);
}
function Lowercase(type, options = {}) {
  return LowercaseAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options = {}) {
  return Deferred("Uncapitalize", [type], options);
}
function Uncapitalize(type, options = {}) {
  return UncapitalizeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options = {}) {
  return Deferred("Uppercase", [type], options);
}
function Uppercase(type, options = {}) {
  return UppercaseAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
var LowercaseMapping = (input) => input.toLowerCase();
var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
var UppercaseMapping = (input) => input.toUpperCase();
function CapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options) : CapitalizeDeferred(type, options);
  return result;
}
function LowercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options) : LowercaseDeferred(type, options);
  return result;
}
function UncapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options) : UncapitalizeDeferred(type, options);
  return result;
}
function UppercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options) : UppercaseDeferred(type, options);
  return result;
}
function CapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return CapitalizeAction(instantiatedType, options);
}
function LowercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return LowercaseAction(instantiatedType, options);
}
function UncapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UncapitalizeAction(instantiatedType, options);
}
function UppercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UppercaseAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options);
}
function Conditional(left, right, true_, false_, options = {}) {
  return ConditionalAction({}, State([], []), left, right, true_, false_, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context, state, left, right, true_, false_) {
  const extendsResult = Extends(context, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state, true_), InstantiateType(context, state, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state, true_) : InstantiateType(context, state, false_);
}
function ConditionalAction(context, state, left, right, true_, false_, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
  return result;
}
function ConditionalInstantiate(context, state, left, right, true_, false_, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ConditionalAction(context, state, instantiatedLeft, instantiatedRight, true_, false_, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options = {}) {
  return Deferred("ConstructorParameters", [type], options);
}
function ConstructorParameters(type, options = {}) {
  return ConstructorParametersAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options) : ConstructorParametersDeferred(type, options);
  return result;
}
function ConstructorParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ConstructorParametersAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options = {}) {
  return Deferred("Exclude", [left, right], options);
}
function Exclude(left, right, options = {}) {
  return ExcludeAction(left, right, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
  return result;
}
function ExcludeInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options = {}) {
  return Deferred("Extract", [left, right], options);
}
function Extract(left, right, options = {}) {
  return ExtractAction(left, right, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExtractType(head, right)];
  }, []);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
  return result;
}
function ExtractInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs
function KeysToLiterals(keys) {
  return keys.reduce((result, left) => {
    return IsLiteralValue(left) ? [...result, Literal(left)] : result;
  }, []);
}
function KeysToIndexer(keys) {
  const literals = KeysToLiterals(keys);
  const result = Union(literals);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options = {}) {
  return Deferred("Index", [type, indexer], options);
}
function Index(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return IndexAction(type, indexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types) {
  return types.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject4(properties) {
  return properties;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types) {
  const object = TupleToObject(Tuple(types));
  const result = FromType8(object);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types, result) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject4(type.properties) : {};
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types) {
  return types.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray3(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types) {
  return types.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
var NumericKeyPattern = new RegExp(IntegerKey);
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject5(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types) {
  return types.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types, indexer) {
  return types.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types) {
  return EvaluateUnionFast(types);
}
function FromTuple2(types, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types) : FromTupleWithIndexer(types, indexer)
  );
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray3(type.items, indexer) : IsObject2(type) ? FromObject5(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options) : IndexDeferred(type, indexer, options);
  return result;
}
function IndexInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options = {}) {
  return Deferred("InstanceType", [type], options);
}
function InstanceType(type, options = {}) {
  return InstanceTypeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options) : InstanceTypeDeferred(type, options);
  return result;
}
function InstanceTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return InstanceTypeAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options = {}) {
  return Deferred("KeyOf", [type], options);
}
function KeyOf2(type, options = {}) {
  return KeyOfAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray4(_type) {
  return Number2();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject6(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types) {
  const result = types.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray4(type.items) : IsObject2(type) ? FromObject6(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options) : KeyOfDeferred(type, options);
}
function KeyOfInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return KeyOfAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options);
}
function Mapped(identifier, type, as, property, options = {}) {
  return MappedAction({}, State([], []), identifier, type, as, property, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context, state, identifier, variant, as, property) {
  const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant });
  const instantiatedAs = InstantiateType(variantContext, state, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context, state, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context, state, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context, state, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context, state, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context, state, identifier, type, as, property, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context, state, identifier, type, as, property), {}, options) : MappedDeferred(identifier, type, as, property, options);
  return result;
}
function MappedInstantiate(context, state, identifier, type, as, property, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return MappedAction(context, state, identifier, instantiatedType, as, property, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context, declarations, options) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options);
}
function ModuleInstantiate(context, _state, declarations, options) {
  const instantiatedModule = InstantiateModule(context, declarations, options);
  return instantiatedModule;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options = {}) {
  return Deferred("NonNullable", [type], options);
}
function NonNullable(type, options = {}) {
  return NonNullableAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options) : NonNullableDeferred(type, options);
  return result;
}
function NonNullableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return NonNullableAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options = {}) {
  return Deferred("Omit", [type, indexer], options);
}
function Omit(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return OmitAction(type, indexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options) : OmitDeferred(type, indexer, options);
  return result;
}
function OmitInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options = {}) {
  return Deferred("Parameters", [type], options);
}
function Parameters(type, options = {}) {
  return ParametersAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options) : ParametersDeferred(type, options);
  return result;
}
function ParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ParametersAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options = {}) {
  return Deferred("Partial", [type], options);
}
function Partial(type, options = {}) {
  return PartialAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types) {
  const result = types.map((type) => FromType15(type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject7(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject7(type.properties) : _Object_({});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options) : PartialDeferred(type, options);
  return result;
}
function PartialInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return PartialAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options = {}) {
  return Deferred("Pick", [type, indexer], options);
}
function Pick(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return PickAction(type, indexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options) : PickDeferred(type, indexer, options);
  return result;
}
function PickInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options = {}) {
  return Deferred("ReadonlyObject", [type], options);
}
function ReadonlyObject(type, options = {}) {
  return ReadonlyObjectAction(type, options);
}
var ReadonlyType = ReadonlyObject;

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray5(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types) {
  const result = AddImmutable(Tuple(types));
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types) {
  const result = types.map((type) => FromType17(type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray5(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject8(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReadonlyObjectAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context, state, type, ref) {
  return state.visited.includes(ref) ? type : ref in context ? InstantiateType(context, State(state["callstack"], [...state["visited"], ref]), context[ref]) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types) {
  const result = types.map((type) => FromType18(type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject9(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject9(type.properties) : _Object_({});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options = {}) {
  return Deferred("Required", [type], options);
}
function Required(type, options = {}) {
  return RequiredAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options) : RequiredDeferred(type, options);
  return result;
}
function RequiredInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return RequiredAction(instaniatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options = {}) {
  return Deferred("ReturnType", [type], options);
}
function ReturnType(type, options = {}) {
  return ReturnTypeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options) : ReturnTypeDeferred(type, options);
  return result;
}
function ReturnTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReturnTypeAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options) {
  return Deferred("With", [type, options], {});
}
function With2(type, options) {
  return WithAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options) : WithDeferred(type, options);
  return result;
}
function WithInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return WithAction(instaniatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types) {
  const result = types.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited2) {
  return { callstack, visited: visited2 };
}
function CanInstantiate(types) {
  return guard_exports.ShiftLeft(types, (left, right) => IsRef(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context, state, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context, state, properties[key]) };
  }, {});
}
function InstantiateElements(context, state, types) {
  const elements = InstantiateTypes(context, state, types);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context, state, types) {
  return types.map((type) => InstantiateType(context, state, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context, state, action, parameters, options) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state, parameters[0], options) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state, parameters[0], parameters[1]) : Deferred(action, parameters, options)
    )
  );
}
function InstantiateImmediate(context, state, type) {
  const instantiatedType = IsRef(type) ? RefInstantiate(context, state, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context, state, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context, state, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context, state, type.if), InstantiateType(context, state, type.then), InstantiateType(context, state, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context, state, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context, state, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context, state, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context, state, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context, state, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context, state, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context, state, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context, state, type.action, type.parameters, type.options) : InstantiateImmediate(context, state, type);
  return result;
}
function Instantiate(context, type) {
  return InstantiateType(context, State([], []), type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options);
  return result;
}
function AddImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddImmutableAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutableDeferred(type, options = {}) {
  return Deferred("AddImmutable", [type], options);
}
function AddImmutable(type, options = {}) {
  return AddImmutableAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/evaluate.mjs
function EvaluateDeferred(type, options = {}) {
  return Deferred("Evaluate", [type], options);
}
function Evaluate(type, options = {}) {
  return EvaluateAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/module.mjs
function ModuleDeferred(declarations, options = {}) {
  return Deferred("Module", [declarations], options);
}
function Module2(declarations, options = {}) {
  return ModuleInstantiate({}, State([], []), declarations, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/priority/priority.mjs
function Comparer(left, right) {
  const compareResult = Compare(left, right);
  const result = guard_exports.IsEqual(compareResult, "right-inside") ? 1 : guard_exports.IsEqual(compareResult, "disjoint") ? 1 : 0;
  return result;
}
function Insert(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => guard_exports.IsEqual(Comparer(type, left), 1) ? Insert(type, right, [...result, left]) : [...result, type, ...types], () => [...result, type]);
}
function Sort(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Sort(right, Insert(left, result)), () => result);
}
function Priority(types) {
  const result = Sort(types);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/script.mjs
function Script2(...args) {
  const [context, input, options] = arguments_exports.Match(args, {
    2: (script, options2) => guard_exports.IsString(script) ? [{}, script, options2] : [script, options2, {}],
    3: (context2, script, options2) => [context2, script, options2],
    1: (script) => [{}, script, {}]
  });
  const result = Script(input);
  const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
  return memory_exports.Update(parsed, {}, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/typebox.mjs
var typebox_exports = {};
__export(typebox_exports, {
  Any: () => Any,
  Array: () => _Array_,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Call: () => Call,
  Capitalize: () => Capitalize,
  Codec: () => Codec,
  Conditional: () => Conditional,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Cyclic: () => Cyclic,
  Decode: () => Decode,
  DecodeBuilder: () => DecodeBuilder,
  Dependent: () => Dependent,
  Encode: () => Encode,
  EncodeBuilder: () => EncodeBuilder,
  Enum: () => Enum,
  Evaluate: () => Evaluate,
  Exclude: () => Exclude,
  Extends: () => Extends,
  ExtendsResult: () => result_exports,
  Extract: () => Extract,
  Function: () => _Function_,
  Generic: () => Generic,
  Identifier: () => Identifier,
  Immutable: () => Immutable,
  Index: () => Index,
  Infer: () => Infer,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Interface: () => Interface,
  Intersect: () => Intersect,
  IsAny: () => IsAny,
  IsArray: () => IsArray2,
  IsBigInt: () => IsBigInt2,
  IsBoolean: () => IsBoolean3,
  IsCall: () => IsCall,
  IsCodec: () => IsCodec,
  IsConstructor: () => IsConstructor2,
  IsCyclic: () => IsCyclic,
  IsDependent: () => IsDependent,
  IsEnum: () => IsEnum,
  IsEnumValue: () => IsEnumValue,
  IsFunction: () => IsFunction2,
  IsGeneric: () => IsGeneric,
  IsIdentifier: () => IsIdentifier,
  IsImmutable: () => IsImmutable,
  IsInfer: () => IsInfer,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect,
  IsKind: () => IsKind,
  IsLiteral: () => IsLiteral,
  IsNever: () => IsNever,
  IsNull: () => IsNull2,
  IsNumber: () => IsNumber3,
  IsObject: () => IsObject2,
  IsOptional: () => IsOptional,
  IsParameter: () => IsParameter,
  IsReadonly: () => IsReadonly,
  IsRecord: () => IsRecord,
  IsRef: () => IsRef,
  IsRefine: () => IsRefine,
  IsRest: () => IsRest,
  IsSchema: () => IsSchema,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol2,
  IsTemplateLiteral: () => IsTemplateLiteral,
  IsThis: () => IsThis,
  IsTuple: () => IsTuple,
  IsUndefined: () => IsUndefined2,
  IsUnion: () => IsUnion,
  IsUnknown: () => IsUnknown,
  IsUnsafe: () => IsUnsafe,
  IsVoid: () => IsVoid,
  KeyOf: () => KeyOf2,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module2,
  Never: () => Never,
  NonNullable: () => NonNullable,
  Null: () => Null,
  Number: () => Number2,
  Object: () => _Object_,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameter: () => Parameter,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Readonly: () => Readonly,
  ReadonlyObject: () => ReadonlyObject,
  ReadonlyType: () => ReadonlyType,
  Record: () => Record,
  RecordKey: () => RecordKey,
  RecordPattern: () => RecordPattern,
  RecordValue: () => RecordValue,
  Ref: () => Ref,
  Refine: () => Refine,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  Script: () => Script2,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral2,
  This: () => This,
  Tuple: () => Tuple,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void,
  With: () => With2
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/_refine.mjs
function IsRefine2(value) {
  return guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => guard_exports.IsObject(value2) && guard_exports.HasPropertyKey(value2, "check") && guard_exports.HasPropertyKey(value2, "error") && guard_exports.IsFunction(value2.check) && guard_exports.IsFunction(value2.error));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/schema.mjs
function IsSchemaObject(value) {
  return guard_exports.IsObject(value) && !guard_exports.IsArray(value);
}
function IsSchemaBoolean(value) {
  return guard_exports.IsBoolean(value);
}
function IsSchema2(value) {
  return IsSchemaObject(value) || IsSchemaBoolean(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/additionalItems.mjs
function IsAdditionalItems(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalItems") && IsSchema2(schema.additionalItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/additionalProperties.mjs
function IsAdditionalProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalProperties") && IsSchema2(schema.additionalProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/allOf.mjs
function IsAllOf(schema) {
  return guard_exports.HasPropertyKey(schema, "allOf") && guard_exports.IsArray(schema.allOf) && schema.allOf.every((value) => IsSchema2(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/anchor.mjs
function IsAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$anchor") && guard_exports.IsString(schema.$anchor);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/anyOf.mjs
function IsAnyOf(schema) {
  return guard_exports.HasPropertyKey(schema, "anyOf") && guard_exports.IsArray(schema.anyOf) && schema.anyOf.every((value) => IsSchema2(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/const.mjs
function IsConst(value) {
  return guard_exports.HasPropertyKey(value, "const");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/contains.mjs
function IsContains(schema) {
  return guard_exports.HasPropertyKey(schema, "contains") && IsSchema2(schema.contains);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/default.mjs
function IsDefault(schema) {
  return guard_exports.HasPropertyKey(schema, "default");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dependencies.mjs
function IsDependencies(schema) {
  return guard_exports.HasPropertyKey(schema, "dependencies") && guard_exports.IsObject(schema.dependencies) && Object.values(schema.dependencies).every((value) => IsSchema2(value) || guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dependentRequired.mjs
function IsDependentRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentRequired") && guard_exports.IsObject(schema.dependentRequired) && Object.values(schema.dependentRequired).every((value) => guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dependentSchemas.mjs
function IsDependentSchemas(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentSchemas") && guard_exports.IsObject(schema.dependentSchemas) && Object.values(schema.dependentSchemas).every((value) => IsSchema2(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dynamicAnchor.mjs
function IsDynamicAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicAnchor") && guard_exports.IsString(schema.$dynamicAnchor);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dynamicRef.mjs
function IsDynamicRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicRef") && guard_exports.IsString(schema.$dynamicRef);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/else.mjs
function IsElse(schema) {
  return guard_exports.HasPropertyKey(schema, "else") && IsSchema2(schema.else);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/enum.mjs
function IsEnum2(schema) {
  return guard_exports.HasPropertyKey(schema, "enum") && guard_exports.IsArray(schema.enum);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/exclusiveMaximum.mjs
function IsExclusiveMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMaximum") && (guard_exports.IsNumber(schema.exclusiveMaximum) || guard_exports.IsBigInt(schema.exclusiveMaximum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/exclusiveMinimum.mjs
function IsExclusiveMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMinimum") && (guard_exports.IsNumber(schema.exclusiveMinimum) || guard_exports.IsBigInt(schema.exclusiveMinimum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/format.mjs
function IsFormat(schema) {
  return guard_exports.HasPropertyKey(schema, "format") && guard_exports.IsString(schema.format);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/id.mjs
function IsId(schema) {
  return guard_exports.HasPropertyKey(schema, "$id") && guard_exports.IsString(schema.$id);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/if.mjs
function IsIf(schema) {
  return guard_exports.HasPropertyKey(schema, "if") && IsSchema2(schema.if);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/items.mjs
function IsItems(schema) {
  return guard_exports.HasPropertyKey(schema, "items") && (IsSchema2(schema.items) || guard_exports.IsArray(schema.items) && schema.items.every((value) => {
    return IsSchema2(value);
  }));
}
function IsItemsSized(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maximum.mjs
function IsMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "maximum") && (guard_exports.IsNumber(schema.maximum) || guard_exports.IsBigInt(schema.maximum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxContains.mjs
function IsMaxContains(schema) {
  return guard_exports.HasPropertyKey(schema, "maxContains") && guard_exports.IsNumber(schema.maxContains);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxItems.mjs
function IsMaxItems(schema) {
  return guard_exports.HasPropertyKey(schema, "maxItems") && guard_exports.IsNumber(schema.maxItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxLength.mjs
function IsMaxLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "maxLength") && guard_exports.IsNumber(schema.maxLength);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxProperties.mjs
function IsMaxProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "maxProperties") && guard_exports.IsNumber(schema.maxProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minimum.mjs
function IsMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "minimum") && (guard_exports.IsNumber(schema.minimum) || guard_exports.IsBigInt(schema.minimum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minContains.mjs
function IsMinContains(schema) {
  return guard_exports.HasPropertyKey(schema, "minContains") && guard_exports.IsNumber(schema.minContains);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minItems.mjs
function IsMinItems(schema) {
  return guard_exports.HasPropertyKey(schema, "minItems") && guard_exports.IsNumber(schema.minItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minLength.mjs
function IsMinLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "minLength") && guard_exports.IsNumber(schema.minLength);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minProperties.mjs
function IsMinProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "minProperties") && guard_exports.IsNumber(schema.minProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/multipleOf.mjs
function IsMultipleOf2(schema) {
  return guard_exports.HasPropertyKey(schema, "multipleOf") && (guard_exports.IsNumber(schema.multipleOf) || guard_exports.IsBigInt(schema.multipleOf));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/not.mjs
function IsNot(schema) {
  return guard_exports.HasPropertyKey(schema, "not") && IsSchema2(schema.not);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/oneOf.mjs
function IsOneOf(schema) {
  return guard_exports.HasPropertyKey(schema, "oneOf") && guard_exports.IsArray(schema.oneOf) && schema.oneOf.every((value) => IsSchema2(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/pattern.mjs
function IsPattern(schema) {
  return guard_exports.HasPropertyKey(schema, "pattern") && (guard_exports.IsString(schema.pattern) || schema.pattern instanceof RegExp);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/patternProperties.mjs
function IsPatternProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "patternProperties") && guard_exports.IsObject(schema.patternProperties) && Object.values(schema.patternProperties).every((value) => IsSchema2(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/prefixItems.mjs
function IsPrefixItems(schema) {
  return guard_exports.HasPropertyKey(schema, "prefixItems") && guard_exports.IsArray(schema.prefixItems) && schema.prefixItems.every((schema2) => IsSchema2(schema2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/properties.mjs
function IsProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "properties") && guard_exports.IsObject(schema.properties) && Object.values(schema.properties).every((value) => IsSchema2(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/propertyNames.mjs
function IsPropertyNames(schema) {
  return guard_exports.HasPropertyKey(schema, "propertyNames") && (guard_exports.IsObject(schema.propertyNames) || IsSchema2(schema.propertyNames));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/recursiveAnchor.mjs
function IsRecursiveAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveAnchor") && guard_exports.IsBoolean(schema.$recursiveAnchor);
}
function IsRecursiveAnchorTrue(schema) {
  return IsRecursiveAnchor(schema) && guard_exports.IsEqual(schema.$recursiveAnchor, true);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/recursiveRef.mjs
function IsRecursiveRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveRef") && guard_exports.IsString(schema.$recursiveRef);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/ref.mjs
function IsRef2(schema) {
  return guard_exports.HasPropertyKey(schema, "$ref") && guard_exports.IsString(schema.$ref);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/required.mjs
function IsRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "required") && guard_exports.IsArray(schema.required) && schema.required.every((value) => guard_exports.IsString(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/then.mjs
function IsThen(schema) {
  return guard_exports.HasPropertyKey(schema, "then") && IsSchema2(schema.then);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/type.mjs
function IsType(schema) {
  return guard_exports.HasPropertyKey(schema, "type") && (guard_exports.IsString(schema.type) || guard_exports.IsArray(schema.type) && schema.type.every((value) => guard_exports.IsString(value)));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/uniqueItems.mjs
function IsUniqueItems(schema) {
  return guard_exports.HasPropertyKey(schema, "uniqueItems") && guard_exports.IsBoolean(schema.uniqueItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/unevaluatedItems.mjs
function IsUnevaluatedItems(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedItems") && IsSchema2(schema.unevaluatedItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/unevaluatedProperties.mjs
function IsUnevaluatedProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedProperties") && IsSchema2(schema.unevaluatedProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_context.mjs
var CheckContext = class {
  constructor() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack = [{ indices, keys }];
  }
  // ----------------------------------------------------------------
  // Stack
  // ----------------------------------------------------------------
  Push() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack.push({ indices, keys });
    return true;
  }
  Pop() {
    this.stack.pop();
    return true;
  }
  // ----------------------------------------------------------------
  // Top
  // ----------------------------------------------------------------
  AddIndex(index) {
    this.GetIndices().add(index);
    return true;
  }
  AddKey(key) {
    this.GetKeys().add(key);
    return true;
  }
  GetIndices() {
    const top = this.stack[this.stack.length - 1];
    return top.indices;
  }
  GetKeys() {
    const top = this.stack[this.stack.length - 1];
    return top.keys;
  }
  Merge(results) {
    for (const context of results) {
      context.GetIndices().forEach((value) => this.GetIndices().add(value));
      context.GetKeys().forEach((value) => this.GetKeys().add(value));
    }
    return true;
  }
};
var ErrorContext = class extends CheckContext {
  constructor(callback) {
    super();
    this.callback = callback;
  }
  AddError(error) {
    this.callback(error);
    return false;
  }
};
var AccumulatedErrorContext = class extends ErrorContext {
  constructor() {
    super((error) => this.errors.push(error));
    this.errors = [];
  }
  AddError(error) {
    this.errors.push(error);
    return false;
  }
  GetErrors() {
    return this.errors;
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_refine.mjs
function CheckRefine(_stack, _context, schema, value) {
  return guard_exports.Every(schema["~refine"], 0, (refinement, _) => refinement.check(value));
}
function ErrorRefine(_stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema["~refine"], 0, (refinement, index) => {
    return refinement.check(value) || context.AddError({
      keyword: "~refine",
      schemaPath,
      instancePath,
      params: { index, message: refinement.error(value) }
    });
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/additionalItems.mjs
function IsValid(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}
function CheckAdditionalItems(stack, context, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = guard_exports.Every(value, 0, (item, index) => {
    return guard_exports.IsLessThan(index, schema.items.length) || CheckSchemaPushStack(stack, context, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}
function ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = guard_exports.Every(value, 0, (item, index) => {
    const nextSchemaPath = `${schemaPath}/additionalItems`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessThan(index, schema.items.length) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/additionalProperties.mjs
function GetPropertyKeyAsPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}$`;
}
function GetPropertiesPattern(schema) {
  const patterns = [];
  if (IsPatternProperties(schema))
    patterns.push(...guard_exports.Keys(schema.patternProperties));
  if (IsProperties(schema))
    patterns.push(...guard_exports.Keys(schema.properties).map(GetPropertyKeyAsPattern));
  return guard_exports.IsEqual(patterns.length, 0) ? "(?!)" : `(${patterns.join("|")})`;
}
function CheckAdditionalProperties(stack, context, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const isAdditionalProperties = guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => {
    return regexp.test(key) || CheckSchemaPushStack(stack, context, schema.additionalProperties, value[key]) && context.AddKey(key);
  });
  return isAdditionalProperties;
}
function ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const additionalProperties = [];
  const isAdditionalProperties = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextSchemaPath = `${schemaPath}/additionalProperties`;
    const nextInstancePath = `${instancePath}/${key}`;
    const nextContext = new AccumulatedErrorContext();
    const isAdditionalProperty = regexp.test(key) || ErrorSchemaPushStack(stack, nextContext, nextSchemaPath, nextInstancePath, schema.additionalProperties, value[key]) && context.AddKey(key);
    if (!isAdditionalProperty)
      additionalProperties.push(key);
    return isAdditionalProperty;
  });
  return isAdditionalProperties || context.AddError({
    keyword: "additionalProperties",
    schemaPath,
    instancePath,
    params: { additionalProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/allOf.mjs
function CheckAllOf(stack, context, schema, value) {
  const results = schema.allOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
}
function ErrorAllOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.allOf.reduce((result, schema2, index) => {
    const nextSchemaPath = `${schemaPath}/allOf/${index}`;
    const nextContext = new AccumulatedErrorContext();
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAllOf = guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
  if (!isAllOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAllOf;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/anyOf.mjs
function CheckAnyOf(stack, context, schema, value) {
  const results = schema.anyOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
}
function ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.anyOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/anyOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAnyOf = guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
  if (!isAnyOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAnyOf || context.AddError({
    keyword: "anyOf",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/boolean.mjs
function CheckSchemaBoolean(_stack, _context, schema, _value) {
  return schema;
}
function ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) {
  return CheckSchemaBoolean(stack, context, schema, value) || context.AddError({
    keyword: "boolean",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/const.mjs
function CheckConst(_stack, _context, schema, value) {
  return guard_exports.IsValueLike(schema.const) ? guard_exports.IsEqual(value, schema.const) : guard_exports.IsDeepEqual(value, schema.const);
}
function ErrorConst(stack, context, schemaPath, instancePath, schema, value) {
  return CheckConst(stack, context, schema, value) || context.AddError({
    keyword: "const",
    schemaPath,
    instancePath,
    params: { allowedValue: schema.const }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/contains.mjs
function IsValid2(schema) {
  return !(IsMinContains(schema) && guard_exports.IsEqual(schema.minContains, 0));
}
function CheckContains(stack, context, schema, value) {
  if (!IsValid2(schema))
    return true;
  return !guard_exports.IsEqual(value.length, 0) && guard_exports.SomeAll(value, (item, index) => {
    return CheckSchema(stack, context, schema.contains, item) && context.AddIndex(index);
  });
}
function ErrorContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: 1 }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dependencies.mjs
function CheckDependencies(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((key2) => guard_exports.HasPropertyKey(value, key2)) : CheckSchema(stack, context, schema2, value));
  });
  return isLength || isEvery;
}
function ErrorDependencies(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependencies/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependencies",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: schema2 }
    })) : ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value));
  });
  return isLength || isEvery;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dependentRequired.mjs
function CheckDependentRequired(_stack, _context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || keys.every((key2) => guard_exports.HasPropertyKey(value, key2));
  });
  return isLength || isEvery;
}
function ErrorDependentRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEveryEntry = guard_exports.EveryAll(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || guard_exports.EveryAll(keys, 0, (dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependentRequired",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: keys }
    }));
  });
  return isLength || isEveryEntry;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dependentSchemas.mjs
function CheckDependentSchemas(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || CheckSchema(stack, context, schema2, value);
  });
  return isLength || isEvery;
}
function ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependentSchemas/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value);
  });
  return isLength || isEvery;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dynamicRef.mjs
function CheckDynamicRef(stack, context, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema2(target) && CheckSchema(stack, context, target, value);
}
function ErrorDynamicRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/enum.mjs
function CheckEnum(_stack, _context, schema, value) {
  return guard_exports.Some(schema.enum, (option) => guard_exports.IsValueLike(option) ? guard_exports.IsEqual(value, option) : guard_exports.IsDeepEqual(value, option));
}
function ErrorEnum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckEnum(stack, context, schema, value) || context.AddError({
    keyword: "enum",
    schemaPath,
    instancePath,
    params: { allowedValues: schema.enum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/exclusiveMaximum.mjs
function CheckExclusiveMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessThan(value, schema.exclusiveMaximum);
}
function ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMaximum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMaximum",
    schemaPath,
    instancePath,
    params: { comparison: "<", limit: schema.exclusiveMaximum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/exclusiveMinimum.mjs
function CheckExclusiveMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterThan(value, schema.exclusiveMinimum);
}
function ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMinimum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMinimum",
    schemaPath,
    instancePath,
    params: { comparison: ">", limit: schema.exclusiveMinimum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/format.mjs
var format_exports = {};
__export(format_exports, {
  Clear: () => Clear,
  Entries: () => Entries2,
  Get: () => Get3,
  Has: () => Has,
  IsDate: () => IsDate2,
  IsDateTime: () => IsDateTime,
  IsDuration: () => IsDuration,
  IsEmail: () => IsEmail,
  IsHostname: () => IsHostname,
  IsIPv4: () => IsIPv4,
  IsIPv6: () => IsIPv6,
  IsIdnEmail: () => IsIdnEmail,
  IsIdnHostname: () => IsIdnHostname,
  IsIri: () => IsIri,
  IsIriReference: () => IsIriReference,
  IsJsonPointer: () => IsJsonPointer,
  IsJsonPointerUriFragment: () => IsJsonPointerUriFragment,
  IsRegex: () => IsRegex,
  IsRelativeJsonPointer: () => IsRelativeJsonPointer,
  IsTime: () => IsTime,
  IsUri: () => IsUri,
  IsUriReference: () => IsUriReference,
  IsUriTemplate: () => IsUriTemplate,
  IsUrl: () => IsUrl,
  IsUuid: () => IsUuid,
  Reset: () => Reset2,
  Set: () => Set3,
  Test: () => Test
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/date.mjs
var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
function IsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function IsDate2(value) {
  const matches = DATE.exec(value);
  if (!matches)
    return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && IsLeapYear(year) ? 29 : DAYS[month]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/time.mjs
var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(?:Z|([+-])(\d\d):(\d\d))?$/i;
function IsTime(value, strictTimeZone = true) {
  const matches = TIME.exec(value);
  if (!matches)
    return false;
  const hr = +matches[1];
  const min = +matches[2];
  const sec = +matches[3];
  const tzSign = matches[4] === "-" ? -1 : 1;
  const tzH = +(matches[5] || 0);
  const tzM = +(matches[6] || 0);
  if (tzH > 23 || tzM > 59)
    return false;
  if (strictTimeZone && !matches[4] && value.toLowerCase().indexOf("z") === -1) {
    return false;
  }
  if (hr <= 23 && min <= 59 && sec < 60)
    return true;
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/date_time.mjs
function IsDateTime(value, strictTimeZone = true) {
  const dateTime = value.split(/T/i);
  return dateTime.length === 2 && IsDate2(dateTime[0]) && IsTime(dateTime[1], strictTimeZone);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/duration.mjs
var Duration = /^P((\d+Y(\d+M(\d+D)?)?|\d+M(\d+D)?|\d+D)(T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S))?|T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S)|\d+W)$/;
function IsDuration(value) {
  return Duration.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/email.mjs
var Email = /^(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
function IsEmail(value) {
  return Email.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/_puny.mjs
var PUNYCODE_BASE = 36;
var PUNYCODE_TMIN = 1;
var PUNYCODE_TMAX = 26;
var PUNYCODE_SKEW = 38;
var PUNYCODE_DAMP = 700;
var PUNYCODE_INITIAL_BIAS = 72;
var PUNYCODE_INITIAL_N = 128;
function Adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > (PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX >> 1) {
    delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return k + Math.floor((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta / (delta + PUNYCODE_SKEW));
}
function Decode2(value) {
  const output = [];
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  const delimIdx = value.lastIndexOf("-");
  if (delimIdx > 0) {
    for (let j = 0; j < delimIdx; j++) {
      const cp = value.charCodeAt(j);
      if (cp >= 128)
        throw new Error("Invalid punycode: non-basic before delimiter");
      output.push(cp);
    }
  }
  let inIdx = delimIdx < 0 ? 0 : delimIdx + 1;
  while (inIdx < value.length) {
    const oldi = i;
    let w = 1;
    let k = PUNYCODE_BASE;
    while (true) {
      if (inIdx >= value.length)
        throw new Error("Invalid punycode: unexpected end of input");
      const ch = value.charCodeAt(inIdx++);
      let digit;
      if (ch >= 97 && ch <= 122)
        digit = ch - 97;
      else if (ch >= 48 && ch <= 57)
        digit = ch - 48 + 26;
      else if (ch >= 65 && ch <= 90)
        Unreachable();
      else
        throw new Error("Invalid punycode: bad digit character");
      i += digit * w;
      const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
      if (digit < t)
        break;
      w *= PUNYCODE_BASE - t;
      k += PUNYCODE_BASE;
    }
    const outLen = output.length + 1;
    bias = Adapt(i - oldi, outLen, oldi === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i, 0, n);
    i++;
  }
  return globalThis.String.fromCodePoint(...output);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/_idna.mjs
function IsNonspacingMark(cp) {
  return new RegExp("\\p{Mn}", "u").test(String.fromCodePoint(cp));
}
function IsSpacingCombiningMark(cp) {
  return new RegExp("\\p{Mc}", "u").test(String.fromCodePoint(cp));
}
function IsEnclosingMark(cp) {
  return new RegExp("\\p{Me}", "u").test(String.fromCodePoint(cp));
}
function IsCombiningMark2(cp) {
  return IsNonspacingMark(cp) || IsSpacingCombiningMark(cp) || IsEnclosingMark(cp);
}
var RFC5892_DISALLOWED = /* @__PURE__ */ new Set([
  1600,
  // ARABIC TATWEEL
  2042,
  // NKO LAJANYALAN
  12334,
  // HANGUL SINGLE DOT TONE MARK
  12335,
  // HANGUL DOUBLE DOT TONE MARK
  12337,
  // VERTICAL KANA REPEAT MARK
  12338,
  // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK
  12339,
  // VERTICAL KANA REPEAT MARK UPPER HALF
  12340,
  // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK UPPER HALF
  12341,
  // VERTICAL KANA REPEAT MARK LOWER HALF
  12347
  // VERTICAL IDEOGRAPHIC ITERATION MARK
]);
var VIRAMA_CPS = /* @__PURE__ */ new Set([
  2381,
  2509,
  2637,
  2765,
  2893,
  3021,
  3149,
  3277,
  3387,
  3388,
  3405,
  3530,
  6980,
  7082,
  7083,
  43456,
  69702,
  69759,
  69817,
  69939,
  69940,
  70080,
  70197,
  70477,
  70722,
  70850,
  71103,
  71231,
  71350,
  72767,
  73028,
  73029
]);
function IsGreek(cp) {
  return new RegExp("\\p{Script=Greek}", "u").test(String.fromCodePoint(cp));
}
function IsHebrew(cp) {
  return new RegExp("\\p{Script=Hebrew}", "u").test(String.fromCodePoint(cp));
}
function IsHiragana(cp) {
  return new RegExp("\\p{Script=Hiragana}", "u").test(String.fromCodePoint(cp));
}
function IsKatakana(cp) {
  return new RegExp("\\p{Script=Katakana}", "u").test(String.fromCodePoint(cp));
}
function IsHan(cp) {
  return new RegExp("\\p{Script=Han}", "u").test(String.fromCodePoint(cp));
}
function IsArabicIndicDigit(cp) {
  return cp >= 1632 && cp <= 1641;
}
function IsExtendedArabicIndicDigit(cp) {
  return cp >= 1776 && cp <= 1785;
}
function IsVirama(cp) {
  return VIRAMA_CPS.has(cp);
}
function IsUnicodeLabel(value) {
  if (value.length === 0)
    return Unreachable();
  const cps = [...value].map((c) => c.codePointAt(0));
  const len = cps.length;
  if (cps[0] === 45 || cps[len - 1] === 45)
    return false;
  if (len >= 4 && cps[2] === 45 && cps[3] === 45)
    return false;
  if (IsCombiningMark2(cps[0]))
    return false;
  let hasJapanese = false;
  let hasArabicIndic = false;
  let hasExtendedArabicIndic = false;
  for (let i = 0; i < len; i++) {
    const cp = cps[i];
    if (RFC5892_DISALLOWED.has(cp))
      return false;
    if (IsHiragana(cp) || IsKatakana(cp) || IsHan(cp))
      hasJapanese = true;
    if (IsArabicIndicDigit(cp))
      hasArabicIndic = true;
    if (IsExtendedArabicIndicDigit(cp))
      hasExtendedArabicIndic = true;
    const prev = cps[i - 1], next = cps[i + 1];
    switch (cp) {
      case 183:
        if (prev !== 108 || next !== 108)
          return false;
        break;
      // MIDDLE DOT (Catalan)
      case 885:
        if (next === void 0 || !IsGreek(next))
          return false;
        break;
      // Greek KERAIA
      case 1523:
      case 1524:
        if (prev === void 0 || !IsHebrew(prev))
          return false;
        break;
      // Hebrew GERESH
      case 8204:
        if (prev === void 0 || prev < 128 && !IsVirama(prev))
          return false;
        break;
      case 8205:
        if (prev === void 0 || !IsVirama(prev))
          return false;
        break;
      case 12539:
        break;
    }
  }
  if (value.includes("・") && !hasJapanese)
    return false;
  if (hasArabicIndic && hasExtendedArabicIndic)
    return false;
  return true;
}
function IsAsciiLabel(value) {
  if (value.charCodeAt(0) === 45 || value.charCodeAt(value.length - 1) === 45)
    return false;
  if (value.length >= 4 && value.charCodeAt(2) === 45 && value.charCodeAt(3) === 45)
    return false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (!(ch >= 97 && ch <= 122 || // a-z
    ch >= 65 && ch <= 90 || // A-Z
    ch >= 48 && ch <= 57 || // 0-9
    ch === 45))
      return false;
  }
  return true;
}
function IsPuny(value) {
  return value.toLowerCase().startsWith("xn--");
}
function IsPunyLabel(value) {
  try {
    const payload = value.slice(4).toLowerCase();
    const lastHyphen = payload.lastIndexOf("-");
    if (lastHyphen === 0) {
      return false;
    }
    const decoded = Decode2(payload);
    if (!decoded)
      return false;
    return IsUnicodeLabel(decoded);
  } catch {
    return false;
  }
}
function IsIdnLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsUnicodeLabel(value);
}
function IsLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsAsciiLabel(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/hostname.mjs
function IsHostname(value) {
  if (value.length === 0 || value.length > 253)
    return false;
  if (value.charCodeAt(value.length - 1) === 46)
    return false;
  for (const label of value.split(".")) {
    if (!IsLabel(label))
      return false;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/idn_email.mjs
var IdnEmail = /^(?!.*\.\.)[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)*$/iu;
function IsIdnEmail(value) {
  return IdnEmail.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/idn_hostname.mjs
function IsIdnHostname(value) {
  if (value.length === 0 || value.includes(" "))
    return false;
  const canonical = value.normalize("NFC").replace(/[\u002E\u3002\uFF0E\uFF61]/g, ".");
  if (canonical.length > 253)
    return false;
  for (const label of canonical.split(".")) {
    if (!IsIdnLabel(label))
      return false;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/ipv4.mjs
function IsIPv4Internal(value, start, end) {
  let dots = 0;
  let num = 0;
  let digits = 0;
  let leading = 0;
  for (let i = start; i < end; i++) {
    const ch = value.charCodeAt(i);
    if (ch === 46) {
      if (digits === 0 || num > 255 || leading === 48 && digits > 1)
        return false;
      dots++;
      num = 0;
      digits = 0;
      leading = 0;
    } else if (ch >= 48 && ch <= 57) {
      if (digits === 0)
        leading = ch;
      num = num * 10 + (ch - 48);
      digits++;
    } else {
      return false;
    }
  }
  return dots === 3 && digits > 0 && num <= 255 && !(leading === 48 && digits > 1);
}
function IsIPv4(value) {
  return IsIPv4Internal(value, 0, value.length);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/ipv6.mjs
function InRange(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsIPv6(value) {
  const length = value.length;
  if (length === 0)
    return false;
  let groups = 0;
  let compressed = false;
  let i = 0;
  if (value.charCodeAt(0) === 58 && value.charCodeAt(1) === 58) {
    if (length === 2)
      return true;
    compressed = true;
    i = 2;
  }
  while (i < length) {
    let digits = 0;
    const start = i;
    while (i < length && InRange(value.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (digits === 0)
      return false;
    const next = value.charCodeAt(i);
    if (next === 46) {
      if (!IsIPv4Internal(value, start, length))
        return false;
      groups += 2;
      i = length;
      break;
    }
    if (digits > 4)
      return false;
    groups++;
    if (i === length)
      break;
    if (next !== 58)
      return false;
    i++;
    if (value.charCodeAt(i) === 58) {
      if (compressed)
        return false;
      if (value.charCodeAt(i + 1) === 58)
        return false;
      compressed = true;
      i++;
      if (i === length)
        break;
    }
  }
  return compressed ? groups <= 7 : groups === 8;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/iri_reference.mjs
function TryUrl(value) {
  try {
    new URL(value, "http://example.com");
    return true;
  } catch {
    return false;
  }
}
function IsIriReference(value) {
  if (value.includes(" ")) {
    return false;
  }
  if (value.includes("\\")) {
    return false;
  }
  if (/[\x00-\x1F\x7F]/.test(value)) {
    return false;
  }
  if (/%(?![0-9a-fA-F]{2})/.test(value)) {
    return false;
  }
  if (value === "") {
    return true;
  }
  const colonIndex = value.indexOf(":");
  const hasValidSchemePrefix = colonIndex > 0 && // Colon must not be at the very beginning (e.g., ":foo")
  /^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(value.substring(0, colonIndex));
  if (hasValidSchemePrefix) {
    return TryUrl(value);
  } else {
    const looksLikeMalformedSchemeAndAuthority = value.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*)(\/\/)/);
    if (looksLikeMalformedSchemeAndAuthority && colonIndex === -1) {
      return false;
    }
    return TryUrl(value);
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/iri.mjs
function IsIri(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/json_pointer_uri_fragment.mjs
var JsonPointerUriFragment = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
function IsJsonPointerUriFragment(value) {
  return JsonPointerUriFragment.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/json_pointer.mjs
var JsonPointer = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
function IsJsonPointer(value) {
  return JsonPointer.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/regex.mjs
function IsRegex(value) {
  if (value.length === 0) {
    return false;
  }
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/relative_json_pointer.mjs
var RelativeJsonPointer = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
function IsRelativeJsonPointer(value) {
  return RelativeJsonPointer.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uri_reference.mjs
var UriReference = /^(?!.*[^\x00-\x7F])(?!.*\\)(?:(?:[a-z][a-z0-9+\-.]*:)?(?:\/\/[^\s[\]{}<>^`|]*)?|[^\s[\]{}<>^`|]*)(?:\?[^\s[\]{}<>^`|]*)?(?:#[^\s[\]{}<>^`|]*)?$/i;
function IsUriReference(value) {
  return UriReference.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uri_template.mjs
var UriTemplate = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
function IsUriTemplate(value) {
  return UriTemplate.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uri.mjs
function IsAlpha(ch) {
  return ch >= 97 && ch <= 122 || ch >= 65 && ch <= 90;
}
function IsAlphaNumeric(ch) {
  return IsAlpha(ch) || ch >= 48 && ch <= 57;
}
function IsHex(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsSchemeChar(ch) {
  return IsAlphaNumeric(ch) || ch === 43 || ch === 45 || ch === 46;
}
function IsUnreserved(ch) {
  return IsAlphaNumeric(ch) || ch === 45 || ch === 46 || // '-', '.'
  ch === 95 || ch === 126;
}
function IsSubDelim(ch) {
  return ch === 33 || ch === 36 || ch === 38 || ch === 39 || ch === 40 || ch === 41 || ch === 42 || ch === 43 || ch === 44 || ch === 59 || ch === 61;
}
function IsPchar(ch) {
  return IsUnreserved(ch) || IsSubDelim(ch) || ch === 58 || ch === 64;
}
function IsUri(value) {
  const length = value.length;
  if (length === 0)
    return false;
  if (!IsAlpha(value.charCodeAt(0)))
    return false;
  let i = 1;
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 58)
      break;
    if (!IsSchemeChar(ch))
      return false;
    i++;
  }
  if (value.charCodeAt(i) !== 58)
    return false;
  i++;
  if (value.charCodeAt(i) === 47 && value.charCodeAt(i + 1) === 47) {
    i += 2;
    const authorityStart = i;
    let atPos = -1;
    for (let j = i; j < length; j++) {
      const ch = value.charCodeAt(j);
      if (ch === 64) {
        atPos = j;
        break;
      }
      if (ch === 47 || ch === 63 || ch === 35)
        break;
    }
    if (atPos !== -1) {
      for (let j = authorityStart; j < atPos; j++) {
        const ch = value.charCodeAt(j);
        if (ch === 91 || ch === 93)
          return false;
        if (ch === 37) {
          if (j + 2 >= atPos || !IsHex(value.charCodeAt(j + 1)) || !IsHex(value.charCodeAt(j + 2)))
            return false;
          j += 2;
        } else if (!IsUnreserved(ch) && !IsSubDelim(ch) && ch !== 58)
          return false;
      }
      i = atPos + 1;
    }
    if (value.charCodeAt(i) === 91) {
      i++;
      while (i < length && value.charCodeAt(i) !== 93)
        i++;
      if (value.charCodeAt(i) !== 93)
        return false;
      i++;
    } else {
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35 || ch === 58)
          break;
        if (ch < 128 && !IsUnreserved(ch) && !IsSubDelim(ch))
          return false;
        i++;
      }
    }
    if (value.charCodeAt(i) === 58) {
      i++;
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35)
          break;
        if (ch < 48 || ch > 57)
          return false;
        i++;
      }
    }
  }
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 37) {
      if (i + 2 >= length || !IsHex(value.charCodeAt(i + 1)) || !IsHex(value.charCodeAt(i + 2)))
        return false;
      i += 2;
    } else if (ch > 127) {
      return false;
    } else if (!(IsPchar(ch) || ch === 47 || ch === 63 || ch === 35)) {
      return false;
    }
    i++;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/url.mjs
var Url = /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
function IsUrl(value) {
  return Url.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uuid.mjs
var Uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function IsUuid(value) {
  return Uuid.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/_registry.mjs
var formats = /* @__PURE__ */ new Map();
function Clear() {
  formats.clear();
}
function Entries2() {
  return [...formats.entries()];
}
function Set3(format, check) {
  formats.set(format, check);
}
function Has(format) {
  return formats.has(format);
}
function Get3(format) {
  return formats.get(format);
}
function Test(format, value) {
  return formats.get(format)?.(value) ?? true;
}
function Reset2() {
  Clear();
  formats.set("date-time", IsDateTime);
  formats.set("date", IsDate2);
  formats.set("duration", IsDuration);
  formats.set("email", IsEmail);
  formats.set("hostname", IsHostname);
  formats.set("idn-email", IsIdnEmail);
  formats.set("idn-hostname", IsIdnHostname);
  formats.set("ipv4", IsIPv4);
  formats.set("ipv6", IsIPv6);
  formats.set("iri-reference", IsIriReference);
  formats.set("iri", IsIri);
  formats.set("json-pointer-uri-fragment", IsJsonPointerUriFragment);
  formats.set("json-pointer", IsJsonPointer);
  formats.set("regex", IsRegex);
  formats.set("relative-json-pointer", IsRelativeJsonPointer);
  formats.set("time", IsTime);
  formats.set("uri-reference", IsUriReference);
  formats.set("uri-template", IsUriTemplate);
  formats.set("uri", IsUri);
  formats.set("url", IsUrl);
  formats.set("uuid", IsUuid);
}
Reset2();

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/format.mjs
function CheckFormat(_stack, _context, schema, value) {
  return format_exports.Test(schema.format, value);
}
function ErrorFormat(stack, context, schemaPath, instancePath, schema, value) {
  return CheckFormat(stack, context, schema, value) || context.AddError({
    keyword: "format",
    schemaPath,
    instancePath,
    params: { format: schema.format }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/if.mjs
function CheckIf(stack, context, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  return CheckSchema(stack, context, schema.if, value) ? CheckSchema(stack, context, thenSchema, value) : CheckSchema(stack, context, elseSchema, value);
}
function ErrorIf(stack, context, schemaPath, instancePath, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  const trueContext = new AccumulatedErrorContext();
  const isIf = ErrorSchema(stack, trueContext, `${schemaPath}/if`, instancePath, schema.if, value) ? ErrorSchema(stack, trueContext, `${schemaPath}/then`, instancePath, thenSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "then" }
  }) : ErrorSchema(stack, context, `${schemaPath}/else`, instancePath, elseSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "else" }
  });
  if (isIf)
    context.Merge([trueContext]);
  return isIf;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/items.mjs
function CheckItemsSized(stack, context, schema, value) {
  return guard_exports.Every(schema.items, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema.items, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/items/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}
function CheckItemsUnsized(stack, context, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.Every(value, offset, (element, index) => {
    return CheckSchemaPushStack(stack, context, schema.items, element) && context.AddIndex(index);
  });
}
function ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.EveryAll(value, offset, (element, index) => {
    const nextSchemaPath = `${schemaPath}/items`;
    const nextInstancePath = `${instancePath}/${index}`;
    return ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.items, element) && context.AddIndex(index);
  });
}
function CheckItems(stack, context, schema, value) {
  return IsItemsSized(schema) ? CheckItemsSized(stack, context, schema, value) : CheckItemsUnsized(stack, context, schema, value);
}
function ErrorItems(stack, context, schemaPath, instancePath, schema, value) {
  return IsItemsSized(schema) ? ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) : ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxContains.mjs
function IsValid3(schema) {
  return IsContains(schema);
}
function CheckMaxContains(stack, context, schema, value) {
  if (!IsValid3(schema))
    return true;
  const count = guard_exports.Counted(value, (item) => CheckSchema(stack, context, schema.contains, item));
  return guard_exports.IsLessEqualThan(count, schema.maxContains);
}
function ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value) {
  const minContains = IsMinContains(schema) ? schema.minContains : 1;
  return CheckMaxContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains, maxContains: schema.maxContains }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maximum.mjs
function CheckMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value, schema.maximum);
}
function ErrorMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaximum(stack, context, schema, value) || context.AddError({
    keyword: "maximum",
    schemaPath,
    instancePath,
    params: { comparison: "<=", limit: schema.maximum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxItems.mjs
function CheckMaxItems(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value.length, schema.maxItems);
}
function ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxItems(stack, context, schema, value) || context.AddError({
    keyword: "maxItems",
    schemaPath,
    instancePath,
    params: { limit: schema.maxItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxLength.mjs
function CheckMaxLength(_stack, _context, schema, value) {
  return guard_exports.IsMaxLength(value, schema.maxLength);
}
function ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxLength(stack, context, schema, value) || context.AddError({
    keyword: "maxLength",
    schemaPath,
    instancePath,
    params: { limit: schema.maxLength }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxProperties.mjs
function CheckMaxProperties(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(guard_exports.Keys(value).length, schema.maxProperties);
}
function ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxProperties(stack, context, schema, value) || context.AddError({
    keyword: "maxProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.maxProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minContains.mjs
function IsValid4(schema) {
  return IsContains(schema);
}
function CheckMinContains(stack, context, schema, value) {
  if (!IsValid4(schema))
    return true;
  const count = guard_exports.Counted(value, (item, index) => CheckSchema(stack, context, schema.contains, item) && context.AddIndex(index));
  return guard_exports.IsGreaterEqualThan(count, schema.minContains);
}
function ErrorMinContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: schema.minContains }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minimum.mjs
function CheckMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value, schema.minimum);
}
function ErrorMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinimum(stack, context, schema, value) || context.AddError({
    keyword: "minimum",
    schemaPath,
    instancePath,
    params: { comparison: ">=", limit: schema.minimum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minItems.mjs
function CheckMinItems(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value.length, schema.minItems);
}
function ErrorMinItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinItems(stack, context, schema, value) || context.AddError({
    keyword: "minItems",
    schemaPath,
    instancePath,
    params: { limit: schema.minItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minLength.mjs
function CheckMinLength(_stack, _context, schema, value) {
  return guard_exports.IsMinLength(value, schema.minLength);
}
function ErrorMinLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinLength(stack, context, schema, value) || context.AddError({
    keyword: "minLength",
    schemaPath,
    instancePath,
    params: { limit: schema.minLength }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minProperties.mjs
function CheckMinProperties(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(guard_exports.Keys(value).length, schema.minProperties);
}
function ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinProperties(stack, context, schema, value) || context.AddError({
    keyword: "minProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.minProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/multipleOf.mjs
function CheckMultipleOf(_stack, _context, schema, value) {
  return guard_exports.IsMultipleOf(value, schema.multipleOf);
}
function ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMultipleOf(stack, context, schema, value) || context.AddError({
    keyword: "multipleOf",
    schemaPath,
    instancePath,
    params: { multipleOf: schema.multipleOf }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/not.mjs
function CheckNot(stack, context, schema, value) {
  const nextContext = new CheckContext();
  const isSchema = !CheckSchema(stack, nextContext, schema.not, value);
  const isNot = isSchema && context.Merge([nextContext]);
  return isNot;
}
function ErrorNot(stack, context, schemaPath, instancePath, schema, value) {
  return CheckNot(stack, context, schema, value) || context.AddError({
    keyword: "not",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/oneOf.mjs
function CheckOneOf(stack, context, schema, value) {
  const passedContexts = schema.oneOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
}
function ErrorOneOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const passingSchemas = [];
  const passedContexts = schema.oneOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/oneOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (isSchema)
      passingSchemas.push(index);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isOneOf = guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
  if (!isOneOf && guard_exports.IsEqual(passingSchemas.length, 0))
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isOneOf || context.AddError({
    keyword: "oneOf",
    schemaPath,
    instancePath,
    params: { passingSchemas }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/pattern.mjs
function CheckPattern(_stack, _context, schema, value) {
  const regexp = guard_exports.IsString(schema.pattern) ? new RegExp(schema.pattern, "u") : schema.pattern;
  return regexp.test(value);
}
function ErrorPattern(stack, context, schemaPath, instancePath, schema, value) {
  return CheckPattern(stack, context, schema, value) || context.AddError({
    keyword: "pattern",
    schemaPath,
    instancePath,
    params: { pattern: schema.pattern }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/patternProperties.mjs
function CheckPatternProperties(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const regexp = new RegExp(pattern, "u");
    return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
      return !regexp.test(key) || CheckSchemaPushStack(stack, context, schema2, prop) && context.AddKey(key);
    });
  });
}
function ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const nextSchemaPath = `${schemaPath}/patternProperties/${pattern}`;
    const regexp = new RegExp(pattern, "u");
    return guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, value2]) => {
      const nextInstancePath = `${instancePath}/${key}`;
      const notKey = !regexp.test(key);
      return notKey || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value2) && context.AddKey(key);
    });
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/prefixItems.mjs
function CheckPrefixItems(stack, context, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.Every(schema.prefixItems, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.EveryAll(schema.prefixItems, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/prefixItems/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_exact_optional.mjs
function IsExactOptional(required, key) {
  return required.includes(key) || settings_exports.Get().exactOptionalPropertyTypes;
}
function InexactOptionalCheck(value, key) {
  return guard_exports.IsUndefined(value[key]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/properties.mjs
function CheckProperties(stack, context, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.Every(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const isProperty = !guard_exports.HasPropertyKey(value, key) || CheckSchemaPushStack(stack, context, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty : InexactOptionalCheck(value, key) || isProperty;
  });
  return isProperties;
}
function ErrorProperties(stack, context, schemaPath, instancePath, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.EveryAll(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/properties/${key}`;
    const nextInstancePath = `${instancePath}/${key}`;
    const isProperty = () => !guard_exports.HasPropertyKey(value, key) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty() : InexactOptionalCheck(value, key) || isProperty();
  });
  return isProperties;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/propertyNames.mjs
function CheckPropertyNames(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => CheckSchema(stack, context, schema.propertyNames, key));
}
function ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value) {
  const propertyNames = [];
  const isPropertyNames = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextInstancePath = `${instancePath}/${key}`;
    const nextSchemaPath = `${schemaPath}/propertyNames`;
    const nextContext = new AccumulatedErrorContext();
    const isPropertyName = ErrorSchema(stack, nextContext, nextSchemaPath, nextInstancePath, schema.propertyNames, key);
    if (!isPropertyName)
      propertyNames.push(key);
    return isPropertyName;
  });
  return isPropertyNames || context.AddError({
    keyword: "propertyNames",
    schemaPath,
    instancePath,
    params: { propertyNames }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/recursiveRef.mjs
function CheckRecursiveRef(stack, context, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema2(target) && CheckSchema(stack, context, target, value);
}
function ErrorRecursiveRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/ref.mjs
function CheckRef(stack, context, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new CheckContext();
  const result = IsSchema2(target) && CheckSchema(stack, nextContext, target, value);
  if (result)
    context.Merge([nextContext]);
  return result;
}
function ErrorRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new AccumulatedErrorContext();
  const result = IsSchema2(target) && ErrorSchema(stack, nextContext, "#", instancePath, target, value);
  if (result)
    context.Merge([nextContext]);
  if (!result)
    nextContext.GetErrors().forEach((error) => context.AddError(error));
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/required.mjs
function CheckRequired(_stack, _context, schema, value) {
  return guard_exports.Every(schema.required, 0, (key) => guard_exports.HasPropertyKey(value, key));
}
function ErrorRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const requiredProperties = [];
  const isRequired = guard_exports.EveryAll(schema.required, 0, (key) => {
    const hasKey = guard_exports.HasPropertyKey(value, key);
    if (!hasKey)
      requiredProperties.push(key);
    return hasKey;
  });
  return isRequired || context.AddError({
    keyword: "required",
    schemaPath,
    instancePath,
    params: { requiredProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/type.mjs
function CheckTypeName(_stack, _context, type, _schema, value) {
  return (
    // jsonschema
    guard_exports.IsEqual(type, "object") ? guard_exports.IsObjectNotArray(value) : guard_exports.IsEqual(type, "array") ? guard_exports.IsArray(value) : guard_exports.IsEqual(type, "boolean") ? guard_exports.IsBoolean(value) : guard_exports.IsEqual(type, "integer") ? guard_exports.IsInteger(value) : guard_exports.IsEqual(type, "number") ? guard_exports.IsNumber(value) : guard_exports.IsEqual(type, "null") ? guard_exports.IsNull(value) : guard_exports.IsEqual(type, "string") ? guard_exports.IsString(value) : (
      // xschema
      guard_exports.IsEqual(type, "bigint") ? guard_exports.IsBigInt(value) : guard_exports.IsEqual(type, "constructor") ? guard_exports.IsConstructor(value) : guard_exports.IsEqual(type, "function") ? guard_exports.IsFunction(value) : guard_exports.IsEqual(type, "symbol") ? guard_exports.IsSymbol(value) : guard_exports.IsEqual(type, "undefined") ? guard_exports.IsUndefined(value) : guard_exports.IsEqual(type, "void") ? guard_exports.IsUndefined(value) : true
    )
  );
}
function CheckTypeNames(stack, context, types, schema, value) {
  return guard_exports.Some(types, (type) => CheckTypeName(stack, context, type, schema, value));
}
function CheckType(stack, context, schema, value) {
  return guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
}
function ErrorType(stack, context, schemaPath, instancePath, schema, value) {
  const isType = guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
  return isType || context.AddError({
    keyword: "type",
    schemaPath,
    instancePath,
    params: { type: schema.type }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/unevaluatedItems.mjs
function CheckUnevaluatedItems(stack, context, schema, value) {
  const indices = context.GetIndices();
  return guard_exports.Every(value, 0, (item, index) => {
    return (indices.has(index) || CheckSchema(stack, context, schema.unevaluatedItems, item)) && context.AddIndex(index);
  });
}
function ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value) {
  const indices = context.GetIndices();
  const unevaluatedItems = [];
  const isUnevaluatedItems = guard_exports.EveryAll(value, 0, (item, index) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedItem = (indices.has(index) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedItems, item)) && context.AddIndex(index);
    if (!isEvaluatedItem)
      unevaluatedItems.push(index);
    return isEvaluatedItem;
  });
  return isUnevaluatedItems || context.AddError({
    keyword: "unevaluatedItems",
    schemaPath,
    instancePath,
    params: { unevaluatedItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/unevaluatedProperties.mjs
function CheckUnevaluatedProperties(stack, context, schema, value) {
  const keys = context.GetKeys();
  return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
    return keys.has(key) || CheckSchema(stack, context, schema.unevaluatedProperties, prop) && context.AddKey(key);
  });
}
function ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value) {
  const keys = context.GetKeys();
  const unevaluatedProperties = [];
  const isUnevaluatedProperties = guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, prop]) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedProperty = keys.has(key) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedProperties, prop) && context.AddKey(key);
    if (!isEvaluatedProperty)
      unevaluatedProperties.push(key);
    return isEvaluatedProperty;
  });
  return isUnevaluatedProperties || context.AddError({
    keyword: "unevaluatedProperties",
    schemaPath,
    instancePath,
    params: { unevaluatedProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/uniqueItems.mjs
function IsValid5(schema) {
  return !guard_exports.IsEqual(schema.uniqueItems, false);
}
function CheckUniqueItems(_stack, _context, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = new Set(value.map(hash_exports.Hash)).size;
  const isLength = value.length;
  return guard_exports.IsEqual(set, isLength);
}
function ErrorUniqueItems(_stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = /* @__PURE__ */ new Set();
  const duplicateItems = value.reduce((result, value2, index) => {
    const hash = hash_exports.Hash(value2);
    if (set.has(hash))
      return [...result, index];
    set.add(hash);
    return result;
  }, []);
  const isUniqueItems = guard_exports.IsEqual(duplicateItems.length, 0);
  return isUniqueItems || context.AddError({
    keyword: "uniqueItems",
    schemaPath,
    instancePath,
    params: { duplicateItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/schema.mjs
function CheckSchemaPushStack(stack, context, schema, value) {
  return context.Push() && CheckSchema(stack, context, schema, value) && context.Pop();
}
function CheckSchema(stack, context, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? CheckSchemaBoolean(stack, context, schema, value) : (!IsType(schema) || CheckType(stack, context, schema, value)) && (!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || (!IsRequired(schema) || CheckRequired(stack, context, schema, value)) && (!IsAdditionalProperties(schema) || CheckAdditionalProperties(stack, context, schema, value)) && (!IsDependencies(schema) || CheckDependencies(stack, context, schema, value)) && (!IsDependentRequired(schema) || CheckDependentRequired(stack, context, schema, value)) && (!IsDependentSchemas(schema) || CheckDependentSchemas(stack, context, schema, value)) && (!IsPatternProperties(schema) || CheckPatternProperties(stack, context, schema, value)) && (!IsProperties(schema) || CheckProperties(stack, context, schema, value)) && (!IsPropertyNames(schema) || CheckPropertyNames(stack, context, schema, value)) && (!IsMinProperties(schema) || CheckMinProperties(stack, context, schema, value)) && (!IsMaxProperties(schema) || CheckMaxProperties(stack, context, schema, value))) && (!guard_exports.IsArray(value) || (!IsAdditionalItems(schema) || CheckAdditionalItems(stack, context, schema, value)) && (!IsContains(schema) || CheckContains(stack, context, schema, value)) && (!IsItems(schema) || CheckItems(stack, context, schema, value)) && (!IsMaxContains(schema) || CheckMaxContains(stack, context, schema, value)) && (!IsMaxItems(schema) || CheckMaxItems(stack, context, schema, value)) && (!IsMinContains(schema) || CheckMinContains(stack, context, schema, value)) && (!IsMinItems(schema) || CheckMinItems(stack, context, schema, value)) && (!IsPrefixItems(schema) || CheckPrefixItems(stack, context, schema, value)) && (!IsUniqueItems(schema) || CheckUniqueItems(stack, context, schema, value))) && (!guard_exports.IsString(value) || (!IsMaxLength3(schema) || CheckMaxLength(stack, context, schema, value)) && (!IsMinLength3(schema) || CheckMinLength(stack, context, schema, value)) && (!IsFormat(schema) || CheckFormat(stack, context, schema, value)) && (!IsPattern(schema) || CheckPattern(stack, context, schema, value))) && (!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || (!IsExclusiveMaximum(schema) || CheckExclusiveMaximum(stack, context, schema, value)) && (!IsExclusiveMinimum(schema) || CheckExclusiveMinimum(stack, context, schema, value)) && (!IsMaximum(schema) || CheckMaximum(stack, context, schema, value)) && (!IsMinimum(schema) || CheckMinimum(stack, context, schema, value)) && (!IsMultipleOf2(schema) || CheckMultipleOf(stack, context, schema, value))) && (!IsRef2(schema) || CheckRef(stack, context, schema, value)) && (!IsRecursiveRef(schema) || CheckRecursiveRef(stack, context, schema, value)) && (!IsDynamicRef(schema) || CheckDynamicRef(stack, context, schema, value)) && (!IsConst(schema) || CheckConst(stack, context, schema, value)) && (!IsEnum2(schema) || CheckEnum(stack, context, schema, value)) && (!IsIf(schema) || CheckIf(stack, context, schema, value)) && (!IsNot(schema) || CheckNot(stack, context, schema, value)) && (!IsAllOf(schema) || CheckAllOf(stack, context, schema, value)) && (!IsAnyOf(schema) || CheckAnyOf(stack, context, schema, value)) && (!IsOneOf(schema) || CheckOneOf(stack, context, schema, value)) && (!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || CheckUnevaluatedItems(stack, context, schema, value))) && (!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || CheckUnevaluatedProperties(stack, context, schema, value))) && (!IsRefine2(schema) || CheckRefine(stack, context, schema, value));
  stack.Pop(schema);
  return result;
}
function ErrorSchemaPushStack(stack, context, schemaPath, instancePath, schema, value) {
  return context.Push() && ErrorSchema(stack, context, schemaPath, instancePath, schema, value) && context.Pop();
}
function ErrorSchema(stack, context, schemaPath, instancePath, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) : !!(+(!IsType(schema) || ErrorType(stack, context, schemaPath, instancePath, schema, value)) & +(!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || !!(+(!IsRequired(schema) || ErrorRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAdditionalProperties(schema) || ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependencies(schema) || ErrorDependencies(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentRequired(schema) || ErrorDependentRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentSchemas(schema) || ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPatternProperties(schema) || ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsProperties(schema) || ErrorProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPropertyNames(schema) || ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinProperties(schema) || ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxProperties(schema) || ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsArray(value) || !!(+(!IsAdditionalItems(schema) || ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsContains(schema) || ErrorContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsItems(schema) || ErrorItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxContains(schema) || ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxItems(schema) || ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinContains(schema) || ErrorMinContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinItems(schema) || ErrorMinItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPrefixItems(schema) || ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUniqueItems(schema) || ErrorUniqueItems(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsString(value) || !!(+(!IsMaxLength3(schema) || ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinLength3(schema) || ErrorMinLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsFormat(schema) || ErrorFormat(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPattern(schema) || ErrorPattern(stack, context, schemaPath, instancePath, schema, value)))) & +(!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || !!(+(!IsExclusiveMaximum(schema) || ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsExclusiveMinimum(schema) || ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaximum(schema) || ErrorMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinimum(schema) || ErrorMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMultipleOf2(schema) || ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value)))) & +(!IsRef2(schema) || ErrorRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsRecursiveRef(schema) || ErrorRecursiveRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDynamicRef(schema) || ErrorDynamicRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsConst(schema) || ErrorConst(stack, context, schemaPath, instancePath, schema, value)) & +(!IsEnum2(schema) || ErrorEnum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsIf(schema) || ErrorIf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsNot(schema) || ErrorNot(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAllOf(schema) || ErrorAllOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAnyOf(schema) || ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsOneOf(schema) || ErrorOneOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value))) & +(!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value)))) && (!IsRefine2(schema) || ErrorRefine(stack, context, schemaPath, instancePath, schema, value));
  stack.Pop(schema);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/resolve/resolve.mjs
var resolve_exports = {};
__export(resolve_exports, {
  DynamicRef: () => DynamicRef,
  Ref: () => Ref2
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/pointer/pointer.mjs
var pointer_exports = {};
__export(pointer_exports, {
  Delete: () => Delete,
  Get: () => Get4,
  Has: () => Has2,
  Indices: () => Indices,
  Set: () => Set4
});
function AssertNotRoot(indices) {
  if (indices.length === 0)
    throw Error("Cannot set root");
}
function AssertCanSet(value) {
  if (!guard_exports.IsObject(value))
    throw Error("Cannot set value");
}
function AssertIndex(index) {
  if (guard_exports.IsUnsafePropertyKey(index))
    throw Error("Pointer contains unsafe property key");
}
function AssertIndices(indices) {
  for (const index of indices)
    AssertIndex(index);
}
function IsNumericIndex(index) {
  return /^(0|[1-9]\d*)$/.test(index);
}
function TakeIndexRight(indices) {
  return [
    indices.slice(0, indices.length - 1),
    indices.slice(indices.length - 1)[0]
  ];
}
function HasIndex(index, value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, index);
}
function GetIndex(index, value) {
  return guard_exports.IsObject(value) && !guard_exports.IsUnsafePropertyKey(index) ? value[index] : void 0;
}
function GetIndices(indices, value) {
  return indices.reduce((value2, index) => GetIndex(index, value2), value);
}
function Indices(pointer) {
  if (guard_exports.IsEqual(pointer.length, 0))
    return [];
  const indices = pointer.split("/").map((index) => index.replace(/~1/g, "/").replace(/~0/g, "~"));
  return indices.length > 0 && indices[0] === "" ? indices.slice(1) : indices;
}
function Has2(value, pointer) {
  let current = value;
  return Indices(pointer).every((index) => {
    if (!HasIndex(index, current))
      return false;
    current = current[index];
    return true;
  });
}
function Get4(value, pointer) {
  const indices = Indices(pointer);
  return GetIndices(indices, value);
}
function Set4(value, pointer, next) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  parent[index] = next;
  return value;
}
function Delete(value, pointer) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  if (guard_exports.IsArray(parent) && IsNumericIndex(index)) {
    parent.splice(+index, 1);
  } else {
    delete parent[index];
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/resolve/ref.mjs
function MatchId(schema, base, ref) {
  if (schema.$id === ref.hash)
    return schema;
  const absoluteId = new URL(schema.$id, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  if (guard_exports.IsEqual(absoluteId.pathname, absoluteRef.pathname)) {
    return ref.hash.startsWith("#") ? MatchHash(schema, base, ref) : schema;
  }
  return void 0;
}
function MatchAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$anchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchDynamicAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$dynamicAnchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchHash(schema, _base, ref) {
  if (ref.href.endsWith("#"))
    return schema;
  if (!ref.hash.startsWith("#"))
    return void 0;
  const fragment = decodeURIComponent(ref.hash.slice(1));
  if (!fragment.startsWith("/"))
    return void 0;
  return pointer_exports.Get(schema, fragment);
}
function Match4(schema, base, ref) {
  if (IsId(schema)) {
    const result = MatchId(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsAnchor(schema)) {
    const result = MatchAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsDynamicAnchor(schema)) {
    const result = MatchDynamicAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  return MatchHash(schema, base, ref);
}
function FromArray6(schema, base, ref) {
  return schema.reduce((result, item) => {
    const match = FromValue3(item, base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromObject10(schema, base, ref) {
  return guard_exports.Keys(schema).reduce((result, key) => {
    const match = FromValue3(schema[key], base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromValue3(schema, base, ref) {
  const nextBase = IsSchemaObject(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
  if (IsSchemaObject(schema)) {
    const result = Match4(schema, nextBase, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (guard_exports.IsArray(schema))
    return FromArray6(schema, nextBase, ref);
  if (guard_exports.IsObject(schema))
    return FromObject10(schema, nextBase, ref);
  return void 0;
}
function Ref2(schema, ref) {
  const defaultBase = new URL("http://unknown/");
  const initialBase = IsId(schema) ? new URL(schema.$id, defaultBase.href) : defaultBase;
  const initialRef = new URL(ref, initialBase.href);
  return FromValue3(schema, initialBase, initialRef);
}
function DynamicRef(root, base, dynamicRef, dynamicAnchors) {
  const fragmentTarget = dynamicRef.$dynamicRef.startsWith("#") ? Ref2(base, dynamicRef.$dynamicRef) : Ref2(root, dynamicRef.$dynamicRef);
  if (guard_exports.IsUndefined(fragmentTarget))
    return void 0;
  if (!IsSchemaObject(fragmentTarget) || !IsDynamicAnchor(fragmentTarget))
    return fragmentTarget;
  const fragment = new URL(dynamicRef.$dynamicRef, "http://unknown/").hash;
  if (fragment.startsWith("#/"))
    return fragmentTarget;
  const anchorTarget = dynamicAnchors.find((anchor) => anchor.$dynamicAnchor === fragmentTarget.$dynamicAnchor);
  return anchorTarget ?? fragmentTarget;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_stack.mjs
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Stack_instances;
var _Stack_PushResourceAnchors;
var _Stack_PopResourceAnchors;
var _Stack_FromContext;
var _Stack_FromRef;
var Stack = class {
  constructor(context, schema) {
    _Stack_instances.add(this);
    this.context = context;
    this.schema = schema;
    this.ids = [];
    this.anchors = [];
    this.recursiveAnchors = [];
    this.dynamicAnchors = [];
  }
  // ----------------------------------------------------------------
  // Base
  // ----------------------------------------------------------------
  BaseURL() {
    return this.ids.reduce((result, schema) => new URL(schema.$id, result), new URL("http://unknown"));
  }
  Base() {
    return this.ids[this.ids.length - 1] ?? this.schema;
  }
  // ----------------------------------------------------------------
  // Stack
  // ----------------------------------------------------------------
  Push(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema)) {
      this.ids.push(schema);
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors).call(this, schema);
    }
    if (IsAnchor(schema))
      this.anchors.push(schema);
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.push(schema);
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.push(schema);
  }
  Pop(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema)) {
      this.ids.pop();
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors).call(this, schema);
    }
    if (IsAnchor(schema))
      this.anchors.pop();
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.pop();
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.pop();
  }
  Ref(ref) {
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromContext).call(this, ref) ?? __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromRef).call(this, ref);
  }
  // ----------------------------------------------------------------
  // RecursiveRef
  // ----------------------------------------------------------------
  RecursiveRef(recursiveRef) {
    return IsRecursiveAnchorTrue(this.Base()) ? resolve_exports.Ref(this.recursiveAnchors[0], recursiveRef.$recursiveRef) : resolve_exports.Ref(this.Base(), recursiveRef.$recursiveRef);
  }
  // ----------------------------------------------------------------
  // DynamicRef
  // ----------------------------------------------------------------
  DynamicRef(dynamicRef) {
    const root = this.schema;
    return resolve_exports.DynamicRef(root, this.Base(), dynamicRef, this.dynamicAnchors);
  }
};
_Stack_instances = /* @__PURE__ */ new WeakSet(), _Stack_PushResourceAnchors = function _Stack_PushResourceAnchors2(schema, isRoot = true) {
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.push(current);
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors2).call(this, current[key], false);
}, _Stack_PopResourceAnchors = function _Stack_PopResourceAnchors2(schema, isRoot = true) {
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.pop();
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors2).call(this, current[key], false);
}, _Stack_FromContext = function _Stack_FromContext2(ref) {
  return guard_exports.HasPropertyKey(this.context, ref.$ref) ? this.context[ref.$ref] : void 0;
}, _Stack_FromRef = function _Stack_FromRef2(ref) {
  const root = this.schema;
  return !ref.$ref.startsWith("#") ? resolve_exports.Ref(root, ref.$ref) : resolve_exports.Ref(this.Base(), ref.$ref);
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/errors.mjs
function Errors(...args) {
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const settings2 = settings_exports.Get();
  const locale2 = Get2();
  const errors = [];
  const stack = new Stack(context, schema);
  const errorContext = new ErrorContext((error) => {
    if (guard_exports.IsGreaterEqualThan(errors.length, settings2.maxErrors))
      return;
    return errors.push({ ...error, message: locale2(error) });
  });
  const result = ErrorSchema(stack, errorContext, "#", "", schema, value);
  return [result, errors];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/check.mjs
function Check(...args) {
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const stack = new Stack(context, schema);
  const checkContext = new CheckContext();
  return CheckSchema(stack, checkContext, schema, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/check/check.mjs
function Check2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Check(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/errors/errors.mjs
function Errors2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const [_, errors] = Errors(context, type, value);
  return errors;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/assert/assert.mjs
var AssertError = class extends Error {
  constructor(source, value, errors) {
    super(source);
    Object.defineProperty(this, "cause", {
      value: { source, errors, value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function Assert(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const check = Check2(context, type, value);
  if (!check)
    throw new AssertError("Assert", value, Errors2(context, type, value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_array.mjs
function FromArray7(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  return value.map((value2) => FromType19(context, type.items, value2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_cyclic.mjs
function FromCyclic6(context, type, value) {
  return FromType19({ ...context, ...type.$defs }, Ref(type.$ref), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_intersect.mjs
function EvaluateIntersection(context, type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "unevaluatedProperties") ? { additionalProperties: type.unevaluatedProperties } : {};
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return IsObject2(evaluated) ? With2(evaluated, additionalProperties) : evaluated;
}
function FromIntersect6(context, type, value) {
  const evaluated = EvaluateIntersection(context, type);
  return FromType19(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/additional.mjs
function GetAdditionalProperties(type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "additionalProperties") ? type.additionalProperties : void 0;
  return additionalProperties;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_object.mjs
function FromObject11(context, type, value) {
  if (!guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.HasPropertyKey(type.properties, key)) {
      value[key] = FromType19(context, type.properties[key], value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_record.mjs
function FromRecord3(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  const [recordPattern, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (recordPattern.test(key)) {
      value[key] = FromType19(context, recordValue, value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_ref.mjs
function FromRef5(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType19(context, context[type.$ref], value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_tuple.mjs
function FromTuple5(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const length = Math.min(value.length, schema.items.length);
  for (let index = 0; index < length; index++) {
    value[index] = FromType19(context, schema.items[index], value[index]);
  }
  return guard_exports.IsGreaterThan(value.length, length) ? value.slice(0, length) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clone/clone.mjs
function Clone2(value) {
  return Clone(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_union.mjs
function FromUnion9(context, type, value) {
  for (const schema of type.anyOf) {
    const clean = FromType19(context, schema, Clone2(value));
    if (Check2(context, schema, clean))
      return clean;
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_type.mjs
function FromType19(context, type, value) {
  return IsArray2(type) ? FromArray7(context, type, value) : IsCyclic(type) ? FromCyclic6(context, type, value) : IsIntersect(type) ? FromIntersect6(context, type, value) : IsObject2(type) ? FromObject11(context, type, value) : IsRecord(type) ? FromRecord3(context, type, value) : IsRef(type) ? FromRef5(context, type, value) : IsTuple(type) ? FromTuple5(context, type, value) : IsUnion(type) ? FromUnion9(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/shared/union_priority_sort.mjs
function Modifiers(type, next) {
  for (const key of guard_default.Keys(type)) {
    if (guard_default.HasPropertyKey(next, key))
      continue;
    next[key] = type[key];
  }
  return next;
}
function FromProperties4(properties) {
  const result = {};
  for (const key of guard_default.Keys(properties))
    result[key] = FromType20(properties[key]);
  return result;
}
function FromPriorityTypes(types) {
  return FromTypes6(Priority(types));
}
function FromTypes6(types) {
  return types.map((type) => FromType20(type));
}
function FromType20(type) {
  const next = IsArray2(type) ? _Array_(FromType20(type.items), ArrayOptions(type)) : IsIntersect(type) ? Intersect(FromTypes6(type.allOf)) : IsUnion(type) ? Union(FromPriorityTypes(type.anyOf)) : IsObject2(type) ? _Object_(FromProperties4(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType20(RecordValue(type))) : IsTuple(type) ? Tuple(FromTypes6(type.items)) : type;
  return Modifiers(type, next);
}
function UnionPrioritySort(type) {
  const result = FromType20(type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/clean.mjs
function Clean(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType19(context, sorted, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try.mjs
var try_exports = {};
__export(try_exports, {
  Fail: () => Fail,
  IsOk: () => IsOk,
  Ok: () => Ok,
  TryArray: () => TryArray,
  TryBigInt: () => TryBigInt,
  TryBoolean: () => TryBoolean,
  TryNull: () => TryNull,
  TryNumber: () => TryNumber,
  TryString: () => TryString,
  TryUndefined: () => TryUndefined
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_result.mjs
function IsOk(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "value");
}
function Ok(value) {
  return { value };
}
function Fail() {
  return void 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_array.mjs
function TryArray(value) {
  return guard_exports.IsArray(value) ? Ok(value) : Ok([value]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_bigint.mjs
function FromBoolean2(value) {
  return guard_exports.IsEqual(value, true) ? Ok(BigInt(1)) : Ok(BigInt(0));
}
var bigintPattern = /^-?(0|[1-9]\d*)n$/;
var decimalPattern = /^-?(0|[1-9]\d*)\.\d+$/;
var integerPattern = /^-?(0|[1-9]\d*)$/;
function IsStringBigIntLike(value) {
  return bigintPattern.test(value);
}
function IsStringDecimalLike(value) {
  return decimalPattern.test(value);
}
function IsStringIntegerLike(value) {
  return integerPattern.test(value);
}
function FromString2(value) {
  const lowercase = value.toLowerCase();
  return IsStringBigIntLike(value) ? Ok(BigInt(value.slice(0, value.length - 1))) : IsStringDecimalLike(value) ? Ok(BigInt(value.split(".")[0])) : IsStringIntegerLike(value) ? Ok(BigInt(value)) : guard_exports.IsEqual(lowercase, "false") ? Ok(BigInt(0)) : guard_exports.IsEqual(lowercase, "true") ? Ok(BigInt(1)) : Fail();
}
function TryBigInt(value) {
  return guard_exports.IsBigInt(value) ? Ok(value) : guard_exports.IsBoolean(value) ? FromBoolean2(value) : guard_exports.IsNumber(value) ? Ok(BigInt(Math.trunc(value))) : guard_exports.IsNull(value) ? Ok(BigInt(0)) : guard_exports.IsString(value) ? FromString2(value) : guard_exports.IsUndefined(value) ? Ok(BigInt(0)) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_boolean.mjs
function FromBigInt2(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(false) : guard_exports.IsEqual(value, BigInt(1)) ? Ok(true) : Fail();
}
function FromNumber2(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(false) : guard_exports.IsEqual(value, 1) ? Ok(true) : Fail();
}
function FromString3(value) {
  return guard_exports.IsEqual(value.toLowerCase(), "false") ? Ok(false) : guard_exports.IsEqual(value.toLowerCase(), "true") ? Ok(true) : guard_exports.IsEqual(value, "0") ? Ok(false) : guard_exports.IsEqual(value, "1") ? Ok(true) : Fail();
}
function TryBoolean(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt2(value) : guard_exports.IsBoolean(value) ? Ok(value) : guard_exports.IsNumber(value) ? FromNumber2(value) : guard_exports.IsNull(value) ? Ok(false) : guard_exports.IsString(value) ? FromString3(value) : guard_exports.IsUndefined(value) ? Ok(false) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_null.mjs
function FromBigInt3(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(null) : Fail();
}
function FromBoolean3(value) {
  return guard_exports.IsEqual(value, false) ? Ok(null) : Fail();
}
function FromNumber3(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(null) : Fail();
}
function FromString4(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(null) : Fail();
}
function TryNull(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt3(value) : guard_exports.IsBoolean(value) ? FromBoolean3(value) : guard_exports.IsNumber(value) ? FromNumber3(value) : guard_exports.IsNull(value) ? Ok(null) : guard_exports.IsString(value) ? FromString4(value) : guard_exports.IsUndefined(value) ? Ok(null) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_number.mjs
var maxBigInt = BigInt(Number.MAX_SAFE_INTEGER);
var minBigInt = BigInt(Number.MIN_SAFE_INTEGER);
function FromBigInt4(value) {
  return value <= maxBigInt && value >= minBigInt ? Ok(Number(value)) : Fail();
}
function FromBoolean4(value) {
  return Ok(value ? 1 : 0);
}
function FromString5(value) {
  const coerced = +value;
  if (guard_exports.IsNumber(coerced))
    return Ok(coerced);
  const lowercase = value.toLowerCase();
  if (guard_exports.IsEqual(lowercase, "false"))
    return Ok(0);
  if (guard_exports.IsEqual(lowercase, "true"))
    return Ok(1);
  const result = TryBigInt(value);
  if (IsOk(result))
    return result.value <= maxBigInt && result.value >= minBigInt ? Ok(Number(result.value)) : Fail();
  return Fail();
}
function TryNumber(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt4(value) : guard_exports.IsBoolean(value) ? FromBoolean4(value) : guard_exports.IsNumber(value) ? Ok(value) : guard_exports.IsNull(value) ? Ok(0) : guard_exports.IsString(value) ? FromString5(value) : guard_exports.IsUndefined(value) ? Ok(0) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_string.mjs
function TryString(value) {
  return guard_exports.IsBigInt(value) ? Ok(value.toString()) : guard_exports.IsBoolean(value) ? Ok(value.toString()) : guard_exports.IsNumber(value) ? Ok(value.toString()) : guard_exports.IsNull(value) ? Ok("null") : guard_exports.IsString(value) ? Ok(value) : guard_exports.IsUndefined(value) ? Ok("") : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_undefined.mjs
function FromBigInt5(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(void 0) : Fail();
}
function FromBoolean5(value) {
  return guard_exports.IsEqual(value, false) ? Ok(void 0) : Fail();
}
function FromNumber4(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(void 0) : Fail();
}
function FromString6(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(void 0) : Fail();
}
function TryUndefined(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt5(value) : guard_exports.IsBoolean(value) ? FromBoolean5(value) : guard_exports.IsNumber(value) ? FromNumber4(value) : guard_exports.IsNull(value) ? Ok(void 0) : guard_exports.IsString(value) ? FromString6(value) : guard_exports.IsUndefined(value) ? Ok(value) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_array.mjs
function FromArray8(context, type, value) {
  const result = try_exports.TryArray(value);
  return result.value.map((value2) => FromType21(context, type.items, value2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_bigint.mjs
function FromBigInt6(_context, _type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_boolean.mjs
function FromBoolean6(_context, _type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_cyclic.mjs
function FromCyclic7(context, type, value) {
  return FromType21({ ...context, ...type.$defs }, Ref(type.$ref), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_enum.mjs
function FromEnum3(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_integer.mjs
function FromInteger(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? Math.trunc(result.value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_intersect.mjs
function FromIntersect7(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType21(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_literal.mjs
function FromLiteralBigInt(_context, type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralBoolean(_context, type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralNumber(_context, type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralString(_context, type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteral6(context, type, value) {
  if (guard_exports.IsEqual(type.const, value))
    return value;
  return IsLiteralBigInt(type) ? FromLiteralBigInt(context, type, value) : IsLiteralBoolean(type) ? FromLiteralBoolean(context, type, value) : IsLiteralNumber(type) ? FromLiteralNumber(context, type, value) : IsLiteralString(type) ? FromLiteralString(context, type, value) : Unreachable();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_null.mjs
function FromNull2(_context, _type, value) {
  const result = try_exports.TryNull(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_number.mjs
function FromNumber5(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_additional.mjs
function FromAdditionalProperties(context, entries, additionalProperties, value) {
  const keys = guard_exports.Keys(value);
  for (const [regexp, _] of entries) {
    for (const key of keys) {
      if (!regexp.test(key)) {
        value[key] = FromType21(context, additionalProperties, value[key]);
      }
    }
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/shared/optional_undefined.mjs
function IsOptionalUndefined(property, key, value) {
  return IsOptional(property) && guard_exports.IsUndefined(value[key]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_object.mjs
function FromProperties5(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.properties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, property] of entries) {
    for (const key of keys) {
      if (!regexp.test(key) || IsOptionalUndefined(property, key, value))
        continue;
      value[key] = FromType21(context, property, value[key]);
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromObject12(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromProperties5(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_record.mjs
function FromPatternProperties(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.patternProperties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, schema] of entries) {
    for (const key of keys) {
      if (regexp.test(key)) {
        value[key] = FromType21(context, schema, value[key]);
      }
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromRecord4(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromPatternProperties(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_ref.mjs
function FromRef6(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType21(context, context[type.$ref], value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_string.mjs
function FromString7(_context, _type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_template_literal.mjs
function FromTemplateLiteral4(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_tuple.mjs
function FromTuple6(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let index = 0; index < Math.min(type.items.length, value.length); index++) {
    value[index] = FromType21(context, type.items[index], value[index]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_undefined.mjs
function FromUndefined2(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_union.mjs
function FromUnion10(context, type, value) {
  const matched = type.anyOf.some((type2) => Check2(context, type2, value));
  if (matched)
    return value;
  const candidates = type.anyOf.map((type2) => FromType21(context, type2, Clone2(value)));
  const selected = candidates.find((value2) => Check2(context, type, value2));
  return guard_exports.IsUndefined(selected) ? value : selected;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_void.mjs
function FromVoid(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? void 0 : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_type.mjs
function FromType21(context, type, value) {
  return IsArray2(type) ? FromArray8(context, type, value) : IsBigInt2(type) ? FromBigInt6(context, type, value) : IsBoolean3(type) ? FromBoolean6(context, type, value) : IsCyclic(type) ? FromCyclic7(context, type, value) : IsEnum(type) ? FromEnum3(context, type, value) : IsInteger2(type) ? FromInteger(context, type, value) : IsIntersect(type) ? FromIntersect7(context, type, value) : IsLiteral(type) ? FromLiteral6(context, type, value) : IsNull2(type) ? FromNull2(context, type, value) : IsNumber3(type) ? FromNumber5(context, type, value) : IsObject2(type) ? FromObject12(context, type, value) : IsRecord(type) ? FromRecord4(context, type, value) : IsRef(type) ? FromRef6(context, type, value) : IsString3(type) ? FromString7(context, type, value) : IsTemplateLiteral(type) ? FromTemplateLiteral4(context, type, value) : IsTuple(type) ? FromTuple6(context, type, value) : IsUndefined2(type) ? FromUndefined2(context, type, value) : IsUnion(type) ? FromUnion10(context, type, value) : IsVoid(type) ? FromVoid(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/convert.mjs
function Convert(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType21(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_array.mjs
function FromArray9(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType22(context, type.items, value[i]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_cyclic.mjs
function FromCyclic8(context, type, value) {
  return FromType22({ ...context, ...type.$defs }, Ref(type.$ref), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_default.mjs
function FromDefault(type, value) {
  if (!guard_exports.IsUndefined(value))
    return value;
  return guard_exports.IsFunction(type.default) ? type.default() : Clone2(type.default);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_intersect.mjs
function FromIntersect8(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType22(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_object.mjs
function FromObject13(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const knownPropertyKeys = guard_exports.Keys(type.properties);
  for (const key of knownPropertyKeys) {
    const propertyValue = FromType22(context, type.properties[key], value[key]);
    const isUnassignableUndefined = guard_exports.IsUndefined(propertyValue) && (IsOptional(type.properties[key]) || !guard_exports.HasPropertyKey(type.properties[key], "default"));
    if (isUnassignableUndefined)
      continue;
    value[key] = propertyValue;
  }
  if (!IsAdditionalProperties(type) || guard_exports.IsBoolean(type.additionalProperties))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (knownPropertyKeys.includes(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_record.mjs
function FromRecord5(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const [recordKey, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (!(recordKey.test(key) && IsDefault(recordValue)))
      continue;
    value[key] = FromType22(context, recordValue, value[key]);
  }
  if (!IsAdditionalProperties(type))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (recordKey.test(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_ref.mjs
function FromRef7(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType22(context, context[type.$ref], value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_tuple.mjs
function FromTuple7(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const [items, max] = [schema.items, Math.max(schema.items.length, value.length)];
  for (let i = 0; i < max; i++) {
    if (i < items.length)
      value[i] = FromType22(context, items[i], value[i]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_union.mjs
function FromUnion11(context, schema, value) {
  for (const inner of schema.anyOf) {
    const result = FromType22(context, inner, Clone2(value));
    if (Check2(context, inner, result)) {
      return result;
    }
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_type.mjs
function FromType22(context, type, value) {
  const defaulted = IsDefault(type) ? FromDefault(type, value) : value;
  return IsArray2(type) ? FromArray9(context, type, defaulted) : IsCyclic(type) ? FromCyclic8(context, type, defaulted) : IsIntersect(type) ? FromIntersect8(context, type, defaulted) : IsObject2(type) ? FromObject13(context, type, defaulted) : IsRecord(type) ? FromRecord5(context, type, defaulted) : IsRef(type) ? FromRef7(context, type, defaulted) : IsTuple(type) ? FromTuple7(context, type, defaulted) : IsUnion(type) ? FromUnion11(context, type, defaulted) : defaulted;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/default.mjs
function Default(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType22(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/pipeline/pipeline.mjs
function Pipeline(pipeline) {
  return (...args) => {
    const [context, type, value] = arguments_exports.Match(args, {
      3: (context2, type2, value2) => [context2, type2, value2],
      2: (type2, value2) => [{}, type2, value2]
    });
    return pipeline.reduce((result, func) => func(context, type, result), value);
  };
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/callback.mjs
function Decode3(_context, type, value) {
  return type["~codec"].decode(value);
}
function Encode2(_context, type, value) {
  return type["~codec"].encode(value);
}
function Callback(direction, context, type, value) {
  if (!IsCodec(type))
    return value;
  return guard_exports.IsEqual(direction, "Decode") ? Decode3(context, type, value) : Encode2(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_array.mjs
function Decode4(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType23(direction, context, type.items, value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode3(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return exterior;
  for (let i = 0; i < exterior.length; i++) {
    exterior[i] = FromType23(direction, context, type.items, exterior[i]);
  }
  return exterior;
}
function FromArray10(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode4(direction, context, type, value) : Encode3(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_cyclic.mjs
function FromCyclic9(direction, context, type, value) {
  value = FromType23(direction, { ...context, ...type.$defs }, Ref(type.$ref), value);
  return Callback(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_intersect.mjs
function MergeInteriors(interiors) {
  return interiors.reduce((results, interior) => ({ ...results, ...interior }), {});
}
function NonMatchingInterior(value, interiors) {
  for (const interior of interiors)
    if (!guard_exports.IsDeepEqual(value, interior))
      return interior;
  return value;
}
function Decode5(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(value))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  const exterior = structural ? MergeInteriors(interiors) : NonMatchingInterior(value, interiors);
  return Callback(direction, context, type, exterior);
}
function Encode4(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const exterior = Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(exterior))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  if (structural)
    return MergeInteriors(interiors);
  return NonMatchingInterior(exterior, interiors);
}
function FromIntersect9(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode5(direction, context, type, value) : Encode4(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_object.mjs
function Decode6(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(value, key) || IsOptionalUndefined(type.properties[key], key, value))
      continue;
    value[key] = FromType23(direction, context, type.properties[key], value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode5(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(exterior, key) || IsOptionalUndefined(type.properties[key], key, exterior))
      continue;
    exterior[key] = FromType23(direction, context, type.properties[key], exterior[key]);
  }
  return exterior;
}
function FromObject14(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode6(direction, context, type, value) : Encode5(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_record.mjs
function Decode7(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(value)) {
    if (!regexp.test(key))
      continue;
    value[key] = FromType23(direction, context, RecordValue(type), value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode6(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(exterior)) {
    if (!regexp.test(key))
      continue;
    exterior[key] = FromType23(direction, context, RecordValue(type), exterior[key]);
  }
  return exterior;
}
function FromRecord6(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode7(direction, context, type, value) : Encode6(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_ref.mjs
function ResolveRef(direction, context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType23(direction, context, context[type.$ref], value) : value;
}
function FromRef8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Callback(direction, context, type, ResolveRef(direction, context, type, value)) : ResolveRef(direction, context, type, Callback(direction, context, type, value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_tuple.mjs
function Decode8(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < Math.min(type.items.length, value.length); i++) {
    value[i] = FromType23(direction, context, type.items[i], value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode7(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return value;
  for (let i = 0; i < Math.min(type.items.length, exterior.length); i++) {
    exterior[i] = FromType23(direction, context, type.items[i], exterior[i]);
  }
  return exterior;
}
function FromTuple8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode8(direction, context, type, value) : Encode7(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_union.mjs
function Decode9(direction, context, type, value) {
  for (const schema of type.anyOf) {
    if (!Check2(context, schema, value))
      continue;
    const variant = FromType23(direction, context, schema, value);
    return Callback(direction, context, type, variant);
  }
  return value;
}
function Encode8(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  for (const schema of type.anyOf) {
    const variant = FromType23(direction, context, schema, Clone2(exterior));
    if (!Check2(context, schema, variant))
      continue;
    return variant;
  }
  return exterior;
}
function FromUnion12(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode9(direction, context, type, value) : Encode8(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_type.mjs
function FromType23(direction, context, type, value) {
  return IsArray2(type) ? FromArray10(direction, context, type, value) : IsCyclic(type) ? FromCyclic9(direction, context, type, value) : IsIntersect(type) ? FromIntersect9(direction, context, type, value) : IsObject2(type) ? FromObject14(direction, context, type, value) : IsRecord(type) ? FromRecord6(direction, context, type, value) : IsRef(type) ? FromRef8(direction, context, type, value) : IsTuple(type) ? FromTuple8(direction, context, type, value) : IsUnion(type) ? FromUnion12(direction, context, type, value) : Callback(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/decode.mjs
var DecodeError = class extends AssertError {
  constructor(value, errors) {
    super("Decode", value, errors);
  }
};
function Assert2(context, type, value) {
  if (!Check2(context, type, value))
    throw new DecodeError(value, Errors2(context, type, value));
  return value;
}
function DecodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Decode", context, sorted, value);
}
var Decoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert2(context, type, value),
  (context, type, value) => DecodeUnsafe(context, type, value)
]);
function Decode10(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Decoder(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/encode.mjs
var EncodeError = class extends AssertError {
  constructor(value, errors) {
    super("Encode", value, errors);
  }
};
function Assert3(context, type, value) {
  if (!Check2(context, type, value))
    throw new EncodeError(value, Errors2(context, type, value));
  return value;
}
function EncodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Encode", context, sorted, value);
}
var Encoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => EncodeUnsafe(context, type, value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert3(context, type, value)
]);
function Encode9(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Encoder(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/has.mjs
function FromArray11(context, type) {
  return IsCodec(type) || FromType24(context, type.items);
}
function FromCyclic10(context, type) {
  return IsCodec(type) || FromRef9({ ...context, ...type.$defs }, Ref(type.$ref));
}
function FromIntersect10(context, type) {
  return IsCodec(type) || type.allOf.some((type2) => FromType24(context, type2));
}
function FromObject15(context, type) {
  return IsCodec(type) || guard_exports.Keys(type.properties).some((key) => {
    return FromType24(context, type.properties[key]);
  });
}
function FromRecord7(context, type) {
  return IsCodec(type) || FromType24(context, RecordValue(type));
}
function FromRef9(context, type) {
  if (visited.has(type.$ref))
    return false;
  visited.add(type.$ref);
  return IsCodec(type) || guard_exports.HasPropertyKey(context, type.$ref) && FromType24(context, context[type.$ref]);
}
function FromTuple9(context, type) {
  return IsCodec(type) || type.items.some((type2) => FromType24(context, type2));
}
function FromUnion13(context, type) {
  return IsCodec(type) || type.anyOf.some((type2) => FromType24(context, type2));
}
function FromType24(context, type) {
  return IsArray2(type) ? FromArray11(context, type) : IsCyclic(type) ? FromCyclic10(context, type) : IsIntersect(type) ? FromIntersect10(context, type) : IsObject2(type) ? FromObject15(context, type) : IsRecord(type) ? FromRecord7(context, type) : IsRef(type) ? FromRef9(context, type) : IsTuple(type) ? FromTuple9(context, type) : IsUnion(type) ? FromUnion13(context, type) : IsCodec(type);
}
var visited = /* @__PURE__ */ new Set();
function HasCodec(...args) {
  const [context, type] = arguments_exports.Match(args, {
    2: (context2, type2) => [context2, type2],
    1: (type2) => [{}, type2]
  });
  visited.clear();
  return FromType24(context, type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/error.mjs
var CreateError = class extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_default.mjs
function FromDefault2(_context, schema) {
  return guard_exports.IsFunction(schema.default) ? schema.default(schema) : guard_exports.IsObject(schema.default) ? Clone2(schema.default) : schema.default;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_array.mjs
function FromArray12(context, type) {
  if (IsUniqueItems(type) && !IsDefault(type))
    throw new CreateError(type, "Arrays with uniqueItems constraints must specify a default annotation");
  const length = IsMinItems(type) ? type.minItems : 0;
  return Array.from({ length }, () => FromType25(context, type.items));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_bigint.mjs
function FromBigInt7(_context, type) {
  return IsExclusiveMinimum(type) ? BigInt(type.exclusiveMinimum) + BigInt(1) : IsMinimum(type) ? BigInt(type.minimum) : BigInt(0);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_boolean.mjs
function FromBoolean7(_context, _type) {
  return false;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_constructor.mjs
function FromConstructor2(context, type) {
  const instanceType = FromType25(context, type.instanceType);
  return class {
    constructor() {
      Object.assign(this, instanceType);
    }
  };
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_cyclic.mjs
function FromCyclic11(context, type) {
  return FromType25({ ...context, ...type.$defs }, Ref(type.$ref));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_enum.mjs
function FromEnum4(context, type) {
  return FromType25(context, Evaluate(type));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_function.mjs
function FromFunction2(context, type) {
  const returnType = FromType25(context, type.returnType);
  return () => returnType;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_integer.mjs
function FromInteger2(_context, type) {
  return IsExclusiveMinimum(type) && guard_exports.IsNumber(type.exclusiveMinimum) ? type.exclusiveMinimum + 1 : IsMinimum(type) ? type.minimum : 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_intersect.mjs
function FromIntersect11(context, type) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType25(context, evaluated);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_literal.mjs
function FromLiteral7(_context, type) {
  return type.const;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_never.mjs
function FromNever(_context, type) {
  throw new CreateError(type, "Cannot create TNever types");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_null.mjs
function FromNull3(_context, _type) {
  return null;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_number.mjs
function FromNumber6(_context, type) {
  return IsExclusiveMinimum(type) && guard_exports.IsNumber(type.exclusiveMinimum) ? type.exclusiveMinimum + 1 : IsMinimum(type) ? type.minimum : 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_object.mjs
function FromObject16(context, type) {
  const required = guard_exports.IsUndefined(type.required) ? [] : type.required;
  return required.reduce((result, key) => {
    return { ...result, [key]: FromType25(context, type.properties[key]) };
  }, {});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_record.mjs
function FromRecord8(_context, type) {
  if (IsMinProperties(type) && !IsDefault(type))
    throw new CreateError(type, "Record with the minProperties constraint must have a default annotation");
  return {};
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_ref.mjs
function FromRef10(context, type) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType25(context, context[type.$ref]) : (() => {
    throw new CreateError(type, "Unable to deref Ref");
  })();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_string.mjs
function FromString8(_context, type) {
  const needsDefault = (IsPattern(type) || IsFormat(type)) && !IsDefault(type);
  if (needsDefault)
    throw Error("Strings with format or pattern constraints must specify default");
  const minLength = IsMinLength3(type) ? type.minLength : 0;
  return "".padEnd(minLength);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_symbol.mjs
function FromSymbol2(_context, _type) {
  return /* @__PURE__ */ Symbol();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_template_literal.mjs
function FromTemplateLiteral5(context, type) {
  const decoded = TemplateLiteralDecode(type.pattern);
  if (IsString3(decoded))
    throw new CreateError(type, "Unable to create TemplateLiteral due to infinite type expansion");
  return FromType25(context, decoded);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_tuple.mjs
function FromTuple10(context, type) {
  return Array.from({ length: type.minItems }, (_, i) => FromType25(context, type.items[i]));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_undefined.mjs
function FromUndefined3(_context, _type) {
  return void 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_union.mjs
function FromUnion14(context, type) {
  if (guard_exports.IsEqual(type.anyOf.length, 0)) {
    throw Error("Unable to create Union with no variants");
  }
  return FromType25(context, type.anyOf[0]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_void.mjs
function FromVoid2(_context, _type) {
  return void 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_type.mjs
function FromType25(context, type) {
  return (
    // -----------------------------------------------------
    // Default
    // -----------------------------------------------------
    IsDefault(type) ? FromDefault2(context, type) : (
      // -----------------------------------------------------
      // Types
      // -----------------------------------------------------
      IsArray2(type) ? FromArray12(context, type) : IsBigInt2(type) ? FromBigInt7(context, type) : IsBoolean3(type) ? FromBoolean7(context, type) : IsConstructor2(type) ? FromConstructor2(context, type) : IsCyclic(type) ? FromCyclic11(context, type) : IsEnum(type) ? FromEnum4(context, type) : IsFunction2(type) ? FromFunction2(context, type) : IsInteger2(type) ? FromInteger2(context, type) : IsIntersect(type) ? FromIntersect11(context, type) : IsLiteral(type) ? FromLiteral7(context, type) : IsNever(type) ? FromNever(context, type) : IsNull2(type) ? FromNull3(context, type) : IsNumber3(type) ? FromNumber6(context, type) : IsObject2(type) ? FromObject16(context, type) : IsRecord(type) ? FromRecord8(context, type) : IsRef(type) ? FromRef10(context, type) : IsString3(type) ? FromString8(context, type) : IsSymbol2(type) ? FromSymbol2(context, type) : IsTemplateLiteral(type) ? FromTemplateLiteral5(context, type) : IsTuple(type) ? FromTuple10(context, type) : IsUndefined2(type) ? FromUndefined3(context, type) : IsUnion(type) ? FromUnion14(context, type) : IsVoid(type) ? FromVoid2(context, type) : void 0
    )
  );
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/create.mjs
function Create2(...args) {
  const [context, type] = arguments_exports.Match(args, {
    2: (context2, type2) => [context2, type2],
    1: (type2) => [{}, type2]
  });
  return FromType25(context, type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/equal/equal.mjs
function Equal(left, right) {
  return guard_exports.IsDeepEqual(left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/hash/hash.mjs
function Hash2(value) {
  return hash_exports.Hash(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/parse/parse.mjs
var ParseError2 = class extends AssertError {
  constructor(value, errors) {
    super("Parse", value, errors);
  }
};
function Assert4(context, type, value) {
  if (!Check2(context, type, value))
    throw new ParseError2(value, Errors2(context, type, value));
  return value;
}
var Parser = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert4(context, type, value)
]);
function Parse(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const checked = Check2(context, type, value);
  if (checked)
    return value;
  if (settings_exports.Get().correctiveParse)
    return Parser(context, type, value);
  throw new ParseError2(value, Errors2(context, type, value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/delta/diff.mjs
function CreateUpdate(path, value) {
  return { type: "update", path, value };
}
function CreateInsert(path, value) {
  return { type: "insert", path, value };
}
function CreateDelete(path) {
  return { type: "delete", path };
}
function AssertCanDiffObject(value) {
  if (guard_exports.IsObject(value) && guard_exports.IsEqual(guard_exports.Symbols(value).length, 0))
    return;
  throw new Error("Cannot create diffs for objects with symbols keys");
}
function* FromObject17(path, left, right) {
  if (!guard_exports.IsObject(right) || guard_exports.IsArray(right))
    return yield CreateUpdate(path, right);
  AssertCanDiffObject(left);
  AssertCanDiffObject(right);
  const leftKeys = guard_exports.Keys(left);
  const rightKeys = guard_exports.Keys(right);
  for (const key of rightKeys) {
    if (guard_exports.HasPropertyKey(left, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    yield CreateInsert(`${path}/${key}`, right[key]);
  }
  for (const key of leftKeys) {
    if (!guard_exports.HasPropertyKey(right, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    if (Equal(left, right))
      continue;
    yield* FromValue4(`${path}/${key}`, left[key], right[key]);
  }
  for (const key of leftKeys) {
    if (guard_exports.HasPropertyKey(right, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    yield CreateDelete(`${path}/${key}`);
  }
}
function* FromArray13(path, left, right) {
  if (!guard_exports.IsArray(right))
    return yield CreateUpdate(path, right);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    yield* FromValue4(`${path}/${i}`, left[i], right[i]);
  }
  for (let i = 0; i < right.length; i++) {
    if (i < left.length)
      continue;
    yield CreateInsert(`${path}/${i}`, right[i]);
  }
  for (let i = left.length - 1; i >= 0; i--) {
    if (i < right.length)
      continue;
    yield CreateDelete(`${path}/${i}`);
  }
}
function* FromTypedArray2(path, left, right) {
  const typeLeft = globalThis.Object.getPrototypeOf(left).constructor.name;
  const typeRight = globalThis.Object.getPrototypeOf(right).constructor.name;
  const predicate = globals_exports.IsTypeArray(right) && guard_exports.IsEqual(left.length, right.length) && guard_exports.IsEqual(typeLeft, typeRight);
  if (predicate) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      yield* FromValue4(`${path}/${index}`, left[index], right[index]);
    }
  } else {
    return yield CreateUpdate(path, right);
  }
}
function* FromUnknown(path, left, right) {
  if (left === right)
    return;
  yield CreateUpdate(path, right);
}
function* FromValue4(path, left, right) {
  return globals_exports.IsTypeArray(left) ? yield* FromTypedArray2(path, left, right) : guard_exports.IsArray(left) ? yield* FromArray13(path, left, right) : guard_exports.IsObject(left) ? yield* FromObject17(path, left, right) : yield* FromUnknown(path, left, right);
}
function Diff(current, next) {
  return [...FromValue4("", current, next)];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/delta/edit.mjs
var Insert2 = _Object_({
  type: Literal("insert"),
  path: String2(),
  value: Unknown()
});
var Update2 = Object({
  type: Literal("update"),
  path: String2(),
  value: Unknown()
});
var Delete2 = _Object_({
  type: Literal("delete"),
  path: String2()
});
var Edit = Union([Insert2, Update2, Delete2]);

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/delta/patch.mjs
function IsRoot(edits) {
  return edits.length > 0 && edits[0].path === "" && edits[0].type === "update";
}
function IsEmpty(edits) {
  return edits.length === 0;
}
function Patch(current, edits) {
  if (IsRoot(edits))
    return Clone2(edits[0].value);
  if (IsEmpty(edits))
    return Clone2(current);
  const clone = Clone2(current);
  for (const edit of edits) {
    switch (edit.type) {
      case "insert": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "update": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "delete": {
        pointer_exports.Delete(clone, edit.path);
        break;
      }
    }
  }
  return clone;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/error.mjs
var RepairError = class extends Error {
  constructor(context, type, value, message) {
    super(message);
    this.context = context;
    this.type = type;
    this.value = value;
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_array.mjs
function MakeUnique(values) {
  const [hashes, result] = [/* @__PURE__ */ new Set(), []];
  for (const value of values) {
    const hash = Hash2(value);
    if (hashes.has(hash))
      continue;
    hashes.add(hash);
    result.push(value);
  }
  return result;
}
function FromArray14(context, type, value) {
  if (Check2(context, type, value))
    return value;
  const created = guard_exports.IsArray(value) ? value : Create2(context, type);
  const minimum = IsMinItems(type) && created.length < type.minItems ? [...created, ...Array.from({ length: type.minItems - created.length }, () => Create2(context, type))] : created;
  const maximum = IsMaxItems(type) && minimum.length > type.maxItems ? minimum.slice(0, type.maxItems) : minimum;
  const repaired = maximum.map((value2) => FromType26(context, type.items, value2));
  if (!IsUniqueItems(type) || IsUniqueItems(type) && !guard_exports.IsEqual(type.uniqueItems, true))
    return repaired;
  const unique = MakeUnique(repaired);
  if (!Check2(context, type, unique))
    throw new RepairError(context, type, value, "Failed to repair Array due to uniqueItems constraint");
  return unique;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_enum.mjs
function FromEnum5(context, type, value) {
  return FromType26(context, Evaluate(type), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_intersect.mjs
function FromIntersect12(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType26(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_object.mjs
function FromObject18(context, type, value) {
  if (Check2(context, type, value))
    return value;
  if (!guard_exports.IsObjectNotArray(value))
    return Create2(context, type);
  const required = new Set(guard_exports.IsUndefined(type.required) ? [] : type.required);
  const result = {};
  for (const [key, schema] of guard_exports.Entries(type.properties)) {
    if (!required.has(key) && guard_exports.IsUndefined(value[key]))
      continue;
    result[key] = key in value ? FromType26(context, schema, value[key]) : Create2(context, schema);
  }
  const evaluatedKeys = guard_exports.Keys(type.properties);
  if (IsAdditionalProperties(type) && guard_exports.IsObject(type.additionalProperties)) {
    for (const key of guard_exports.Keys(value)) {
      if (evaluatedKeys.includes(key))
        continue;
      result[key] = FromType26(context, type.additionalProperties, value[key]);
    }
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_record.mjs
function FromRecord9(context, type, value) {
  if (Check2(context, type, value))
    return value;
  if (guard_exports.IsNull(value) || !guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return Create2(context, type);
  const recordKey = new RegExp(RecordPattern(type));
  const recordValue = RecordValue(type);
  const evaluatedKeys = /* @__PURE__ */ new Set();
  const result = {};
  for (const [key, value_] of guard_exports.Entries(value)) {
    if (!recordKey.test(key))
      continue;
    result[key] = FromType26(context, recordValue, value_);
    evaluatedKeys.add(key);
  }
  if (IsAdditionalProperties(type)) {
    for (const key of guard_exports.Keys(value)) {
      if (evaluatedKeys.has(key))
        continue;
      result[key] = FromType26(context, type.additionalProperties, value[key]);
    }
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_ref.mjs
function FromRef11(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType26(context, context[type.$ref], value) : (() => {
    throw new RepairError(context, type, value, "Unable to de-reference target type");
  })();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_template_literal.mjs
function FromTemplateLiteral6(context, type, value) {
  const decoded = TemplateLiteralDecode(type.pattern);
  return FromType26(context, decoded, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_tuple.mjs
function FromTuple11(context, schema, value) {
  if (Check2(context, schema, value))
    return value;
  if (!guard_exports.IsArray(value))
    return Create2(context, schema);
  return schema.items.map((schema2, index) => FromType26(context, schema2, value[index]));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/shared/union_score_select.mjs
function Deref(context, type, value) {
  return IsRef(type) ? guard_exports.HasPropertyKey(context, type.$ref) ? Deref(context, context[type.$ref], value) : (() => {
    throw new Error("Unable to Deref target");
  })() : type;
}
function ScoreVariant(context, type, value) {
  if (!(IsObject2(type) && guard_exports.IsObject(value)))
    return 0;
  const keys = guard_exports.Keys(value);
  const entries = guard_exports.Entries(type.properties);
  return entries.reduce((result, [key, schema]) => {
    const literal = IsLiteral(schema) && guard_exports.IsEqual(schema.const, value[key]) ? 100 : 0;
    const checks = Check2(context, schema, value[key]) ? 10 : 0;
    const exists = keys.includes(key) ? 1 : 0;
    return result + (literal + checks + exists);
  }, 0);
}
function UnionScoreSelect(context, type, value) {
  const schemas = type.anyOf.map((schema) => Deref(context, schema, value));
  let [select, best] = [schemas[0], 0];
  for (const schema of schemas) {
    const score = ScoreVariant(context, schema, value);
    if (score > best) {
      select = schema;
      best = score;
    }
  }
  return select;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_union.mjs
function RepairUnion(context, type, value) {
  const union = Union(Flatten(type.anyOf));
  const schema = UnionScoreSelect(context, union, value);
  return FromType26(context, schema, value);
}
function FromUnion15(context, type, value) {
  if (Check2(context, type, value))
    return Clone2(value);
  if (IsDefault(type))
    return Create2(context, type);
  return RepairUnion(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_unknown.mjs
function FromUnknown2(context, type, value) {
  if (Check2(context, type, value))
    return value;
  const converted = Convert(context, type, value);
  if (Check2(context, type, converted))
    return converted;
  return Create2(context, type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_type.mjs
function AssertRepairableValue(context, type, value) {
  const unsupported = globals_exports.IsDate(value) || globals_exports.IsMap(value) || globals_exports.IsSet(value) || globals_exports.IsTypeArray(value) || guard_exports.IsConstructor(value) || guard_exports.IsFunction(value);
  if (unsupported) {
    throw new RepairError(context, type, value, "Value is not repairable");
  }
}
function AssertRepairableType(context, type, value) {
  const unsupported = IsConstructor2(type) || IsFunction2(type) || IsNever(type);
  if (unsupported) {
    throw new RepairError(context, type, value, "Type is not repairable");
  }
}
function CreateWhenUndefined(context, type, value) {
  return guard_exports.IsUndefined(value) && !IsUndefined2(type) ? Create2(context, type) : value;
}
function FinalizeRepair(context, type, repaired) {
  return IsRefine(type) ? Check2(context, type, repaired) ? repaired : Create2(context, type) : repaired;
}
function FromType26(context, type, value) {
  AssertRepairableValue(context, type, value);
  AssertRepairableType(context, type, value);
  const candidate = CreateWhenUndefined(context, type, value);
  const repaired = IsArray2(type) ? FromArray14(context, type, candidate) : IsEnum(type) ? FromEnum5(context, type, candidate) : IsIntersect(type) ? FromIntersect12(context, type, candidate) : IsObject2(type) ? FromObject18(context, type, candidate) : IsRecord(type) ? FromRecord9(context, type, candidate) : IsRef(type) ? FromRef11(context, type, candidate) : IsTemplateLiteral(type) ? FromTemplateLiteral6(context, type, candidate) : IsTuple(type) ? FromTuple11(context, type, candidate) : IsUnion(type) ? FromUnion15(context, type, candidate) : FromUnknown2(context, type, candidate);
  return FinalizeRepair(context, type, repaired);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/repair.mjs
function Repair(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const repaired = FromType26(context, type, value);
  Assert(context, type, repaired);
  return repaired;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/value.mjs
var value_exports = {};
__export(value_exports, {
  Assert: () => Assert,
  Check: () => Check2,
  Clean: () => Clean,
  Clone: () => Clone2,
  Convert: () => Convert,
  Create: () => Create2,
  Decode: () => Decode10,
  Default: () => Default,
  Diff: () => Diff,
  Encode: () => Encode9,
  Equal: () => Equal,
  Errors: () => Errors2,
  HasCodec: () => HasCodec,
  Hash: () => Hash2,
  Parse: () => Parse,
  Patch: () => Patch,
  Pointer: () => pointer_exports,
  Repair: () => Repair
});

// src/lib/tweet-thread-validation-core.ts
var import_twitter_text = __toESM(require_dist2(), 1);
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
var { extractUrls, parseTweet } = import_twitter_text.default;
var X_POST_WEIGHTED_LENGTH_LIMIT = 280;
var HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
var STYLED_UNICODE_ALPHABET_RE = /[\u{1D400}-\u{1D7FF}\uFF21-\uFF3A\uFF41-\uFF5A]/u;
var REPEATED_EMOJI_RE = new RegExp("(\\p{Extended_Pictographic})(?:\\uFE0E|\\uFE0F)?(?:\\1(?:\\uFE0E|\\uFE0F)?){3,}", "gu");
var IMAGE_DEPENDENT_RE = /\b(?:(?:only\s+)?(?:shown|visible|available|provided)\s+in|see)\s+(?:the\s+)?(?:image|chart|screenshot|graphic|diagram)\b/u;
var GENERIC_ALT_TEXT = /* @__PURE__ */ new Set(["image", "chart", "screenshot", "graphic", "photo", "diagram"]);
var FINDING_MESSAGE_MAX_LENGTH = 2e3;
var FINDING_MESSAGE_TRUNCATION_MARKER = "… [truncated]";
var THREAD_VALIDATION_MAX_FINDINGS = 256;
var THREAD_VALIDATION_MAX_MEASUREMENTS = 50;
var THREAD_VALIDATION_LIMITS = {
  posts: 50,
  bannedPhrases: 128,
  evidence: 512,
  requiredClaimIds: 128,
  postClaimIds: 32,
  postMedia: 4
};
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalizeText(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}
function compareOrdinalStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
var WORD_CONTINUATION_CHARACTER_CLASS = "\\p{L}\\p{N}\\p{M}\\p{Pc}\\u200C\\u200D";
var WORD_CONTINUATION_CHARACTER_RE = new RegExp(`[${WORD_CONTINUATION_CHARACTER_CLASS}]`, "u");
function containsBannedPhrase(text, phrase) {
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase("en-US");
  const normalizedPhrase = phrase.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (normalizedPhrase.length === 0) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const firstCharacter = Array.from(normalizedPhrase)[0];
  const lastCharacter = Array.from(normalizedPhrase).at(-1);
  const startBoundary = firstCharacter && WORD_CONTINUATION_CHARACTER_RE.test(firstCharacter) ? `(?<![${WORD_CONTINUATION_CHARACTER_CLASS}])` : "";
  const endBoundary = lastCharacter && WORD_CONTINUATION_CHARACTER_RE.test(lastCharacter) ? `(?![${WORD_CONTINUATION_CHARACTER_CLASS}])` : "";
  return new RegExp(`${startBoundary}${escaped}${endBoundary}`, "u").test(normalizedText);
}
function findingId(parts) {
  const hash = createHash("sha256").update(parts.join("\0"), "utf8").digest("hex").slice(0, 16);
  return `finding-${hash}`;
}
function postReference(candidate, issue) {
  const match = issue.match(/\.posts\[(\d+)\]/u);
  if (!match || !Array.isArray(candidate.posts)) return void 0;
  const post = candidate.posts[Number(match[1])];
  return isRecord(post) && typeof post.postId === "string" ? post.postId : void 0;
}
function claimReference(issue) {
  return issue.match(/claim "([^"]+)"/u)?.[1];
}
function boundFindingMessage(message) {
  const characters = Array.from(message);
  if (characters.length <= FINDING_MESSAGE_MAX_LENGTH) return message;
  const markerLength = Array.from(FINDING_MESSAGE_TRUNCATION_MARKER).length;
  return characters.slice(0, FINDING_MESSAGE_MAX_LENGTH - markerLength).join("").concat(FINDING_MESSAGE_TRUNCATION_MARKER);
}
function createDeterministicFinding(code, severity, message, references = {}, identityParts = [
  code,
  severity,
  references.postId ?? "",
  references.claimId ?? "",
  message
]) {
  const finding = {
    findingId: findingId(identityParts),
    code,
    severity,
    message: boundFindingMessage(message)
  };
  if (references.postId && references.postId.length <= 32 && /^post-[1-9][0-9]*$/u.test(references.postId)) {
    finding.postId = references.postId;
  }
  if (references.claimId && references.claimId.length <= 128 && /^claim-[a-z0-9-]+$/u.test(references.claimId)) {
    finding.claimId = references.claimId;
  }
  return finding;
}
function addFinding(findings, code, severity, message, references = {}, identityParts) {
  const finding = createDeterministicFinding(
    code,
    severity,
    message,
    references,
    identityParts
  );
  if (findings.values.has(finding.findingId)) {
    findings.values.set(finding.findingId, finding);
    return;
  }
  if (findings.values.size >= THREAD_VALIDATION_MAX_FINDINGS - 1) {
    findings.truncated = true;
    return;
  }
  findings.values.set(finding.findingId, finding);
}
function collectProtocolFindings(candidate, findings, issues) {
  const record = isRecord(candidate) ? candidate : {};
  for (const issue of issues) {
    addFinding(findings, "protocol-invalid", "fail", issue, {
      postId: postReference(record, issue),
      claimId: claimReference(issue)
    });
  }
}
function collectCollectionLimitFindings(record, findings) {
  const violations = [];
  const candidateBrief = isRecord(record.brief) ? record.brief : null;
  const constraints = candidateBrief && isRecord(candidateBrief.constraints) ? candidateBrief.constraints : null;
  const posts = Array.isArray(record.posts) ? record.posts : [];
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const bannedPhrases = constraints && Array.isArray(constraints.bannedPhrases) ? constraints.bannedPhrases : [];
  const requiredClaimIds = constraints && Array.isArray(constraints.requiredClaimIds) ? constraints.requiredClaimIds : [];
  for (const [path, actual, maximum] of [
    ["ThreadCandidate.posts", posts.length, THREAD_VALIDATION_LIMITS.posts],
    ["ThreadCandidate.evidence", evidence.length, THREAD_VALIDATION_LIMITS.evidence],
    [
      "ThreadCandidate.brief.constraints.bannedPhrases",
      bannedPhrases.length,
      THREAD_VALIDATION_LIMITS.bannedPhrases
    ],
    [
      "ThreadCandidate.brief.constraints.requiredClaimIds",
      requiredClaimIds.length,
      THREAD_VALIDATION_LIMITS.requiredClaimIds
    ]
  ]) {
    if (actual > maximum) violations.push({ path, actual, maximum });
  }
  for (const [index, post] of posts.entries()) {
    if (!isRecord(post)) continue;
    const claimIds = Array.isArray(post.claimIds) ? post.claimIds : [];
    const media = Array.isArray(post.media) ? post.media : [];
    if (claimIds.length > THREAD_VALIDATION_LIMITS.postClaimIds) {
      violations.push({
        path: `ThreadCandidate.posts[${index}].claimIds`,
        actual: claimIds.length,
        maximum: THREAD_VALIDATION_LIMITS.postClaimIds
      });
    }
    if (media.length > THREAD_VALIDATION_LIMITS.postMedia) {
      violations.push({
        path: `ThreadCandidate.posts[${index}].media`,
        actual: media.length,
        maximum: THREAD_VALIDATION_LIMITS.postMedia
      });
    }
  }
  for (const violation of violations) {
    addFinding(
      findings,
      "collection-limit",
      "fail",
      `${violation.path} has ${violation.actual} items; the validation limit is ${violation.maximum}.`,
      {},
      ["collection-limit", violation.path, String(violation.actual), String(violation.maximum)]
    );
  }
  return violations.length > 0;
}
function finalizeFindings(findings) {
  if (findings.truncated) {
    const truncated = createDeterministicFinding(
      "validation-output-truncated",
      "fail",
      `Validation output exceeded ${THREAD_VALIDATION_MAX_FINDINGS} findings or ${THREAD_VALIDATION_MAX_MEASUREMENTS} measurements and was truncated.`,
      {},
      ["validation-output-truncated"]
    );
    findings.values.set(truncated.findingId, truncated);
  }
  return [...findings.values.values()].sort(
    (left, right) => compareOrdinalStrings(left.findingId, right.findingId)
  );
}
function countRepeatedEmojiRuns(text) {
  return Array.from(text.matchAll(REPEATED_EMOJI_RE)).length;
}
function hasTextEquivalent(altText) {
  if (typeof altText !== "string") return false;
  const normalized = normalizeText(altText);
  return normalized.length >= 12 && !GENERIC_ALT_TEXT.has(normalized);
}
function validateThreadCandidateCore(candidate, protocolIssues = [], brief) {
  const findings = {
    values: /* @__PURE__ */ new Map(),
    truncated: false
  };
  collectProtocolFindings(candidate, findings, protocolIssues);
  const record = isRecord(candidate) ? candidate : {};
  const collectionLimitFailed = collectCollectionLimitFindings(record, findings);
  if (collectionLimitFailed) {
    const orderedFindings2 = finalizeFindings(findings);
    return {
      candidateSha256: typeof record.candidateSha256 === "string" ? record.candidateSha256 : null,
      accepted: false,
      findings: orderedFindings2,
      measurements: []
    };
  }
  const candidateBrief = isRecord(record.brief) ? record.brief : null;
  if (brief !== void 0 && (!candidateBrief || !isDeepStrictEqual(candidateBrief, brief))) {
    addFinding(
      findings,
      "brief-mismatch",
      "fail",
      "The supplied brief must exactly match the brief embedded in the candidate."
    );
  }
  const constraints = candidateBrief && isRecord(candidateBrief.constraints) ? candidateBrief.constraints : null;
  const posts = Array.isArray(record.posts) ? record.posts : [];
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const evidenceClaimIds = new Set(
    evidence.flatMap(
      (item) => isRecord(item) && typeof item.claimId === "string" ? [item.claimId] : []
    )
  );
  const postedClaimIds = /* @__PURE__ */ new Set();
  const measurements = [];
  if (constraints && typeof constraints.minPosts === "number" && typeof constraints.maxPosts === "number" && (posts.length < constraints.minPosts || posts.length > constraints.maxPosts)) {
    addFinding(
      findings,
      "post-count-out-of-range",
      "fail",
      `Candidate has ${posts.length} posts; the brief requires ${constraints.minPosts}..${constraints.maxPosts}.`
    );
  }
  for (const [index, postValue] of posts.entries()) {
    if (!isRecord(postValue)) continue;
    const expectedPostId = `post-${index + 1}`;
    const postId = typeof postValue.postId === "string" ? postValue.postId : expectedPostId;
    if (postId !== expectedPostId) {
      addFinding(
        findings,
        "post-id-sequence",
        "fail",
        `Post at index ${index} must use postId "${expectedPostId}", not "${postId}".`,
        { postId }
      );
    }
    if (Array.isArray(postValue.claimIds)) {
      for (const claimId of postValue.claimIds) {
        if (typeof claimId !== "string") continue;
        postedClaimIds.add(claimId);
        if (!evidenceClaimIds.has(claimId)) {
          addFinding(
            findings,
            "claim-missing-evidence",
            "fail",
            `Claim "${claimId}" is used by ${postId} but has no evidence ledger entry.`,
            { postId, claimId }
          );
        }
      }
    }
    if (typeof postValue.text !== "string") continue;
    const text = postValue.text;
    const parsedTweet = parseTweet(text);
    const weightedLength = parsedTweet.weightedLength;
    const urls = extractUrls(text);
    const hashtags = text.match(HASHTAG_RE) ?? [];
    const normalizedHashtags = hashtags.map((tag) => normalizeText(tag));
    const repeatedHashtagCount = normalizedHashtags.length - new Set(normalizedHashtags).size;
    const repeatedEmojiRuns = countRepeatedEmojiRuns(text);
    const tokenCount = Math.max(normalizeText(text).split(" ").filter(Boolean).length, 1);
    const linkDensity = urls.length / tokenCount;
    if (measurements.length < THREAD_VALIDATION_MAX_MEASUREMENTS) {
      measurements.push({
        postId,
        weightedLength,
        urlCount: urls.length,
        hashtagCount: hashtags.length,
        repeatedHashtagCount,
        repeatedEmojiRuns,
        linkDensity
      });
    } else {
      findings.truncated = true;
    }
    if (weightedLength > X_POST_WEIGHTED_LENGTH_LIMIT) {
      addFinding(
        findings,
        "post-weighted-length",
        "fail",
        `${postId} has official X weighted length ${weightedLength}; the preflight limit is ${X_POST_WEIGHTED_LENGTH_LIMIT}.`,
        { postId }
      );
    }
    if (!parsedTweet.valid && weightedLength <= X_POST_WEIGHTED_LENGTH_LIMIT) {
      addFinding(
        findings,
        "post-twitter-text-invalid",
        "fail",
        `${postId} is not valid according to official twitter-text parsing.`,
        { postId }
      );
    }
    if (protocolIssues.length === 0 && constraints && Array.isArray(constraints.bannedPhrases)) {
      for (const phrase of constraints.bannedPhrases) {
        if (typeof phrase !== "string") continue;
        if (containsBannedPhrase(text, phrase)) {
          addFinding(
            findings,
            "banned-phrase",
            "fail",
            `${postId} contains banned phrase "${phrase.trim()}".`,
            { postId }
          );
        }
      }
    }
    if (STYLED_UNICODE_ALPHABET_RE.test(text)) {
      addFinding(
        findings,
        "styled-unicode-alphabet",
        "fail",
        `${postId} contains styled Unicode alphabet characters that are not reliably accessible.`,
        { postId }
      );
    }
    const media = Array.isArray(postValue.media) ? postValue.media : [];
    if (constraints?.requireAltText === true) {
      for (const mediaValue of media) {
        if (!isRecord(mediaValue)) continue;
        if (typeof mediaValue.altText !== "string" || mediaValue.altText.trim().length === 0) {
          addFinding(
            findings,
            "missing-alt-text",
            "fail",
            `${postId} includes media without required alt text.`,
            { postId }
          );
        }
      }
      if (IMAGE_DEPENDENT_RE.test(normalizeText(text)) && (media.length === 0 || media.some((item) => !isRecord(item) || !hasTextEquivalent(item.altText)))) {
        addFinding(
          findings,
          "image-dependent-text",
          "fail",
          `${postId} makes the message depend on an image without a meaningful text equivalent.`,
          { postId }
        );
      }
    }
    if (repeatedEmojiRuns > 0) {
      addFinding(
        findings,
        "repeated-emoji",
        "warn",
        `${postId} contains ${repeatedEmojiRuns} run(s) of four or more repeated emoji.`,
        { postId }
      );
    }
    if (hashtags.length > 3) {
      addFinding(
        findings,
        "hashtag-count",
        "warn",
        `${postId} contains ${hashtags.length} hashtags; more than three may reduce readability.`,
        { postId }
      );
    }
    if (repeatedHashtagCount > 0) {
      addFinding(
        findings,
        "hashtag-repetition",
        "warn",
        `${postId} repeats ${repeatedHashtagCount} hashtag(s) after normalization.`,
        { postId }
      );
    }
    if (urls.length >= 2 || linkDensity >= 0.25) {
      addFinding(
        findings,
        "link-density",
        "warn",
        `${postId} contains ${urls.length} links across ${tokenCount} text tokens.`,
        { postId }
      );
    }
  }
  if (constraints && Array.isArray(constraints.requiredClaimIds)) {
    for (const claimId of constraints.requiredClaimIds) {
      if (typeof claimId !== "string") continue;
      if (!evidenceClaimIds.has(claimId)) {
        addFinding(
          findings,
          "claim-missing-evidence",
          "fail",
          `Required claim "${claimId}" has no evidence ledger entry.`,
          { claimId }
        );
      }
      if (!postedClaimIds.has(claimId)) {
        addFinding(
          findings,
          "required-claim-unresolved",
          "fail",
          `Required claim "${claimId}" does not appear in any post.`,
          { claimId }
        );
      }
    }
  }
  const orderedFindings = finalizeFindings(findings);
  return {
    candidateSha256: typeof record.candidateSha256 === "string" ? record.candidateSha256 : null,
    accepted: !orderedFindings.some((finding) => finding.severity === "fail"),
    findings: orderedFindings,
    measurements
  };
}

// src/lib/strict-json-snapshot.ts
var MAX_DEPTH = 64;
var MAX_NODE_PROPERTY_BUDGET = 1e6;
var MAX_OBJECT_KEYS = 1024;
var MAX_ARRAY_LENGTH = 1024;
var StrictJsonSnapshotError = class extends Error {
  constructor(message = "Value must be strict accessor-free plain JSON data.") {
    super(message);
    this.name = "StrictJsonSnapshotError";
  }
};
function fail() {
  throw new StrictJsonSnapshotError();
}
function freezeJson(value) {
  if (Array.isArray(value)) {
    for (const entry of value) freezeJson(entry);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) {
      freezeJson(entry);
    }
    return Object.freeze(value);
  }
  return value;
}
function createStrictJsonSnapshot(input) {
  const ancestors = /* @__PURE__ */ new WeakSet();
  let budget = 0;
  const consume = (amount) => {
    if (amount > MAX_NODE_PROPERTY_BUDGET - budget) fail();
    budget += amount;
  };
  const visit = (value, depth) => {
    if (depth > MAX_DEPTH) fail();
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      consume(1);
      return value;
    }
    if (typeof value === "number") {
      consume(1);
      if (!Number.isFinite(value)) fail();
      return value;
    }
    if (typeof value !== "object" || ancestors.has(value)) fail();
    let keys;
    let isArray;
    try {
      keys = Reflect.ownKeys(value);
      isArray = Array.isArray(value);
    } catch {
      fail();
    }
    if (keys.some((key) => typeof key === "symbol")) fail();
    if (isArray) {
      let lengthDescriptor;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      } catch {
        fail();
      }
      if (lengthDescriptor === void 0 || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_ARRAY_LENGTH) {
        fail();
      }
      const length = lengthDescriptor.value;
      if (keys.length !== length + 1) fail();
      const keySet = new Set(keys);
      if (!keySet.has("length")) fail();
      for (let index = 0; index < length; index += 1) {
        if (!keySet.has(String(index))) fail();
      }
      consume(keys.length + 1);
      let prototype2;
      try {
        prototype2 = Object.getPrototypeOf(value);
      } catch {
        fail();
      }
      if (prototype2 !== Array.prototype) fail();
      ancestors.add(value);
      try {
        const snapshot = new Array(length);
        for (let index = 0; index < length; index += 1) {
          let descriptor;
          try {
            descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          } catch {
            fail();
          }
          if (descriptor === void 0 || !("value" in descriptor) || descriptor.enumerable !== true) {
            fail();
          }
          Object.defineProperty(snapshot, String(index), {
            configurable: false,
            enumerable: true,
            value: visit(descriptor.value, depth + 1),
            writable: false
          });
        }
        return snapshot;
      } finally {
        ancestors.delete(value);
      }
    }
    if (keys.length > MAX_OBJECT_KEYS) fail();
    if (keys.includes("toJSON")) fail();
    consume(keys.length + 1);
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      fail();
    }
    if (prototype !== Object.prototype && prototype !== null) fail();
    ancestors.add(value);
    try {
      const snapshot = /* @__PURE__ */ Object.create(null);
      for (const key of keys) {
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          fail();
        }
        if (descriptor === void 0 || !("value" in descriptor) || descriptor.enumerable !== true) {
          fail();
        }
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: visit(descriptor.value, depth + 1),
          writable: false
        });
      }
      return snapshot;
    } finally {
      ancestors.delete(value);
    }
  };
  return freezeJson(visit(input, 0));
}

// src/lib/tweet-thread-protocol.ts
var TWEET_THREAD_PROTOCOL_VERSION = "opencoven.tweet-thread.v1";
var RFC3339_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
var SHA256_HEX = /^[a-f0-9]{64}$/;
var CLAIM_ID_RE = /^claim-[a-z0-9-]+$/;
var POST_ID_RE = /^post-[1-9][0-9]*$/;
var X_POST_ID_RE = /^[1-9][0-9]*$/;
var X_THREAD_URL_RE = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9][0-9]*$/;
var HTTP_URL_RE = /^https?:\/\/[^\s/?#]+(?:[/?#]|$)/;
var THREAD_OBSERVATION_METRIC_NAMES = [
  "impressions",
  "likes",
  "reposts",
  "replies",
  "quotes",
  "bookmarks"
];
var OBJECTIVE_WEIGHT_KEYS = [
  "factuality",
  "provenance",
  "accessibility",
  "voice",
  "coherence",
  "engagement"
];
var JCS_JSON_VALUE_SCHEMA = typebox_exports.Unsafe({
  $defs: {
    value: {
      anyOf: [
        { type: "null" },
        { type: "boolean" },
        { type: "number" },
        {
          type: "string",
          pattern: "^(?:(?:[^\\uD800-\\uDFFF])|(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]))*$"
        },
        {
          type: "array",
          items: { $ref: "#/$defs/value" }
        },
        {
          type: "object",
          additionalProperties: { $ref: "#/$defs/value" }
        }
      ]
    }
  },
  $ref: "#/$defs/value"
});
var boundedNonWhitespaceString = (maxLength) => typebox_exports.String({ minLength: 1, maxLength, pattern: "\\S" });
var boundedUrlString = (maxLength, pattern = HTTP_URL_RE.source) => typebox_exports.String({ format: "uri", minLength: 1, maxLength, pattern });
var timestampString = () => typebox_exports.String({ format: "date-time", minLength: 24, maxLength: 24, pattern: RFC3339_UTC_MILLIS.source });
var stableId = (prefix) => typebox_exports.String({ minLength: prefix.length + 2, maxLength: 128, pattern: `^${prefix}-[a-z0-9-]+$` });
var protocolVersionLiteral = () => typebox_exports.Literal(TWEET_THREAD_PROTOCOL_VERSION);
var claimIdSchema = () => typebox_exports.String({ minLength: 7, maxLength: 128, pattern: CLAIM_ID_RE.source });
var postIdSchema = () => typebox_exports.String({ minLength: 6, maxLength: 32, pattern: POST_ID_RE.source });
var xPostIdSchema = () => typebox_exports.String({ minLength: 1, maxLength: 64, pattern: X_POST_ID_RE.source });
var xThreadUrlSchema = () => boundedUrlString(2e3, X_THREAD_URL_RE.source);
var sha256Schema = () => typebox_exports.String({ minLength: 64, maxLength: 64, pattern: SHA256_HEX.source });
var ObjectiveWeightsSchema = typebox_exports.Object({
  factuality: typebox_exports.Number({ minimum: 0, maximum: 1 }),
  provenance: typebox_exports.Number({ minimum: 0, maximum: 1 }),
  accessibility: typebox_exports.Number({ minimum: 0, maximum: 1 }),
  voice: typebox_exports.Number({ minimum: 0, maximum: 1 }),
  coherence: typebox_exports.Number({ minimum: 0, maximum: 1 }),
  engagement: typebox_exports.Number({ minimum: 0, maximum: 1 })
}, {
  additionalProperties: false,
  anyOf: OBJECTIVE_WEIGHT_KEYS.map((key) => ({
    required: [key],
    properties: {
      [key]: {
        type: "number",
        exclusiveMinimum: 0
      }
    }
  }))
});
var ThreadConstraintsSchema = typebox_exports.Object({
  minPosts: typebox_exports.Integer({ minimum: 1, maximum: 50 }),
  maxPosts: typebox_exports.Integer({ minimum: 1, maximum: 50 }),
  requiredClaimIds: typebox_exports.Array(claimIdSchema(), { maxItems: 128, uniqueItems: true }),
  bannedPhrases: typebox_exports.Array(boundedNonWhitespaceString(200), { maxItems: 128, uniqueItems: true }),
  requireAltText: typebox_exports.Boolean()
}, { additionalProperties: false });
var ThreadBriefSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  briefId: stableId("brief"),
  topic: boundedNonWhitespaceString(500),
  audience: boundedNonWhitespaceString(500),
  objectiveWeights: ObjectiveWeightsSchema,
  constraints: ThreadConstraintsSchema,
  notes: typebox_exports.Optional(typebox_exports.String({ maxLength: 2e3 }))
}, { additionalProperties: false });
var EvidenceItemSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  evidenceId: stableId("evidence"),
  claimId: claimIdSchema(),
  summary: boundedNonWhitespaceString(2e3),
  sourceLabel: boundedNonWhitespaceString(200),
  sourceUrl: typebox_exports.Optional(boundedUrlString(2e3)),
  retrievedAt: timestampString()
}, { additionalProperties: false });
var VoiceProfileSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  voiceProfileId: stableId("voice"),
  displayName: boundedNonWhitespaceString(120),
  tone: boundedNonWhitespaceString(500),
  do: typebox_exports.Array(boundedNonWhitespaceString(200), { maxItems: 32, uniqueItems: true }),
  dont: typebox_exports.Array(boundedNonWhitespaceString(200), { maxItems: 32, uniqueItems: true })
}, { additionalProperties: false });
var ThreadPostMediaSchema = typebox_exports.Object({
  description: boundedNonWhitespaceString(500),
  altText: typebox_exports.Optional(boundedNonWhitespaceString(1e3))
}, { additionalProperties: false });
var ThreadPostSchema = typebox_exports.Object({
  postId: postIdSchema(),
  text: boundedNonWhitespaceString(25e3),
  claimIds: typebox_exports.Array(claimIdSchema(), { maxItems: 32, uniqueItems: true }),
  media: typebox_exports.Optional(typebox_exports.Array(ThreadPostMediaSchema, { maxItems: 4 }))
}, { additionalProperties: false });
var ThreadCandidateSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  candidateId: stableId("candidate"),
  candidateSha256: sha256Schema(),
  brief: ThreadBriefSchema,
  voiceProfile: VoiceProfileSchema,
  evidence: typebox_exports.Array(EvidenceItemSchema, { minItems: 1, maxItems: 512 }),
  posts: typebox_exports.Array(ThreadPostSchema, { minItems: 1, maxItems: 50 }),
  generatedAt: timestampString()
}, { additionalProperties: false });
var ThreadCandidateCanonicalContentSchema = typebox_exports.Omit(
  ThreadCandidateSchema,
  ["candidateSha256"]
);
var DeterministicFindingSchemaInternal = typebox_exports.Object({
  findingId: stableId("finding"),
  code: boundedNonWhitespaceString(120),
  severity: typebox_exports.Union([typebox_exports.Literal("info"), typebox_exports.Literal("warn"), typebox_exports.Literal("fail")]),
  message: boundedNonWhitespaceString(2e3),
  postId: typebox_exports.Optional(postIdSchema()),
  claimId: typebox_exports.Optional(claimIdSchema())
}, { additionalProperties: false });
var ThreadPostMeasurementSchema = typebox_exports.Object({
  postId: postIdSchema(),
  weightedLength: typebox_exports.Integer({ minimum: 0 }),
  urlCount: typebox_exports.Integer({ minimum: 0 }),
  hashtagCount: typebox_exports.Integer({ minimum: 0 }),
  repeatedHashtagCount: typebox_exports.Integer({ minimum: 0 }),
  repeatedEmojiRuns: typebox_exports.Integer({ minimum: 0 }),
  linkDensity: typebox_exports.Number({ minimum: 0 })
}, { additionalProperties: false });
var ThreadValidationRecordSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  validationId: stableId("validation"),
  candidateSha256: sha256Schema(),
  validatedAt: timestampString(),
  accepted: typebox_exports.Boolean(),
  findings: typebox_exports.Array(DeterministicFindingSchemaInternal, {
    maxItems: THREAD_VALIDATION_MAX_FINDINGS
  }),
  measurements: typebox_exports.Array(ThreadPostMeasurementSchema, { maxItems: 50 })
}, { additionalProperties: false });
var DimensionScoreSchemaInternal = (dimension) => typebox_exports.Object({
  dimension: typebox_exports.Literal(dimension),
  score: typebox_exports.Number({ minimum: 0, maximum: 1 }),
  rationale: boundedNonWhitespaceString(2e3),
  findings: typebox_exports.Array(DeterministicFindingSchemaInternal, { maxItems: 128 })
}, { additionalProperties: false });
var DimensionScoreSchema = typebox_exports.Union([
  DimensionScoreSchemaInternal("factuality"),
  DimensionScoreSchemaInternal("provenance"),
  DimensionScoreSchemaInternal("accessibility"),
  DimensionScoreSchemaInternal("voice"),
  DimensionScoreSchemaInternal("coherence"),
  DimensionScoreSchemaInternal("engagement")
]);
var ThreadScorecardDimensionsSchema = typebox_exports.Object({
  factuality: DimensionScoreSchemaInternal("factuality"),
  provenance: DimensionScoreSchemaInternal("provenance"),
  accessibility: DimensionScoreSchemaInternal("accessibility"),
  voice: DimensionScoreSchemaInternal("voice"),
  coherence: DimensionScoreSchemaInternal("coherence"),
  engagement: DimensionScoreSchemaInternal("engagement")
}, { additionalProperties: false });
var ThreadScorecardBlindingProvenanceSchema = typebox_exports.Object({
  trialId: typebox_exports.String({ minLength: 7, maxLength: 128, pattern: "^trial-[a-z0-9-]+$" }),
  publicTrialSha256: sha256Schema(),
  armToken: typebox_exports.String({ minLength: 68, maxLength: 68, pattern: "^arm-[a-f0-9]{64}$" })
}, { additionalProperties: false });
var ThreadScorecardSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  scorecardId: stableId("scorecard"),
  candidateSha256: sha256Schema(),
  scoredAt: timestampString(),
  dimensions: ThreadScorecardDimensionsSchema,
  blinding: typebox_exports.Optional(ThreadScorecardBlindingProvenanceSchema)
}, { additionalProperties: false });
var ApprovalRecordSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  approvalId: stableId("approval"),
  candidateSha256: sha256Schema(),
  decision: typebox_exports.Union([typebox_exports.Literal("approved"), typebox_exports.Literal("rejected")]),
  actor: boundedNonWhitespaceString(200),
  decidedAt: timestampString(),
  note: typebox_exports.Optional(typebox_exports.String({ maxLength: 2e3 }))
}, { additionalProperties: false });
var publishReceiptBaseProperties = () => ({
  protocolVersion: protocolVersionLiteral(),
  receiptId: stableId("publish"),
  candidateSha256: sha256Schema(),
  platform: typebox_exports.Literal("x"),
  attemptedAt: timestampString()
});
var publishReceiptRemoteEvidenceProperties = () => ({
  publishedAt: timestampString(),
  threadUrl: xThreadUrlSchema(),
  remotePostIds: typebox_exports.Array(xPostIdSchema(), { minItems: 1, maxItems: 50, uniqueItems: true })
});
var PublishReceiptSchema = typebox_exports.Union([
  typebox_exports.Object({
    ...publishReceiptBaseProperties(),
    status: typebox_exports.Literal("publishing")
  }, { additionalProperties: false }),
  typebox_exports.Object({
    ...publishReceiptBaseProperties(),
    status: typebox_exports.Literal("published"),
    ...publishReceiptRemoteEvidenceProperties()
  }, { additionalProperties: false }),
  typebox_exports.Object({
    ...publishReceiptBaseProperties(),
    status: typebox_exports.Literal("partial"),
    ...publishReceiptRemoteEvidenceProperties(),
    errorCode: boundedNonWhitespaceString(120)
  }, { additionalProperties: false }),
  typebox_exports.Object({
    ...publishReceiptBaseProperties(),
    status: typebox_exports.Literal("failed"),
    errorCode: boundedNonWhitespaceString(120)
  }, { additionalProperties: false }),
  typebox_exports.Object({
    ...publishReceiptBaseProperties(),
    status: typebox_exports.Literal("uncertain"),
    errorCode: boundedNonWhitespaceString(120)
  }, { additionalProperties: false }),
  typebox_exports.Object({
    ...publishReceiptBaseProperties(),
    status: typebox_exports.Literal("uncertain"),
    ...publishReceiptRemoteEvidenceProperties(),
    errorCode: boundedNonWhitespaceString(120)
  }, { additionalProperties: false })
]);
var ThreadObservationMetricsSchema = typebox_exports.Object({
  impressions: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
  likes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
  reposts: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
  replies: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
  quotes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
  bookmarks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 }))
}, { additionalProperties: false });
var ThreadObservationMetricNameSchema = typebox_exports.Union([
  typebox_exports.Literal("impressions"),
  typebox_exports.Literal("likes"),
  typebox_exports.Literal("reposts"),
  typebox_exports.Literal("replies"),
  typebox_exports.Literal("quotes"),
  typebox_exports.Literal("bookmarks")
]);
var ThreadObservationMissingMetricReasonSchema = typebox_exports.Object({
  metric: ThreadObservationMetricNameSchema,
  reason: boundedNonWhitespaceString(500)
}, { additionalProperties: false });
var ThreadObservationSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  observationId: stableId("observation"),
  candidateSha256: sha256Schema(),
  publishReceiptId: stableId("publish"),
  source: typebox_exports.Literal("x"),
  retrievedAt: timestampString(),
  exposedAt: timestampString(),
  metrics: ThreadObservationMetricsSchema,
  missingMetricReasons: typebox_exports.Array(ThreadObservationMissingMetricReasonSchema, {
    maxItems: THREAD_OBSERVATION_METRIC_NAMES.length
  }),
  note: typebox_exports.Optional(typebox_exports.String({ maxLength: 2e3 }))
}, { additionalProperties: false });
var ThreadRunManifestSchema = typebox_exports.Object({
  protocolVersion: protocolVersionLiteral(),
  manifestId: stableId("manifest"),
  runId: stableId("run"),
  createdAt: timestampString(),
  brief: ThreadBriefSchema,
  voiceProfile: VoiceProfileSchema,
  candidates: typebox_exports.Array(ThreadCandidateSchema, { minItems: 1, maxItems: 32 }),
  validations: typebox_exports.Array(ThreadValidationRecordSchema, { maxItems: 64 }),
  scorecards: typebox_exports.Array(ThreadScorecardSchema, { maxItems: 64 }),
  approvals: typebox_exports.Array(ApprovalRecordSchema, { maxItems: 64 }),
  publishReceipts: typebox_exports.Array(PublishReceiptSchema, { maxItems: 64 }),
  observations: typebox_exports.Array(ThreadObservationSchema, { maxItems: 256 })
}, { additionalProperties: false });
var TweetThreadProtocolValidationError = class extends Error {
  constructor(issues) {
    super(`Tweet thread protocol validation failed: ${issues.join("; ")}`);
    this.name = "TweetThreadProtocolValidationError";
    this.issues = issues;
  }
};
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function snapshotProtocolValue(value, path) {
  try {
    return createStrictJsonSnapshot(value);
  } catch (error) {
    if (error instanceof StrictJsonSnapshotError) {
      throw new TweetThreadProtocolValidationError([
        `${path} must be strict accessor-free plain JSON without custom prototypes, toJSON hooks, symbols, sparse arrays, cycles, unsupported primitives, or resource-budget excess.`
      ]);
    }
    throw error;
  }
}
function serializeCanonicalThreadCandidateSnapshot(candidate) {
  const content = { ...candidate };
  delete content.candidateSha256;
  if (!value_exports.Check(JCS_JSON_VALUE_SCHEMA, content)) {
    throw new TweetThreadProtocolValidationError([
      "Thread candidate content must contain only finite JSON values and well-formed Unicode before JCS serialization."
    ]);
  }
  const serialized = canonicalize(content);
  if (serialized === void 0) {
    throw new TweetThreadProtocolValidationError([
      "Thread candidate content could not be serialized as RFC 8785 JCS."
    ]);
  }
  return serialized;
}
function computeThreadCandidateSnapshotSha256(candidate) {
  return createHash2("sha256").update(serializeCanonicalThreadCandidateSnapshot(candidate), "utf8").digest("hex");
}
function collectObjectiveWeightIssues(value, path) {
  if (!isRecord2(value)) return [`${path} must be an object with exact objective weight keys.`];
  const issues = [];
  let hasPositiveWeight = false;
  for (const key of OBJECTIVE_WEIGHT_KEYS) {
    const current = value[key];
    if (typeof current !== "number" || current < 0 || current > 1) {
      issues.push(`${path}.${key} must be a number in 0..1.`);
    } else if (current > 0) {
      hasPositiveWeight = true;
    }
  }
  if (!hasPositiveWeight) {
    issues.push(`${path} must include at least one positive objective weight.`);
  }
  return issues;
}
function collectThreadBriefIssues(value, path = "ThreadBrief") {
  const issues = [];
  if (!isRecord2(value)) return [`${path} must be an object.`];
  issues.push(...collectNonWhitespaceStringIssues(value.topic, `${path}.topic`));
  issues.push(...collectNonWhitespaceStringIssues(value.audience, `${path}.audience`));
  issues.push(...collectObjectiveWeightIssues(value.objectiveWeights, `${path}.objectiveWeights`));
  const constraints = value.constraints;
  if (!isRecord2(constraints)) {
    issues.push(`${path}.constraints must be an object.`);
  } else {
    if (typeof constraints.minPosts === "number" && typeof constraints.maxPosts === "number" && Number.isInteger(constraints.minPosts) && Number.isInteger(constraints.maxPosts) && constraints.minPosts > constraints.maxPosts) {
      issues.push(`${path}.constraints.minPosts must be less than or equal to maxPosts.`);
    }
    if (Array.isArray(constraints.bannedPhrases)) {
      for (const [index, phrase] of constraints.bannedPhrases.entries()) {
        if (typeof phrase === "string" && phrase.trim().length === 0) {
          issues.push(`${path}.constraints.bannedPhrases[${index}] must contain non-whitespace text.`);
        }
      }
    }
  }
  if (!value_exports.Check(ThreadBriefSchema, value)) {
    issues.push(`${path} does not match ThreadBriefSchema.`);
  }
  return issues;
}
function collectTimestampIssues(value, path) {
  if (typeof value !== "string" || !RFC3339_UTC_MILLIS.test(value)) return [];
  const timestamp = new Date(value);
  if (!Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value) return [];
  return [`${path} must be a calendar-valid UTC-millisecond timestamp.`];
}
function collectTimestampOrderIssues(value, bound, valuePath, boundPath, order) {
  if (typeof value !== "string" || typeof bound !== "string") return [];
  const valueMs = Date.parse(value);
  const boundMs = Date.parse(bound);
  if (!Number.isFinite(valueMs) || !Number.isFinite(boundMs)) return [];
  const valid = order === "at-or-before" ? valueMs <= boundMs : valueMs >= boundMs;
  if (valid) return [];
  const relation = order === "at-or-before" ? "less than or equal to" : "greater than or equal to";
  return [`${valuePath} must be ${relation} ${boundPath}.`];
}
function collectNonWhitespaceStringIssues(value, path) {
  return typeof value === "string" && value.trim().length === 0 ? [`${path} must contain non-whitespace text.`] : [];
}
var MAX_PROTOCOL_ISSUES = 256;
var MAX_ISSUE_VALUE_LENGTH = 128;
function boundedIssueValue(value) {
  return value.length <= MAX_ISSUE_VALUE_LENGTH ? value : `${value.slice(0, MAX_ISSUE_VALUE_LENGTH)}…`;
}
function pushDuplicateIssue(seen, next, path, issues) {
  if (seen.has(next)) {
    if (issues.length < MAX_PROTOCOL_ISSUES) {
      issues.push(
        `${path} must be unique; duplicate value "${boundedIssueValue(next)}" found.`
      );
    }
    return;
  }
  seen.add(next);
}
function collectThreadCandidateIssues(value, path = "ThreadCandidate", includeDeterministicFailures = false) {
  const issues = [];
  if (!isRecord2(value)) return [`${path} must be an object.`];
  issues.push(...collectThreadBriefIssues(value.brief, `${path}.brief`));
  const matchesCandidateSchema = value_exports.Check(ThreadCandidateSchema, value);
  if (!matchesCandidateSchema) {
    issues.push(`${path} does not match ThreadCandidateSchema.`);
  }
  issues.push(...collectTimestampIssues(value.generatedAt, `${path}.generatedAt`));
  if (matchesCandidateSchema && typeof value.candidateSha256 === "string" && SHA256_HEX.test(value.candidateSha256)) {
    try {
      const computedSha256 = computeThreadCandidateSnapshotSha256(value);
      if (computedSha256 !== value.candidateSha256) {
        issues.push(
          `${path}.candidateSha256 must equal the SHA-256 of canonical candidate content; expected "${computedSha256}".`
        );
      }
    } catch {
      issues.push(`${path} must be serializable as canonical JSON before candidateSha256 can be verified.`);
    }
  }
  if (!isRecord2(value.brief) || !Array.isArray(value.evidence) || !Array.isArray(value.posts)) return issues;
  if (isRecord2(value.voiceProfile)) {
    issues.push(...collectNonWhitespaceStringIssues(value.voiceProfile.displayName, `${path}.voiceProfile.displayName`));
    issues.push(...collectNonWhitespaceStringIssues(value.voiceProfile.tone, `${path}.voiceProfile.tone`));
  }
  const evidenceClaimIds = /* @__PURE__ */ new Set();
  const evidenceIds = /* @__PURE__ */ new Set();
  for (const [index, item] of value.evidence.entries()) {
    if (!isRecord2(item)) continue;
    issues.push(...collectTimestampIssues(item.retrievedAt, `${path}.evidence[${index}].retrievedAt`));
    issues.push(...collectTimestampOrderIssues(
      item.retrievedAt,
      value.generatedAt,
      `${path}.evidence[${index}].retrievedAt`,
      `${path}.generatedAt`,
      "at-or-before"
    ));
    issues.push(...collectNonWhitespaceStringIssues(item.summary, `${path}.evidence[${index}].summary`));
    issues.push(...collectNonWhitespaceStringIssues(item.sourceLabel, `${path}.evidence[${index}].sourceLabel`));
    if (typeof item.evidenceId === "string") {
      pushDuplicateIssue(evidenceIds, item.evidenceId, `${path}.evidence[${index}].evidenceId`, issues);
    }
    if (typeof item.claimId === "string") {
      pushDuplicateIssue(evidenceClaimIds, item.claimId, `${path}.evidence[${index}].claimId`, issues);
    }
  }
  const postIds = /* @__PURE__ */ new Set();
  for (const [index, post] of value.posts.entries()) {
    if (!isRecord2(post)) continue;
    issues.push(...collectNonWhitespaceStringIssues(post.text, `${path}.posts[${index}].text`));
    if (typeof post.postId === "string") {
      pushDuplicateIssue(postIds, post.postId, `${path}.posts[${index}].postId`, issues);
    }
    if (Array.isArray(post.media)) {
      for (const [mediaIndex, media] of post.media.entries()) {
        if (!isRecord2(media)) continue;
        issues.push(...collectNonWhitespaceStringIssues(
          media.description,
          `${path}.posts[${index}].media[${mediaIndex}].description`
        ));
      }
    }
  }
  if (includeDeterministicFailures) {
    const postIndexById = new Map(
      value.posts.flatMap(
        (post, index) => isRecord2(post) && typeof post.postId === "string" ? [[post.postId, index]] : []
      )
    );
    for (const finding of validateThreadCandidateCore(value).findings) {
      if (finding.severity !== "fail") continue;
      const postIndex = finding.postId === void 0 ? void 0 : postIndexById.get(finding.postId);
      const findingPath = postIndex === void 0 ? path : `${path}.posts[${postIndex}]`;
      issues.push(
        `${findingPath} deterministic validation failed (${finding.code}): ${finding.message}`
      );
    }
  }
  return issues;
}
function inspectThreadCandidateForValidation(input) {
  const snapshot = snapshotProtocolValue(input, "ThreadCandidate");
  return {
    snapshot,
    issues: collectThreadCandidateIssues(snapshot)
  };
}

// src/lib/tweet-thread-validation.ts
function validateThreadCandidate(candidate, brief) {
  const inspected = inspectThreadCandidateForValidation(candidate);
  let suppliedBriefSnapshot;
  let suppliedBriefInvalid = false;
  if (brief !== void 0) {
    try {
      suppliedBriefSnapshot = createStrictJsonSnapshot(brief);
    } catch (error) {
      if (error instanceof StrictJsonSnapshotError) {
        suppliedBriefInvalid = true;
      } else {
        throw error;
      }
    }
  }
  const briefMismatch = brief !== void 0 && (suppliedBriefInvalid || !inspected.snapshot || typeof inspected.snapshot !== "object" || canonicalize(inspected.snapshot.brief) !== canonicalize(suppliedBriefSnapshot));
  const result = validateThreadCandidateCore(
    inspected.snapshot,
    inspected.issues,
    briefMismatch ? suppliedBriefSnapshot ?? Object.freeze(/* @__PURE__ */ Object.create(null)) : void 0
  );
  return {
    candidateSha256: result.candidateSha256,
    accepted: result.accepted,
    findings: result.findings,
    measurements: result.measurements
  };
}

// scripts/tweet-thread-validator-cli.ts
var USAGE = "Usage: node tweet-thread-validate.mjs validate <candidate.json> [brief.json]";
var MAX_INPUT_BYTES = 8 * 1024 * 1024;
var CliContractError = class extends Error {
  constructor(safeMessage) {
    super(safeMessage);
    this.safeMessage = safeMessage;
    this.name = "CliContractError";
  }
};
function readJsonFile(label, filename) {
  let handle;
  try {
    handle = openSync(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    throw new CliContractError(`${label} file could not be read.`);
  }
  try {
    let stat;
    try {
      stat = fstatSync(handle);
    } catch {
      throw new CliContractError(`${label} file could not be read.`);
    }
    if (!stat.isFile()) {
      throw new CliContractError(`${label} file must be a regular file.`);
    }
    if (stat.size > MAX_INPUT_BYTES) {
      throw new CliContractError(`${label} file exceeds the portable size limit.`);
    }
    const bounded = Buffer.allocUnsafe(MAX_INPUT_BYTES + 1);
    let total = 0;
    while (total <= MAX_INPUT_BYTES) {
      let read;
      try {
        read = readSync(handle, bounded, total, bounded.byteLength - total, null);
      } catch {
        throw new CliContractError(`${label} file could not be read.`);
      }
      if (read === 0) break;
      total += read;
    }
    if (total > MAX_INPUT_BYTES) {
      throw new CliContractError(`${label} file exceeds the portable size limit.`);
    }
    try {
      return JSON.parse(bounded.subarray(0, total).toString("utf8"));
    } catch {
      throw new CliContractError(`${label} JSON could not be parsed.`);
    }
  } finally {
    if (handle !== void 0) closeSync(handle);
  }
}
function readBrief(filename) {
  if (filename === void 0) return void 0;
  return readJsonFile("brief", filename);
}
function run() {
  const [command, candidatePath, briefPath, ...extra] = process.argv.slice(2);
  if (command !== "validate" || candidatePath === void 0 || extra.length > 0) {
    process.stderr.write(`${USAGE}
`);
    process.exitCode = 2;
    return;
  }
  try {
    const candidate = readJsonFile("candidate", candidatePath);
    const brief = readBrief(briefPath);
    const result = validateThreadCandidate(candidate, brief);
    process.stdout.write(`${JSON.stringify(result)}
`);
    process.exitCode = result.accepted ? 0 : 1;
  } catch (error) {
    const message = error instanceof CliContractError ? error.safeMessage : "runtime contract error.";
    process.stderr.write(`tweet-thread-validate: ${message}
`);
    process.exitCode = 2;
  }
}
run();
