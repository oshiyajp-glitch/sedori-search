(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : window;

  function codes() {
    return root.SedoriCodes;
  }

  function interpretScan(text) {
    var compact = String(text || "").normalize("NFKC").replace(/\D/g, "");
    if (/^\d{13}$/.test(compact) && compact.charAt(0) === "0") {
      var upca = codes().validateCode(compact.slice(1));
      if (upca.ok && upca.kind === "upca") {
        return { ok: true, code: upca.normalized, kind: "upca", message: upca.message };
      }
    }
    var checked = codes().validateCode(compact);
    if (checked.empty || !checked.ok) {
      return {
        ok: false,
        code: compact,
        kind: checked.kind || "",
        message: checked.message || "読み取った数字を確認してください。"
      };
    }
    if (checked.kind === "isbn10") {
      return {
        ok: false,
        code: compact,
        kind: "isbn10",
        message: "ISBN-10はカメラでは読めません。上の欄に手入力してください。"
      };
    }
    if (checked.kind !== "jan" && checked.kind !== "isbn13" && checked.kind !== "ean8" && checked.kind !== "upca") {
      return {
        ok: false,
        code: compact,
        kind: checked.kind,
        message: "EAN-13、EAN-8、UPC-A以外は読み取れません。"
      };
    }
    return { ok: true, code: checked.normalized, kind: checked.kind, message: checked.message };
  }

  function createGuard() {
    var accepted = "";
    var locked = false;
    var lastFailure = "";
    return {
      accept: function (code) {
        if (locked && code === accepted) return false;
        accepted = code;
        locked = true;
        return true;
      },
      seeFailure: function (code) {
        if (!code || code === lastFailure) return false;
        lastFailure = code;
        return true;
      }
    };
  }

  function searchMethod(query, scannedCode) {
    if (scannedCode && query === scannedCode) return "barcode";
    return "manual";
  }

  function releaseStream(stream) {
    if (!stream || typeof stream.getTracks !== "function") return;
    stream.getTracks().forEach(function (track) {
      try {
        track.stop();
      } catch (error) {}
    });
  }

  function cameraAvailability(env) {
    var source = env || {};
    var has = Object.prototype.hasOwnProperty;
    var secure = has.call(source, "isSecureContext") ? source.isSecureContext : root.isSecureContext;
    var media = has.call(source, "mediaDevices")
      ? source.mediaDevices
      : (root.navigator && root.navigator.mediaDevices);
    var zxing = has.call(source, "zxing") ? source.zxing : root.ZXing;
    if (!secure) return { ok: false, reason: "insecure" };
    if (!media || typeof media.getUserMedia !== "function") return { ok: false, reason: "unsupported" };
    if (!zxing || typeof zxing.BrowserMultiFormatReader !== "function") return { ok: false, reason: "library" };
    return { ok: true, zxing: zxing };
  }

  function errorKind(error) {
    var name = "";
    if (error) name = String(error.name || error.message || "");
    if (/NotAllowed|Permission/i.test(name)) return "denied";
    if (/NotFound|Overconstrained|DevicesNotFound/i.test(name)) return "missing";
    if (/NotReadable|TrackStart/i.test(name)) return "busy";
    if (/Security/i.test(name)) return "insecure";
    return "failed";
  }

  function productHints(zxing) {
    if (!zxing.DecodeHintType || !zxing.BarcodeFormat) return null;
    var hints = new Map();
    hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [
      zxing.BarcodeFormat.EAN_13,
      zxing.BarcodeFormat.EAN_8,
      zxing.BarcodeFormat.UPC_A
    ]);
    return hints;
  }

  function attachCamera(video, handlers, env) {
    var notify = handlers || {};
    var availability = cameraAvailability(env);
    if (!availability.ok) {
      if (notify.onError) notify.onError(availability.reason);
      return { stop: function () {} };
    }
    if (!video) {
      if (notify.onError) notify.onError("failed");
      return { stop: function () {} };
    }
    var token = {};
    var current = token;
    var stopped = false;
    var guard = createGuard();
    var reader = new availability.zxing.BrowserMultiFormatReader(productHints(availability.zxing), 300);
    function stop() {
      if (stopped) return;
      stopped = true;
      current = null;
      try { reader.reset(); } catch (error) {}
      releaseStream(video.srcObject);
      if ("srcObject" in video) video.srcObject = null;
      try { video.pause(); } catch (error) {}
    }
    try {
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.muted = true;
    } catch (error) {}
    var pending;
    try {
      pending = reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        video,
        function (result) {
          if (current !== token || stopped || !result) return;
          var text = typeof result.getText === "function" ? result.getText() : result.text;
          var interpreted = interpretScan(text);
          if (!interpreted.ok) {
            if (guard.seeFailure(interpreted.code || text) && notify.onReject) notify.onReject(interpreted.message);
            return;
          }
          if (!guard.accept(interpreted.code)) return;
          stop();
          if (notify.onScan) notify.onScan(interpreted);
        }
      );
    } catch (error) {
      stop();
      if (notify.onError) notify.onError(errorKind(error));
      return { stop: stop };
    }
    if (pending && typeof pending.catch === "function") {
      pending.catch(function (error) {
        if (current !== token || stopped) return;
        stop();
        if (notify.onError) notify.onError(errorKind(error));
      });
    }
    return { stop: stop };
  }

  root.SedoriBarcode = {
    interpretScan: interpretScan,
    createGuard: createGuard,
    searchMethod: searchMethod,
    releaseStream: releaseStream,
    cameraAvailability: cameraAvailability,
    errorKind: errorKind,
    attachCamera: attachCamera
  };
})();
