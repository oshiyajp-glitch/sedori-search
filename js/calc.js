(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : window;

  function roundJpy(value) {
    return Math.round(value);
  }

  function parseAmount(value) {
    if (value == null || value === "") return { state: "empty", value: null };
    var text = String(value).normalize("NFKC").trim().replace(/,/g, "");
    if (!text) return { state: "empty", value: null };
    if (!/^\d+(\.\d+)?$/.test(text)) return { state: "invalid", value: null };
    var number = Number(text);
    if (!Number.isFinite(number) || number < 0) return { state: "invalid", value: null };
    return { state: "ok", value: number };
  }

  function optionalCost(value) {
    var parsed = parseAmount(value);
    if (parsed.state === "empty") return { state: "ok", value: 0 };
    return parsed;
  }

  function channel(id, label) {
    return {
      id: id,
      label: label,
      status: "incomplete",
      message: "",
      revenueJpy: null,
      feeJpy: null,
      fixedFeeJpy: null,
      shippingJpy: null,
      dutyJpy: null,
      otherJpy: null,
      profitJpy: null,
      salesMargin: null,
      costMargin: null,
      maxBuyJpy: null
    };
  }

  function invalidChannel(id, label, message) {
    var result = channel(id, label);
    result.status = "invalid";
    result.message = message;
    return result;
  }

  function margins(profit, revenue, cost) {
    return {
      salesMargin: revenue === 0 ? null : profit / revenue,
      costMargin: cost === 0 ? null : profit / cost
    };
  }

  function domesticChannel(id, label, cost, price, feeRate, shipping, other, target) {
    if (price.state === "invalid" || feeRate.state === "invalid" || shipping.state === "invalid" || other.state === "invalid" || target.state === "invalid" || cost.state === "invalid") {
      return invalidChannel(id, label, "数値を確認してください。マイナスは使えません。");
    }
    if (price.state === "empty") {
      var missingPrice = channel(id, label);
      missingPrice.message = "国内の想定販売価格を入力してください。";
      return missingPrice;
    }
    if (feeRate.state === "empty") {
      var missingFee = channel(id, label);
      missingFee.message = label + "の販売手数料率が未設定です。";
      return missingFee;
    }
    if (feeRate.value > 100) {
      return invalidChannel(id, label, label + "の販売手数料率は100以下にしてください。");
    }
    var revenue = roundJpy(price.value);
    var fee = roundJpy(revenue * feeRate.value / 100);
    var ship = roundJpy(shipping.value);
    var extra = roundJpy(other.value);
    var targetJpy = roundJpy(target.value);
    var result = channel(id, label);
    result.revenueJpy = revenue;
    result.feeJpy = fee;
    result.shippingJpy = ship;
    result.otherJpy = extra;
    result.maxBuyJpy = revenue - fee - ship - extra - targetJpy;
    if (cost.state === "empty") {
      result.message = "仕入価格を入力すると利益が出ます。";
      return result;
    }
    var profit = revenue - roundJpy(cost.value) - fee - ship - extra;
    var ratio = margins(profit, revenue, cost.value);
    result.status = "ok";
    result.profitJpy = profit;
    result.salesMargin = ratio.salesMargin;
    result.costMargin = ratio.costMargin;
    if (cost.value === 0) result.message = "仕入価格が0円のため、仕入原価利益率は出せません。";
    return result;
  }

  function ebayChannel(cost, item, buyerShipping, rate, feeRate, feeBase, fixed, shipping, duty, other, target) {
    var label = "eBay";
    var fields = [item, buyerShipping, rate, feeRate, fixed, shipping, duty, other, target, cost];
    for (var i = 0; i < fields.length; i += 1) {
      if (fields[i].state === "invalid") return invalidChannel("ebay", label, "数値を確認してください。マイナスは使えません。");
    }
    if (item.state === "empty") {
      var missingItem = channel("ebay", label);
      missingItem.message = "eBayの商品価格を入力してください。";
      return missingItem;
    }
    if (rate.state === "empty") {
      var missingRate = channel("ebay", label);
      missingRate.message = "為替レートを入力してください。";
      return missingRate;
    }
    if (rate.value === 0) return invalidChannel("ebay", label, "為替レートが0のため計算できません。");
    if (feeRate.state === "empty") {
      var missingFee = channel("ebay", label);
      missingFee.message = "eBayの販売手数料率が未設定です。";
      return missingFee;
    }
    if (feeRate.value > 100) return invalidChannel("ebay", label, "eBayの販売手数料率は100以下にしてください。");
    if (feeBase !== "item_only" && feeBase !== "item_plus_shipping") {
      var missingBase = channel("ebay", label);
      missingBase.message = "eBayの手数料の対象が未設定です。";
      return missingBase;
    }
    var itemUsd = item.value;
    var shippingUsd = buyerShipping.state === "empty" ? 0 : buyerShipping.value;
    var revenueUsd = itemUsd + shippingUsd;
    var feeBaseUsd = feeBase === "item_only" ? itemUsd : revenueUsd;
    var revenue = roundJpy(revenueUsd * rate.value);
    var fee = roundJpy(feeBaseUsd * feeRate.value / 100 * rate.value);
    var fixedJpy = roundJpy(fixed.value);
    var ship = roundJpy(shipping.value);
    var dutyJpy = roundJpy(duty.value);
    var extra = roundJpy(other.value);
    var targetJpy = roundJpy(target.value);
    var result = channel("ebay", label);
    result.revenueJpy = revenue;
    result.feeJpy = fee;
    result.fixedFeeJpy = fixedJpy;
    result.shippingJpy = ship;
    result.dutyJpy = dutyJpy;
    result.otherJpy = extra;
    result.maxBuyJpy = revenue - fee - fixedJpy - ship - dutyJpy - extra - targetJpy;
    if (cost.state === "empty") {
      result.message = "仕入価格を入力すると利益が出ます。";
      return result;
    }
    var profit = revenue - roundJpy(cost.value) - fee - fixedJpy - ship - dutyJpy - extra;
    var ratio = margins(profit, revenue, cost.value);
    result.status = "ok";
    result.profitJpy = profit;
    result.salesMargin = ratio.salesMargin;
    result.costMargin = ratio.costMargin;
    if (cost.value === 0) result.message = "仕入価格が0円のため、仕入原価利益率は出せません。";
    return result;
  }

  function chooseBest(channels) {
    var ready = channels.filter(function (item) {
      return item.status === "ok" && item.profitJpy != null;
    });
    if (!ready.length) return { ids: [], labels: [], profitJpy: null };
    var maxProfit = ready[0].profitJpy;
    ready.forEach(function (item) {
      if (item.profitJpy > maxProfit) maxProfit = item.profitJpy;
    });
    var winners = ready.filter(function (item) { return item.profitJpy === maxProfit; });
    return {
      ids: winners.map(function (item) { return item.id; }),
      labels: winners.map(function (item) { return item.label; }),
      profitJpy: maxProfit
    };
  }

  function calculate(input) {
    var source = input || {};
    var cost = parseAmount(source.costJpy);
    var price = parseAmount(source.domesticPriceJpy);
    var target = parseAmount(source.targetProfitJpy);
    if (target.state === "empty") target = { state: "ok", value: 0 };
    var yahooSettings = source.yahoo || {};
    var mercariSettings = source.mercari || {};
    var ebaySettings = source.ebay || {};
    var yahoo = domesticChannel(
      "yahoo",
      "ヤフオク",
      cost,
      price,
      parseAmount(yahooSettings.feeRatePercent),
      optionalCost(yahooSettings.shippingJpy),
      optionalCost(yahooSettings.otherJpy),
      target
    );
    var mercari = domesticChannel(
      "mercari",
      "メルカリ",
      cost,
      price,
      parseAmount(mercariSettings.feeRatePercent),
      optionalCost(mercariSettings.shippingJpy),
      optionalCost(mercariSettings.otherJpy),
      target
    );
    var ebay = ebayChannel(
      cost,
      parseAmount(source.itemUsd),
      parseAmount(source.buyerShippingUsd),
      parseAmount(source.exchangeRate),
      parseAmount(ebaySettings.feeRatePercent),
      ebaySettings.feeBase || "",
      optionalCost(ebaySettings.fixedFeeJpy),
      optionalCost(ebaySettings.shippingJpy),
      optionalCost(ebaySettings.dutyJpy),
      optionalCost(ebaySettings.otherJpy),
      target
    );
    return {
      cost: cost,
      targetAssumedZero: parseAmount(source.targetProfitJpy).state === "empty",
      yahoo: yahoo,
      mercari: mercari,
      ebay: ebay,
      best: chooseBest([yahoo, mercari, ebay])
    };
  }

  root.SedoriCalc = {
    calculate: calculate,
    parseAmount: parseAmount,
    roundJpy: roundJpy
  };
})();
