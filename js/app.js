(function () {
  var urls = window.SedoriUrls;
  var codes = window.SedoriCodes;
  var books = window.SedoriBooks;
  var barcode = window.SedoriBarcode;
  var calc = window.SedoriCalc;
  var model = window.SedoriModel;
  var storage = window.SedoriStorage;

  var SITE_LABELS = { ebay: "eBay", yahoo: "ヤフオク", mercari: "メルカリ" };
  var METHOD_LABELS = { manual: "手入力", barcode: "バーコード", ocr: "型番撮影" };
  var STATUS_LABELS = {
    undecided: "未判断",
    buy: "購入候補",
    pass: "見送り",
    purchased: "購入済み"
  };

  var loaded = storage.loadState();
  var state = loaded.state;
  var canPersist = loaded.ok;
  var currentView = "search";
  var editingId = "";
  var savedCalculation = null;
  var editingCalculation = null;
  var profitCandidateId = "";
  var COMPARE_NOTE = "販売速度や需要は見ていません。利益額だけの比較です。";
  var scannedQuery = "";
  var barcodeSession = null;
  var heldCode = { code: "", kind: "" };
  var bookState = "idle";
  var bookAuthor = "";
  var bookPublisher = "";
  var lookupGate = books.createLookupGate();
  var lookupTimer = 0;
  var manualTimer = 0;
  var BARCODE_MESSAGES = {
    insecure: "この接続ではカメラを使えません。iPhoneではHTTPSのページで開いてください。型番は手入力できます。",
    unsupported: "このブラウザではカメラを使えません。型番は手入力できます。",
    library: "バーコード読み取りを読み込めませんでした。型番は手入力できます。",
    denied: "カメラの使用が拒否されました。型番は手入力できます。",
    missing: "カメラが見つかりません。型番は手入力できます。",
    busy: "カメラを起動できませんでした。ほかのアプリが使用中の可能性があります。型番は手入力できます。",
    failed: "バーコードを読み取れませんでした。型番は手入力できます。"
  };

  var input = document.getElementById("query");
  var searchForm = document.getElementById("search-form");
  var statusNode = document.getElementById("status");
  var clearButton = document.getElementById("clear");
  var openAllButton = document.getElementById("open-all");
  var saveAlert = document.getElementById("save-alert");
  var links = {
    ebay: document.getElementById("link-ebay"),
    yahoo: document.getElementById("link-yahoo"),
    mercari: document.getElementById("link-mercari")
  };

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function showSaveAlert(message) {
    saveAlert.hidden = false;
    saveAlert.textContent = message;
  }

  function hideSaveAlert() {
    saveAlert.hidden = true;
    saveAlert.textContent = "";
  }

  function commit(next) {
    state = next;
    if (!canPersist) {
      showSaveAlert(loaded.message || storage.saveMessage("write"));
      refreshVisibleLists();
      return { ok: false, reason: "blocked" };
    }
    var result = storage.saveState(state);
    if (!result.ok) showSaveAlert(storage.saveMessage(result.reason));
    else hideSaveAlert();
    refreshVisibleLists();
    return result;
  }

  function refreshVisibleLists() {
    if (currentView === "history") renderHistory();
    if (currentView === "candidates" && document.getElementById("candidate-form").hidden) renderCandidates();
  }

  function currentQuery() {
    return urls.normalizeQuery(input.value);
  }

  function sync() {
    var query = currentQuery();
    var ready = query.length > 0;
    var built = ready ? urls.buildUrls(query) : null;
    openAllButton.classList.toggle("is-ready", ready);
    openAllButton.setAttribute("aria-disabled", ready ? "false" : "true");
    clearButton.hidden = input.value.length === 0;
    Object.keys(links).forEach(function (id) {
      var link = links[id];
      if (ready) {
        link.href = built[id];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-disabled", "false");
        link.tabIndex = 0;
      } else {
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.removeAttribute("rel");
        link.setAttribute("aria-disabled", "true");
        link.tabIndex = -1;
      }
    });
  }

  function openSites(siteIds) {
    var built = urls.buildUrls(currentQuery());
    siteIds.forEach(function (id) {
      var popup = window.open(built[id], "_blank");
      if (popup) {
        try { popup.opener = null; } catch (error) {}
      }
    });
  }

  function renderBook(state, book) {
    bookState = state;
    bookAuthor = state === "found" && book ? book.author : "";
    bookPublisher = state === "found" && book ? book.publisher : "";
    var panel = document.getElementById("book-panel");
    var found = document.getElementById("book-found");
    var status = document.getElementById("book-status");
    var messages = {
      loading: "書誌を確認しています。検索はISBNのまま続行できます。",
      missing: "openBDに該当する書籍がありません。ISBNのまま検索できます。",
      timeout: "書誌の応答がありませんでした。ISBNのまま検索できます。",
      failed: "書誌を取得できませんでした。ISBNのまま検索できます。",
      skipped: "この番号はISBNではないため、書誌は取得しません。番号のまま検索できます。"
    };
    panel.hidden = state === "idle";
    found.hidden = state !== "found";
    status.textContent = messages[state] || "";
    if (state !== "found") {
      document.getElementById("book-title").value = "";
      document.getElementById("book-source").textContent = "";
      return;
    }
    var lines = [];
    if (book.title) lines.push("書名: " + book.title);
    if (book.author) lines.push("著者: " + book.author);
    if (book.publisher) lines.push("出版社: " + book.publisher);
    lines.push("ISBN: " + heldCode.code);
    document.getElementById("book-source").textContent = lines.join("\n");
    status.textContent = "書誌を取得しました。内容を確認してください。";
    document.getElementById("book-title").value = book.title;
  }

  function cancelBookLookup() {
    if (manualTimer) clearTimeout(manualTimer);
    manualTimer = 0;
    if (lookupTimer) clearTimeout(lookupTimer);
    lookupTimer = 0;
    lookupGate.cancel();
  }

  function followCode(check, immediate) {
    if (check && check.empty) {
      heldCode = { code: "", kind: "" };
      cancelBookLookup();
      renderBook("idle");
      return;
    }
    if (!check || !check.ok) return;
    if (books.shouldLookup(check)) {
      if (!immediate && heldCode.code === check.isbn13 && (bookState === "loading" || bookState === "found" || bookState === "missing")) return;
      heldCode = { code: check.isbn13, kind: check.kind };
      startBookLookup(check.isbn13);
      return;
    }
    if (check.kind === "jan" || check.kind === "ean8" || check.kind === "upca") {
      heldCode = { code: check.normalized, kind: check.kind };
      cancelBookLookup();
      renderBook("skipped");
    }
  }

  function startBookLookup(isbn) {
    if (lookupTimer) clearTimeout(lookupTimer);
    var request = lookupGate.begin();
    renderBook("loading");
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      request.abort();
    }, books.TIMEOUT_MS);
    lookupTimer = timer;
    var pending;
    try {
      pending = books.lookupIsbn(isbn, request.signal);
    } catch (error) {
      settleBookLookup(isbn, request, timer, { error: error, timedOut: false });
      return;
    }
    pending.then(function (body) {
      settleBookLookup(isbn, request, timer, { body: body });
    }, function (error) {
      settleBookLookup(isbn, request, timer, { error: error, timedOut: timedOut });
    });
  }

  function settleBookLookup(isbn, request, timer, outcome) {
    if (lookupTimer === timer) {
      clearTimeout(timer);
      lookupTimer = 0;
    }
    var result = request.finish(outcome);
    if (!result || heldCode.code !== isbn) return;
    renderBook(result.status, result);
  }

  function stopBarcodeCamera() {
    var video = document.getElementById("barcode-video");
    var stream = video && video.srcObject;
    if (barcodeSession) {
      barcodeSession.stop();
      barcodeSession = null;
    }
    if (video) {
      barcode.releaseStream(stream || video.srcObject);
      video.srcObject = null;
      try { video.pause(); } catch (error) {}
    }
    var panel = document.getElementById("barcode-panel");
    if (panel) panel.hidden = true;
  }

  function startBarcode() {
    stopBarcodeCamera();
    var availability = barcode.cameraAvailability();
    if (!availability.ok) {
      setStatus(BARCODE_MESSAGES[availability.reason] || BARCODE_MESSAGES.failed);
      input.focus();
      return;
    }
    var panel = document.getElementById("barcode-panel");
    var video = document.getElementById("barcode-video");
    panel.hidden = false;
    document.getElementById("barcode-status").textContent = "カメラを向けてください。読み取ったら、確認してから検索してください。";
    barcodeSession = barcode.attachCamera(video, {
      onScan: function (scan) {
        barcodeSession = null;
        panel.hidden = true;
        scannedQuery = scan.code;
        input.value = scan.code;
        sync();
        if (manualTimer) clearTimeout(manualTimer);
        manualTimer = 0;
        var check = codes.validateCode(scan.code);
        if (check.ok) followCode(check, true);
        setStatus(scan.message + "検索はまだ開いていません。内容を確認してから検索してください。");
        input.focus();
      },
      onReject: function (message) {
        document.getElementById("barcode-status").textContent = message + "読み取りを続けるか、上の欄に手入力してください。";
      },
      onError: function (reason) {
        stopBarcodeCamera();
        setStatus(BARCODE_MESSAGES[reason] || BARCODE_MESSAGES.failed);
        input.focus();
      }
    });
  }

  function remember(siteIds) {
    var query = currentQuery();
    if (!query) return { ok: false, reason: "empty" };
    return commit(model.recordSearch(state, {
      keyword: query,
      sites: siteIds,
      method: barcode.searchMethod(query, scannedQuery)
    }));
  }

  function showView(name) {
    currentView = name;
    ["search", "history", "candidates", "settings", "profit"].forEach(function (view) {
      var section = document.getElementById("view-" + view);
      if (section) section.hidden = view !== name;
      var tab = document.getElementById("tab-" + view);
      if (!tab) return;
      if (view === name) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    if (name === "history") renderHistory();
    if (name === "settings") {
      fillSettingsForm();
      document.getElementById("settings-status").textContent = "";
    }
    if (name === "profit") renderProfit();
    if (name !== "search") stopBarcodeCamera();
  }

  function formatWhen(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function renderHistory() {
    var list = document.getElementById("history-list");
    var items = model.filterHistory(state.history, document.getElementById("history-filter").value);
    document.getElementById("history-clear").disabled = state.history.length === 0;
    list.replaceChildren();
    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = state.history.length ? "一致する履歴はありません。" : "まだ履歴はありません。";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      list.appendChild(historyCard(item));
    });
  }

  function historyCard(item) {
    var card = document.createElement("article");
    card.className = "card" + (item.favorite ? " is-favorite" : "");

    var open = document.createElement("button");
    open.type = "button";
    open.className = "keyword-button";
    open.textContent = item.keyword;
    open.addEventListener("click", function () { research(item); });

    var meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = item.count + "回 · " + formatWhen(item.lastSearchedAt) + " · " + labels(item.methods, METHOD_LABELS);

    var sites = document.createElement("p");
    sites.className = "meta";
    sites.textContent = item.sites.length ? labels(item.sites, SITE_LABELS) : "検索先未記録";

    var actions = document.createElement("div");
    actions.className = "card-actions";
    var favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = "secondary";
    favorite.textContent = item.favorite ? "お気に入り解除" : "お気に入り";
    favorite.setAttribute("aria-pressed", item.favorite ? "true" : "false");
    favorite.addEventListener("click", function () {
      commit(model.toggleFavorite(state, item.id));
    });
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "削除";
    remove.addEventListener("click", function () {
      commit(model.deleteHistory(state, item.id));
    });
    actions.appendChild(favorite);
    actions.appendChild(remove);
    card.appendChild(open);
    card.appendChild(meta);
    card.appendChild(sites);
    card.appendChild(actions);
    return card;
  }

  function labels(values, table) {
    return values.map(function (value) { return table[value] || value; }).join(" · ");
  }

  function research(item) {
    input.value = item.keyword;
    sync();
    var sites = item.sites.length ? item.sites.slice() : ["ebay", "yahoo", "mercari"];
    remember(sites);
    showView("search");
    openSites(sites);
    setStatus("開きました。足りないサイトは下のボタンを押してください。");
  }

  function showCandidateList() {
    editingId = "";
    showView("candidates");
    document.getElementById("candidate-list-wrap").hidden = false;
    document.getElementById("candidate-form").hidden = true;
    renderCandidates();
  }

  function renderCandidates() {
    var list = document.getElementById("candidate-list");
    var items = model.filterCandidates(
      state.candidates,
      document.getElementById("candidate-filter").value,
      document.getElementById("candidate-status-filter").value
    );
    list.replaceChildren();
    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = state.candidates.length ? "一致する候補はありません。" : "まだ仕入れ候補はありません。";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      list.appendChild(candidateCard(item));
    });
  }

  function candidateCard(item) {
    var card = document.createElement("article");
    card.className = "card";
    var title = document.createElement("button");
    title.type = "button";
    title.className = "keyword-button";
    title.textContent = item.modelNumber || item.name || "名称未設定";
    title.addEventListener("click", function () { openCandidateEditor(item); });
    var meta = document.createElement("p");
    meta.className = "meta";
    var bits = [STATUS_LABELS[item.status] || item.status];
    if (item.shopName) bits.push(item.shopName);
    if (item.plannedCostJpy != null) bits.push("仕入 " + formatYen(item.plannedCostJpy));
    var channelResults = item.calculation && item.calculation.results ? item.calculation.results : null;
    if (channelResults && channelResults.yahoo && channelResults.yahoo.status === "ok") bits.push("ヤフオク " + formatYen(channelResults.yahoo.profitJpy));
    if (channelResults && channelResults.mercari && channelResults.mercari.status === "ok") bits.push("メルカリ " + formatYen(channelResults.mercari.profitJpy));
    if (channelResults && channelResults.ebay && channelResults.ebay.status === "ok") bits.push("eBay " + formatYen(channelResults.ebay.profitJpy));
    if (!channelResults && item.domesticProfitJpy != null) bits.push("国内利益 " + formatYen(item.domesticProfitJpy));
    if (!channelResults && item.overseasProfitJpy != null) bits.push("海外利益 " + formatYen(item.overseasProfitJpy));
    if (item.code) bits.push(item.code);
    meta.textContent = bits.join(" · ");
    var bestLabels = item.calculation && item.calculation.results && item.calculation.results.best
      ? item.calculation.results.best.labels
      : [];
    var actions = document.createElement("div");
    actions.className = "card-actions";
    var edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "編集";
    edit.addEventListener("click", function () { openCandidateEditor(item); });
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "削除";
    remove.addEventListener("click", function () {
      confirmDialog("仕入れ候補を削除", "この仕入れ候補を削除します。", "削除する").then(function (ok) {
        if (!ok) return;
        commit(model.deleteCandidate(state, item.id));
      });
    });
    actions.appendChild(edit);
    actions.appendChild(remove);
    card.appendChild(title);
    card.appendChild(meta);
    if (bestLabels.length) {
      var bestLine = document.createElement("p");
      bestLine.className = "meta";
      bestLine.textContent = "利益額がいちばん高いのは" + bestLabels.join("と") + "です。" + COMPARE_NOTE;
      card.appendChild(bestLine);
    }
    card.appendChild(actions);
    return card;
  }

  function openCandidateEditor(candidate) {
    var seed = books.candidateSeed(
      currentQuery(),
      heldCode,
      bookState,
      document.getElementById("book-title").value,
      bookAuthor,
      bookPublisher
    );
    var draft = candidate || model.blankCandidate(seed);
    editingId = draft.id;
    document.getElementById("candidate-form-title").textContent = candidate ? "仕入れ候補を編集" : "仕入れ候補を追加";
    document.getElementById("candidate-delete").hidden = !candidate;
    setValue("candidate-name", draft.name);
    setValue("candidate-maker", draft.maker);
    setValue("candidate-model", draft.modelNumber);
    setValue("candidate-code", draft.code);
    setValue("candidate-category", draft.category);
    setValue("candidate-cost", moneyText(draft.plannedCostJpy));
    setValue("candidate-shop", draft.shopName);
    setValue("candidate-condition", draft.condition);
    setValue("candidate-accessories", draft.accessories);
    setValue("candidate-domestic-price", moneyText(draft.domesticPriceJpy));
    setValue("candidate-overseas-price", moneyText(draft.overseasPriceUsd));
    setValue("candidate-memo", draft.memo);
    setValue("candidate-status", draft.status);
    savedCalculation = candidate && candidate.calculation ? cloneData(candidate.calculation) : null;
    editingCalculation = savedCalculation ? cloneData(savedCalculation) : null;
    renderSavedCalculation();
    updateCodeNote();
    showView("candidates");
    document.getElementById("candidate-list-wrap").hidden = true;
    document.getElementById("candidate-form").hidden = false;
    document.getElementById("candidate-model").focus();
  }

  function setValue(id, value) {
    document.getElementById(id).value = value == null ? "" : String(value);
  }

  function moneyText(value) {
    return value == null ? "" : String(value);
  }

  function parseOptionalNumber(value) {
    var text = String(value || "").normalize("NFKC").trim().replace(/,/g, "");
    if (!text) return { ok: true, value: null };
    if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, value: null };
    return { ok: true, value: Number(text) };
  }

  function readMoney(id, label, integer) {
    var parsed = parseOptionalNumber(document.getElementById(id).value);
    if (!parsed.ok) return { ok: false, message: label + "は数値で入力してください。" };
    if (parsed.value != null && parsed.value < 0) return { ok: false, message: label + "にマイナスは使えません。" };
    if (integer && parsed.value != null) return { ok: true, value: Math.round(parsed.value) };
    return parsed;
  }

  function updateCodeNote() {
    var checked = codes.validateCode(document.getElementById("candidate-code").value);
    var note = document.getElementById("code-note");
    note.textContent = checked.message;
    note.classList.toggle("is-bad", !checked.ok);
    return checked;
  }

  function saveCandidate(event) {
    event.preventDefault();
    var checked = updateCodeNote();
    if (!checked.ok) {
      document.getElementById("candidate-code").focus();
      return;
    }
    var cost = readMoney("candidate-cost", "仕入れ予定価格", true);
    var domestic = readMoney("candidate-domestic-price", "国内想定販売価格", true);
    var overseas = readMoney("candidate-overseas-price", "海外想定販売価格", false);
    var invalid = [cost, domestic, overseas].filter(function (item) { return !item.ok; })[0];
    if (invalid) {
      showSaveAlert(invalid.message);
      return;
    }
    var existing = null;
    state.candidates.forEach(function (item) {
      if (item.id === editingId) existing = item;
    });
    var draft = model.blankCandidate({
      modelNumber: urls.normalizeQuery(document.getElementById("candidate-model").value)
    });
    if (existing) {
      draft.id = existing.id;
      draft.createdAt = existing.createdAt;
      draft.domesticProfitJpy = existing.domesticProfitJpy;
      draft.overseasProfitJpy = existing.overseasProfitJpy;
      draft.calculation = existing.calculation;
    }
    if (editingCalculation) {
      draft.calculation = editingCalculation;
      var summary = summaryFromSnapshot(editingCalculation);
      draft.domesticProfitJpy = summary.domesticProfitJpy;
      draft.overseasProfitJpy = summary.overseasProfitJpy;
    }
    draft.name = document.getElementById("candidate-name").value.trim();
    draft.maker = document.getElementById("candidate-maker").value.trim();
    draft.modelNumber = urls.normalizeQuery(document.getElementById("candidate-model").value);
    draft.code = checked.empty ? "" : (checked.isbn13 || checked.normalized);
    draft.codeKind = checked.empty ? "" : checked.kind;
    draft.category = document.getElementById("candidate-category").value.trim();
    draft.plannedCostJpy = cost.value;
    draft.shopName = document.getElementById("candidate-shop").value.trim();
    draft.condition = document.getElementById("candidate-condition").value.trim();
    draft.accessories = document.getElementById("candidate-accessories").value.trim();
    draft.domesticPriceJpy = domestic.value;
    draft.overseasPriceUsd = overseas.value;
    draft.memo = document.getElementById("candidate-memo").value.trim();
    draft.status = document.getElementById("candidate-status").value;
    draft.updatedAt = new Date().toISOString();
    var result = commit(model.upsertCandidate(state, draft));
    if (result.ok || result.reason === "quota" || result.reason === "write" || result.reason === "blocked") {
      showCandidateList();
    }
  }

  function readRate(id, label) {
    var parsed = readMoney(id, label, false);
    if (!parsed.ok) return parsed;
    if (parsed.value != null && parsed.value > 100) {
      return { ok: false, message: label + "は100以下にしてください。" };
    }
    return parsed;
  }

  function readSettings() {
    var ebayFee = readRate("ebay-fee", "eBayの販売手数料率");
    var ebayFixed = readMoney("ebay-fixed", "eBayの固定手数料", true);
    var ebayShip = readMoney("ebay-ship", "eBayの国際送料", true);
    var ebayDuty = readMoney("ebay-duty", "eBayの関税・税金", true);
    var ebayOther = readMoney("ebay-other", "eBayのその他経費", true);
    var yahooFee = readRate("yahoo-fee", "ヤフオクの販売手数料率");
    var yahooShip = readMoney("yahoo-ship", "ヤフオクの送料", true);
    var yahooOther = readMoney("yahoo-other", "ヤフオクのその他経費", true);
    var mercariFee = readRate("mercari-fee", "メルカリの販売手数料率");
    var mercariShip = readMoney("mercari-ship", "メルカリの送料", true);
    var mercariOther = readMoney("mercari-other", "メルカリのその他経費", true);
    var exchangeRate = readMoney("setting-rate", "為替レート", false);
    var targetProfit = readMoney("setting-target", "目標利益", true);
    var fields = [ebayFee, ebayFixed, ebayShip, ebayDuty, ebayOther, yahooFee, yahooShip, yahooOther, mercariFee, mercariShip, mercariOther, exchangeRate, targetProfit];
    var invalid = fields.filter(function (item) { return !item.ok; })[0];
    if (invalid) return invalid;
    return {
      ok: true,
      settings: {
        targetProfitJpy: targetProfit.value,
        exchangeRate: exchangeRate.value,
        marketplaces: {
          ebay: {
            feeRatePercent: ebayFee.value,
            feeBase: document.getElementById("ebay-base").value,
            fixedFeeJpy: ebayFixed.value,
            shippingJpy: ebayShip.value,
            dutyJpy: ebayDuty.value,
            otherJpy: ebayOther.value
          },
          yahoo: {
            feeRatePercent: yahooFee.value,
            shippingJpy: yahooShip.value,
            otherJpy: yahooOther.value
          },
          mercari: {
            feeRatePercent: mercariFee.value,
            shippingJpy: mercariShip.value,
            otherJpy: mercariOther.value
          }
        }
      }
    };
  }

  function fillSettingsForm() {
    var markets = state.settings.marketplaces;
    setValue("setting-rate", moneyText(state.settings.exchangeRate));
    setValue("setting-target", moneyText(state.settings.targetProfitJpy));
    setValue("ebay-fee", moneyText(markets.ebay.feeRatePercent));
    setValue("ebay-base", markets.ebay.feeBase || "");
    setValue("ebay-fixed", moneyText(markets.ebay.fixedFeeJpy));
    setValue("ebay-ship", moneyText(markets.ebay.shippingJpy));
    setValue("ebay-duty", moneyText(markets.ebay.dutyJpy));
    setValue("ebay-other", moneyText(markets.ebay.otherJpy));
    setValue("yahoo-fee", moneyText(markets.yahoo.feeRatePercent));
    setValue("yahoo-ship", moneyText(markets.yahoo.shippingJpy));
    setValue("yahoo-other", moneyText(markets.yahoo.otherJpy));
    setValue("mercari-fee", moneyText(markets.mercari.feeRatePercent));
    setValue("mercari-ship", moneyText(markets.mercari.shippingJpy));
    setValue("mercari-other", moneyText(markets.mercari.otherJpy));
  }

  function saveSettings() {
    var read = readSettings();
    var settingsStatus = document.getElementById("settings-status");
    if (!read.ok) {
      settingsStatus.textContent = read.message;
      return;
    }
    var result = commit(Object.assign({}, state, { settings: read.settings }));
    setValue("profit-rate", moneyText(read.settings.exchangeRate));
    setValue("profit-target", moneyText(read.settings.targetProfitJpy));
    settingsStatus.textContent = result.ok ? "設定を保存しました。" : "";
    if (currentView === "profit") renderProfit();
  }

  function exportJson() {
    var payload = model.exportPayload(state, new Date().toISOString());
    var json = JSON.stringify(payload, null, 2);
    document.getElementById("export-json").value = json;
    document.querySelector("#view-settings details").open = true;
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "sedori-search-backup.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (error) {
        showSaveAlert("JSONを読み取れませんでした。現在のデータは変更していません。");
        return;
      }
      var inspection = model.inspectImport(parsed);
      if (!inspection.ok) {
        showSaveAlert(inspection.message);
        return;
      }
      var body = "履歴 " + inspection.historyCount + "件、仕入れ候補 " + inspection.candidateCount + "件を読み込み、いまのデータを置き換えます。";
      if (inspection.skippedHistory || inspection.skippedCandidates) {
        body += "形式が不正な履歴 " + inspection.skippedHistory + "件、候補 " + inspection.skippedCandidates + "件は除きます。";
      }
      confirmDialog("バックアップを読み込む", body, "置き換える").then(function (ok) {
        if (!ok) return;
        var result = commit(model.replaceUserData(state, inspection.state));
        fillSettingsForm();
        if (result.ok) document.getElementById("settings-status").textContent = "バックアップを読み込みました。";
      });
    };
    reader.onerror = function () {
      showSaveAlert("ファイルを読み取れませんでした。現在のデータは変更していません。");
    };
    reader.readAsText(file);
  }

  function confirmDialog(title, body, okLabel) {
    var dialog = document.getElementById("confirm-dialog");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-body").textContent = body;
    document.getElementById("confirm-ok").textContent = okLabel;
    if (typeof dialog.showModal !== "function") {
      return Promise.resolve(window.confirm(title + "\n" + body));
    }
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise(function (resolve) {
      dialog.addEventListener("close", function onClose() {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "ok");
      });
    });
  }

  function cloneData(value) {
    if (value == null) return null;
    return JSON.parse(JSON.stringify(value));
  }

  function formatYen(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return Math.round(Number(value)).toLocaleString("ja-JP") + "円";
  }

  function rateText(value) {
    var parsed = calc.parseAmount(value);
    if (parsed.state === "empty") return "未入力";
    if (parsed.state !== "ok") return "確認してください";
    return parsed.value.toLocaleString("ja-JP") + "円 / 1USD";
  }

  function formatUsd(value, emptyNote) {
    var parsed = calc.parseAmount(value);
    if (parsed.state === "empty") return emptyNote || "未入力";
    if (parsed.state !== "ok") return "確認してください";
    return parsed.value.toLocaleString("ja-JP") + " USD";
  }

  function formatPercent(ratio) {
    if (ratio == null || !Number.isFinite(ratio)) return "—";
    return (Math.round(ratio * 1000) / 10).toFixed(1) + "%";
  }

  function feeBaseLabel(feeBase) {
    if (feeBase === "item_only") return "商品価格のみ";
    if (feeBase === "item_plus_shipping") return "商品価格＋購入者負担送料";
    return "未設定";
  }

  function percentText(value) {
    return value == null ? "未設定" : value + "%";
  }

  function conditionsCopy() {
    var markets = state.settings.marketplaces;
    return {
      yahoo: {
        feeRatePercent: markets.yahoo.feeRatePercent,
        shippingJpy: markets.yahoo.shippingJpy,
        otherJpy: markets.yahoo.otherJpy
      },
      mercari: {
        feeRatePercent: markets.mercari.feeRatePercent,
        shippingJpy: markets.mercari.shippingJpy,
        otherJpy: markets.mercari.otherJpy
      },
      ebay: {
        feeRatePercent: markets.ebay.feeRatePercent,
        feeBase: markets.ebay.feeBase,
        fixedFeeJpy: markets.ebay.fixedFeeJpy,
        shippingJpy: markets.ebay.shippingJpy,
        dutyJpy: markets.ebay.dutyJpy,
        otherJpy: markets.ebay.otherJpy
      }
    };
  }

  function yenSetting(value) {
    if (value == null) return "未設定（0円で計算）";
    return formatYen(value);
  }

  function conditionsText(conditions) {
    var yahoo = conditions.yahoo || {};
    var mercari = conditions.mercari || {};
    var ebay = conditions.ebay || {};
    return [
      "ヤフオク 手数料 " + percentText(yahoo.feeRatePercent) + " / 送料 " + yenSetting(yahoo.shippingJpy) + " / その他 " + yenSetting(yahoo.otherJpy),
      "メルカリ 手数料 " + percentText(mercari.feeRatePercent) + " / 送料 " + yenSetting(mercari.shippingJpy) + " / その他 " + yenSetting(mercari.otherJpy),
      "eBay 手数料 " + percentText(ebay.feeRatePercent) + "（" + feeBaseLabel(ebay.feeBase) + "） / 固定 " + yenSetting(ebay.fixedFeeJpy) + " / 国際送料 " + yenSetting(ebay.shippingJpy) + " / 関税・税金 " + yenSetting(ebay.dutyJpy) + " / その他 " + yenSetting(ebay.otherJpy)
    ].join("\n");
  }

  function readProfitInputs() {
    return {
      costJpy: document.getElementById("profit-cost").value,
      domesticPriceJpy: document.getElementById("profit-domestic").value,
      itemUsd: document.getElementById("profit-item-usd").value,
      buyerShippingUsd: document.getElementById("profit-ship-usd").value,
      exchangeRate: document.getElementById("profit-rate").value,
      targetProfitJpy: document.getElementById("profit-target").value
    };
  }

  function quoteFrom(inputs, conditions) {
    var source = conditions || conditionsCopy();
    return calc.calculate({
      costJpy: inputs.costJpy,
      domesticPriceJpy: inputs.domesticPriceJpy,
      itemUsd: inputs.itemUsd,
      buyerShippingUsd: inputs.buyerShippingUsd,
      exchangeRate: inputs.exchangeRate,
      targetProfitJpy: inputs.targetProfitJpy,
      yahoo: source.yahoo,
      mercari: source.mercari,
      ebay: source.ebay
    });
  }

  function currentQuote() {
    return quoteFrom(readProfitInputs());
  }

  function storedAmount(value) {
    var parsed = calc.parseAmount(value);
    return parsed.state === "ok" ? parsed.value : null;
  }

  function buildSnapshot(inputs, quote) {
    return {
      calculatedAt: new Date().toISOString(),
      costJpy: storedAmount(inputs.costJpy),
      domesticPriceJpy: storedAmount(inputs.domesticPriceJpy),
      itemUsd: storedAmount(inputs.itemUsd),
      buyerShippingUsd: storedAmount(inputs.buyerShippingUsd),
      exchangeRate: storedAmount(inputs.exchangeRate),
      targetProfitJpy: storedAmount(inputs.targetProfitJpy),
      targetAssumedZero: quote.targetAssumedZero === true,
      conditions: conditionsCopy(),
      results: {
        yahoo: quote.yahoo,
        mercari: quote.mercari,
        ebay: quote.ebay,
        best: quote.best
      }
    };
  }

  function summaryFromSnapshot(snapshot) {
    var results = snapshot && snapshot.results ? snapshot.results : {};
    var domestic = [];
    ["yahoo", "mercari"].forEach(function (id) {
      var channel = results[id];
      if (channel && channel.status === "ok" && channel.profitJpy != null) domestic.push(channel.profitJpy);
    });
    var ebay = results.ebay;
    return {
      domesticProfitJpy: domestic.length ? Math.max.apply(null, domestic) : null,
      overseasProfitJpy: ebay && ebay.status === "ok" ? ebay.profitJpy : null
    };
  }

  function findCandidate(id) {
    var found = null;
    state.candidates.forEach(function (item) {
      if (item.id === id) found = item;
    });
    return found;
  }

  function addLine(list, label, value) {
    var item = document.createElement("li");
    item.textContent = label + " " + value;
    list.appendChild(item);
  }

  function bestText(best) {
    if (!best || !best.labels || !best.labels.length || best.profitJpy == null) {
      return "比較できる利益がありません。未入力やエラーの販売先は含めていません。" + COMPARE_NOTE;
    }
    var lead = best.labels.length > 1
      ? "利益額が同じなのは" + best.labels.join("と") + "です"
      : "利益額が最も高いのは" + best.labels[0] + "です";
    return lead + "（" + formatYen(best.profitJpy) + "）。" + COMPARE_NOTE;
  }

  function renderChannel(channel, extraLines) {
    var card = document.createElement("article");
    card.className = "card profit-card";
    card.setAttribute("data-channel", channel.id);
    var title = document.createElement("h3");
    title.textContent = channel.label;
    card.appendChild(title);
    if (channel.status === "ok" && channel.profitJpy != null) {
      var profit = document.createElement("p");
      profit.className = "profit-value" + (channel.profitJpy < 0 ? " is-negative" : "");
      profit.textContent = "想定利益 " + formatYen(channel.profitJpy);
      card.appendChild(profit);
    }
    if (channel.message) {
      var message = document.createElement("p");
      message.className = "meta";
      message.textContent = channel.message;
      card.appendChild(message);
    }
    var list = document.createElement("ul");
    list.className = "profit-lines";
    (extraLines || []).forEach(function (line) { addLine(list, line.label, line.value); });
    if (channel.revenueJpy != null) addLine(list, "売上", formatYen(channel.revenueJpy));
    if (channel.feeJpy != null) addLine(list, "販売手数料", formatYen(channel.feeJpy));
    if (channel.fixedFeeJpy != null) addLine(list, "固定手数料", formatYen(channel.fixedFeeJpy));
    if (channel.shippingJpy != null) addLine(list, channel.id === "ebay" ? "国際送料" : "送料", formatYen(channel.shippingJpy));
    if (channel.dutyJpy != null) addLine(list, "関税・税金", formatYen(channel.dutyJpy));
    if (channel.otherJpy != null) addLine(list, "その他経費", formatYen(channel.otherJpy));
    if (channel.status === "ok") {
      addLine(list, "売上高利益率", formatPercent(channel.salesMargin));
      addLine(list, "仕入原価利益率", formatPercent(channel.costMargin));
    }
    if (channel.maxBuyJpy != null) addLine(list, "仕入れ上限額", formatYen(channel.maxBuyJpy));
    if (list.childNodes.length) card.appendChild(list);
    return card;
  }

  function renderProfit() {
    var inputs = readProfitInputs();
    var quote = currentQuote();
    document.getElementById("profit-status").textContent = "";
    var conditions = conditionsCopy();
    document.getElementById("profit-target-note").textContent = quote.targetAssumedZero
      ? "目標利益は未設定のため、0円で仕入れ上限を計算しています。"
      : "";
    document.getElementById("profit-conditions").textContent = conditionsText(conditions);
    var best = document.getElementById("profit-best");
    best.textContent = bestText(quote.best);
    var results = document.getElementById("profit-results");
    results.replaceChildren();
    var buyerText = formatUsd(inputs.buyerShippingUsd, "0 USD（未入力）");
    [
      { channel: quote.yahoo, lines: [] },
      { channel: quote.mercari, lines: [] },
      {
        channel: quote.ebay,
        lines: [
          { label: "商品価格", value: formatUsd(inputs.itemUsd, "未入力") },
          { label: "購入者負担送料", value: buyerText },
          { label: "為替レート", value: rateText(inputs.exchangeRate) },
          { label: "手数料の対象", value: feeBaseLabel(conditions.ebay.feeBase) }
        ]
      }
    ].forEach(function (item) {
      var card = renderChannel(item.channel, item.lines);
      if (quote.best.ids.indexOf(item.channel.id) !== -1) card.classList.add("is-best");
      results.appendChild(card);
    });
    if (quote.ebay.status === "ok" || quote.ebay.revenueJpy != null) {
      var estimate = document.createElement("p");
      estimate.className = "note";
      estimate.textContent = "eBayの結果は概算です。実際の手数料はカテゴリや国際取引で変わります。";
      results.appendChild(estimate);
    }
  }

  function updateProfitSaveLabel() {
    document.getElementById("profit-save").textContent = profitCandidateId
      ? "この仕入れ候補を更新"
      : "この結果を仕入れ候補に保存";
  }

  function showProfit(prefill) {
    if (prefill) {
      profitCandidateId = prefill.candidateId || "";
      setValue("profit-cost", moneyText(prefill.costJpy));
      setValue("profit-domestic", moneyText(prefill.domesticPriceJpy));
      setValue("profit-item-usd", moneyText(prefill.itemUsd));
      setValue("profit-ship-usd", moneyText(prefill.buyerShippingUsd));
      setValue("profit-rate", moneyText(prefill.exchangeRate != null ? prefill.exchangeRate : state.settings.exchangeRate));
      setValue("profit-target", moneyText(prefill.targetProfitJpy != null ? prefill.targetProfitJpy : state.settings.targetProfitJpy));
    } else {
      profitCandidateId = "";
      setValue("profit-rate", moneyText(state.settings.exchangeRate));
      setValue("profit-target", moneyText(state.settings.targetProfitJpy));
    }
    document.getElementById("profit-status").textContent = "";
    updateProfitSaveLabel();
    showView("profit");
  }

  function persistProfitSetting(inputId, settingsKey, formId, integer) {
    var parsed = parseOptionalNumber(document.getElementById(inputId).value);
    if (!parsed.ok) return;
    var value = parsed.value;
    if (integer && value != null) value = Math.round(value);
    if (value === state.settings[settingsKey]) return;
    if (integer && value != null) setValue(inputId, String(value));
    setValue(formId, moneyText(value));
    var settings = {
      targetProfitJpy: state.settings.targetProfitJpy,
      exchangeRate: state.settings.exchangeRate,
      marketplaces: state.settings.marketplaces
    };
    settings[settingsKey] = value;
    commit(Object.assign({}, state, { settings: settings }));
  }

  function saveProfitCandidate() {
    var status = document.getElementById("profit-status");
    var inputs = readProfitInputs();
    var cost = calc.parseAmount(inputs.costJpy);
    var domestic = calc.parseAmount(inputs.domesticPriceJpy);
    var itemUsd = calc.parseAmount(inputs.itemUsd);
    var buyer = calc.parseAmount(inputs.buyerShippingUsd);
    var rate = calc.parseAmount(inputs.exchangeRate);
    var target = calc.parseAmount(inputs.targetProfitJpy);
    var invalid = [cost, domestic, itemUsd, buyer, rate, target].some(function (item) {
      return item.state === "invalid";
    });
    if (invalid) {
      status.textContent = "数値を確認してください。マイナスは使えません。";
      return;
    }
    var quote = currentQuote();
    var useful = [quote.yahoo, quote.mercari, quote.ebay].some(function (item) {
      return item.status === "ok" || item.maxBuyJpy != null;
    });
    if (!useful) {
      status.textContent = "保存できる計算結果がありません。入力と設定を確認してください。";
      return;
    }
    var snapshot = buildSnapshot(inputs, quote);
    var summary = summaryFromSnapshot(snapshot);
    var existing = findCandidate(profitCandidateId);
    var draft = model.blankCandidate(existing || { modelNumber: currentQuery() });
    if (existing) {
      draft.id = existing.id;
      draft.createdAt = existing.createdAt;
    }
    if (!draft.modelNumber) draft.modelNumber = currentQuery();
    draft.plannedCostJpy = cost.state === "ok" ? Math.round(cost.value) : null;
    draft.domesticPriceJpy = domestic.state === "ok" ? Math.round(domestic.value) : null;
    draft.overseasPriceUsd = itemUsd.state === "ok" ? itemUsd.value : null;
    draft.domesticProfitJpy = summary.domesticProfitJpy;
    draft.overseasProfitJpy = summary.overseasProfitJpy;
    draft.calculation = snapshot;
    draft.updatedAt = new Date().toISOString();
    var result = commit(model.upsertCandidate(state, draft));
    if (result.ok || result.reason === "quota" || result.reason === "write" || result.reason === "blocked") {
      profitCandidateId = draft.id;
      updateProfitSaveLabel();
    }
    status.textContent = result.ok ? "仕入れ候補に保存しました。計算条件と為替レートも記録しています。" : "";
  }

  function appendSnapshot(box, title, snapshot) {
    var heading = document.createElement("h3");
    heading.textContent = title;
    box.appendChild(heading);
    var when = document.createElement("p");
    when.className = "meta";
    when.textContent = snapshot.calculatedAt ? formatWhen(snapshot.calculatedAt) : "";
    box.appendChild(when);
    var inputs = document.createElement("p");
    inputs.className = "meta";
    inputs.textContent = [
      "仕入 " + formatYen(snapshot.costJpy),
      "国内販売 " + formatYen(snapshot.domesticPriceJpy),
      "eBay商品 " + (snapshot.itemUsd == null ? "—" : snapshot.itemUsd + " USD"),
      "購入者負担送料 " + (snapshot.buyerShippingUsd == null ? "—" : snapshot.buyerShippingUsd + " USD"),
      "為替 " + (snapshot.exchangeRate == null ? "未設定" : snapshot.exchangeRate + "円 / 1USD"),
      snapshot.targetAssumedZero ? "目標利益 未設定（0円で計算）" : "目標利益 " + formatYen(snapshot.targetProfitJpy)
    ].join(" / ");
    box.appendChild(inputs);
    var condition = document.createElement("p");
    condition.className = "meta";
    condition.textContent = conditionsText(snapshot.conditions || {});
    box.appendChild(condition);
    var results = snapshot.results || {};
    ["yahoo", "mercari", "ebay"].forEach(function (id) {
      var channel = results[id];
      if (!channel) return;
      var line = document.createElement("p");
      line.className = "meta";
      if (channel.status === "ok") {
        line.textContent = channel.label + " 想定利益 " + formatYen(channel.profitJpy)
          + " / 売上高利益率 " + formatPercent(channel.salesMargin)
          + " / 仕入原価利益率 " + formatPercent(channel.costMargin)
          + " / 仕入れ上限 " + formatYen(channel.maxBuyJpy);
      } else {
        line.textContent = channel.label + " " + (channel.message || "計算できません");
      }
      box.appendChild(line);
    });
    var best = document.createElement("p");
    best.className = "best-note";
    best.textContent = bestText(results.best);
    box.appendChild(best);
  }

  function renderSavedCalculation() {
    var box = document.getElementById("saved-calc");
    box.replaceChildren();
    box.hidden = false;
    if (!savedCalculation && !editingCalculation) {
      var empty = document.createElement("p");
      empty.className = "meta";
      empty.textContent = "まだ利益計算は保存されていません。";
      box.appendChild(empty);
      return;
    }
    if (savedCalculation) appendSnapshot(box, "前回保存した計算", savedCalculation);
    var showNew = editingCalculation && (!savedCalculation || editingCalculation.calculatedAt !== savedCalculation.calculatedAt);
    if (showNew) appendSnapshot(box, "再計算結果（保存すると置き換わります）", editingCalculation);
  }

  function recalcCandidate() {
    var cost = readMoney("candidate-cost", "仕入れ予定価格", true);
    var domestic = readMoney("candidate-domestic-price", "国内想定販売価格", true);
    var overseas = readMoney("candidate-overseas-price", "海外想定販売価格", false);
    var invalid = [cost, domestic, overseas].filter(function (item) { return !item.ok; })[0];
    if (invalid) {
      showSaveAlert(invalid.message);
      return;
    }
    hideSaveAlert();
    var inputs = {
      costJpy: cost.value,
      domesticPriceJpy: domestic.value,
      itemUsd: overseas.value,
      buyerShippingUsd: savedCalculation ? savedCalculation.buyerShippingUsd : null,
      exchangeRate: state.settings.exchangeRate,
      targetProfitJpy: state.settings.targetProfitJpy
    };
    editingCalculation = buildSnapshot(inputs, quoteFrom(inputs));
    renderSavedCalculation();
  }

  searchForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var query = currentQuery();
    if (!query) {
      setStatus("型番を入力してください。");
      input.focus();
      return;
    }
    if (input.value !== query) input.value = query;
    sync();
    remember(["ebay", "yahoo", "mercari"]);
    openSites(["ebay", "yahoo", "mercari"]);
    setStatus("開きました。足りないサイトは下のボタンを押してください。");
  });

  input.addEventListener("input", function () {
    stopBarcodeCamera();
    setStatus("");
    sync();
    if (manualTimer) clearTimeout(manualTimer);
    manualTimer = setTimeout(function () {
      manualTimer = 0;
      followCode(codes.validateCode(input.value), false);
    }, 400);
  });

  clearButton.addEventListener("click", function () {
    scannedQuery = "";
    input.value = "";
    heldCode = { code: "", kind: "" };
    stopBarcodeCamera();
    cancelBookLookup();
    renderBook("idle");
    setStatus("");
    sync();
    input.focus();
  });

  document.getElementById("book-apply").addEventListener("click", function () {
    var title = document.getElementById("book-title").value.replace(/^\s+|\s+$/g, "");
    if (!title) {
      setStatus("商品名を入力してください。ISBNのまま検索することもできます。");
      return;
    }
    input.value = title;
    sync();
    setStatus("商品名を検索欄に入れました。ISBNは保持しています。内容を確認してから検索してください。");
    input.focus();
  });

  document.getElementById("open-barcode").addEventListener("click", startBarcode);
  document.getElementById("barcode-close").addEventListener("click", function () {
    stopBarcodeCamera();
    setStatus("カメラを閉じました。型番は手入力できます。");
    input.focus();
  });
  window.addEventListener("pagehide", stopBarcodeCamera);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") stopBarcodeCamera();
  });

  Object.keys(links).forEach(function (id) {
    links[id].addEventListener("click", function (event) {
      if (!links[id].getAttribute("href")) {
        event.preventDefault();
        setStatus("型番を入力してください。");
        input.focus();
        return;
      }
      remember([id]);
    });
  });

  document.getElementById("add-candidate").addEventListener("click", function () {
    openCandidateEditor(null);
  });
  document.getElementById("open-profit").addEventListener("click", function () {
    showProfit(null);
  });
  document.getElementById("profit-back").addEventListener("click", function () {
    showView("search");
  });
  ["profit-cost", "profit-domestic", "profit-item-usd", "profit-ship-usd"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", renderProfit);
  });
  document.getElementById("profit-rate").addEventListener("input", function () {
    persistProfitSetting("profit-rate", "exchangeRate", "setting-rate", false);
    renderProfit();
  });
  document.getElementById("profit-target").addEventListener("input", function () {
    persistProfitSetting("profit-target", "targetProfitJpy", "setting-target", true);
    renderProfit();
  });
  document.getElementById("profit-settings").addEventListener("click", function () {
    showView("settings");
  });
  document.getElementById("profit-save").addEventListener("click", saveProfitCandidate);
  document.getElementById("candidate-open-profit").addEventListener("click", function () {
    showProfit({
      candidateId: editingId,
      costJpy: document.getElementById("candidate-cost").value,
      domesticPriceJpy: document.getElementById("candidate-domestic-price").value,
      itemUsd: document.getElementById("candidate-overseas-price").value,
      buyerShippingUsd: savedCalculation ? savedCalculation.buyerShippingUsd : null,
      exchangeRate: savedCalculation && savedCalculation.exchangeRate != null ? savedCalculation.exchangeRate : state.settings.exchangeRate,
      targetProfitJpy: savedCalculation && savedCalculation.targetProfitJpy != null ? savedCalculation.targetProfitJpy : state.settings.targetProfitJpy
    });
  });
  document.getElementById("candidate-recalc").addEventListener("click", recalcCandidate);
  document.getElementById("candidate-add").addEventListener("click", function () {
    openCandidateEditor(null);
  });
  document.getElementById("candidate-form").addEventListener("submit", saveCandidate);
  document.getElementById("candidate-cancel").addEventListener("click", showCandidateList);
  document.getElementById("candidate-delete").addEventListener("click", function () {
    confirmDialog("仕入れ候補を削除", "この仕入れ候補を削除します。", "削除する").then(function (ok) {
      if (!ok || !editingId) return;
      commit(model.deleteCandidate(state, editingId));
      showCandidateList();
    });
  });
  document.getElementById("candidate-code").addEventListener("input", updateCodeNote);
  document.getElementById("history-filter").addEventListener("input", renderHistory);
  document.getElementById("candidate-filter").addEventListener("input", renderCandidates);
  document.getElementById("candidate-status-filter").addEventListener("change", renderCandidates);
  document.getElementById("history-clear").addEventListener("click", function () {
    confirmDialog(
      "履歴を削除",
      "お気に入りも含めて、検索履歴をすべて削除します。仕入れ候補は残ります。",
      "すべて削除"
    ).then(function (ok) {
      if (!ok) return;
      commit(model.clearHistory(state));
    });
  });
  document.getElementById("settings-form").addEventListener("change", saveSettings);
  document.getElementById("export-button").addEventListener("click", exportJson);
  document.getElementById("import-file").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (file) importJson(file);
  });

  document.getElementById("tab-search").addEventListener("click", function () { showView("search"); });
  document.getElementById("tab-history").addEventListener("click", function () { showView("history"); });
    document.getElementById("tab-candidates").addEventListener("click", showCandidateList);
  document.getElementById("tab-settings").addEventListener("click", function () { showView("settings"); });

  if (!loaded.ok) showSaveAlert(loaded.message);
  fillSettingsForm();
  if (!input.value && state.history[0]) input.value = state.history[0].keyword;
  sync();
})();
