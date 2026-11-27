/*! RecoverInChina sanctions & export-control name screening widget v1
 * Client-side only. Loads a daily data file and matches names in the browser.
 * Matching mirrors list_sync.py: normalized names, max(ratio, token_sort_ratio) >= 85,
 * names shorter than 4 characters must match exactly.
 * Embed:
 *   <div id="rc-screen" data-src="https://YOUR-DATA-HOST/screening-data.json.gz"></div>
 *   <script src="https://YOUR-DATA-HOST/rc-screen.js" defer></script>
 */
(function () {
  "use strict";
  var THRESHOLD = 85, LIMIT = 20;
  var DEFAULT_LINKS = {
    review09B: "/services/regulatory-defense/",
    supplier01: "/services/supplier-default/",
    retainer09D: "/services/regulatory-defense/",
    registry: "/intake/",
    intake: "/intake/"
  };

  // ---------- normalization (same as list_sync.norm) ----------
  var SUFFIX = /\b(PUBLIC JOINT STOCK|CLOSED JOINT STOCK|OPEN JOINT STOCK|JOINT STOCK|LIMITED LIABILITY|PAO|OAO|AO|TOO|CO|COMPANY|CORP|CORPORATION|INC|INCORPORATED|LTD|LIMITED|LLC|L L C|PLC|GMBH|AG|SA|S A|SAS|SRL|S R L|SPA|S P A|BV|B V|NV|AB|UAB|KK|JSC|OJSC|PJSC|CJSC|OOO|ZAO|PTE|PVT|PTY|GROUP|HOLDINGS?|INTERNATIONAL|INTL|THE)\b/g;
  var ZH_SUFFIX = /(股份有限公司|有限责任公司|有限公司|集团公司|集团|株式会社|公司)$/;
  function norm(s) {
    if (!s) return "";
    s = s.normalize("NFKC").toUpperCase();
    s = s.replace(ZH_SUFFIX, "");
    s = s.replace(/[^\p{L}\p{N}_\u4e00-\u9fff]+/gu, " ");
    // pad so \b works next to non-ASCII letters the same way as Python's Unicode \b in most cases
    s = s.replace(SUFFIX, " ");
    return s.replace(/\s+/g, " ").trim();
  }
  function tsort(s) { return s.split(" ").sort().join(" "); }

  // ---------- scoring (rapidfuzz ratio = 2*LCS/(la+lb)*100) ----------
  var prev = new Int32Array(256), cur = new Int32Array(256);
  function lcs(a, b) {
    var la = a.length, lb = b.length, i, j;
    if (lb + 1 > prev.length) { prev = new Int32Array(lb + 1); cur = new Int32Array(lb + 1); }
    for (j = 0; j <= lb; j++) prev[j] = 0;
    for (i = 1; i <= la; i++) {
      cur[0] = 0;
      var ca = a.charCodeAt(i - 1);
      for (j = 1; j <= lb; j++) {
        if (ca === b.charCodeAt(j - 1)) cur[j] = prev[j - 1] + 1;
        else cur[j] = prev[j] > cur[j - 1] ? prev[j] : cur[j - 1];
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }
  function ratio(a, b) { var t = a.length + b.length; return t ? 200 * lcs(a, b) / t : 100; }

  // ---------- data ----------
  var DATA = null, IDX = null;
  function loadData(url) {
    function asJson(resp) { if (!resp.ok) throw new Error("HTTP " + resp.status); return resp; }
    var gz = /\.gz(\?|$)/.test(url);
    if (gz && typeof DecompressionStream !== "undefined") {
      return fetch(url, { cache: "no-cache" }).then(asJson).then(function (r) {
        return new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json();
      }).catch(function () { return fetch(url.replace(/\.gz(\?|$)/, "$1"), { cache: "no-cache" }).then(asJson).then(function (r) { return r.json(); }); });
    }
    return fetch(gz ? url.replace(/\.gz(\?|$)/, "$1") : url, { cache: "no-cache" }).then(asJson).then(function (r) { return r.json(); });
  }
  function buildIndex(d) {
    var n = [], t = [], row = [], raw = [];
    d.rows.forEach(function (r, i) {
      [r[2]].concat(r[3]).forEach(function (nm) {
        var x = norm(nm);
        if (x) { n.push(x); t.push(tsort(x)); row.push(i); raw.push(nm); }
      });
    });
    return { n: n, t: t, row: row, raw: raw };
  }
  // Place and industry words alone do not identify a company; a containment match needs one distinctive word.
  var GENERIC = {"CHINA":1,"CHINESE":1,"HONG":1,"KONG":1,"HK":1,"BEIJING":1,"SHANGHAI":1,"SHENZHEN":1,"GUANGZHOU":1,"TIANJIN":1,"CHONGQING":1,"HANGZHOU":1,"NANJING":1,"WUHAN":1,"CHENGDU":1,"XIAN":1,"SUZHOU":1,"NINGBO":1,"XIAMEN":1,"QINGDAO":1,"DALIAN":1,"SHENYANG":1,"HARBIN":1,"CHANGSHA":1,"ZHENGZHOU":1,"JINAN":1,"HEFEI":1,"FUZHOU":1,"KUNMING":1,"DONGGUAN":1,"FOSHAN":1,"ZHUHAI":1,"GUANGDONG":1,"ZHEJIANG":1,"JIANGSU":1,"SHANDONG":1,"SICHUAN":1,"HUBEI":1,"HUNAN":1,"HENAN":1,"HEBEI":1,"FUJIAN":1,"ANHUI":1,"JIANGXI":1,"LIAONING":1,"JILIN":1,"HEILONGJIANG":1,"SHAANXI":1,"SHANXI":1,"YUNNAN":1,"GUIZHOU":1,"GUANGXI":1,"HAINAN":1,"GANSU":1,"XINJIANG":1,"TIBET":1,"INNER":1,"MONGOLIA":1,"NINGXIA":1,"QINGHAI":1,"TECHNOLOGY":1,"TECHNOLOGIES":1,"TECH":1,"SCIENCE":1,"SCI":1,"ELECTRONIC":1,"ELECTRONICS":1,"ELECTRIC":1,"TRADING":1,"TRADE":1,"INDUSTRIAL":1,"INDUSTRY":1,"INDUSTRIES":1,"MANUFACTURING":1,"DEVELOPMENT":1,"ENTERPRISE":1,"ENTERPRISES":1,"IMPORT":1,"EXPORT":1,"LOGISTICS":1,"SHIPPING":1,"NEW":1,"ENERGY":1,"INSTITUTE":1,"UNIVERSITY":1,"RESEARCH":1,"NATIONAL":1,"STATE":1,"OF":1,"AND":1,"MACHINERY":1,"EQUIPMENT":1,"ENGINEERING":1,"MATERIALS":1,"MATERIAL":1,"INFORMATION":1,"INTELLIGENT":1,"SYSTEMS":1,"SYSTEM":1,"DIGITAL":1,"AVIATION":1,"AEROSPACE":1,"COMMUNICATION":1,"COMMUNICATIONS":1,"NETWORK":1,"SUPPLY":1,"CHAIN":1,"SERVICE":1,"SERVICES":1,"INVESTMENT":1};
  function containScore(qt, s) {
    if (!qt) return 0;
    var st = s.split(" "), set = {};
    for (var i = 0; i < st.length; i++) set[st[i]] = 1;
    for (var j = 0; j < qt.length; j++) if (!set[qt[j]]) return 0;
    var cov = qt.length / st.length;
    return cov >= 0.5 ? 80 + 20 * cov : 0;
  }
  function search(q) {
    var nq = norm(q); if (!nq) return [];
    var qw = nq.split(" "), qt = (qw.length >= 2 && nq.replace(/ /g, "").length >= 8 && qw.some(function (w) { return w.length >= 3 && !GENERIC[w]; })) ? qw : null;
    var tq = tsort(nq), lq = nq.length, best = {};
    for (var k = 0; k < IDX.n.length; k++) {
      var s = IDX.n[k], ls = s.length, sc;
      if (Math.min(lq, ls) < 4) { if (s !== nq) continue; sc = 100; }
      else {
        if (200 * Math.min(lq, ls) / (lq + ls) < THRESHOLD) sc = 0; // fuzzy ratio cannot reach threshold
        else {
          sc = ratio(nq, s);
          if (sc < 100) { var s2 = ratio(tq, IDX.t[k]); if (s2 > sc) sc = s2; }
        }
        if (sc < THRESHOLD) {
          // Token containment: every word of a multi-word query appears in the listed name
          // and covers at least half of its words (e.g. a name entered without "Manufacturing").
          var cs = containScore(qt, IDX.n[k]);
          if (cs < THRESHOLD) continue;
          sc = cs;
        }
      }
      var ri = IDX.row[k];
      if (!best[ri] || sc > best[ri].score) best[ri] = { score: sc, row: ri, matched: IDX.raw[k] };
    }
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, LIMIT);
  }

  // ---------- rendering ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function a(href, text) { return '<a class="rcs-cta" href="' + esc(href) + '">' + esc(text) + "</a>"; }
  function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (b) {
      return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    });
  }
  var CSS = ".rcs{font:inherit;color:inherit;max-width:880px}.rcs form{display:flex;gap:8px;flex-wrap:wrap}.rcs input{flex:1 1 320px;padding:12px 14px;border:1px solid #bbb;border-radius:6px;font:inherit}.rcs button{padding:12px 20px;border:0;border-radius:6px;background:#1f2a44;color:#fff;font:inherit;cursor:pointer}.rcs button[disabled]{opacity:.5}.rcs-tip,.rcs-src,.rcs-ev{font-size:.85em;opacity:.8;margin:8px 0}.rcs-card{border:1px solid #ddd;border-left:4px solid #1f2a44;border-radius:6px;padding:16px;margin:16px 0}.rcs-card.f{border-left-color:#b23a2a}.rcs-card.p{border-left-color:#b8862b}.rcs-card.n{border-left-color:#5c6b7a}.rcs-card h3{margin:0 0 8px;font-size:1.05em}.rcs table{width:100%;border-collapse:collapse;font-size:.9em;margin:8px 0}.rcs th,.rcs td{text-align:left;padding:6px;border-bottom:1px solid #eee;vertical-align:top}.rcs-cta{display:inline-block;margin:6px 12px 0 0;font-weight:600}.rcs-note{margin:8px 0}.rcs-disc{font-size:.8em;opacity:.85;margin-top:16px}.rcs-disc strong{color:#8b1a1a}.rcs-warn{font-size:.9em;color:#8b1a1a;border-left:3px solid #8b1a1a;background:#fbf3f3;padding:8px 12px;margin:10px 0}.rcs-copy{background:transparent!important;color:inherit!important;border:1px solid #bbb!important;padding:6px 12px!important;font-size:.85em}";

  function hitTable(hits, prc) {
    var h = '<div style="overflow-x:auto"><table><tr><th>Score</th><th>Matched name</th><th>Listed name</th><th>List</th>' +
      (prc ? "<th>Announcement</th><th>Status</th>" : "<th>Country</th><th>Program</th>") +
      "<th>Listing date</th><th>Official source</th></tr>";
    hits.forEach(function (x) {
      var r = DATA.rows[x.row], list = DATA.lists[r[1]].en;
      if (r[11]) list += " (also in CSL)";
      h += "<tr><td>" + Math.round(x.score) + "</td><td>" + esc(x.matched) + "</td><td>" + esc(r[2]) +
        (r[3].length ? "<br><small>" + esc(r[3].slice(0, 3).join(" · ")) + "</small>" : "") + "</td><td>" + esc(list) + "</td>" +
        (prc ? "<td>" + esc(r[6]) + "</td><td>" + esc(r[9]) + "</td>" : "<td>" + esc(r[5]) + "</td><td>" + esc(r[6]) + "</td>") +
        "<td>" + esc(r[7] || "Not published") + "</td><td>" + (r[8] ? '<a href="' + esc(r[8]) + '" target="_blank" rel="noopener">Verify</a>' : "") + "</td></tr>";
    });
    return h + "</table></div>";
  }

  function render(el, q, hits, L) {
    var mof = DATA.src.indexOf("MOFCOM");
    var prc = hits.filter(function (x) { return DATA.rows[x.row][0] === mof; });
    var frn = hits.filter(function (x) { return DATA.rows[x.row][0] !== mof; });
    var out = "";
    var cjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(q);
    if (cjk) out += '<div class="rcs-card p"><h3>Chinese name entered — search the English name too</h3>' +
      '<p class="rcs-note">A Chinese name is checked mainly against the PRC MOFCOM lists. U.S. lists (OFAC SDN, BIS Entity List and the rest of the Consolidated Screening List) record Chinese companies in English or Pinyin only, so a Chinese-name search cannot show those matches. Run the search again with the company\'s English name as it appears on the contract, invoice or website.</p></div>';
    if (frn.length) out += '<div class="rcs-card f"><h3>Possible Name Match — Foreign Restricted List. Verify on the official source.</h3>' + hitTable(frn, false) +
      '<p class="rcs-note">If the matched counterparty is a Chinese entity and you are considering suspending payment, shipment or the contract, acting solely on a foreign restrictive measure may expose you to a civil claim in China under Article 12 of the PRC Anti-Foreign Sanctions Law. Chinese courts have awarded damages on this basis ((2023) Hu 72 Min Chu No. 1936).</p>' +
      a(L.review09B, "PRC-law contract review before you send a notice →") + "</div>";
    if (prc.length) out += '<div class="rcs-card p"><h3>Possible Name Match — PRC MOFCOM List. Verify on the official source.</h3>' + hitTable(prc, true) +
      '<p class="rcs-note">Entities on MOFCOM lists are mostly foreign companies. Depending on the list and announcement, Chinese exporters may be barred from supplying them with dual-use items, and other dealings may be restricted. If you or an affiliate is the matched party, your Chinese suppliers may suspend shipments or contracts. Check the current status column: some measures are suspended or revoked.</p>' +
      a(L.supplier01, "Supplier stopped shipping or holding your deposit? →") + a(L.retainer09D, "Ongoing PRC compliance support →") + "</div>";
    if (!hits.length) out += '<div class="rcs-card n"><h3>' + (cjk ? 'No Direct Match for This Chinese Name' : 'No Direct Name Match Found in Selected Public Lists') + '</h3>' +
      '<p class="rcs-note"><strong>This is not a clearance.</strong> A name search cannot see:</p><ol>' +
      "<li><strong>Unlisted subsidiaries.</strong> The OFAC 50% Rule applies now. The BIS Affiliates Rule is suspended until January 10, 2027; unless extended again, it will extend Entity List restrictions to companies 50% or more owned by listed parties.</li>" +
      "<li><strong>Trade-name mismatches.</strong> Chinese suppliers often invoice under an English trade name that differs from their registered Chinese legal name.</li>" +
      "<li><strong>Shell and enforcement risk.</strong> Sanctions lists say nothing about whether a Chinese company has assets or is subject to court enforcement.</li></ol>" +
      a(L.registry, "PRC registry & shareholding report for your counsel's 50% review →") + a(L.supplier01, "Vet a Chinese supplier before paying a deposit →") + "</div>";
    var now = new Date(), m = DATA.meta;
    var summary = { query: q, queried_at_utc: now.toISOString(), threshold: THRESHOLD, data_generated_at: m.generated_at, data_sha256: m.data_sha256,
      hits: hits.map(function (x) { var r = DATA.rows[x.row]; return [Math.round(x.score), r[2], DATA.lists[r[1]].en, r[8]]; }) };
    var text = JSON.stringify(summary);
    out += '<p class="rcs-ev" data-ev>Searched “' + esc(q) + "” at " + esc(now.toISOString()) + " · data built " + esc(m.generated_at) + " · data SHA-256 " + esc((m.data_sha256 || "").slice(0, 16)) + "… · threshold " + THRESHOLD +
      ' <button type="button" class="rcs-copy">Copy record</button></p>';
    el.innerHTML = out;
    sha256(text).then(function (h) {
      var b = el.querySelector(".rcs-copy");
      b.onclick = function () {
        var rec = text + "\nresult_sha256=" + h;
        (navigator.clipboard ? navigator.clipboard.writeText(rec) : Promise.reject()).then(function () { b.textContent = "Copied"; }, function () { window.prompt("Copy this record:", rec); });
      };
    });
  }

  function mount(root) {
    var L = {}; Object.keys(DEFAULT_LINKS).forEach(function (k) { L[k] = root.getAttribute("data-link-" + k) || DEFAULT_LINKS[k]; });
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    root.classList.add("rcs");
    root.innerHTML = '<form><input type="search" placeholder="Company or person name in English (as on the contract, invoice or website)" aria-label="Name to screen" maxlength="200" required><button type="submit" disabled>Loading lists…</button></form>' +
      '<p class="rcs-warn" role="note"><strong>Free tool: name matches only.</strong> A “no match” is not a clearance. Lists may be incomplete or out of date, and results are provided “as is”. See the full terms at the bottom of this page.</p>' +
      '<p class="rcs-tip">Search the English name first. U.S. lists (OFAC, BIS) record Chinese entities in English or Pinyin only, and a Chinese name will not find them. Only the MOFCOM lists, and a few EU and UN entries, carry Chinese names. Also try known trade names and former names. Uniform Social Credit Codes are not in these lists.</p>' +
      '<p class="rcs-src" data-src-line></p><div data-results aria-live="polite"></div>' +
      '<p class="rcs-disc">Name matches against selected public lists only, for preliminary reference; not legal advice. Your search text is processed in your browser and is not sent to us. Full terms are at the bottom of this page.</p>';
    var form = root.querySelector("form"), input = root.querySelector("input"), btn = root.querySelector("button"),
      res = root.querySelector("[data-results]"), srcLine = root.querySelector("[data-src-line]");
    loadData(root.getAttribute("data-src") || "screening-data.json.gz").then(function (d) {
      DATA = d; IDX = buildIndex(d);
      btn.disabled = false; btn.textContent = "Screen";
      srcLine.textContent = "Official sources: U.S. Consolidated Screening List (ITA) & OFAC SDN · EU Financial Sanctions Files · UN Security Council Consolidated List · PRC MOFCOM (Unreliable Entity List, Export Control List, Watch List, Anti-Foreign Sanctions Law countermeasures). " +
        DATA.meta.count.toLocaleString() + " entries. Last synchronized " + DATA.meta.generated_at + ".";
    }).catch(function (e) { btn.textContent = "Unavailable"; res.textContent = "The lists could not be loaded. Please try again later."; if (window.console) console.error(e); });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault(); if (!DATA) return;
      var q = input.value.trim(); if (!q) return;
      btn.disabled = true; btn.textContent = "Screening…";
      setTimeout(function () {
        render(res, q, search(q), L);
        btn.disabled = false; btn.textContent = "Screen";
        if (window.gtag) window.gtag("event", "sanctions_screen", { hits: res.querySelectorAll("tr").length });
      }, 10);
    });
  }

  window.RCScreen = { norm: norm, ratio: ratio, search: function (q) { return search(q); }, _load: function (d) { DATA = d; IDX = buildIndex(d); } };
  function init() { var el = document.getElementById("rc-screen"); if (el) mount(el); }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  }
})();
