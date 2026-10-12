(function (root) {
  var LONG_EDGE = 1280;
  var INIT_TIMEOUT_MS = 25000;
  var RECOGNIZE_TIMEOUT_MS = 20000;
  var CHAR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-./# ";
  var PAGE_MODE = "11";
  var DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g;
  var PAIRS = [
    ["0", "O"],
    ["O", "0"],
    ["1", "I"],
    ["I", "1"],
    ["5", "S"],
    ["S", "5"],
    ["8", "B"],
    ["B", "8"],
    ["2", "Z"],
    ["Z", "2"]
  ];

  function normalizeOcrText(value) {
    return String(value || "").normalize("NFKC").replace(DASHES, "-").replace(/\s+/g, " ").trim();
  }

  function fitLongEdge(width, height, edge) {
    var limit = edge || LONG_EDGE;
    var w = Number(width) || 0;
    var h = Number(height) || 0;
    if (w < 1 || h < 1) return { width: 1, height: 1, scale: 1 };
    var longEdge = Math.max(w, h);
    var scale = longEdge > limit ? limit / longEdge : 1;
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
      scale: scale
    };
  }

  function tidyToken(token) {
    return String(token || "").replace(/^[-./#]+|[-./#]+$/g, "");
  }

  function modelScore(token) {
    var score = 0;
    if (token.indexOf("-") !== -1) score += 4;
    if (token.length >= 5 && token.length <= 16) score += 2;
    return score;
  }

  function isModelToken(token) {
    if (!token || token.length < 4 || token.length > 20) return false;
    if (!/^[A-Z0-9][A-Z0-9./#-]*$/.test(token)) return false;
    if (!/[A-Z]/.test(token) || !/\d/.test(token)) return false;
    if (/^(19|20)\d{2}$/.test(token)) return false;
    return true;
  }

  function isWordOnly(token) {
    return /^[A-Z]{4,}$/.test(token);
  }

  function extractModelCandidates(raw) {
    var text = String(raw || "").normalize("NFKC").replace(DASHES, "-").toUpperCase();
    var found = [];
    var seen = {};
    function consider(part) {
      var token = tidyToken(part);
      if (!isModelToken(token) || seen[token]) return;
      seen[token] = true;
      found.push({ text: token, score: modelScore(token), index: found.length });
    }
    text.split(/\n+/).forEach(function (line) {
      var cleaned = line.replace(/[^A-Z0-9./#\-\s]/g, " ").replace(/\s+/g, " ").trim();
      if (!cleaned) return;
      var parts = cleaned.split(" ");
      parts.forEach(consider);
      for (var i = 0; i < parts.length - 1; i += 1) {
        if (isWordOnly(parts[i]) || isWordOnly(parts[i + 1])) continue;
        consider(parts[i] + parts[i + 1]);
      }
    });
    found.sort(function (a, b) {
      return b.score - a.score || a.index - b.index;
    });
    return found.slice(0, 6).map(function (item) { return item.text; });
  }

  function confusionVariants(token) {
    var source = tidyToken(String(token || "").toUpperCase());
    var variants = [];
    var seen = {};
    PAIRS.forEach(function (pair) {
      if (source.indexOf(pair[0]) === -1) return;
      var next = source.split(pair[0]).join(pair[1]);
      if (!next || next === source || seen[next]) return;
      seen[next] = true;
      variants.push(next);
    });
    return variants.slice(0, 3);
  }

  function searchMethod(query, chosen) {
    if (!chosen) return "manual";
    var left = normalizeOcrText(query);
    var right = normalizeOcrText(chosen);
    if (!left || left.toLowerCase() !== right.toLowerCase()) return "manual";
    return "ocr";
  }

  root.SedoriOcr = {
    LONG_EDGE: LONG_EDGE,
    INIT_TIMEOUT_MS: INIT_TIMEOUT_MS,
    RECOGNIZE_TIMEOUT_MS: RECOGNIZE_TIMEOUT_MS,
    CHAR_WHITELIST: CHAR_WHITELIST,
    PAGE_MODE: PAGE_MODE,
    normalizeOcrText: normalizeOcrText,
    fitLongEdge: fitLongEdge,
    extractModelCandidates: extractModelCandidates,
    confusionVariants: confusionVariants,
    searchMethod: searchMethod
  };
})(typeof window !== "undefined" ? window : globalThis);
