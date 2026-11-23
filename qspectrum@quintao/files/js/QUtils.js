/*
 * Copyright (c) 2026 - Raphael Quintao <raphaelquintao@gmail.com>
 * https://github.com/raphaelquintao/qspectrumcinnamon
 * SPDX-License-Identifier: Apache-2.0
 */

const Cairo = imports.cairo;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Cinnamon = imports.gi.Cinnamon;
const Signals = imports.signals;
const St = imports.gi.St;
const Atk = imports.gi.Atk;
const Gio = imports.gi.Gio;

const BoxPointer = imports.ui.boxpointer;
const DND = imports.ui.dnd;
const Main = imports.ui.main;
const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Util = imports.misc.util;

const UUID = "qspectrum@quintao";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}


function lerp(if_t_zero, if_t_one, t) {
  return (if_t_zero + (if_t_one - if_t_zero) * t);
}


/**
 * Rate-limit `fn` to at most one call per `delay_ms` (leading + trailing).
 * @param {Function} fn
 * @param {number} delay_ms
 * @return {Function}
 * @see https://lodash.com/docs/#throttle
 */
function THROTTLE(fn, delay_ms) {
  let last_call = 0;
  let pending_timer = null;
  return function (...args) {
    const now = Date.now();
    const remaining = delay_ms - (now - last_call);
    if (remaining <= 0) {
      clearTimeout(pending_timer);
      pending_timer = null;
      last_call = now;
      fn.apply(this, args);
    } else if (!pending_timer) {
      pending_timer = setTimeout(() => {
        pending_timer = null;
        last_call = Date.now();
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * Run `fn` once `delay_ms` has passed with no further calls.
 * @param {Function} fn
 * @param {number} delay_ms
 * @return {Function}
 * @see https://lodash.com/docs/#debounce
 */
function DEBOUNCE(fn, delay_ms) {
  let pending_timer = null;
  return function (...args) {
    clearTimeout(pending_timer);
    pending_timer = setTimeout(() => {
      pending_timer = null;
      fn.apply(this, args);
    }, delay_ms);
  };
}

/**
 * @param {Number[]} data
 * @return {string}
 */
function byte_array_to_string(data) {
  if (ByteArray.hasOwnProperty("toString")) return "" + ByteArray.toString(data);
  return "" + data;
}

/**
 * A custom logging function that formats messages and data for better readability in the console.
 * It handles various data types, including objects, arrays, and GObjects, and formats them with indentation for easier debugging.
 * Info and trace messages are only logged when global.QDEBUG is true; errors and warnings are always logged.
 * @param {'i', 'w', 'e'} _category - The main message to log.
 * @param {string} msg - The main message to log.
 * @param {...any} data - Additional data to log, which can be of any type (objects, arrays, primitives, etc.).
 * @returns {void}
 */
function _qLOG(_category, msg, ...data) {
  const category = {i: 'info', w: 'warning', e: 'error', t: 'trace'}[_category];
  if (!global.QDEBUG && (category === 'info' || category === 'trace')) return;
  
  const use_cols = true;
  
  let max_cols = 90;
  
  /** @type {{text: string[], lines: number, cols: number}[]} */
  let _data_cols = [];
  let _data_max_cols = 0;
  let _data_max_lines = 0;
  
  let _formated_arr = [];
  let _formated = '';
  if (data && data.length > 0) {
    for (let d of data) {
      let text = formatLogArgument(d);
      let lines = text.split(/\n/);
      let lines_length = lines.length;
      let cols = 0;
      for (let l of lines) {
        if (l.length > cols) cols = l.length;
        if (l.length > _data_max_cols) _data_max_cols = l.length;
      }
      if (lines_length > _data_max_lines) _data_max_lines = lines_length;
      _data_cols.push({text: lines, cols, lines: lines_length});
    }
    if (use_cols) {
      for (let i in _data_cols) {
        let col = _data_cols[i];
        for (let j = 0; j < _data_max_lines; j++) {
          if (!_formated_arr[j]) _formated_arr[j] = '';
          
          let line = col.text[j];
          if (line) {
            line = line.padEnd(col.cols, ' ');
            if (i > 0) line = ' | ' + line;
            _formated_arr[j] += line;
          } else _formated_arr[j] += ''.padStart(col.cols, ' ');
        }
      }
    } else {
      for (let i in _data_cols) {
        let col = _data_cols[i];
        if (i > 0) _formated_arr.push('_'.padEnd(_data_max_cols, '_'));
        for (let line of col.text) {
          line = line.padEnd(_data_max_cols, ' ');
          _formated_arr.push(line);
        }
      }
    }
  }
  _formated = _formated_arr.join('\n');
  
  let box = ''.padStart(max_cols, '=');
  let title = center(` ${msg} `, max_cols, _formated ? "=" : ' ');
  
  let out = '';
  if (_formated) {
    out += `${title}`;
    out += `\n${_formated}`;
  } else {
    out += `${box}`;
    out += `\n${title}`;
  }
  
  out += `\n${box}`;
  
  Main._log(category, `\n${out}\n`);
  
  function center(text, size, fill = " ") {
    let diff = size - text.length;
    return text.padStart((diff / 2) + text.length, fill).padEnd(size, fill);
  }
  
  function formatLogArgument(arg = '', recursion = 0, depth = 4) {
    // global.logWarning(typeof arg);
    const GObject = imports.gi.GObject;
    // Make sure falsey values are clearly indicated.
    if (arg === null) {
      arg = 'null';
    } else if (arg === undefined) {
      arg = 'undefined';
      // Ensure strings are distinguishable.
    } else if (typeof arg === 'string' && recursion > 0) {
      arg = '\'' + arg + '\'';
    } else if (['boolean', 'number'].includes(typeof arg)) {
      arg = '' + arg;
    }
    // Check if we reached the depth threshold
    if (recursion + 1 > depth) {
      try {
        arg = JSON.stringify(arg);
      } catch (e) {
        arg = byte_array_to_string(arg);
      }
      return arg;
    }
    let isGObject = arg instanceof GObject.Object;
    
    let space = '';
    for (let i = 0; i < recursion + 1; i++) {
      space += '    ';
    }
    if (typeof arg === 'object') {
      let isArray = Array.isArray(arg);
      let brackets = isArray ? ['[', ']'] : ['{', '}'];
      if (isGObject) {
        arg = Util.getGObjectPropertyValues(arg);
        if (Object.keys(arg).length === 0) {
          return byte_array_to_string(arg);
        }
      }
      let array = isArray ? arg : Object.keys(arg);
      // Add beginning bracket with indentation
      let string = brackets[0] + (recursion + 1 > depth ? '' : '\n');
      for (let j = 0, len = array.length; j < len; j++) {
        if (isArray) {
          string += space + formatLogArgument(arg[j], recursion + 1, depth) + ',\n';
        } else {
          string += space + array[j] + ': ' + formatLogArgument(arg[array[j]], recursion + 1, depth) + ',\n';
        }
      }
      // Remove one level of indentation and add the closing bracket.
      space = space.substr(4, space.length);
      arg = string + space + brackets[1];
      // Functions, numbers, etc.
    } else if (typeof arg === 'function') {
      let array = arg.toString().split('\n');
      for (let i = 0; i < array.length; i++) {
        if (i === 0) continue;
        array[i] = space + array[i];
      }
      arg = array.join('\n');
    } else if (typeof arg !== 'string' || isGObject) {
      arg = byte_array_to_string(arg);
    }
    return arg;
  }
}

/**
 * Custom formated Log
 * @function
 * @param {string} msg - The main message to log.
 * @param {...any} data - Additional data to log, which can be of any type (objects, arrays, primitives, etc.).
 */
const qLOG = (msg, ...data) => _qLOG('w', msg, ...data);

/** Log to: info */
qLOG.i = (msg, ...data) => _qLOG('i', msg, ...data);
/** Log to: warning */
qLOG.w = (msg, ...data) => _qLOG('w', msg, ...data);
/** Log to: error */
qLOG.e = (msg, ...data) => _qLOG('e', msg, ...data);
/** Log to: trace */
qLOG.t = (msg, ...data) => _qLOG('t', msg, ...data);


// Easing curves ported from AHEasing (Warren Moore), which itself models
// Robert Penner's easing equations. Every curve maps a normalized progress
// p in [0, 1] to an eased value (overshoot curves like back/elastic go a
// bit outside that range on purpose).
// Source: https://github.com/warrenm/AHEasing (easing.c); Penner,
// http://robertpenner.com/easing/
const M_PI_2 = Math.PI / 2;

/*
 * count: 31
 linearInterpolation    0.0000  0.2500  0.5000  0.7500  1.0000
 quadraticEaseIn        0.0000  0.0625  0.2500  0.5625  1.0000
 quadraticEaseOut       0.0000  0.4375  0.7500  0.9375  1.0000
 quadraticEaseInOut     0.0000  0.1250  0.5000  0.8750  1.0000
 cubicEaseIn            0.0000  0.0156  0.1250  0.4219  1.0000
 cubicEaseOut           0.0000  0.5781  0.8750  0.9844  1.0000
 cubicEaseInOut         0.0000  0.0625  0.5000  0.9375  1.0000
 quarticEaseIn          0.0000  0.0039  0.0625  0.3164  1.0000
 quarticEaseOut         0.0000  0.6836  0.9375  0.9961  1.0000
 quarticEaseInOut       0.0000  0.0313  0.5000  0.9688  1.0000
 quinticEaseIn          0.0000  0.0010  0.0313  0.2373  1.0000
 quinticEaseOut         0.0000  0.7627  0.9688  0.9990  1.0000
 quinticEaseInOut       0.0000  0.0156  0.5000  0.9844  1.0000
 sineEaseIn             0.0000  0.0761  0.2929  0.6173  1.0000
 sineEaseOut            0.0000  0.3827  0.7071  0.9239  1.0000
 sineEaseInOut          0.0000  0.1464  0.5000  0.8536  1.0000
 circularEaseIn         0.0000  0.0318  0.1340  0.3386  1.0000
 circularEaseOut        0.0000  0.6614  0.8660  0.9682  1.0000
 circularEaseInOut      0.0000  0.0670  0.5000  0.9330  1.0000
 exponentialEaseIn      0.0000  0.0055  0.0313  0.1768  1.0000
 exponentialEaseOut     0.0000  0.8232  0.9688  0.9945  1.0000
 exponentialEaseInOut   0.0000  0.0156  0.5000  0.9844  1.0000
 elasticEaseIn          0.0000  -0.0051  -0.0221  0.0676  1.0000
 elasticEaseOut         0.0000  0.9324  1.0221  1.0051  1.0000
 elasticEaseInOut       0.0000  -0.0110  0.5000  1.0110  1.0000
 backEaseIn             0.0000  -0.1612  -0.3750  -0.1085  1.0000
 backEaseOut            0.0000  1.1085  1.3750  1.1612  1.0000
 backEaseInOut          0.0000  -0.1875  0.5000  1.1875  1.0000
 bounceEaseIn           -0.0000  0.0411  0.2813  0.5273  1.0000
 bounceEaseOut          0.0000  0.4727  0.7187  0.9589  1.0000
 bounceEaseInOut        -0.0000  0.1406  0.5000  0.8594  1.0000
 * */
class Easing {
  
  /**
   * Modeled after the line y = x <br>
   * 0.0000  0.2500  0.5000  0.7500  1.0000
   * @param p
   * @return {*}
   */
  static linear_interpolation(p) {
    return p;
  }
  
  /**
   * Modeled after the parabola y = x^2 <br>
   * 0.0000  0.0625  0.2500  0.5625  1.0000
   * @param {number} p
   * @return {number}
   */
  static quadratic_ease_in(p) {
    return p * p;
  }
  
  /**
   * Modeled after the parabola y = -x^2 + 2x <br>
   * 0.0000  0.4375  0.7500  0.9375  1.0000
   * @param {number} p
   * @return {number}
   */
  static quadratic_ease_out(p) {
    return -(p * (p - 2));
  }
  
  /**
   * Modeled after the piecewise quadratic \
   * y = (1/2)((2x)^2)             ; [0, 0.5) \
   * y = -(1/2)((2x-1)*(2x-3) - 1) ; [0.5, 1] <br>
   * 0.0000  0.1250  0.5000  0.8750  1.0000
   * @param {number} p
   * @return {number}
   */
  static quadratic_ease_in_out(p) {
    if (p < 0.5) return 2 * p * p;
    return (-2 * p * p) + (4 * p) - 1;
  }
  
  /**
   * Modeled after the cubic y = x^3
   * @param {number} p
   * @return {number}
   */
  static cubic_ease_in(p) {
    return p * p * p;
  }
  
  /**
   * Modeled after the cubic y = (x - 1)^3 + 1
   * @param {number} p
   * @return {number}
   */
  static cubic_ease_out(p) {
    const f = (p - 1);
    return f * f * f + 1;
  }
  
  /**
   * Modeled after the piecewise cubic \
   * y = (1/2)((2x)^3)       ; [0, 0.5) \
   * y = (1/2)((2x-2)^3 + 2) ; [0.5, 1]
   *
   * @param {number} p
   * @return {number}
   */
  static cubic_ease_in_out(p) {
    if (p < 0.5) return 4 * p * p * p;
    const f = ((2 * p) - 2);
    return 0.5 * f * f * f + 1;
  }
  
  /**
   * Modeled after the quartic x^4
   * @param {number} p
   * @return {number}
   */
  static quartic_ease_in(p) {
    return p * p * p * p;
  }
  
  // Modeled after the quartic y = 1 - (x - 1)^4
  static quartic_ease_out(p) {
    const f = (p - 1);
    return f * f * f * (1 - p) + 1;
  }
  
  // Modeled after the piecewise quartic \
  // y = (1/2)((2x)^4)        ; [0, 0.5)
  // y = -(1/2)((2x-2)^4 - 2) ; [0.5, 1]
  static quartic_ease_in_out(p) {
    if (p < 0.5) return 8 * p * p * p * p;
    const f = (p - 1);
    return -8 * f * f * f * f + 1;
  }
  
  // Modeled after the quintic y = x^5
  static quintic_ease_in(p) {
    return p * p * p * p * p;
  }
  
  // Modeled after the quintic y = (x - 1)^5 + 1
  static quintic_ease_out(p) {
    const f = (p - 1);
    return f * f * f * f * f + 1;
  }
  
  // Modeled after the piecewise quintic
  // y = (1/2)((2x)^5)       ; [0, 0.5)
  // y = (1/2)((2x-2)^5 + 2) ; [0.5, 1]
  static quintic_ease_in_out(p) {
    if (p < 0.5) return 16 * p * p * p * p * p;
    const f = ((2 * p) - 2);
    return 0.5 * f * f * f * f * f + 1;
  }
  
  // Modeled after quarter-cycle of sine wave
  static sine_ease_in(p) {
    return Math.sin((p - 1) * M_PI_2) + 1;
  }
  
  // Modeled after quarter-cycle of sine wave (different phase)
  static sine_ease_out(p) {
    return Math.sin(p * M_PI_2);
  }
  
  // Modeled after half sine wave
  static sine_ease_in_out(p) {
    return 0.5 * (1 - Math.cos(p * Math.PI));
  }
  
  // Modeled after shifted quadrant IV of unit circle
  static circular_ease_in(p) {
    return 1 - Math.sqrt(1 - (p * p));
  }
  
  // Modeled after shifted quadrant II of unit circle
  static circular_ease_out(p) {
    return Math.sqrt((2 - p) * p);
  }
  
  // Modeled after the piecewise circular function
  // y = (1/2)(1 - sqrt(1 - 4x^2))           ; [0, 0.5)
  // y = (1/2)(sqrt(-(2x - 3)*(2x - 1)) + 1) ; [0.5, 1]
  static circular_ease_in_out(p) {
    if (p < 0.5) return 0.5 * (1 - Math.sqrt(1 - 4 * (p * p)));
    return 0.5 * (Math.sqrt(-((2 * p) - 3) * ((2 * p) - 1)) + 1);
  }
  
  // Modeled after the exponential function y = 2^(10(x - 1))
  static exponential_ease_in(p) {
    return p === 0.0 ? p : Math.pow(2, 10 * (p - 1));
  }
  
  // Modeled after the exponential function y = -2^(-10x) + 1
  static exponential_ease_out(p) {
    return p === 1.0 ? p : 1 - Math.pow(2, -10 * p);
  }
  
  // Modeled after the piecewise exponential
  // y = (1/2)2^(10(2x - 1))         ; [0, 0.5)
  // y = -(1/2)*2^(-10(2x - 1)) + 1  ; [0.5, 1]
  static exponential_ease_in_out(p) {
    if (p === 0.0 || p === 1.0) return p;
    if (p < 0.5) return 0.5 * Math.pow(2, (20 * p) - 10);
    return -0.5 * Math.pow(2, (-20 * p) + 10) + 1;
  }
  
  // Modeled after the damped sine wave y = sin(13pi/2*x)*pow(2, 10 * (x - 1))
  static elastic_ease_in(p) {
    return Math.sin(13 * M_PI_2 * p) * Math.pow(2, 10 * (p - 1));
  }
  
  // Modeled after the damped sine wave y = sin(-13pi/2*(x + 1))*pow(2, -10x) + 1
  static elastic_ease_out(p) {
    return Math.sin(-13 * M_PI_2 * (p + 1)) * Math.pow(2, -10 * p) + 1;
  }
  
  // Modeled after the piecewise exponentially-damped sine wave
  // y = (1/2)*sin(13pi/2*(2*x))*pow(2, 10 * ((2*x) - 1))      ; [0, 0.5)
  // y = (1/2)*(sin(-13pi/2*((2x-1)+1))*pow(2,-10(2*x-1)) + 2) ; [0.5, 1]
  static elastic_ease_in_out(p) {
    if (p < 0.5) {
      return 0.5 * Math.sin(13 * M_PI_2 * (2 * p)) * Math.pow(2, 10 * ((2 * p) - 1));
    }
    return 0.5 * (Math.sin(-13 * M_PI_2 * ((2 * p - 1) + 1)) * Math.pow(2, -10 * (2 * p - 1)) + 2);
  }
  
  // Modeled after the overshooting cubic y = x^3-x*sin(x*pi)
  static back_ease_in(p) {
    return p * p * p - p * Math.sin(p * Math.PI);
  }
  
  /**
   * Modeled after overshooting cubic y = 1-((1-x)^3-(1-x)*sin((1-x)*pi))
   *
   * @param {number} p
   */
  static back_ease_out(p) {
    const f = (1 - p);
    return 1 - (f * f * f - f * Math.sin(f * Math.PI));
  }
  
  /**
   * Modeled after the piecewise overshooting cubic function
   * y = (1/2)*((2x)^3-(2x)*sin(2*x*pi))           ; [0, 0.5)
   * y = (1/2)*(1-((1-x)^3-(1-x)*sin((1-x)*pi))+1) ; [0.5, 1]
   * @param {number} p
   * @return
   */
  static back_ease_in_out(p) {
    if (p < 0.5) {
      const f = 2 * p;
      return 0.5 * (f * f * f - f * Math.sin(f * Math.PI));
    }
    const f = (1 - (2 * p - 1));
    return 0.5 * (1 - (f * f * f - f * Math.sin(f * Math.PI))) + 0.5;
  }
  
  static bounce_ease_in(p) {
    return 1 - Easing.bounce_ease_out(1 - p);
  }
  
  /**
   * 0.0000  0.4727  0.7187  0.9589  1.0000
   * @param p
   * @return {number}
   */
  static bounce_ease_out(p) {
    if (p < 4 / 11.0) {
      return (121 * p * p) / 16.0;
    } else if (p < 8 / 11.0) {
      return (363 / 40.0 * p * p) - (99 / 10.0 * p) + 17 / 5.0;
    } else if (p < 9 / 10.0) {
      return (4356 / 361.0 * p * p) - (35442 / 1805.0 * p) + 16061 / 1805.0;
    } else {
      return (54 / 5.0 * p * p) - (513 / 25.0 * p) + 268 / 25.0;
    }
  }
  
  /**
   * -0.0000  0.1406  0.5000  0.8594  1.0000
   * @param p
   * @return {number}
   */
  static bounce_ease_in_out(p) {
    if (p < 0.5) return 0.5 * Easing.bounce_ease_in(p * 2);
    return 0.5 * Easing.bounce_ease_out(p * 2 - 1) + 0.5;
  }
}

module.exports = {
  _,
  qLOG,
  lerp,
  THROTTLE,
  DEBOUNCE,
  Easing
};













