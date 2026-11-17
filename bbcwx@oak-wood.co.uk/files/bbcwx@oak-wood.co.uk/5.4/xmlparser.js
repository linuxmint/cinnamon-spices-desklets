// Single-pass XML parser for the RSS feeds the drivers download.
//
// Replaces the marknote library for this job. marknote re-tokenised every nested
// element, which costs ~150 ms per BBC refresh on the thread that draws the
// whole desktop; this reads the text once.
//
// It offers the subset of marknote's interface the BBC driver uses
// (getRootElement, getChildElement, getChildElements, getText), with the same
// results on well-formed feeds. Where it differs, it is deliberately stricter
// or more correct:
// - getText() includes text inside child elements; marknote stopped at the
//   first child element.
// - Broken XML (mismatched or unclosed tags, text outside the root, a
//   truncated download) makes parse() return null instead of a partial tree.
// - &amp; and numeric references such as &#176; are decoded.
// - A '<' that cannot start a tag, as in "Visibility: <1km", is kept as text
//   rather than cutting the text short.

// Refuse anything bigger. This runs on the thread that draws the desktop, and
// parse time grows with length: the worst input measured at this cap took
// ~10 ms (under a frame), against ~84 ms at 256 KB. A BBC feed is ~4 KB.
const MAX_DOCUMENT_LENGTH = 32 * 1024;
const BYTE_ORDER_MARK = '﻿';
const HIGHEST_CODE_POINT = 0x10FFFF;
const FIRST_SURROGATE = 0xD800;
const LAST_SURROGATE = 0xDFFF;
const HEXADECIMAL = 16;
const DECIMAL = 10;
// how much stray text to quote in an error message
const ERROR_PREVIEW_LENGTH = 40;

const COMMENT_START = '<!--';
const COMMENT_END = '-->';
const CDATA_START = '<![CDATA[';
const CDATA_END = ']]>';
const PROCESSING_INSTRUCTION_START = '<?';
const PROCESSING_INSTRUCTION_END = '?>';
const DECLARATION_START = '<!';
const END_TAG_START = '</';

const NAME = '[A-Za-z_:\\u00C0-\\uFFFF][-\\w.:\\u00B7\\u00C0-\\uFFFF]*';
const QUOTED_OR_BARE_VALUE = '"[^"]*"|\'[^\']*\'|[^\\s"\'=<>\`/]+';
// attributes are accepted so tags carrying them still parse, but not kept
const ATTRIBUTE = NAME + '(?:\\s*=\\s*(?:' + QUOTED_OR_BARE_VALUE + '))?';
const START_TAG = new RegExp('<(' + NAME + ')(?:\\s+' + ATTRIBUTE + ')*\\s*(/?)>', 'y');
const END_TAG = new RegExp('</(' + NAME + ')\\s*>', 'y');
const NAME_START = new RegExp('^' + NAME);
const ENTITY_REFERENCE = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));/g;

// The HTML 4 named entities, the same set marknote decoded, so text decodes identically.
const NAMED_ENTITIES = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, nbsp: 160, iexcl: 161, cent: 162, pound: 163,
  curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171,
  not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177, sup2: 178, sup3: 179, acute: 180,
  micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188,
  frac12: 189, frac34: 190, iquest: 191, Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195,
  Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203,
  Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211,
  Ocirc: 212, Otilde: 213, Ouml: 214, times: 215, Oslash: 216, Ugrave: 217, Uacute: 218,
  Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222, szlig: 223, agrave: 224, aacute: 225, acirc: 226,
  atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231, egrave: 232, eacute: 233,
  ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240, ntilde: 241,
  ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247, oslash: 248,
  ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253, thorn: 254, yuml: 255, OElig: 338,
  oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732, Alpha: 913,
  Beta: 914, Gamma: 915, Delta: 916, Epsilon: 917, Zeta: 918, Eta: 919, Theta: 920, Iota: 921,
  Kappa: 922, Lambda: 923, Mu: 924, Nu: 925, Xi: 926, Omicron: 927, Pi: 928, Rho: 929, Sigma: 931,
  Tau: 932, Upsilon: 933, Phi: 934, Chi: 935, Psi: 936, Omega: 937, alpha: 945, beta: 946,
  gamma: 947, delta: 948, epsilon: 949, zeta: 950, eta: 951, theta: 952, iota: 953, kappa: 954,
  lambda: 955, mu: 956, nu: 957, xi: 958, omicron: 959, pi: 960, rho: 961, sigmaf: 962, sigma: 963,
  tau: 964, upsilon: 965, phi: 966, chi: 967, psi: 968, omega: 969, thetasym: 977, upish: 978,
  piv: 982, ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221,
  bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242,
  Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364, image: 8465,
  weierp: 8472, real: 8476, trade: 8482, alefsym: 8501, larr: 8592, uarr: 8593, rarr: 8594,
  darr: 8595, harr: 8596, crarr: 8629, lArr: 8656, uArr: 8657, rArr: 8658, dArr: 8659, hArr: 8660,
  forall: 8704, part: 8706, exist: 8707, empty: 8709, nabla: 8711, isin: 8712, notin: 8713,
  ni: 8715, prod: 8719, sum: 8721, minus: 8722, lowast: 8727, radic: 8730, prop: 8733, infin: 8734,
  ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756, sim: 8764,
  cong: 8773, asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835,
  nsub: 8836, sube: 8838, supe: 8839, oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901,
  lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971, lang: 9001, rang: 9002, loz: 9674,
  spades: 9824, clubs: 9827, hearts: 9829, diams: 9830
};

var XmlElement = class XmlElement {
  constructor(name) {
    this.name = name;
    this.children = [];
    // text and child elements in document order
    this.contents = [];
  }

  // false when absent, as marknote returns
  getChildElement(name) {
    return this.children.find(child => child.name === name) || false;
  }

  getChildElements(name) {
    return this.children.filter(child => child.name === name);
  }

  // all text inside this element, including inside child elements, so markup
  // such as "Pollution: <b>Low</b>" still reads "Pollution: Low"
  getText() {
    return this.contents.map(content => (typeof content === 'string') ? content : content.getText()).join('');
  }
};

var XmlDocument = class XmlDocument {
  constructor(rootElement) {
    this.rootElement = rootElement;
  }

  getRootElement() {
    return this.rootElement;
  }
};

class MalformedXml extends Error { }

// Returns an XmlDocument, or null (after logging why) if text is not usable XML.
function parse(text) {
  try {
    return new XmlDocument(parseRootElement(text));
  } catch (e) {
    if (!(e instanceof MalformedXml)) throw e;
    global.logWarning('bbcwx: could not parse XML: ' + e.message);
    return null;
  }
}

function parseRootElement(text) {
  if (typeof text !== 'string') throw new MalformedXml('expected text, got ' + typeof text);
  if (text.length > MAX_DOCUMENT_LENGTH) throw new MalformedXml(text.length + ' characters is too large');
  if (text.startsWith(BYTE_ORDER_MARK)) text = text.slice(BYTE_ORDER_MARK.length);

  let root = null;
  let openElements = [];
  let position = 0;

  let currentElement = () => openElements[openElements.length - 1];

  let addText = (decodedText) => {
    let parent = currentElement();
    if (parent) {
      parent.contents.push(decodedText);
    } else if (decodedText.trim() !== '') {
      throw new MalformedXml('text outside the root element: ' + JSON.stringify(decodedText.trim().slice(0, ERROR_PREVIEW_LENGTH)));
    }
  };

  let skipPast = (terminator, from, what) => {
    let end = text.indexOf(terminator, from);
    if (end === -1) throw new MalformedXml('unterminated ' + what);
    return end + terminator.length;
  };

  while (position < text.length) {
    let tagStart = text.indexOf('<', position);
    if (tagStart === -1) {
      addText(decodeEntities(text.slice(position)));
      break;
    }
    if (tagStart > position) addText(decodeEntities(text.slice(position, tagStart)));
    let afterTagOpen = tagStart + '<'.length;

    if (text.startsWith(COMMENT_START, tagStart)) {
      position = skipPast(COMMENT_END, tagStart + COMMENT_START.length, 'comment');
    } else if (text.startsWith(CDATA_START, tagStart)) {
      let contentStart = tagStart + CDATA_START.length;
      position = skipPast(CDATA_END, contentStart, 'CDATA section');
      addText(text.slice(contentStart, position - CDATA_END.length));
    } else if (text.startsWith(PROCESSING_INSTRUCTION_START, tagStart)) {
      position = skipPast(PROCESSING_INSTRUCTION_END, tagStart + PROCESSING_INSTRUCTION_START.length, 'processing instruction');
    } else if (text.startsWith(DECLARATION_START, tagStart)) {
      position = skipDeclaration(text, tagStart);
    } else if (text.startsWith(END_TAG_START, tagStart)) {
      END_TAG.lastIndex = tagStart;
      let match = END_TAG.exec(text);
      if (!match) throw new MalformedXml('malformed end tag at character ' + tagStart);
      let [, name] = match;
      let element = openElements.pop();
      if (!element) throw new MalformedXml('</' + name + '> closes nothing');
      if (element.name !== name) throw new MalformedXml('<' + element.name + '> closed by </' + name + '>');
      position = END_TAG.lastIndex;
    } else if (!NAME_START.test(text.charAt(afterTagOpen))) {
      addText('<');
      position = afterTagOpen;
    } else {
      START_TAG.lastIndex = tagStart;
      let match = START_TAG.exec(text);
      if (!match) throw new MalformedXml('malformed tag at character ' + tagStart);
      let [, name, selfClosingSlash] = match;
      let element = new XmlElement(name);
      let parent = currentElement();
      if (parent) {
        parent.children.push(element);
        parent.contents.push(element);
      } else if (root) {
        throw new MalformedXml('more than one root element');
      } else {
        root = element;
      }
      if (selfClosingSlash !== '/') openElements.push(element);
      position = START_TAG.lastIndex;
    }
  }

  if (openElements.length > 0) {
    throw new MalformedXml('<' + currentElement().name + '> is never closed (truncated?)');
  }
  if (!root) throw new MalformedXml('no root element');
  return root;
}

// <!DOCTYPE ...>, which may hold a [...] internal subset containing '>'
function skipDeclaration(text, from) {
  let unterminated = () => new MalformedXml('unterminated declaration');
  let subsetStart = text.indexOf('[', from);
  let declarationEnd = text.indexOf('>', from);
  if (declarationEnd === -1) throw unterminated();
  if (subsetStart !== -1 && subsetStart < declarationEnd) {
    let subsetEnd = text.indexOf(']', subsetStart);
    if (subsetEnd === -1) throw unterminated();
    declarationEnd = text.indexOf('>', subsetEnd);
    if (declarationEnd === -1) throw unterminated();
  }
  return declarationEnd + '>'.length;
}

// Unknown or invalid references are left as written.
function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_REFERENCE, (reference, hexDigits, decimalDigits, name) => {
    if (name !== undefined) {
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? String.fromCodePoint(NAMED_ENTITIES[name]) : reference;
    }
    let codePoint = (hexDigits !== undefined) ? parseInt(hexDigits, HEXADECIMAL) : parseInt(decimalDigits, DECIMAL);
    let isSurrogate = codePoint >= FIRST_SURROGATE && codePoint <= LAST_SURROGATE;
    let isValid = codePoint > 0 && codePoint <= HIGHEST_CODE_POINT && !isSurrogate;
    return isValid ? String.fromCodePoint(codePoint) : reference;
  });
}
