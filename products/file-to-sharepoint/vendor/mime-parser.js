// package/src/utils.ts
var isString = (data) => {
  return typeof data === "string" || data instanceof String;
};
var uint8ArrayToBinaryString = (bytes) => {
  const result = [];
  const bs = 1 << 14;
  const j = bytes.length;
  for (let i = 0; i < j; i += bs) {
    result.push(
      // eslint-disable-next-line prefer-spread
      String.fromCharCode.apply(
        String,
        // @ts-expect-error expects number[] instead of Uint8Array
        bytes.subarray(i, Math.min(i + bs, j))
      )
    );
  }
  return result.join("");
};
var binaryStringToUint8Array = (binaryString) => {
  if (!isString(binaryString)) {
    throw new Error(
      "binaryStringToUint8Array: Data must be in the form of a string"
    );
  }
  const result = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    result[i] = binaryString.charCodeAt(i);
  }
  return result;
};

// package/src/jsmimeparser/utils.js
function decode_qp(buffer) {
  const decoded = buffer.replace(
    // Replace either =<hex><hex> or =<wsp>CRLF
    /=([0-9A-F][0-9A-F]|[ \t]*(\r\n|[\r\n]|$))/gi,
    function(match, param) {
      if (param.trim().length == 0) {
        return "";
      }
      return String.fromCharCode(parseInt(param, 16));
    }
  );
  return [decoded, ""];
}
function decode_base64(buffer, more) {
  let sanitize = buffer.replace(/[^A-Za-z0-9+/=]/g, "");
  sanitize = sanitize.replace(/=+([A-Za-z0-9+/])/g, "$1");
  const excess = sanitize.length % 4;
  if (excess != 0 && more) {
    buffer = sanitize.slice(-excess);
  } else {
    buffer = "";
  }
  sanitize = sanitize.substring(0, sanitize.length - excess);
  sanitize = sanitize.replace(/(====)+$/g, "");
  return [atob(sanitize), buffer];
}
var kMonthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

// package/src/jsmimeparser/textDecoders.js
var UTF7TextDecoder = class {
  constructor() {
    this.collectInput = "";
    this.decodeString = decodeUtf7;
  }
  decode(input, options = {}) {
    const more = options.stream;
    if (input) {
      this.collectInput += uint8ArrayToBinaryString(input);
    }
    if (more) {
      return "";
    }
    return this.decodeString(this.collectInput);
  }
};
var UTF7ImapTextDecoder = class extends UTF7TextDecoder {
  constructor() {
    super();
    this.decodeString = decodeUtf7Imap;
  }
};
function MimeTextDecoder(charset, options) {
  switch (charset.toLowerCase()) {
    case "utf-7":
      return new UTF7TextDecoder();
    case "utf-7-imap":
      return new UTF7ImapTextDecoder();
    case "cp932":
      return new TextDecoder("shift_jis", options);
    default:
      return new TextDecoder(charset, options);
  }
}
function decodeFromUTF7(str) {
  const octets = Uint8Array.fromBase64(str);
  let output = "";
  for (let i = 0, len = octets.length; i < len; ) {
    output += String.fromCharCode(octets[i++] << 8 | octets[i++]);
  }
  return output;
}
var decodeUtf7 = (str) => str.replace(/\+([A-Za-z0-9/]*)-?/gi, (_, chunk) => chunk === "" ? "+" : decodeFromUTF7(chunk));
var decodeUtf7Imap = (str) => str.replace(/&([^-]*)-/g, (_, chunk) => chunk === "" ? "&" : decodeFromUTF7(chunk.replace(/,/g, "/")));

// package/src/jsmimeparser/structuredHeaders.js
var structuredDecoders = /* @__PURE__ */ new Map();
var structuredEncoders = /* @__PURE__ */ new Map();
var preferredSpellings = /* @__PURE__ */ new Map();
function addHeader(name, decoder, encoder) {
  const lowerName = name.toLowerCase();
  structuredDecoders.set(lowerName, decoder);
  structuredEncoders.set(lowerName, encoder);
  preferredSpellings.set(lowerName, name);
}
function parseAddress(value) {
  const headerparser2 = this;
  return value.reduce(function(results, header) {
    return results.concat(headerparser2.parseAddressingHeader(header, true));
  }, []);
}
function writeAddress(value) {
  if (!Array.isArray(value)) {
    value = [value];
  }
  this.addAddresses(value);
}
addHeader("Bcc", parseAddress, writeAddress);
addHeader("Cc", parseAddress, writeAddress);
addHeader("From", parseAddress, writeAddress);
addHeader("Reply-To", parseAddress, writeAddress);
addHeader("Resent-Bcc", parseAddress, writeAddress);
addHeader("Resent-Cc", parseAddress, writeAddress);
addHeader("Resent-From", parseAddress, writeAddress);
addHeader("Resent-Reply-To", parseAddress, writeAddress);
addHeader("Resent-Sender", parseAddress, writeAddress);
addHeader("Resent-To", parseAddress, writeAddress);
addHeader("Sender", parseAddress, writeAddress);
addHeader("To", parseAddress, writeAddress);
addHeader("Approved", parseAddress, writeAddress);
addHeader("Disposition-Notification-To", parseAddress, writeAddress);
addHeader("Delivered-To", parseAddress, writeAddress);
addHeader("Return-Receipt-To", parseAddress, writeAddress);
addHeader("Mail-Reply-To", parseAddress, writeAddress);
addHeader("Mail-Followup-To", parseAddress, writeAddress);
function parseParameterHeader(value, do2231, do2047) {
  return this.parseParameterHeader(value[0], do2231, do2047);
}
function parseContentType(value) {
  let params = parseParameterHeader.call(this, value, false, false);
  const origtype = params.preSemi;
  let parts = origtype.split("/");
  if (parts.length != 2) {
    params = /* @__PURE__ */ new Map();
    parts = ["text", "plain"];
  }
  const mediatype = parts[0].toLowerCase();
  const subtype = parts[1].toLowerCase();
  const type = mediatype + "/" + subtype;
  const structure = /* @__PURE__ */ new Map();
  structure.mediatype = mediatype;
  structure.subtype = subtype;
  structure.type = type;
  params.forEach(function(value2, name) {
    structure.set(name.toLowerCase(), value2);
  });
  return structure;
}
structuredDecoders.set("Content-Type", parseContentType);
function parseUnstructured(values) {
  return this.decodeRFC2047Words(values[0]);
}
function writeUnstructured(value) {
  this.addUnstructured(value);
}
function parseMessageID(values) {
  return this.decodeRFC2047Words(values[0]);
}
function writeMessageID(value) {
  this.addUnstructured(value);
}
addHeader("Comments", parseUnstructured, writeUnstructured);
addHeader("Keywords", parseUnstructured, writeUnstructured);
addHeader("Subject", parseUnstructured, writeUnstructured);
addHeader("MIME-Version", parseUnstructured, writeUnstructured);
addHeader("Content-Description", parseUnstructured, writeUnstructured);
addHeader("User-Agent", parseUnstructured, writeUnstructured);
function parseDate(values) {
  return this.parseDateHeader(values[0]);
}
function writeDate(value) {
  this.addDate(value);
}
addHeader("Date", parseDate, writeDate);
addHeader("Resent-Date", parseDate, writeDate);
addHeader("Expires", parseDate, writeDate);
addHeader("Injection-Date", parseDate, writeDate);
addHeader("NNTP-Posting-Date", parseDate, writeDate);
addHeader("Message-ID", parseMessageID, writeMessageID);
addHeader("Resent-Message-ID", parseMessageID, writeMessageID);
structuredDecoders.set("Content-Transfer-Encoding", function(values) {
  return values[0].toLowerCase();
});
structuredEncoders.set("Content-Transfer-Encoding", writeUnstructured);
function preprocessMessageIDs(values) {
  const msgId = /<[^>]*>/g;
  let match;
  const ids = [];
  while ((match = msgId.exec(values)) !== null) {
    ids.push(match[0]);
  }
  return ids.join(" ");
}
structuredDecoders.set("References", preprocessMessageIDs);
structuredDecoders.set("In-Reply-To", preprocessMessageIDs);

// package/src/jsmimeparser/headerParser.js
var headerparser = {};
function cleanToken(token) {
  token = token.replace(
    /[\xA0\u1680\u2000-\u200A\u202F\u205F\u3000]/g,
    " "
  );
  token = token.replace(
    // oxlint-disable-next-line no-misleading-character-class
    /[\u034F\u17B4\u17B5\u180B-\u180D\uFE00-\uFE0F]/g,
    ""
  );
  token = token.replace(/\uDB40[\uDD00-\uDDEF]/g, "");
  token = token.replace(/(?![\t\n\r])[\0-\x1F\x7F-\x9F]/g, "");
  token = token.replace(
    /(?:[\xAD\u061C\u06DD\u070F\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|\uD804[\uDCBD\uDCCD]|\uD80D[\uDC30-\uDC38]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|\uDB40[\uDC01\uDC20-\uDC7F])/g,
    " "
  );
  token = token.replace(/\u2800/g, " ");
  return token;
}
function getHeaderTokens(value, delimiters, opts) {
  const tokenList = [];
  function Token(token) {
    this.token = token.replace(/\\(.?)/g, "$1");
  }
  Token.prototype.toString = function() {
    return this.token;
  };
  let tokenStart = void 0;
  const wsp = " 	\r\n";
  let endQuote = void 0;
  let commentDepth = 0;
  const length = value.length;
  for (let i = 0; i < length; i++) {
    const ch = value[i];
    if (ch == "\\") {
      i++;
      continue;
    }
    if (endQuote !== void 0) {
      if (ch == endQuote && ch == '"') {
        let text = value.slice(tokenStart + 1, i);
        if (opts.rfc2047) {
          text = decodeRFC2047Words(text);
        }
        tokenList.push(new Token(text));
        endQuote = void 0;
        tokenStart = void 0;
      } else if (ch == endQuote && ch == "]") {
        tokenList.push(new Token(value.slice(tokenStart, i + 1)));
        endQuote = void 0;
        tokenStart = void 0;
      }
      continue;
    }
    if (opts.rfc2047 && ch == "=" && i + 1 < value.length && value[i + 1] == "?") {
      const encodedWordsRE = /([ \t\r\n]*=\?[^?]*\?[BbQq]\?[^?]*\?=)+/;
      const result = encodedWordsRE.exec(value.slice(i));
      if (result !== null) {
        if (tokenStart !== void 0) {
          tokenList.push(new Token(value.slice(tokenStart, i)));
          tokenStart = void 0;
        }
        const encWordsLen = result[0].length;
        const string = decodeRFC2047Words(
          value.slice(i, i + encWordsLen),
          "UTF-8"
        );
        tokenList.push({
          toString() {
            return string;
          }
        });
        i += encWordsLen - 1;
        continue;
      }
    }
    let tokenIsEnding = false, tokenIsStarting = false, isSpecial = false;
    if (wsp.includes(ch)) {
      tokenIsEnding = true;
    } else if (commentDepth == 0 && delimiters.includes(ch)) {
      tokenIsEnding = true;
      isSpecial = true;
    } else if (opts.qstring && ch == '"') {
      tokenIsEnding = true;
      tokenIsStarting = true;
      endQuote = ch;
    } else if (opts.dliteral && ch == "[") {
      tokenIsEnding = true;
      tokenIsStarting = true;
      endQuote = "]";
    } else if (opts.comments && ch == "(") {
      commentDepth++;
      if (commentDepth == 1) {
        tokenIsEnding = true;
        isSpecial = true;
      } else {
        tokenIsStarting = true;
      }
    } else if (opts.comments && ch == ")") {
      if (commentDepth > 0) {
        commentDepth--;
      }
      if (commentDepth == 0) {
        tokenIsEnding = true;
        isSpecial = true;
      } else {
        tokenIsStarting = true;
      }
    } else {
      tokenIsStarting = true;
    }
    if (tokenIsEnding && tokenStart !== void 0) {
      tokenList.push(new Token(value.slice(tokenStart, i)));
      tokenStart = void 0;
    }
    if (isSpecial) {
      tokenList.push(ch);
    }
    if (tokenIsStarting && tokenStart === void 0) {
      tokenStart = i;
    }
  }
  if (tokenStart !== void 0) {
    if (endQuote == '"') {
      tokenList.push(new Token(value.slice(tokenStart + 1)));
    } else {
      tokenList.push(new Token(value.slice(tokenStart)));
    }
  }
  return tokenList;
}
function convert8BitHeader(headerValue, fallbackCharset) {
  if (/[\x80-\xff]/.exec(headerValue)) {
    const typedarray = binaryStringToUint8Array(headerValue);
    const hasFallback = fallbackCharset && !fallbackCharset.toLowerCase().startsWith("utf");
    const utf8Decoder = new MimeTextDecoder("utf-8", { fatal: hasFallback });
    try {
      headerValue = utf8Decoder.decode(typedarray);
    } catch {
      try {
        const decoder = new MimeTextDecoder(fallbackCharset, {
          fatal: false
        });
        headerValue = decoder.decode(typedarray);
      } catch {
      }
    }
  }
  return headerValue;
}
function decodeRFC2047Words(headerValue) {
  let lastCharset = "", currentDecoder = void 0;
  function decode2047Token(token, isLastToken) {
    const tokenParts = token.split("?");
    if (tokenParts.length != 5 || tokenParts[4] != "=") {
      return false;
    }
    const charset = tokenParts[1].split("*", 1)[0];
    const encoding = tokenParts[2], text = tokenParts[3];
    let buffer;
    if (encoding == "B" || encoding == "b") {
      if (/[^ A-Za-z0-9+/=]/.exec(text)) {
        return false;
      }
      buffer = decode_base64(text, false)[0];
    } else if (encoding == "Q" || encoding == "q") {
      buffer = decode_qp(text.replace(/_/g, " "), false)[0];
    } else {
      return false;
    }
    const stringBuffer = buffer;
    buffer = binaryStringToUint8Array(buffer);
    let output = "";
    if (charset != lastCharset && currentDecoder) {
      output += currentDecoder.decode();
      currentDecoder = null;
    }
    lastCharset = charset;
    if (!currentDecoder) {
      try {
        currentDecoder = new MimeTextDecoder(charset, { fatal: false });
      } catch {
        return false;
      }
    }
    let doStreaming;
    if (isLastToken || charset.toUpperCase() == "ISO-2022-JP" && stringBuffer.endsWith("\x1B(B")) {
      doStreaming = { stream: false };
    } else {
      doStreaming = { stream: true };
    }
    return output + currentDecoder.decode(buffer, doStreaming);
  }
  const components = headerValue.split(/(=\?[^?]*\?[BQbq]\?[^?]*\?=)/);
  let lastRFC2047Index = -1;
  for (let i = 0; i < components.length; i++) {
    if (components[i].startsWith("=?")) {
      lastRFC2047Index = i;
    }
  }
  for (let i = 0; i < components.length; i++) {
    if (components[i].startsWith("=?")) {
      const decoded = decode2047Token(components[i], i == lastRFC2047Index);
      if (decoded !== false) {
        components[i] = decoded;
        continue;
      }
    } else if (/^[ \t\r\n]*$/.exec(components[i])) {
      components[i] = "";
      continue;
    }
    lastCharset = "";
    if (currentDecoder) {
      components[i] = currentDecoder.decode() + components[i];
      currentDecoder = null;
    }
  }
  return components.join("");
}
function parseAddressingHeader(header, doRFC2047) {
  if (doRFC2047 === void 0) {
    doRFC2047 = true;
  }
  let results = [];
  let addrlist = [];
  let name = "", groupName = "", localPart = "", address = "", comment = "";
  let inAngle = false, inComment = false, needsSpace = false, afterAddress = false;
  let preserveSpace = false;
  let commentClosed = false;
  let lastComment = "";
  function addToAddrList(displayName, addrSpec) {
    const lp = addrSpec.substring(0, addrSpec.lastIndexOf("@"));
    if (/[ !()<>[\]:;@\\,"]/.exec(lp) !== null) {
      addrSpec = '"' + lp.replace(/([\\"])/g, "\\$1") + '"' + addrSpec.substring(addrSpec.lastIndexOf("@"));
    }
    displayName = displayName.replace(/\s+/g, " ").trim();
    if (displayName === "" && lastComment !== "") {
      const offset = lastComment.startsWith(" ") ? 2 : 1;
      displayName = lastComment.substr(
        offset,
        lastComment.length - offset - 1
      );
    }
    if (displayName !== "" || addrSpec !== "") {
      addrlist.push({ name: displayName, email: addrSpec });
    }
    name = localPart = address = lastComment = "";
    inAngle = inComment = needsSpace = afterAddress = false;
  }
  for (let headerToken of getHeaderTokens(header, ":,;<>@", {
    qstring: true,
    comments: true,
    dliteral: true,
    rfc2047: doRFC2047
  })) {
    if (headerToken === ":") {
      groupName = name;
      name = "";
      localPart = "";
      if (addrlist.length > 0) {
        results = results.concat(addrlist);
      }
      addrlist = [];
    } else if (headerToken === "<" && !afterAddress) {
      if (inAngle) {
        if (address.length > 0) {
          name = address;
        }
        localPart = address = "";
      } else {
        inAngle = true;
      }
    } else if (headerToken === ">" && !afterAddress) {
      inAngle = false;
      lastComment = "";
      afterAddress = true;
    } else if (headerToken === "(") {
      inComment = true;
      preserveSpace = needsSpace;
      if (!needsSpace) {
        needsSpace = name !== "" && name.substr(-1) !== " ";
      }
      comment = needsSpace ? " (" : "(";
      commentClosed = false;
    } else if (headerToken === ")") {
      inComment = false;
      comment += ")";
      lastComment = comment;
      if (inAngle) {
        needsSpace = preserveSpace;
      } else {
        name += comment;
        needsSpace = true;
      }
      commentClosed = true;
      continue;
    } else if (headerToken === "@") {
      if (afterAddress) {
        continue;
      }
      if (!inAngle) {
        address = localPart;
        name = "";
        localPart = "";
        inAngle = true;
      }
      address += "@";
    } else if (headerToken === ",") {
      addToAddrList(name, address);
      afterAddress = false;
    } else if (headerToken === ";") {
      addToAddrList(name, address);
      if (groupName === "") {
        results = results.concat(addrlist);
      } else {
        results.push({
          name: groupName,
          group: addrlist
        });
      }
      addrlist = [];
      groupName = "";
    } else {
      headerToken = cleanToken(headerToken.toString());
      let spacedToken = headerToken;
      if (needsSpace && headerToken && headerToken[0] != ".") {
        spacedToken = " " + spacedToken;
      }
      if (inComment) {
        comment += spacedToken;
      } else if (inAngle) {
        address += spacedToken;
      } else {
        if (!afterAddress) {
          name += spacedToken;
        }
        if (commentClosed) {
          localPart += headerToken;
          commentClosed = false;
        } else {
          localPart += spacedToken;
        }
      }
      needsSpace = headerToken && headerToken[0] != ".";
      continue;
    }
    needsSpace = false;
  }
  addToAddrList(name, address);
  if (groupName !== "") {
    results.push({ name: groupName, group: addrlist });
    addrlist = [];
  }
  return results.concat(addrlist);
}
function parseParameterHeader2(headerValue, doRFC2047, doRFC2231) {
  const semi = headerValue.indexOf(";");
  let start, rest;
  if (semi < 0) {
    start = headerValue;
    rest = "";
  } else {
    start = headerValue.substring(0, semi);
    rest = headerValue.substring(semi);
  }
  start = start.trim().split(/[ \t\r\n]/)[0];
  const opts = { qstring: true, rfc2047: doRFC2047 };
  let name = "", inName = true;
  const matches = [];
  for (let headerToken of getHeaderTokens(rest, ";=", opts)) {
    if (headerToken === ";") {
      if (name != "" && !inName) {
        matches.push([name, ""]);
      }
      name = "";
      inName = true;
    } else if (headerToken === "=") {
      inName = false;
    } else if (inName && name == "") {
      name = headerToken.toString();
    } else if (!inName && name != "") {
      headerToken = headerToken.toString();
      if (doRFC2231 && name.endsWith("*")) {
        headerToken = headerToken.replace(/%([0-9A-Fa-f]{2})/g, function(match, hexchars) {
          return String.fromCharCode(parseInt(hexchars, 16));
        });
      }
      matches.push([name, headerToken]);
      name = "";
    } else if (inName) {
      name = "";
    }
  }
  if (name != "" && !inName) {
    matches.push([name, ""]);
  }
  const simpleValues = /* @__PURE__ */ new Map(), charsetValues = /* @__PURE__ */ new Map(), continuationValues = /* @__PURE__ */ new Map();
  for (const pair of matches) {
    let name2 = pair[0];
    const value = pair[1];
    const star = name2.indexOf("*");
    if (star == -1) {
      if (!simpleValues.has(name2)) {
        simpleValues.set(name2, value);
      }
    } else if (star == name2.length - 1) {
      name2 = name2.substring(0, star);
      if (!charsetValues.has(name2)) {
        charsetValues.set(name2, value);
      }
    } else {
      const param = name2.substring(0, star);
      let entry = continuationValues.get(param);
      if (continuationValues.has(param) && !entry.valid) {
        continue;
      }
      if (!continuationValues.has(param)) {
        entry = [];
        entry.valid = true;
        entry.hasCharset = void 0;
        continuationValues.set(param, entry);
      }
      const lastStar = name2[name2.length - 1] == "*";
      let number = name2.substring(
        star + 1,
        name2.length - (lastStar ? 1 : 0)
      );
      if (number == "0") {
        entry.hasCharset = lastStar;
      } else if (number.length == 0 || number[0] == "0" && number != "0" || !/^[0-9]+$/.test(number)) {
        entry.valid = false;
        continue;
      }
      number = parseInt(number, 10);
      if (entry[number] !== void 0) {
        entry.valid = false;
        continue;
      }
      entry[number] = value;
    }
  }
  const values = /* @__PURE__ */ new Map();
  for (const pair of simpleValues) {
    values.set(pair[0], pair[1]);
  }
  if (doRFC2231) {
    for (const pair of continuationValues) {
      const name2 = pair[0];
      const entry = pair[1];
      if (entry.hasCharset === void 0) {
        continue;
      }
      let valid = true;
      for (var i = 0; valid && i < entry.length; i++) {
        if (entry[i] === void 0) {
          valid = false;
        }
      }
      let value = entry.slice(0, i).join("");
      if (entry.hasCharset) {
        try {
          value = decode2231Value(value);
        } catch {
          continue;
        }
      }
      values.set(name2, value);
    }
    for (const pair of charsetValues) {
      try {
        values.set(pair[0], decode2231Value(pair[1]));
      } catch {
      }
    }
  }
  values.preSemi = start;
  return values;
}
function decode2231Value(value) {
  const quote1 = value.indexOf("'");
  const quote2 = quote1 >= 0 ? value.indexOf("'", quote1 + 1) : -1;
  const charset = quote1 >= 0 ? value.substring(0, quote1) : "";
  value = value.substring(Math.max(quote1, quote2) + 1);
  const typedarray = binaryStringToUint8Array(value);
  return new MimeTextDecoder(charset, { fatal: true }).decode(typedarray, {
    stream: false
  });
}
var kKnownTZs = {
  // The following timezones are explicitly listed in RFC 5322.
  UT: "+0000",
  GMT: "+0000",
  EST: "-0500",
  EDT: "-0400",
  CST: "-0600",
  CDT: "-0500",
  MST: "-0700",
  MDT: "-0600",
  PST: "-0800",
  PDT: "-0700",
  // The following are time zones copied from NSPR's prtime.c
  AST: "-0400",
  // Atlantic Standard Time
  NST: "-0330",
  // Newfoundland Standard Time
  BST: "+0100",
  // British Summer Time
  MET: "+0100",
  // Middle Europe Time
  EET: "+0200",
  // Eastern Europe Time
  JST: "+0900"
  // Japan Standard Time
};
function parseDateHeader(header) {
  let tokens = getHeaderTokens(header, ",:", {}).map((x) => x.toString());
  if (tokens.length > 1 && tokens[1] === ",") {
    tokens = tokens.slice(2);
  }
  if (tokens.length < 8) {
    return /* @__PURE__ */ new Date(NaN);
  }
  const day = parseInt(tokens[0]);
  let year = parseInt(tokens[2]);
  const hours = parseInt(tokens[3]);
  const minutes = parseInt(tokens[5]);
  const seconds = parseInt(tokens[7]);
  let month = kMonthNames.indexOf(tokens[1].slice(0, 3));
  if (month < 0) {
    month = NaN;
  }
  if (year < 100) {
    year += year < 50 ? 2e3 : 1900;
  }
  let tzoffset = tokens[8];
  if (tzoffset in kKnownTZs) {
    tzoffset = kKnownTZs[tzoffset];
  }
  let decompose = /^([+-])(\d\d)(\d\d)$/.exec(tzoffset);
  if (decompose === null) {
    decompose = ["+0000", "+", "00", "00"];
  }
  let tzOffsetInMin = parseInt(decompose[2]) * 60 + parseInt(decompose[3]);
  if (decompose[1] == "-") {
    tzOffsetInMin = -tzOffsetInMin;
  }
  const finalDate = new Date(
    Date.UTC(year, month, day, hours, minutes, seconds) - tzOffsetInMin * 60 * 1e3
  );
  return finalDate;
}
var structuredDecoders2 = /* @__PURE__ */ new Map();
var forbiddenHeaders = /* @__PURE__ */ new Set();
for (const pair of structuredDecoders) {
  addStructuredDecoder(pair[0], pair[1]);
  forbiddenHeaders.add(pair[0].toLowerCase());
}
function parseStructuredHeader(header, value) {
  if (typeof value === "string" || value instanceof String) {
    value = [value];
  }
  if (!Array.isArray(value)) {
    throw new TypeError("Header value is not an array: " + value);
  }
  const lowerHeader = header.toLowerCase();
  if (structuredDecoders2.has(lowerHeader)) {
    return structuredDecoders2.get(lowerHeader).call(headerparser, value);
  }
  throw new Error("Unknown structured header: " + header);
}
function addStructuredDecoder(header, decoder) {
  const lowerHeader = header.toLowerCase();
  if (forbiddenHeaders.has(lowerHeader)) {
    throw new Error("Cannot override header: " + header);
  }
  structuredDecoders2.set(lowerHeader, decoder);
  if (!preferredSpellings.has(lowerHeader)) {
    preferredSpellings.set(lowerHeader, header);
  }
}
headerparser.addStructuredDecoder = addStructuredDecoder;
headerparser.convert8BitHeader = convert8BitHeader;
headerparser.decodeRFC2047Words = decodeRFC2047Words;
headerparser.getHeaderTokens = getHeaderTokens;
headerparser.parseAddressingHeader = parseAddressingHeader;
headerparser.parseDateHeader = parseDateHeader;
headerparser.parseParameterHeader = parseParameterHeader2;
headerparser.parseStructuredHeader = parseStructuredHeader;
var headerParser_default = Object.freeze(headerparser);

// package/src/jsmimeparser/rawMimeParser.js
function StructuredHeaders(rawHeaderText, options) {
  const values = rawHeaderText.split(/(?:\r\n|\n)(?![ \t])|\r(?![ \t\n])/);
  if (values.length > 0 && values[0].substring(0, 5) == "From ") {
    values.shift();
    if (values.length == 0) {
      rawHeaderText = "";
    } else {
      rawHeaderText = rawHeaderText.substring(
        rawHeaderText.indexOf(values[0])
      );
    }
  }
  const headers = /* @__PURE__ */ new Map();
  for (let i = 0; i < values.length; i++) {
    const colon = values[i].indexOf(":");
    let header, val;
    if (colon >= 0) {
      header = values[i].substring(0, colon);
      val = values[i].substring(colon + 1).trim();
      if (options.stripcontinuations) {
        val = val.replace(/[\r\n]/g, "");
      }
    } else {
      header = values[i];
      val = "";
    }
    header = header.trim().toLowerCase();
    if (header == "") {
      continue;
    }
    if (headers.has(header)) {
      headers.get(header).push(val);
    } else {
      headers.set(header, [val]);
    }
  }
  this._rawHeaders = headers;
  this._cachedHeaders = /* @__PURE__ */ new Map();
  Object.defineProperty(this, "rawHeaderText", {
    get() {
      return rawHeaderText;
    }
  });
  Object.defineProperty(this, "size", {
    get() {
      return this._rawHeaders.size;
    }
  });
  Object.defineProperty(this, "charset", {
    get() {
      return this._charset;
    },
    set(value) {
      this._charset = value;
      this._cachedHeaders.clear();
    }
  });
  if ("charset" in options) {
    this._charset = options.charset;
  } else {
    this._charset = null;
  }
  Object.defineProperty(this, "contentType", {
    configurable: true,
    get() {
      return this.get("Content-Type");
    }
  });
}
StructuredHeaders.prototype.getRawHeader = function(headerName) {
  return this._rawHeaders.get(headerName.toLowerCase());
};
StructuredHeaders.prototype.get = function(headerName) {
  headerName = headerName.toLowerCase();
  if (this._cachedHeaders.has(headerName)) {
    return this._cachedHeaders.get(headerName);
  }
  let headerValue = this._rawHeaders.get(headerName);
  if (headerValue === void 0) {
    return headerValue;
  }
  const charset = this.charset;
  headerValue = headerValue.map(function(value) {
    return headerParser_default.convert8BitHeader(value, charset);
  });
  let structured;
  try {
    structured = headerParser_default.parseStructuredHeader(
      headerName,
      headerValue
    );
  } catch {
    structured = headerValue.map(function(value) {
      return headerParser_default.decodeRFC2047Words(value);
    });
  }
  this._cachedHeaders.set(headerName, structured);
  return structured;
};
StructuredHeaders.prototype.has = function(headerName) {
  return this._rawHeaders.has(headerName.toLowerCase());
};
var JS_HAS_SYMBOLS = typeof Symbol === "function";
var ITERATOR_SYMBOL = JS_HAS_SYMBOLS ? Symbol.iterator : "@@iterator";
StructuredHeaders.prototype[ITERATOR_SYMBOL] = function* () {
  for (const headerName of this.keys()) {
    yield [headerName, this.get(headerName)];
  }
};
StructuredHeaders.prototype.forEach = function(callback, thisarg) {
  for (const [header, value] of this) {
    callback.call(thisarg, value, header, this);
  }
};
StructuredHeaders.prototype.entries = StructuredHeaders.prototype[Symbol.iterator];
function capitalize(headerName) {
  return headerName.replace(/\b[a-z]/g, function(match) {
    return match.toUpperCase();
  });
}
StructuredHeaders.prototype.keys = function* () {
  for (const name of this._rawHeaders.keys()) {
    yield preferredSpellings.get(name) || capitalize(name);
  }
};
StructuredHeaders.prototype.values = function* () {
  for (const [, value] of this) {
    yield value;
  }
};
function MimeParser(emitter, options) {
  this._emitter = emitter;
  this._options = {
    pruneat: "",
    bodyformat: "nodecode",
    strformat: "binarystring",
    stripcontinuations: true,
    charset: "",
    "force-charset": false,
    onerror: () => {
    }
  };
  if (options) {
    for (const opt in options) {
      this._options[opt] = options[opt];
    }
  }
  if (typeof this._options.onerror != "function") {
    throw new Error("onerror callback must be a function");
  }
  this.resetParser();
}
MimeParser.prototype.resetParser = function() {
  this._state = PARSING_HEADERS;
  this._holdData = "";
  this._headerData = "";
  this._triggeredCall = false;
  this._splitRegex = this._handleSplit = void 0;
  this._subparser = this._subPartNum = void 0;
  this._savedBuffer = "";
  this._convertData = void 0;
  this._decoder = void 0;
};
MimeParser.prototype.deliverData = function(buffer) {
  if (this._holdData) {
    buffer = this._holdData + buffer;
    this._holdData = "";
  }
  if (buffer.length > 0) {
    [buffer, this._holdData] = conditionToEndOnCRLF(buffer);
  }
  if (buffer.length == 0) {
    return;
  }
  if (!this._triggeredCall) {
    this._callEmitter("startMessage");
    this._triggeredCall = true;
  }
  this._dispatchData("", buffer, true);
};
function conditionToEndOnCRLF(buffer) {
  const lastCR = buffer.lastIndexOf("\r", buffer.length - 2);
  const lastLF = buffer.lastIndexOf("\n");
  const end = lastLF > lastCR ? lastLF : lastCR;
  return [buffer.substring(0, end + 1), buffer.substring(end + 1)];
}
MimeParser.prototype.deliverEOF = function() {
  if (!this._triggeredCall) {
    this._triggeredCall = true;
    this._callEmitter("startMessage");
  }
  if (this._holdData) {
    this._dispatchData("", this._holdData, true);
  }
  this._dispatchEOF("");
  this._callEmitter("endMessage");
};
MimeParser.prototype._callEmitter = function(funcname, ...args) {
  if (this._emitter && funcname in this._emitter) {
    if (args.length > 0 && this._willIgnorePart(args[0])) {
      return;
    }
    try {
      this._emitter[funcname](...args);
    } catch (e) {
      this._options.onerror(e);
    }
  }
};
MimeParser.prototype._willIgnorePart = function(part) {
  if (this._options.pruneat) {
    const match = this._options.pruneat;
    const start = part.substr(0, match.length);
    if (start != match || match.length < part.length && !"$.".includes(part[match.length])) {
      return true;
    }
  }
  return false;
};
var PARSING_HEADERS = 1;
var SEND_TO_BLACK_HOLE = 2;
var SEND_TO_EMITTER = 3;
var SEND_TO_SUBPARSER = 4;
MimeParser.prototype._dispatchData = function(partNum, buffer, checkSplit) {
  if (this._state == PARSING_HEADERS) {
    this._headerData += buffer;
    const result = /(?:^(?:\r\n|[\r\n]))|(\r\n|[\r\n])\1/.exec(
      this._headerData
    );
    if (result != null) {
      const headers = this._headerData.substr(0, result.index);
      buffer = this._headerData.substring(result.index + result[0].length);
      this._headerData = headers;
      this._headers = this._parseHeaders();
      this._callEmitter("startPart", partNum, this._headers);
      this._startBody(partNum);
    } else {
      return;
    }
  }
  if (checkSplit && this._splitRegex) {
    const splitResult = this._splitRegex.exec(buffer);
    if (splitResult) {
      const start = splitResult.index, len = splitResult[0].length;
      if (start > 0) {
        this._dispatchData(partNum, buffer.substr(0, start), false);
      }
      this._handleSplit(partNum, splitResult);
      buffer = buffer.substring(start + len);
      if (buffer.length > 0) {
        this._dispatchData(partNum, buffer, true);
      }
      return;
    }
  }
  if (this._state == SEND_TO_BLACK_HOLE) {
  } else if (this._state == SEND_TO_EMITTER) {
    const passData = this._options.bodyformat != "none";
    if (!passData || this._willIgnorePart(partNum)) {
      return;
    }
    const { coerced, raw } = this._applyDataConversion(buffer, this._options.strformat);
    this._callEmitter("deliverPartData", partNum, coerced, raw);
  } else if (this._state == SEND_TO_SUBPARSER) {
    const { coerced } = this._applyDataConversion(buffer, "binarystring");
    if (buffer.length > 0) {
      this._subparser._dispatchData(this._subPartNum, coerced, true);
    }
  }
};
MimeParser.prototype._applyDataConversion = function(buf, type) {
  if (this._convertData) {
    buf = this._savedBuffer + buf;
    [buf, this._savedBuffer] = this._convertData(buf, true);
  }
  return {
    coerced: this._coerceData(buf, type, false),
    raw: buf instanceof Uint8Array ? buf : binaryStringToUint8Array(buf)
  };
};
MimeParser.prototype._coerceData = function(buffer, type, more) {
  if (typeof buffer == "string") {
    if (type == "binarystring") {
      return buffer;
    }
    const typedarray = binaryStringToUint8Array(buffer);
    return type == "unicode" ? this._coerceData(typedarray, "unicode", more) : typedarray;
  } else if (type == "binarystring") {
    return uint8ArrayToBinaryString(buffer);
  } else if (type == "unicode") {
    if (this._decoder) {
      return this._decoder.decode(buffer, { stream: more });
    }
    return buffer;
  }
  throw new Error("Invalid type: " + type);
};
MimeParser.prototype._dispatchEOF = function(partNum) {
  if (this._state == PARSING_HEADERS) {
    this._headers = this._parseHeaders();
    this._callEmitter("startPart", partNum, this._headers);
  } else if (this._state == SEND_TO_SUBPARSER) {
    if (this._convertData && this._savedBuffer) {
      this._subparser._dispatchData(
        this._subPartNum,
        this._convertData(this._savedBuffer, false)[0],
        true
      );
    }
    this._subparser._dispatchEOF(this._subPartNum);
    this._subparser = null;
  } else if (this._convertData && this._savedBuffer) {
    let [buffer] = this._convertData(this._savedBuffer, false);
    buffer = this._coerceData(buffer, this._options.strformat, false);
    if (buffer.length > 0) {
      this._callEmitter("deliverPartData", partNum, buffer);
    }
  }
  this._callEmitter("endPart", partNum);
};
MimeParser.prototype._parseHeaders = function() {
  const headers = new StructuredHeaders(this._headerData, this._options);
  let contentType = headers.get("Content-Type");
  if (typeof contentType === "undefined") {
    contentType = headerParser_default.parseStructuredHeader(
      "Content-Type",
      this._defaultContentType || "text/plain"
    );
    Object.defineProperty(headers, "contentType", {
      get() {
        return contentType;
      }
    });
  } else {
    Object.defineProperty(headers, "contentType", { configurable: false });
  }
  let charset = "";
  if (this._options["force-charset"]) {
    charset = this._options.charset;
  } else if (contentType.has("charset")) {
    charset = contentType.get("charset");
  } else {
    charset = this._options.charset;
  }
  headers.charset = charset;
  this._charset = charset;
  return headers;
};
MimeParser.prototype._startBody = function(partNum) {
  const contentType = this._headers.contentType;
  if (this._options.bodyformat == "raw" && partNum == this._options.pruneat) {
    this._state = SEND_TO_EMITTER;
    return;
  }
  if (contentType.mediatype == "multipart") {
    if (!contentType.has("boundary")) {
      this._state = SEND_TO_BLACK_HOLE;
      return;
    }
    this._splitRegex = new RegExp(
      "(\r\n|[\r\n]|^)--" + contentType.get("boundary").replace(/[\\^$*+?.()|{}[\]]/g, "\\$&") + "(--)?[ 	]*(?:\r\n|[\r\n]|$)"
    );
    this._handleSplit = this._whenMultipart;
    this._subparser = new MimeParser(this._emitter, this._options);
    if (contentType.subtype == "digest") {
      this._subparser._defaultContentType = "message/rfc822";
    }
    this._state = SEND_TO_BLACK_HOLE;
    this._convertData = function(buffer, more) {
      let splitPoint = buffer.length;
      if (more) {
        if (buffer.charAt(splitPoint - 1) == "\n") {
          splitPoint--;
        }
        if (splitPoint >= 0 && buffer.charAt(splitPoint - 1) == "\r") {
          splitPoint--;
        }
      }
      const res = conditionToEndOnCRLF(buffer.substring(0, splitPoint));
      const preLF = res[0];
      const rest = res[1];
      return [preLF, rest + buffer.substring(splitPoint)];
    };
  } else if (contentType.type == "message/rfc822" || contentType.type == "message/global" || contentType.type == "message/news") {
    this._state = SEND_TO_SUBPARSER;
    this._subPartNum = partNum + "$";
    this._subparser = new MimeParser(this._emitter, this._options);
    const cte = this._extractHeader("content-transfer-encoding", "");
    if (cte in ContentDecoders) {
      this._convertData = ContentDecoders[cte];
    }
  } else {
    this._state = SEND_TO_EMITTER;
    if (this._options.bodyformat == "decode") {
      const cte = this._extractHeader("content-transfer-encoding", "");
      if (cte in ContentDecoders) {
        this._convertData = ContentDecoders[cte];
      }
    }
  }
  if (this._options.strformat == "unicode" && contentType.mediatype == "text") {
    this._decoder = null;
    if (this._charset !== "") {
      try {
        this._decoder = new MimeTextDecoder(this._charset);
      } catch (e) {
        console.error(e);
      }
    }
    if (!this._decoder) {
      this._decoder = {
        decode(buffer) {
          return MimeParser.prototype._coerceData(
            buffer,
            "binarystring",
            true
          );
        }
      };
    }
  } else {
    this._decoder = null;
  }
};
MimeParser.prototype._whenMultipart = function(partNum, lastResult) {
  if (partNum != "") {
    partNum += ".";
  }
  if (!this._subPartNum) {
    this._count = 1;
  } else {
    if (this._savedBuffer != "" && lastResult[1] === "") {
      let useEnd = this._savedBuffer.length - 1;
      if (this._savedBuffer[useEnd] == "\n") {
        useEnd--;
      }
      if (useEnd >= 0 && this._savedBuffer[useEnd] == "\r") {
        useEnd--;
      }
      this._savedBuffer = this._savedBuffer.substring(0, useEnd + 1);
    }
    if (this._savedBuffer != "") {
      this._subparser._dispatchData(
        this._subPartNum,
        this._savedBuffer,
        true
      );
    }
    this._subparser._dispatchEOF(this._subPartNum);
  }
  this._savedBuffer = "";
  if (lastResult[2] == void 0) {
    this._subparser.resetParser();
    this._state = SEND_TO_SUBPARSER;
    this._subPartNum = partNum + this._count;
    this._count += 1;
  } else {
    this._splitRegex = null;
    this._state = SEND_TO_BLACK_HOLE;
  }
};
MimeParser.prototype._extractHeader = function(name, dflt) {
  name = name.toLowerCase();
  return this._headers.has(name) ? this._headers.get(name) : headerParser_default.parseStructuredHeader(name, [dflt]);
};
var ContentDecoders = {};
ContentDecoders["quoted-printable"] = decode_qp;
ContentDecoders.base64 = decode_base64;
var rawMimeParser_default = MimeParser;
export {
  rawMimeParser_default as MimeParser
};
