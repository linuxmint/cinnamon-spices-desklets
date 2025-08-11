/**
 * The fromXML() method parses an XML string, constructing the JavaScript
 * value or object described by the string.
 *
 * @function fromXML
 * @param text {String} The string to parse as XML
 * @param [reviver] {Function} If a function, prescribes how the value
 * originally produced by parsing is transformed, before being returned.
 * @returns {Object}
 */

const UNESCAPE = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&apos;": "'",
  "&quot;": '"'
};

const ATTRIBUTE_KEY = "@";
const CHILD_NODE_KEY = "#";

function _fromXML(text, reviver) {
  return toObject(parseXML(text), reviver);
}

function parseXML(text) {
  const list = String.prototype.split.call(text, /<([^!<>?](?:'[\S\s]*?'|"[\S\s]*?"|[^'"<>])*|!(?:--[\S\s]*?--|\[[^\[\]'"<>]+\[[\S\s]*?]]|DOCTYPE[^\[<>]*?\[[\S\s]*?]|(?:ENTITY[^"<>]*?"[\S\s]*?")?[\S\s]*?)|\?[\S\s]*?\?)>/);
  const length = list.length;

  // root element
  const root = { f: [] };
  let elem = root;

  // dom tree stack
  const stack = [];

  for (let i = 0; i < length;) {
    // text node
    const str = list[i++];
    if (str) appendText(str);

    // child node
    const tag = list[i++];
    if (tag) parseNode(tag);
  }

  return root;

  function parseNode(tag) {
    const tagLength = tag.length;
    const firstChar = tag[0];
    if (firstChar === "/") {
      // close tag
      const closed = tag.replace(/^\/|[\s\/].*$/g, "").toLowerCase();
      while (stack.length) {
        const tagName = elem.n && elem.n.toLowerCase();
        elem = stack.pop();
        if (tagName === closed) break;
      }
    } else if (firstChar === "?") {
      // XML declaration
      appendChild({ n: "?", r: tag.substr(1, tagLength - 2) });
    } else if (firstChar === "!") {
      if (tag.substr(1, 7) === "[CDATA[" && tag.substr(-2) === "]]") {
        // CDATA section
        appendText(tag.substr(8, tagLength - 10));
      } else {
        // comment
        appendChild({ n: "!", r: tag.substr(1) });
      }
    } else {
      const child = openTag(tag);
      appendChild(child);
      if (tag[tagLength - 1] === "/") {
        child.c = 1; // emptyTag
      } else {
        stack.push(elem); // openTag
        elem = child;
      }
    }
  }

  function appendChild(child) {
    elem.f.push(child);
  }

  function appendText(str) {
    str = removeSpaces(str);
    if (str) appendChild(unescapeXML(str));
  }
}

function openTag(tag) {
  const elem = { f: [] };
  tag = tag.replace(/\s*\/?$/, "");
  const pos = tag.search(/[\s='"\/]/);
  if (pos < 0) {
    elem.n = tag;
  } else {
    elem.n = tag.substr(0, pos);
    elem.t = tag.substr(pos);
  }
  return elem;
}

function parseAttribute(elem, reviver) {
  if (!elem.t) return;
  const list = elem.t.split(/([^\s='"]+(?:\s*=\s*(?:'[\S\s]*?'|"[\S\s]*?"|[^\s'"]*))?)/);
  const length = list.length;
  let attributes, val;

  for (let i = 0; i < length; i++) {
    let str = removeSpaces(list[i]);
    if (!str) continue;

    if (!attributes) {
      attributes = {};
    }

    const pos = str.indexOf("=");
    if (pos < 0) {
      // bare attribute
      str = ATTRIBUTE_KEY + str;
      val = null;
    } else {
      // attribute key/value pair
      val = str.substr(pos + 1).replace(/^\s+/, "");
      str = ATTRIBUTE_KEY + str.substr(0, pos).replace(/\s+$/, "");

      // quote: foo="FOO" bar='BAR'
      const firstChar = val[0];
      const lastChar = val[val.length - 1];
      if (firstChar === lastChar && (firstChar === "'" || firstChar === '"')) {
        val = val.substr(1, val.length - 2);
      }

      val = unescapeXML(val);
    }
    if (reviver) {
      val = reviver(str, val);
    }
    addObject(attributes, str, val);
  }

  return attributes;
}

function removeSpaces(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/^\s+|\s+$/g, "");
}

function unescapeXML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/(&(?:lt|gt|amp|apos|quot|#(?:\d{1,6}|x[0-9a-fA-F]{1,5}));)/g, function (str) {
    if (str[1] === "#") {
      const code = (str[2] === "x") ? parseInt(str.substr(3), 16) : parseInt(str.substr(2), 10);
      if (code > -1) return String.fromCharCode(code);
    }
    return UNESCAPE[str] || str;
  });
}

function toObject(elem, reviver) {
  if ("string" === typeof elem) return elem;

  const raw = elem.r;
  if (raw) return raw;

  const attributes = parseAttribute(elem, reviver);
  let object;
  const childList = elem.f;
  const childLength = childList.length;

  if (attributes || childLength > 1) {
    // merge attributes and child nodes
    object = attributes || {};
    childList.forEach(function (child) {
      if ("string" === typeof child) {
        addObject(object, CHILD_NODE_KEY, child);
      } else {
        addObject(object, child.n, toObject(child, reviver));
      }
    });
  } else if (childLength) {
    // the node has single child node but no attribute
    const child = childList[0];
    object = toObject(child, reviver);
    if (child.n) {
      const wrap = {};
      wrap[child.n] = object;
      object = wrap;
    }
  } else {
    // the node has no attribute nor child node
    object = elem.c ? null : "";
  }

  if (reviver) {
    object = reviver(elem.n || "", object);
  }

  return object;
}

function addObject(object, key, val) {
  if ("undefined" === typeof val) return;
  const prev = object[key];
  if (prev instanceof Array) {
    prev.push(val);
  } else if (key in object) {
    object[key] = [prev, val];
  } else {
    object[key] = val;
  }
}

// Export the fromXML function
const fromXML = _fromXML;

module.exports = {
  fromXML
};