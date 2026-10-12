(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var model = root.SedoriModel;
  var STORAGE_KEY = "sedori-search-v2";

  function isQuotaError(error) {
    if (!error) return false;
    if (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    return error.code === 22 || error.code === 1014;
  }

  function saveMessage(reason) {
    if (reason === "quota") {
      return "保存できませんでした。ブラウザの保存容量が不足しています。設定からJSONを書き出し、古い履歴を削除してください。この変更は再読み込み後に残らない可能性があります。";
    }
    return "保存できませんでした。この変更は再読み込み後に残らない可能性があります。設定からJSONを書き出してください。";
  }

  function loadState() {
    var storage = root.localStorage;
    if (!storage) {
      return {
        ok: false,
        reason: "unavailable",
        message: "このブラウザではデータを保存できません。JSONの書き出しで控えてください。",
        state: model.emptyState()
      };
    }
    var raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
      return {
        ok: false,
        reason: "read",
        message: "保存データを読み込めませんでした。上書きはしていません。",
        state: model.emptyState()
      };
    }
    if (!raw) {
      return { ok: true, reason: "", message: "", state: model.emptyState() };
    }
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 1) {
        return {
          ok: false,
          reason: "version",
          message: "保存データの形式が対応範囲外です。上書きはしていません。",
          state: model.emptyState()
        };
      }
      return { ok: true, reason: "", message: "", state: model.normalizeState(parsed) };
    } catch (error) {
      return {
        ok: false,
        reason: "read",
        message: "保存データを読み込めませんでした。上書きはしていません。",
        state: model.emptyState()
      };
    }
  }

  function saveState(state) {
    var storage = root.localStorage;
    if (!storage) return { ok: false, reason: "unavailable" };
    var json;
    try {
      json = JSON.stringify(state);
    } catch (error) {
      return { ok: false, reason: "serialize" };
    }
    try {
      storage.setItem(STORAGE_KEY, json);
    } catch (error) {
      return { ok: false, reason: isQuotaError(error) ? "quota" : "write" };
    }
    try {
      if (storage.getItem(STORAGE_KEY) !== json) {
        return { ok: false, reason: "verify" };
      }
    } catch (error) {
      return { ok: false, reason: "readback" };
    }
    return { ok: true, reason: "" };
  }

  root.SedoriStorage = {
    STORAGE_KEY: STORAGE_KEY,
    isQuotaError: isQuotaError,
    saveMessage: saveMessage,
    loadState: loadState,
    saveState: saveState
  };
})();
