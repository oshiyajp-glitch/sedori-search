(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : window;

  function checkDigit(dataDigits) {
    var sum = 0;
    for (var i = 0; i < dataDigits.length; i += 1) {
      var posFromRight = dataDigits.length - i;
      var weight = posFromRight % 2 === 1 ? 3 : 1;
      sum += Number(dataDigits.charAt(i)) * weight;
    }
    return (10 - (sum % 10)) % 10;
  }

  function hasValidCheckDigit(digits) {
    if (digits.length < 2) return false;
    var expected = checkDigit(digits.slice(0, -1));
    return expected === Number(digits.charAt(digits.length - 1));
  }

  function isbn10CheckDigit(data9) {
    var sum = 0;
    for (var i = 0; i < 9; i += 1) {
      sum += Number(data9.charAt(i)) * (10 - i);
    }
    var remainder = (11 - (sum % 11)) % 11;
    return remainder === 10 ? "X" : String(remainder);
  }

  function isbn10ToIsbn13(isbn10) {
    var body = "978" + isbn10.slice(0, 9);
    return body + String(checkDigit(body));
  }

  function compactCode(raw) {
    return String(raw || "").normalize("NFKC").trim().replace(/[-\s]/g, "").toUpperCase();
  }

  function result(ok, kind, normalized, message, isbn13) {
    return {
      ok: ok,
      empty: false,
      kind: kind,
      normalized: normalized || "",
      isbn13: isbn13 || "",
      message: message
    };
  }

  function validateCode(raw) {
    var compact = compactCode(raw);
    if (!compact) {
      return { ok: true, empty: true, kind: "", normalized: "", isbn13: "", message: "" };
    }

    if (/^\d{13}$/.test(compact)) {
      var isbnPrefix = compact.indexOf("978") === 0 || compact.indexOf("979") === 0;
      if (!hasValidCheckDigit(compact)) {
        return result(
          false,
          isbnPrefix ? "isbn13" : "ean13",
          compact,
          isbnPrefix
            ? "978/979で始まりますが、ISBNのチェックデジットが正しくありません。"
            : "JAN・EAN-13のチェックデジットが正しくありません。"
        );
      }
      if (isbnPrefix) {
        return result(true, "isbn13", compact, "有効なISBN-13です。", compact);
      }
      return result(true, "jan", compact, "有効なJAN・EAN-13です。");
    }

    if (/^\d{8}$/.test(compact)) {
      if (!hasValidCheckDigit(compact)) {
        return result(false, "ean8", compact, "EAN-8のチェックデジットが正しくありません。");
      }
      return result(true, "ean8", compact, "有効なEAN-8です。");
    }

    if (/^\d{12}$/.test(compact)) {
      if (!hasValidCheckDigit(compact)) {
        return result(false, "upca", compact, "UPC-Aのチェックデジットが正しくありません。");
      }
      return result(true, "upca", compact, "有効なUPC-Aです。");
    }

    if (/^\d{9}[\dX]$/.test(compact)) {
      var expected = isbn10CheckDigit(compact.slice(0, 9));
      if (compact.charAt(9) !== expected) {
        return result(false, "isbn10", compact, "ISBN-10のチェックデジットが正しくありません。");
      }
      var isbn13 = isbn10ToIsbn13(compact);
      return result(true, "isbn10", compact, "有効なISBN-10です。ISBN-13は " + isbn13 + " です。", isbn13);
    }

    return result(false, "unknown", compact, "JAN・ISBNの桁数を確認してください。");
  }

  root.SedoriCodes = {
    validateCode: validateCode,
    checkDigit: checkDigit
  };
})();
