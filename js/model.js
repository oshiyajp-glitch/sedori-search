(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var urls = root.SedoriUrls;
  var HISTORY_LIMIT = 500;
  var SITE_IDS = ["ebay", "yahoo", "mercari"];
  var METHODS = ["manual", "barcode", "ocr"];
  var STATUSES = ["undecided", "buy", "pass", "purchased"];

  function createId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function union(current, incoming) {
    var next = Array.isArray(current) ? current.slice() : [];
    (incoming || []).forEach(function (item) {
      if (next.indexOf(item) === -1) next.push(item);
    });
    return next;
  }

  function cleanList(values, allowed) {
    var next = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      if (allowed.indexOf(value) !== -1 && next.indexOf(value) === -1) next.push(value);
    });
    return next;
  }

  function numberOrNull(value) {
    if (value == null || value === "") return null;
    var number = typeof value === "number" ? value : Number(String(value).normalize("NFKC").replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function blankMarketplace() {
    return {
      feeRatePercent: null,
      shippingJpy: null,
      otherJpy: null
    };
  }

  function blankEbay() {
    return {
      feeRatePercent: null,
      feeBase: "",
      fixedFeeJpy: null,
      shippingJpy: null,
      dutyJpy: null,
      otherJpy: null
    };
  }

  function normalizeDomestic(source) {
    var input = source && typeof source === "object" ? source : {};
    return {
      feeRatePercent: numberOrNull(input.feeRatePercent),
      shippingJpy: numberOrNull(input.shippingJpy),
      otherJpy: numberOrNull(input.otherJpy)
    };
  }

  function normalizeEbay(source) {
    var input = source && typeof source === "object" ? source : {};
    var feeBase = input.feeBase === "item_only" || input.feeBase === "item_plus_shipping" ? input.feeBase : "";
    return {
      feeRatePercent: numberOrNull(input.feeRatePercent),
      feeBase: feeBase,
      fixedFeeJpy: numberOrNull(input.fixedFeeJpy),
      shippingJpy: numberOrNull(input.shippingJpy),
      dutyJpy: numberOrNull(input.dutyJpy),
      otherJpy: numberOrNull(input.otherJpy)
    };
  }

  function defaultSettings() {
    return {
      targetProfitJpy: null,
      exchangeRate: null,
      marketplaces: {
        ebay: blankEbay(),
        yahoo: blankMarketplace(),
        mercari: blankMarketplace()
      }
    };
  }

  function normalizeSettings(source) {
    var input = source && typeof source === "object" ? source : {};
    var markets = input.marketplaces && typeof input.marketplaces === "object" ? input.marketplaces : {};
    return {
      targetProfitJpy: numberOrNull(input.targetProfitJpy),
      exchangeRate: numberOrNull(input.exchangeRate),
      marketplaces: {
        ebay: normalizeEbay(markets.ebay),
        yahoo: normalizeDomestic(markets.yahoo),
        mercari: normalizeDomestic(markets.mercari)
      }
    };
  }

  function normalizeHistoryItem(item) {
    if (!item || typeof item !== "object" || typeof item.keyword !== "string") return null;
    var keyword = urls.normalizeQuery(item.keyword);
    if (!keyword) return null;
    var count = Number(item.count);
    return {
      id: typeof item.id === "string" && item.id ? item.id : createId(),
      keyword: keyword,
      keywordKey: keyword.toLowerCase(),
      firstSearchedAt: typeof item.firstSearchedAt === "string" ? item.firstSearchedAt : (item.lastSearchedAt || nowIso()),
      lastSearchedAt: typeof item.lastSearchedAt === "string" ? item.lastSearchedAt : (item.firstSearchedAt || nowIso()),
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
      sites: cleanList(item.sites, SITE_IDS),
      methods: cleanList(item.methods, METHODS),
      favorite: item.favorite === true
    };
  }

  function normalizeChannelResult(source) {
    if (!source || typeof source !== "object") return null;
    var status = source.status === "ok" || source.status === "invalid" || source.status === "incomplete" ? source.status : "incomplete";
    return {
      id: text(source.id),
      label: text(source.label),
      status: status,
      message: text(source.message),
      revenueJpy: numberOrNull(source.revenueJpy),
      feeJpy: numberOrNull(source.feeJpy),
      fixedFeeJpy: numberOrNull(source.fixedFeeJpy),
      shippingJpy: numberOrNull(source.shippingJpy),
      dutyJpy: numberOrNull(source.dutyJpy),
      otherJpy: numberOrNull(source.otherJpy),
      profitJpy: numberOrNull(source.profitJpy),
      salesMargin: numberOrNull(source.salesMargin),
      costMargin: numberOrNull(source.costMargin),
      maxBuyJpy: numberOrNull(source.maxBuyJpy)
    };
  }

  function normalizeCalculation(source) {
    if (!source || typeof source !== "object") return null;
    var conditions = source.conditions && typeof source.conditions === "object" ? source.conditions : {};
    var results = source.results && typeof source.results === "object" ? source.results : {};
    var best = results.best && typeof results.best === "object" ? results.best : {};
    var labels = [];
    (Array.isArray(best.labels) ? best.labels : []).forEach(function (label) {
      if (typeof label === "string" && label) labels.push(label);
    });
    return {
      calculatedAt: typeof source.calculatedAt === "string" ? source.calculatedAt : "",
      costJpy: numberOrNull(source.costJpy),
      domesticPriceJpy: numberOrNull(source.domesticPriceJpy),
      itemUsd: numberOrNull(source.itemUsd),
      buyerShippingUsd: numberOrNull(source.buyerShippingUsd),
      exchangeRate: numberOrNull(source.exchangeRate),
      targetProfitJpy: numberOrNull(source.targetProfitJpy),
      targetAssumedZero: source.targetAssumedZero === true,
      conditions: {
        yahoo: normalizeDomestic(conditions.yahoo),
        mercari: normalizeDomestic(conditions.mercari),
        ebay: normalizeEbay(conditions.ebay)
      },
      results: {
        yahoo: normalizeChannelResult(results.yahoo),
        mercari: normalizeChannelResult(results.mercari),
        ebay: normalizeChannelResult(results.ebay),
        best: {
          ids: cleanList(best.ids, SITE_IDS),
          labels: labels,
          profitJpy: numberOrNull(best.profitJpy)
        }
      }
    };
  }

  function normalizeCandidate(item) {
    if (!item || typeof item !== "object") return null;
    var status = STATUSES.indexOf(item.status) !== -1 ? item.status : "undecided";
    var createdAt = typeof item.createdAt === "string" ? item.createdAt : nowIso();
    return {
      id: typeof item.id === "string" && item.id ? item.id : createId(),
      name: text(item.name),
      maker: text(item.maker),
      modelNumber: text(item.modelNumber),
      code: text(item.code),
      codeKind: text(item.codeKind),
      category: text(item.category),
      plannedCostJpy: numberOrNull(item.plannedCostJpy),
      shopName: text(item.shopName),
      condition: text(item.condition),
      accessories: text(item.accessories),
      domesticPriceJpy: numberOrNull(item.domesticPriceJpy),
      overseasPriceUsd: numberOrNull(item.overseasPriceUsd),
      domesticProfitJpy: numberOrNull(item.domesticProfitJpy),
      overseasProfitJpy: numberOrNull(item.overseasProfitJpy),
      calculation: normalizeCalculation(item.calculation),
      memo: text(item.memo),
      status: status,
      createdAt: createdAt,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt
    };
  }

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function mapValid(list, normalizer) {
    if (!Array.isArray(list)) return [];
    var next = [];
    list.forEach(function (item) {
      var normalized = normalizer(item);
      if (normalized) next.push(normalized);
    });
    return next;
  }

  function emptyState() {
    return {
      schemaVersion: 1,
      settings: defaultSettings(),
      history: [],
      candidates: []
    };
  }

  function normalizeState(input) {
    var source = input && typeof input === "object" ? input : {};
    return {
      schemaVersion: 1,
      settings: normalizeSettings(source.settings),
      history: mapValid(source.history, normalizeHistoryItem),
      candidates: mapValid(source.candidates, normalizeCandidate)
    };
  }

  function pruneHistory(history) {
    var next = history.slice();
    while (next.length > HISTORY_LIMIT) {
      var oldestIndex = -1;
      for (var i = 0; i < next.length; i += 1) {
        if (next[i].favorite) continue;
        if (oldestIndex < 0 || next[i].lastSearchedAt < next[oldestIndex].lastSearchedAt) {
          oldestIndex = i;
        }
      }
      if (oldestIndex < 0) break;
      next.splice(oldestIndex, 1);
    }
    return next;
  }

  function recordSearch(state, input) {
    var keyword = urls.normalizeQuery(input.keyword);
    if (!keyword) return state;
    var sites = cleanList(input.sites, SITE_IDS);
    var method = METHODS.indexOf(input.method) !== -1 ? input.method : "manual";
    var at = input.now || nowIso();
    var key = keyword.toLowerCase();
    var history = state.history.slice();
    var index = -1;
    for (var i = 0; i < history.length; i += 1) {
      if (history[i].keywordKey === key) {
        index = i;
        break;
      }
    }
    if (index >= 0) {
      var current = history[index];
      history.splice(index, 1);
      history.unshift({
        id: current.id,
        keyword: keyword,
        keywordKey: key,
        firstSearchedAt: current.firstSearchedAt,
        lastSearchedAt: at,
        count: current.count + 1,
        sites: union(current.sites, sites),
        methods: union(current.methods, [method]),
        favorite: current.favorite === true
      });
    } else {
      history.unshift({
        id: createId(),
        keyword: keyword,
        keywordKey: key,
        firstSearchedAt: at,
        lastSearchedAt: at,
        count: 1,
        sites: sites,
        methods: [method],
        favorite: false
      });
    }
    return {
      schemaVersion: state.schemaVersion,
      settings: state.settings,
      history: pruneHistory(history),
      candidates: state.candidates
    };
  }

  function toggleFavorite(state, id) {
    return {
      schemaVersion: state.schemaVersion,
      settings: state.settings,
      candidates: state.candidates,
      history: state.history.map(function (item) {
        if (item.id !== id) return item;
        return {
          id: item.id,
          keyword: item.keyword,
          keywordKey: item.keywordKey,
          firstSearchedAt: item.firstSearchedAt,
          lastSearchedAt: item.lastSearchedAt,
          count: item.count,
          sites: item.sites.slice(),
          methods: item.methods.slice(),
          favorite: !item.favorite
        };
      })
    };
  }

  function deleteHistory(state, id) {
    return {
      schemaVersion: state.schemaVersion,
      settings: state.settings,
      candidates: state.candidates,
      history: state.history.filter(function (item) { return item.id !== id; })
    };
  }

  function clearHistory(state) {
    return {
      schemaVersion: state.schemaVersion,
      settings: state.settings,
      candidates: state.candidates,
      history: []
    };
  }

  function filterHistory(history, query) {
    var key = urls.normalizeQuery(query).toLowerCase();
    if (!key) return history.slice();
    return history.filter(function (item) {
      return item.keyword.toLowerCase().indexOf(key) !== -1 || item.keywordKey.indexOf(key) !== -1;
    });
  }

  function blankCandidate(partial) {
    var at = nowIso();
    var base = {
      id: createId(),
      name: "",
      maker: "",
      modelNumber: "",
      code: "",
      codeKind: "",
      category: "",
      plannedCostJpy: null,
      shopName: "",
      condition: "",
      accessories: "",
      domesticPriceJpy: null,
      overseasPriceUsd: null,
      domesticProfitJpy: null,
      overseasProfitJpy: null,
      calculation: null,
      memo: "",
      status: "undecided",
      createdAt: at,
      updatedAt: at
    };
    var source = partial && typeof partial === "object" ? partial : {};
    Object.keys(source).forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(base, name) && name !== "id" && name !== "createdAt") {
        base[name] = source[name];
      }
    });
    return base;
  }

  function upsertCandidate(state, candidate) {
    var normalized = normalizeCandidate(candidate);
    if (!normalized) return state;
    normalized.updatedAt = candidate.updatedAt || nowIso();
    var found = false;
    var candidates = state.candidates.map(function (item) {
      if (item.id !== normalized.id) return item;
      found = true;
      return normalized;
    });
    if (!found) candidates.unshift(normalized);
    return {
      schemaVersion: state.schemaVersion,
      settings: state.settings,
      history: state.history,
      candidates: candidates
    };
  }

  function deleteCandidate(state, id) {
    return {
      schemaVersion: state.schemaVersion,
      settings: state.settings,
      history: state.history,
      candidates: state.candidates.filter(function (item) { return item.id !== id; })
    };
  }

  function filterCandidates(candidates, query, status) {
    var key = urls.normalizeQuery(query).toLowerCase();
    return candidates.filter(function (item) {
      if (status && item.status !== status) return false;
      if (!key) return true;
      var haystack = [
        item.name,
        item.maker,
        item.modelNumber,
        item.code,
        item.category,
        item.shopName,
        item.memo
      ].join("\n").toLowerCase();
      return haystack.indexOf(key) !== -1;
    });
  }

  function replaceUserData(state, incoming) {
    var normalized = normalizeState(incoming);
    return {
      schemaVersion: 1,
      settings: normalized.settings,
      history: pruneHistory(normalized.history),
      candidates: normalized.candidates
    };
  }

  function exportPayload(state, exportedAt) {
    return {
      schemaVersion: 1,
      exportedAt: exportedAt,
      app: "sedori-search",
      settings: state.settings,
      history: state.history,
      candidates: state.candidates
    };
  }

  function inspectImport(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, message: "JSONの形式を確認してください。" };
    }
    if (payload.schemaVersion !== 1) {
      return { ok: false, message: "このバックアップの形式には対応していません。現在のデータは変更していません。" };
    }
    if (!Array.isArray(payload.history) || !Array.isArray(payload.candidates)) {
      return { ok: false, message: "履歴または仕入れ候補の形式を確認してください。現在のデータは変更していません。" };
    }
    var history = mapValid(payload.history, normalizeHistoryItem);
    var candidates = mapValid(payload.candidates, normalizeCandidate);
    return {
      ok: true,
      historyCount: history.length,
      candidateCount: candidates.length,
      skippedHistory: payload.history.length - history.length,
      skippedCandidates: payload.candidates.length - candidates.length,
      state: {
        schemaVersion: 1,
        settings: normalizeSettings(payload.settings),
        history: history,
        candidates: candidates
      }
    };
  }

  root.SedoriModel = {
    HISTORY_LIMIT: HISTORY_LIMIT,
    STATUSES: STATUSES,
    emptyState: emptyState,
    normalizeState: normalizeState,
    normalizeSettings: normalizeSettings,
    recordSearch: recordSearch,
    toggleFavorite: toggleFavorite,
    deleteHistory: deleteHistory,
    clearHistory: clearHistory,
    filterHistory: filterHistory,
    pruneHistory: pruneHistory,
    blankCandidate: blankCandidate,
    upsertCandidate: upsertCandidate,
    deleteCandidate: deleteCandidate,
    filterCandidates: filterCandidates,
    replaceUserData: replaceUserData,
    exportPayload: exportPayload,
    inspectImport: inspectImport
  };
})();
