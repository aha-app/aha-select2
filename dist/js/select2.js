/**
 * @license almond 0.2.9 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            return req.apply(undef, aps.call(arguments, 0).concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("almond", function(){});

define('jquery',[],function () {
    return jQuery;
})
;
define('select2/utils',[], function () {
  var Utils = {};

  Utils.Extend = function (ChildClass, SuperClass) {
    var __hasProp = {}.hasOwnProperty

    function BaseConstructor () {
      this.constructor = ChildClass;
    }

    for (var key in SuperClass) {
      if (__hasProp.call(SuperClass, key)) {
        ChildClass[key] = SuperClass[key];
      }
    }

    BaseConstructor.prototype = SuperClass.prototype;
    ChildClass.prototype = new BaseConstructor();
    ChildClass.__super__ = SuperClass.prototype;

    return ChildClass;
  };

  function getMethods (theClass) {
    var proto = theClass.prototype;

    var methods = [];

    for (var methodName in proto) {
      var m = proto[methodName];

      if (typeof m !== "function") {
        continue;
      }

      methods.push(methodName);
    }

    return methods;
  }

  Utils.Decorate = function (SuperClass, DecoratorClass) {
    var decoratedMethods = getMethods(DecoratorClass);
    var superMethods = getMethods(SuperClass);

    function DecoratedClass () {
      var unshift = Array.prototype.unshift;

      var argCount = DecoratorClass.prototype.constructor.length;

      var calledConstructor = SuperClass.prototype.constructor;

      if (argCount > 0) {
        unshift.call(arguments, SuperClass.prototype.constructor);

        calledConstructor = DecoratorClass.prototype.constructor;
      }

      calledConstructor.apply(this, arguments);
    }

    function ctr () {
      this.constructor = DecoratedClass;
    }

    DecoratedClass.prototype = new ctr();

    for (var m = 0; m < superMethods.length; m++) {
        var methodName = superMethods[m];

        DecoratedClass.prototype[methodName] = SuperClass.prototype[methodName];
    }

    for (var m = 0; m < decoratedMethods.length; m++) {
      var methodName = decoratedMethods[m];

      function calledMethod (methodName) {
        // Stub out the original method if it's not decorating an actual method
        var originalMethod = function () {};

        if (methodName in DecoratedClass.prototype) {
          originalMethod = DecoratedClass.prototype[methodName];
        }

        var decoratedMethod = DecoratorClass.prototype[methodName];

        return function () {
          var unshift = Array.prototype.unshift;

          unshift.call(arguments, originalMethod);

          return decoratedMethod.apply(this, arguments);
        }
      }

      DecoratedClass.prototype[methodName] = calledMethod(methodName);
    }

    return DecoratedClass;
  }

  var Observable = function () {
    this.listeners = {};
  };

  Observable.prototype.on = function (event, callback) {
    if (event in this.listeners) {
      this.listeners[event].push(callback);
    } else {
      this.listeners[event] = [callback];
    }
  };

  Observable.prototype.trigger = function (event) {
    var slice = Array.prototype.slice;

    if (event in this.listeners) {
      this.invoke(this.listeners[event], slice.call(arguments, 1));
    }

    if ("*" in this.listeners) {
      this.invoke(this.listeners["*"], arguments);
    }
  };

  Observable.prototype.invoke = function (listeners, params) {
    for (var i = 0, len = listeners.length; i < len; i++) {
      listeners[i].apply(this, params);
    }
  };

  Utils.Observable = Observable;

  return Utils;
});

define('select2/data/select',[
  '../utils',
  'jquery'
], function (Utils, $) {
  function SelectAdapter ($element, options) {
    this.$element = $element;

    SelectAdapter.__super__.constructor.call(this);
  }

  Utils.Extend(SelectAdapter, Utils.Observable);

  SelectAdapter.prototype.current = function (callback) {
    var data = [];
    var self = this;

    this.$element.find(":selected").each(function () {
      var $option = $(this);

      var option = self.item($option);

      data.push(option);
    });

    callback(data);
  };

  SelectAdapter.prototype.select = function (data) {
    var val;

    if (this.$element.prop("multiple")) {
      var currentData = this.current();

      data = [data];
      data.push(currentData);

      val = [];

      for (var d = 0; d < data.length; d++) {
        id = data[d].id;

        if (ids.indexOf(id) === -1) {
          val.push(id);
        }
      }
    } else {
      val = data.id;
    }

    this.$element.val(val);
    this.$element.trigger("change");
  }

  SelectAdapter.prototype.query = function (params, callback) {
    var data = [];
    var self = this;

    this.$element.find("option").each(function () {
      var $option = $(this);

      var option = self.item($option);

      if (self.matches(params, option)) {
        data.push(option);
      }
    });

    callback(data);
  };

  SelectAdapter.prototype.item = function ($option) {
    var data = {
      id: $option.val(),
      text: $option.html()
    };

    return data;
  };

  SelectAdapter.prototype.matches = function (params, data) {
    if ($.trim(params.term) == "") {
      return true;
    }

    if (data.text.indexOf(params.term) > -1) {
      return true;
    }

    return false;
  }

  return SelectAdapter;
});

define('select2/results',[
  './utils'
], function (Utils) {
  function Results ($element, options, dataAdapter) {
    this.$element = $element;
    this.data = dataAdapter;

    Results.__super__.constructor.call(this);
  }

  Utils.Extend(Results, Utils.Observable);

  Results.prototype.render = function () {
    var $results = $(
      '<ul class="options"></ul>'
    );

    this.$results = $results;

    return $results;
  };

  Results.prototype.clear = function () {
    this.$results.empty();
  };

  Results.prototype.append = function (data) {
    var $options = [];

    for (var d = 0; d < data.length; d++) {
      var item = data[d];

      var $option = this.option(item);

      $options.push($option);
    }

    this.$results.append($options);
  };

  Results.prototype.setClasses = function () {
    var self = this;

    this.data.current(function (selected) {
      selected = $.map(selected, function (s) { return s.id; });

      self.$results.find(".option.selected").removeClass("selected");

      var $options = self.$results.find(".option");

      $options.each(function () {
        var $option = $(this);
        var item = $option.data("data");

        if (selected.indexOf(item.id) > -1) {
          $option.addClass("selected");
        }
      });
    });
  };

  Results.prototype.option = function (data) {
    var $option = $(
      '<li class="option"></li>'
    );

    $option.html(data.text);
    $option.data("data", data);

    return $option;
  }

  Results.prototype.bind = function ($container) {
    var self = this;

    this.on("results:all", function (data) {
      self.clear();
      self.append(data);
      self.setClasses();
    });

    this.on("results:append", function (data) {
      self.append(data);

      self.setClasses();
    })

    this.$results.on("click", ".option", function (evt) {
      var data = $(this).data("data");

      self.trigger("selected", {
        originalEvent: evt,
        data: data
      });

      self.setClasses();
    });

    this.$results.on("mouseenter", ".option", function (evt) {
      self.$results.find(".option.highlighted").removeClass("highlighted");
      $(this).addClass("highlighted");
    });

    this.$results.on("mouseleave", ".option", function (evt) {
      $(this).removeClass("highlighted");
    });
  };

  return Results;
})
;
define('select2/dropdown',[
  './utils'
], function (Utils) {
  function Dropdown ($element, options) {
    this.$element = $element;
  }

  Utils.Extend(Dropdown, Utils.Observable);

  Dropdown.prototype.render = function () {
    var $dropdown = $(
      '<span class="">' +
        '<span class="results"></span>' +
      '</span>'
    );

    return $dropdown;
  }

  return Dropdown;
})
;
define('select2/selection',[
  './utils'
], function (Utils) {
  function Selection ($element, options) {
    this.$element = $element;
    this.options = options;

    Selection.__super__.constructor.call(this);
  }

  Utils.Extend(Selection, Utils.Observable);

  Selection.prototype.render = function () {
    var $selection = $(
      '<span class="single-select">' +
        '<span class="rendered-selection"></span>' +
      '</span>'
    );

    this.$selection = $selection;

    return $selection;
  }

  Selection.prototype.bind = function ($container) {
    var self = this;

    this.$selection.on('click', function (evt) {
      self.trigger("toggle", {
        originalEvent: evt
      });
    });
  }

  Selection.prototype.clear = function () {
    this.$selection.find(".rendered-selection").text("");
  }

  Selection.prototype.display = function (data) {
    return data.text;
  }

  Selection.prototype.update = function (data) {
    if (data.length == 0) {
      this.clear();
      return;
    }

    var selection = data[0];

    var formatted = this.display(selection);

    this.$selection.find(".rendered-selection").html(formatted);
  }

  return Selection;
});

define('select2/options',[
  './data/select',
  './results',
  './dropdown',
  './selection'
], function (SelectData, ResultsList, Dropdown, Selection) {
  function Options (options) {
    this.options = options;

    this.dataAdapter = SelectData;
    this.resultsAdapter = ResultsList;
    this.dropdownAdapter = Dropdown;
    this.selectionAdapter = options.selectionAdapter || Selection;
  }

  return Options;
})
;
define('select2/core',[
  'jquery',
  './options',
  './utils'
], function ($, Options, Utils) {
  var Select2 = function ($element, options) {
    this.$element = $element;
    this.options = new Options(options);

    Select2.__super__.constructor.call(this);

    // Set up containers and adapters

    this.data = new this.options.dataAdapter($element, this.options);

    var $container = this.render();

    $container.insertAfter(this.$element);

    $container.width($element.width());

    this.selection = new this.options.selectionAdapter($element, this.options);

    var $selectionContainer = $container.find(".selection");
    var $selection = this.selection.render();

    $selectionContainer.append($selection);

    this.dropdown = new this.options.dropdownAdapter($element, this.options);

    var $dropdownContainer = $container.find(".dropdown");
    var $dropdown = this.dropdown.render();

    $dropdownContainer.append($dropdown);

    this.results = new this.options.resultsAdapter($element, this.options, this.data);

    var $resultsContainer = $dropdown.find(".results");
    var $results = this.results.render();

    $resultsContainer.append($results);

    // Bind events

    var self = this;

    this.selection.bind($container);
    this.results.bind($container);

    this.$element.on("change", function () {
      self.data.current(function (data) {
        self.selection.update(data);
      });
    });

    this.selection.on("toggle", function () {
      $container.toggleClass("open");
    });

    this.results.on("selected", function (params) {
      self.data.select(params.data);
      $container.removeClass("open");
    });

    // Set the initial state

    this.data.current(function (initialData) {
      self.selection.update(initialData);
    });

    this.data.query({}, function (data) {
      self.results.trigger("results:all", data);
    });
  };

  Utils.Extend(Select2, Utils.Observable);

  Select2.prototype.render = function () {
    var $container = $(
      '<span class="select2 select2-container select2-theme-default">' +
        '<span class="selection"></span>' +
        '<span class="dropdown"></span>' +
      '</span>'
    );

    return $container;
  };

  return Select2;
});
