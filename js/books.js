(function (root) {
  var TIMEOUT_MS = 7000;

  function clean(value) {
    return String(value || "").replace(/^\s+|\s+$/g, "");
  }

  function shouldLookup(check) {
    return !!(check && check.ok && !check.empty && check.isbn13 && (check.kind === "isbn13" || check.kind === "isbn10"));
  }

  function interpretBody(data) {
    var empty = { status: "missing", title: "", author: "", publisher: "", isbn: "" };
    if (!data || !data.length || data[0] == null) return empty;
    var summary = data[0].summary || {};
    var book = {
      status: "found",
      title: clean(summary.title),
      author: clean(summary.author),
      publisher: clean(summary.publisher),
      isbn: clean(summary.isbn).replace(/[^0-9Xx]/g, "")
    };
    if (!book.title && !book.author && !book.publisher) return empty;
    return book;
  }

  function lookupIsbn(isbn, signal) {
    return fetch("https://api.openbd.jp/v1/get?isbn=" + encodeURIComponent(isbn), {
      method: "GET",
      signal: signal,
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("http-" + response.status);
      return response.json();
    });
  }

  function createLookupGate() {
    var active = 0;
    var currentController = null;
    return {
      begin: function () {
        active += 1;
        var id = active;
        if (currentController) currentController.abort();
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        currentController = controller;
        return {
          signal: controller ? controller.signal : undefined,
          abort: function () {
            if (controller) controller.abort();
          },
          finish: function (outcome) {
            if (id !== active) return null;
            if (outcome && outcome.error) {
              var name = outcome.error && outcome.error.name;
              if (name === "AbortError" && !outcome.timedOut) return null;
              return { status: outcome.timedOut ? "timeout" : "failed", title: "", author: "", publisher: "", isbn: "" };
            }
            return interpretBody(outcome && outcome.body);
          }
        };
      },
      cancel: function () {
        active += 1;
        if (currentController) {
          currentController.abort();
          currentController = null;
        }
      }
    };
  }

  function candidateSeed(currentQuery, held, bookState, title, author, publisher) {
    var partial = { modelNumber: currentQuery || "" };
    if (held && held.code) {
      partial.code = held.code;
      partial.codeKind = held.kind || "";
    }
    if (bookState === "found") {
      var name = clean(title);
      var maker = clean(publisher);
      var writer = clean(author);
      if (name) partial.name = name;
      if (maker) partial.maker = maker;
      if (writer) partial.memo = "著者: " + writer;
    }
    return partial;
  }

  root.SedoriBooks = {
    TIMEOUT_MS: TIMEOUT_MS,
    shouldLookup: shouldLookup,
    interpretBody: interpretBody,
    lookupIsbn: lookupIsbn,
    createLookupGate: createLookupGate,
    candidateSeed: candidateSeed
  };
})(typeof window !== "undefined" ? window : globalThis);
