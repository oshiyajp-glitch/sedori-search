(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var dashes = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g;

  function normalizeQuery(value) {
    return String(value || "").normalize("NFKC").replace(dashes, "-").trim().replace(/\s+/g, " ");
  }

  function buildUrls(query) {
    var q = encodeURIComponent(query);
    return {
      ebay: "https://www.ebay.com/sch/i.html?_nkw=" + q + "&_sacat=0&LH_Sold=1&LH_Complete=1&rt=nc&_sop=13",
      yahoo: "https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=" + q,
      mercari: "https://jp.mercari.com/search?keyword=" + q + "&status=" + encodeURIComponent("sold_out|trading")
    };
  }

  root.SedoriUrls = {
    normalizeQuery: normalizeQuery,
    buildUrls: buildUrls
  };
})();
