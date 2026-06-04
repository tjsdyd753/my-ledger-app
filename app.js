/* ============================================
   한손 · app.js  (순수 JavaScript, 빌드 불필요)
   데이터는 브라우저 localStorage에 저장됩니다.
   ============================================ */
(function () {
  "use strict";

  /* ---------- 저장 키 ---------- */
  var TX_KEY  = "kyul.transactions.v1";
  var CAT_KEY = "kyul.categories.v1";
  var REC_KEY = "kyul.recurring.v1";
  var AST_KEY = "kyul.assets.v1";
  var ACAT_KEY = "kyul.assetCategories.v1";

  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  /* ---------- 기본 카테고리 ---------- */
  var DEFAULT_CATEGORIES = {
    business: {
      income:  ["매출(상품/판매)", "용역/수수료 수입", "기타 사업수입"],
      expense: ["임차료", "인건비", "재료비/매입", "광고·마케팅", "통신·공과금",
                "소프트웨어·구독", "여비·교통", "접대비", "지급수수료", "기타 경비"]
    },
    personal: {
      income:  ["급여", "이자·배당", "용돈·기타수입"],
      expense: ["식비", "주거·관리비", "교통", "통신", "쇼핑", "의료·건강",
                "문화·여가", "교육", "기타 지출"]
    }
  };
  var DEFAULT_ASSET_CATS = { asset: ["현금", "예·적금", "투자", "부동산", "기타 자산"],
                     liability: ["카드 대금", "대출", "기타 부채"] };

  /* ---------- 상태 ---------- */
  var state = {
    transactions: load(TX_KEY, []),
    categories:   load(CAT_KEY, JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))),
    recurring:    load(REC_KEY, []),
    assets:       load(AST_KEY, []),
    assetCategories: load(ACAT_KEY, JSON.parse(JSON.stringify(DEFAULT_ASSET_CATS))),
    month: new Date(),
    form: { scope: "business", type: "expense", repeat: "once" },
    listFilter: "all",
    dashScope: "business",
    selectedDay: null,
    pickerYear: null,
    assetKind: "asset",
    currentView: "dashboard",
    menuOpen: false
  };

  /* ---------- 유틸 ---------- */
  function won(n) { var s = n < 0 ? "-" : ""; return s + "₩" + Math.abs(Math.round(n)).toLocaleString("ko-KR"); }
  function pct(n) { return (Math.round(n * 10) / 10) + "%"; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function dKey(y, m, day) { return y + "-" + pad(m + 1) + "-" + pad(day); }
  function inMonth(tx, d) { return tx.date.slice(0, 7) === ymKey(d); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function uid() { return Date.now() + "-" + Math.random().toString(36).slice(2, 7); }
  function onlyNum(s) { return Number(String(s).replace(/[^0-9]/g, "")); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  /* ================= 화면 전환 ================= */
  function switchView(name) {
    state.currentView = name;
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.view === name); });
    if (name === "assets") renderAssets();
    if (name === "recurring") renderRecurring();
    updateFab();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  // 입력 화면이거나 메뉴가 열려 있으면 입력 버튼을 숨깁니다
  function updateFab() {
    $("fab").hidden = state.menuOpen || state.currentView === "add";
  }

  /* ================= 월 이동 ================= */
  function changeMonth(delta) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
    state.selectedDay = null;
    renderAll();
  }
  function renderMonthLabel() {
    var d = state.month;
    $("currentMonth").textContent = d.getFullYear() + "." + pad(d.getMonth() + 1);
    $("dashMonthLabel").textContent = (d.getMonth() + 1) + "월";
  }

  /* ================= 정기 거래 생성 ================= */
  function advance(dateStr, interval) {
    var p = dateStr.split("-"), y = +p[0], m = +p[1] - 1, d = +p[2];
    if (interval === "yearly") y += 1; else m += 1;
    if (m > 11) { y += 1; m -= 12; }
    var last = new Date(y, m + 1, 0).getDate();
    if (d > last) d = last;
    return dKey(y, m, d);
  }
  function generateRecurring() {
    var today = todayStr(), touched = false;
    state.recurring.forEach(function (r) {
      var guard = 0;
      while (r.nextDate <= today && guard < 600) {
        // 같은 정기거래의 같은 날짜 거래가 이미 있으면 건너뜀 (중복 방지)
        var exists = state.transactions.some(function (t) { return t.recurringId === r.id && t.date === r.nextDate; });
        if (!exists) {
          state.transactions.push({
            id: uid(), date: r.nextDate, scope: r.scope, type: r.type,
            category: r.category, amount: r.amount, memo: r.memo, recurringId: r.id
          });
        }
        r.nextDate = advance(r.nextDate, r.interval);
        touched = true; guard++;
      }
    });
    if (touched) { save(TX_KEY, state.transactions); save(REC_KEY, state.recurring); }
  }

  /* ================= 대시보드 ================= */
  function scopeTotals(scope) {
    var inc = 0, exp = 0;
    state.transactions.forEach(function (t) {
      if (t.scope === scope && inMonth(t, state.month)) { if (t.type === "income") inc += t.amount; else exp += t.amount; }
    });
    return { inc: inc, exp: exp, net: inc - exp };
  }
  function renderDashboard() {
    var scope = state.dashScope, isBiz = scope === "business";
    document.querySelectorAll("#dashToggle .seg-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.dscope === scope); });
    $("dashTitle").textContent = isBiz ? "사업 대시보드" : "개인 가계부";
    $("trendTitle").textContent = isBiz ? "최근 6개월 매출·비용" : "최근 6개월 수입·지출";
    $("legendIncome").textContent = isBiz ? "매출" : "수입";
    $("legendExpense").textContent = isBiz ? "비용" : "지출";
    $("catTitle").innerHTML = (isBiz ? "비용 카테고리" : "지출 카테고리") + ' <small class="muted">(많이 쓴 순)</small>';
    var t = scopeTotals(scope);
    renderKPI(scope, t); renderTrend(scope); renderCategory(scope); renderCalendar(scope); renderDayDetail(scope);
  }
  function renderKPI(scope, t) {
    var isBiz = scope === "business";
    var rate = t.inc > 0 ? (t.net / t.inc * 100) : 0;
    var cards = isBiz
      ? [{ label: "매출", value: won(t.inc), tone: "income" }, { label: "비용", value: won(t.exp), tone: "expense" },
         { label: "순이익", value: won(t.net), tone: "highlight" }, { label: "이익률", value: t.inc > 0 ? pct(rate) : "—", tone: "plain", sub: "순이익 ÷ 매출" }]
      : [{ label: "수입", value: won(t.inc), tone: "income" }, { label: "지출", value: won(t.exp), tone: "expense" },
         { label: "이번 달 수지", value: won(t.net), tone: "highlight" }, { label: "저축률", value: t.inc > 0 ? pct(rate) : "—", tone: "plain", sub: "남은 돈 ÷ 수입" }];
    $("kpiGrid").innerHTML = cards.map(function (c) {
      return '<div class="kpi-card ' + c.tone + '"><span class="kpi-label">' + c.label + '</span><strong class="kpi-value">' + c.value + '</strong>' + (c.sub ? '<span class="kpi-sub">' + c.sub + '</span>' : '') + '</div>';
    }).join("");
  }
  function renderTrend(scope) {
    var chart = $("trendChart"); chart.innerHTML = "";
    var months = [];
    for (var i = 5; i >= 0; i--) months.push(new Date(state.month.getFullYear(), state.month.getMonth() - i, 1));
    var data = months.map(function (m) {
      var inc = 0, exp = 0;
      state.transactions.forEach(function (tx) { if (tx.scope === scope && inMonth(tx, m)) { if (tx.type === "income") inc += tx.amount; else exp += tx.amount; } });
      return { m: m, inc: inc, exp: exp };
    });
    var max = Math.max(1, Math.max.apply(null, data.map(function (d) { return Math.max(d.inc, d.exp); })));
    data.forEach(function (d) {
      var col = document.createElement("div"); col.className = "trend-col";
      col.innerHTML = '<div class="trend-bars"><i class="income" style="height:' + (d.inc / max * 100) + '%"></i><i class="expense" style="height:' + (d.exp / max * 100) + '%"></i></div><span class="trend-label">' + (d.m.getMonth() + 1) + '월</span>';
      chart.appendChild(col);
    });
  }
  function renderCategory(scope) {
    var box = $("categoryBreakdown"), sums = {};
    state.transactions.forEach(function (t) { if (t.scope === scope && t.type === "expense" && inMonth(t, state.month)) sums[t.category] = (sums[t.category] || 0) + t.amount; });
    var rows = Object.keys(sums).map(function (k) { return { name: k, amt: sums[k] }; }).sort(function (a, b) { return b.amt - a.amt; });
    if (!rows.length) { box.innerHTML = '<p class="empty">이번 달 기록된 ' + (scope === "business" ? "비용" : "지출") + '이 없습니다.</p>'; return; }
    var max = rows[0].amt;
    box.innerHTML = rows.map(function (r) {
      return '<div class="cat-row"><span class="cat-name">' + esc(r.name) + '</span><span class="cat-bar"><span style="width:' + (r.amt / max * 100) + '%"></span></span><span class="cat-amt">' + won(r.amt) + '</span></div>';
    }).join("");
  }
  function renderCalendar(scope) {
    var grid = $("calendarGrid"), y = state.month.getFullYear(), m = state.month.getMonth();
    var firstWeekday = new Date(y, m, 1).getDay(), daysInMonth = new Date(y, m + 1, 0).getDate();
    var byDay = {};
    state.transactions.forEach(function (t) {
      if (t.scope === scope && inMonth(t, state.month)) {
        var day = +t.date.slice(8, 10); if (!byDay[day]) byDay[day] = { inc: 0, exp: 0 };
        if (t.type === "income") byDay[day].inc += t.amount; else byDay[day].exp += t.amount;
      }
    });
    var today = new Date(), isThisMonth = today.getFullYear() === y && today.getMonth() === m, html = "";
    for (var b = 0; b < firstWeekday; b++) html += '<span class="cal-cell empty-cell"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = dKey(y, m, day), info = byDay[day], wd = new Date(y, m, day).getDay(), cls = "cal-cell";
      if (wd === 0) cls += " sun"; if (wd === 6) cls += " sat";
      if (isThisMonth && today.getDate() === day) cls += " today";
      if (state.selectedDay === key) cls += " selected";
      var dots = ""; if (info) { if (info.inc > 0) dots += '<i class="cd income"></i>'; if (info.exp > 0) dots += '<i class="cd expense"></i>'; }
      html += '<button class="' + cls + '" data-date="' + key + '"><span class="cal-day">' + day + '</span><span class="cal-dots">' + dots + '</span></button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".cal-cell[data-date]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        state.selectedDay = (state.selectedDay === cell.dataset.date) ? null : cell.dataset.date;
        renderCalendar(state.dashScope); renderDayDetail(state.dashScope);
      });
    });
  }
  function renderDayDetail(scope) {
    var box = $("dayDetail");
    if (!state.selectedDay) { box.innerHTML = '<p class="day-hint">날짜를 누르면 그 날의 거래를 볼 수 있어요.</p>'; return; }
    var list = state.transactions.filter(function (t) { return t.scope === scope && t.date === state.selectedDay; }).sort(function (a, b) { return b.id.localeCompare(a.id); });
    var head = '<div class="day-detail-head">' + state.selectedDay.slice(5).replace("-", "월 ") + "일</div>";
    if (!list.length) { box.innerHTML = head + '<p class="day-hint">이 날은 기록된 거래가 없어요.</p>'; return; }
    box.innerHTML = head + list.map(function (t) {
      var sign = t.type === "income" ? "+" : "-";
      return '<div class="day-row"><span class="day-cat">' + esc(t.category) + (t.memo ? ' · ' + esc(t.memo) : '') + '</span><span class="tx-amt ' + t.type + '">' + sign + won(t.amount) + '</span><button class="tx-del" data-id="' + t.id + '" aria-label="삭제">×</button></div>';
    }).join("");
    box.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 거래를 삭제할까요?")) return;
        state.transactions = state.transactions.filter(function (t) { return t.id !== btn.dataset.id; });
        save(TX_KEY, state.transactions); renderAll();
      });
    });
  }

  /* ================= 입력 폼 + 카테고리 편집 ================= */
  function refreshCategoryOptions() {
    var opts = state.categories[state.form.scope][state.form.type] || [];
    $("txCategory").innerHTML = opts.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join("");
    renderCatPills();
  }
  function renderCatPills() {
    var opts = state.categories[state.form.scope][state.form.type] || [];
    $("catPills").innerHTML = opts.length
      ? opts.map(function (o) { return '<span class="cat-pill">' + esc(o) + '<button type="button" class="cat-del" data-cat="' + esc(o) + '" aria-label="삭제">−</button></span>'; }).join("")
      : '<span class="day-hint">카테고리가 없습니다. 아래에서 추가하세요.</span>';
    $("catPills").querySelectorAll(".cat-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.dataset.cat;
        state.categories[state.form.scope][state.form.type] = opts.filter(function (o) { return o !== name; });
        save(CAT_KEY, state.categories); refreshCategoryOptions();
      });
    });
  }
  function setupForm() {
    document.querySelectorAll(".seg-btn[data-scope]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".seg-btn[data-scope]").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active"); state.form.scope = btn.dataset.scope; refreshCategoryOptions();
      });
    });
    document.querySelectorAll(".type-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".type-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active"); state.form.type = btn.dataset.type; refreshCategoryOptions();
      });
    });
    document.querySelectorAll(".rep-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".rep-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active"); state.form.repeat = btn.dataset.repeat;
      });
    });
    $("catEditToggle").addEventListener("click", function () {
      var ed = $("catEditor"); ed.hidden = !ed.hidden;
      $("catEditToggle").textContent = ed.hidden ? "＋ 카테고리 추가·삭제" : "▾ 카테고리 편집 닫기";
    });
    $("catAddBtn").addEventListener("click", function () {
      var name = $("catAddInput").value.trim(); if (!name) return;
      var arr = state.categories[state.form.scope][state.form.type];
      if (arr.indexOf(name) === -1) { arr.push(name); save(CAT_KEY, state.categories); refreshCategoryOptions(); }
      $("catAddInput").value = "";
    });
    $("txAmount").addEventListener("input", function (e) {
      var raw = onlyNum(e.target.value); e.target.value = raw ? raw.toLocaleString("ko-KR") : "";
    });
    $("txDate").value = todayStr();

    $("txForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var amount = onlyNum($("txAmount").value), msg = $("formMsg");
      if (!amount || amount <= 0) { msg.textContent = "금액을 올바르게 입력해 주세요."; msg.className = "form-msg err"; return; }
      var date = $("txDate").value || todayStr();
      var base = { scope: state.form.scope, type: state.form.type, category: $("txCategory").value, amount: amount, memo: $("txMemo").value.trim() };

      if (state.form.repeat === "once") {
        state.transactions.push(Object.assign({ id: uid(), date: date }, base));
        save(TX_KEY, state.transactions);
        msg.textContent = "✓ 저장되었습니다.";
      } else {
        // 이중 클릭 등으로 동일한 정기거래가 두 번 등록되는 것을 방지
        var dup = state.recurring.some(function (x) {
          return x.scope === base.scope && x.type === base.type && x.category === base.category &&
                 x.amount === base.amount && x.memo === base.memo &&
                 x.interval === state.form.repeat && x.startDate === date;
        });
        if (!dup) {
          var rule = Object.assign({ id: uid(), interval: state.form.repeat, startDate: date, nextDate: date }, base);
          state.recurring.push(rule); save(REC_KEY, state.recurring);
        }
        generateRecurring();
        msg.textContent = "✓ 정기 거래로 등록했습니다 (" + (state.form.repeat === "monthly" ? "매월" : "매년") + ").";
      }
      msg.className = "form-msg ok";
      $("txAmount").value = ""; $("txMemo").value = "";
      renderAll();
      setTimeout(function () { msg.textContent = ""; }, 2500);
    });
    refreshCategoryOptions();
  }

  /* ================= 내역 ================= */
  function renderList() {
    var box = $("txList");
    var list = state.transactions.filter(function (t) { return inMonth(t, state.month); })
      .filter(function (t) { return state.listFilter === "all" || t.scope === state.listFilter; })
      .sort(function (a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });
    if (!list.length) { box.innerHTML = '<p class="empty">표시할 거래가 없습니다. 입력 탭에서 기록을 추가해 보세요.</p>'; return; }
    box.innerHTML = list.map(function (t) {
      var icon = t.scope === "business" ? "💼" : "🏠", scopeKo = t.scope === "business" ? "사업" : "개인", sign = t.type === "income" ? "+" : "-";
      var rec = t.recurringId ? ' <span class="rec-tag">🔁</span>' : '';
      return '<div class="tx-item ' + t.scope + '"><div class="tx-badge">' + icon + '</div><div class="tx-main"><div class="tx-cat">' + esc(t.category) + (t.memo ? ' · ' + esc(t.memo) : '') + rec + '</div><div class="tx-meta"><span class="scope-tag">' + scopeKo + '</span> · ' + t.date + '</div></div><div class="tx-amt ' + t.type + '">' + sign + won(t.amount) + '</div><button class="tx-del" data-id="' + t.id + '" aria-label="삭제">×</button></div>';
    }).join("");
    box.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 거래를 삭제할까요?")) return;
        state.transactions = state.transactions.filter(function (t) { return t.id !== btn.dataset.id; });
        save(TX_KEY, state.transactions); renderAll();
      });
    });
  }
  function setupListControls() {
    document.querySelectorAll(".chip[data-filter]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".chip[data-filter]").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active"); state.listFilter = chip.dataset.filter; renderList();
      });
    });
    $("exportBtn").addEventListener("click", exportCSV);
  }
  function exportCSV() {
    var list = state.transactions.filter(function (t) { return inMonth(t, state.month); });
    if (!list.length) { alert("이번 달 내보낼 거래가 없습니다."); return; }
    var header = ["날짜", "구분", "유형", "카테고리", "금액", "메모"];
    var rows = list.map(function (t) { return [t.date, t.scope === "business" ? "사업" : "개인", t.type === "income" ? "수입" : "지출", t.category, t.amount, '"' + (t.memo || "").replace(/"/g, '""') + '"'].join(","); });
    var csv = "\uFEFF" + header.join(",") + "\n" + rows.join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "한손_" + ymKey(state.month) + ".csv"; a.click(); URL.revokeObjectURL(url);
  }

  /* ================= 자산 관리 ================= */
  function refreshAssetCategoryOptions() {
    var opts = state.assetCategories[state.assetKind] || [];
    $("assetCategory").innerHTML = opts.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join("");
    renderAssetCatPills();
  }
  function renderAssetCatPills() {
    var opts = state.assetCategories[state.assetKind] || [];
    $("assetCatPills").innerHTML = opts.length
      ? opts.map(function (o) { return '<span class="cat-pill">' + esc(o) + '<button type="button" class="cat-del" data-cat="' + esc(o) + '" aria-label="삭제">−</button></span>'; }).join("")
      : '<span class="day-hint">카테고리가 없습니다. 아래에서 추가하세요.</span>';
    $("assetCatPills").querySelectorAll(".cat-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.dataset.cat;
        state.assetCategories[state.assetKind] = opts.filter(function (o) { return o !== name; });
        save(ACAT_KEY, state.assetCategories); refreshAssetCategoryOptions();
      });
    });
  }
  function renderAssets() {
    var totalA = 0, totalL = 0;
    state.assets.forEach(function (a) { if (a.kind === "liability") totalL += a.balance; else totalA += a.balance; });
    var net = totalA - totalL;
    $("assetKpi").innerHTML =
      '<div class="kpi-card income"><span class="kpi-label">총자산</span><strong class="kpi-value">' + won(totalA) + '</strong></div>' +
      '<div class="kpi-card expense"><span class="kpi-label">총부채</span><strong class="kpi-value">' + won(totalL) + '</strong></div>' +
      '<div class="kpi-card highlight"><span class="kpi-label">순자산</span><strong class="kpi-value">' + won(net) + '</strong><span class="kpi-sub">자산 − 부채</span></div>';

    var box = $("assetBreakdown"), sums = {};
    state.assets.forEach(function (a) { if (a.kind !== "liability") sums[a.category] = (sums[a.category] || 0) + a.balance; });
    var rows = Object.keys(sums).map(function (k) { return { name: k, amt: sums[k] }; }).sort(function (a, b) { return b.amt - a.amt; });
    if (!rows.length) { box.innerHTML = '<p class="empty">등록된 자산이 없습니다.</p>'; }
    else { var max = rows[0].amt; box.innerHTML = rows.map(function (r) { return '<div class="cat-row"><span class="cat-name">' + esc(r.name) + '</span><span class="cat-bar"><span style="width:' + (r.amt / max * 100) + '%"></span></span><span class="cat-amt">' + won(r.amt) + '</span></div>'; }).join(""); }

    var listBox = $("assetList");
    if (!state.assets.length) { listBox.innerHTML = '<p class="empty">아래에서 자산을 추가해 보세요.</p>'; return; }
    listBox.innerHTML = state.assets.map(function (a) {
      var icon = a.kind === "liability" ? "💳" : "💰";
      return '<div class="tx-item"><div class="tx-badge">' + icon + '</div><div class="tx-main"><div class="tx-cat">' + esc(a.name) + '</div><div class="tx-meta"><span class="scope-tag">' + esc(a.category) + '</span> · ' + (a.kind === "liability" ? "부채" : "자산") + '</div></div><div class="tx-amt ' + (a.kind === "liability" ? "expense" : "income") + '">' + won(a.balance) + '</div><button class="tx-del" data-id="' + a.id + '" aria-label="삭제">×</button></div>';
    }).join("");
    listBox.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 자산을 삭제할까요?")) return;
        state.assets = state.assets.filter(function (a) { return a.id !== btn.dataset.id; });
        save(AST_KEY, state.assets); renderAssets();
      });
    });
  }
  function setupAssets() {
    document.querySelectorAll("#assetKindSeg .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("#assetKindSeg .seg-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active"); state.assetKind = btn.dataset.kind; refreshAssetCategoryOptions();
      });
    });
    $("assetCatEditToggle").addEventListener("click", function () {
      var ed = $("assetCatEditor"); ed.hidden = !ed.hidden;
      $("assetCatEditToggle").textContent = ed.hidden ? "＋ 카테고리 추가·삭제" : "▾ 카테고리 편집 닫기";
    });
    $("assetCatAddBtn").addEventListener("click", function () {
      var name = $("assetCatAddInput").value.trim(); if (!name) return;
      var arr = state.assetCategories[state.assetKind];
      if (arr.indexOf(name) === -1) { arr.push(name); save(ACAT_KEY, state.assetCategories); refreshAssetCategoryOptions(); }
      $("assetCatAddInput").value = "";
    });
    $("assetBalance").addEventListener("input", function (e) { var raw = onlyNum(e.target.value); e.target.value = raw ? raw.toLocaleString("ko-KR") : ""; });
    $("assetAddBtn").addEventListener("click", function () {
      var name = $("assetName").value.trim(), bal = onlyNum($("assetBalance").value);
      if (!name) { alert("자산 이름을 입력해 주세요."); return; }
      if (!bal || bal <= 0) { alert("금액을 올바르게 입력해 주세요."); return; }
      state.assets.push({ id: uid(), name: name, category: $("assetCategory").value, balance: bal, kind: state.assetKind });
      save(AST_KEY, state.assets);
      $("assetName").value = ""; $("assetBalance").value = "";
      renderAssets();
    });
    refreshAssetCategoryOptions();
  }

  /* ================= 정기 거래 관리 ================= */
  function renderRecurring() {
    var box = $("recurringList");
    if (!state.recurring.length) { box.innerHTML = '<p class="empty">등록된 정기 거래가 없습니다. 입력 화면에서 반복을 "매월/매년"으로 저장하면 여기에 표시돼요.</p>'; return; }
    box.innerHTML = state.recurring.map(function (r) {
      var scopeKo = r.scope === "business" ? "사업" : "개인", intKo = r.interval === "monthly" ? "매월" : "매년", sign = r.type === "income" ? "+" : "-";
      return '<div class="tx-item"><div class="tx-badge">🔁</div><div class="tx-main"><div class="tx-cat">' + esc(r.category) + (r.memo ? ' · ' + esc(r.memo) : '') + '</div><div class="tx-meta"><span class="scope-tag">' + scopeKo + '</span> · ' + intKo + ' · 다음 ' + r.nextDate + '</div></div><div class="tx-amt ' + r.type + '">' + sign + won(r.amount) + '</div><button class="tx-del" data-id="' + r.id + '" aria-label="중지">×</button></div>';
    }).join("");
    box.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 정기 거래를 중지(삭제)할까요? 이미 등록된 과거 거래는 그대로 남습니다.")) return;
        state.recurring = state.recurring.filter(function (r) { return r.id !== btn.dataset.id; });
        save(REC_KEY, state.recurring); renderRecurring();
      });
    });
  }

  /* ================= 연/월 선택 ================= */
  function openPicker() { state.pickerYear = state.month.getFullYear(); renderPicker(); $("pickerOverlay").hidden = false; }
  function closePicker() { $("pickerOverlay").hidden = true; }
  function renderPicker() {
    $("pickerYearLabel").textContent = state.pickerYear;
    var curY = state.month.getFullYear(), curM = state.month.getMonth(), html = "";
    for (var i = 0; i < 12; i++) html += '<button class="pm' + ((state.pickerYear === curY && i === curM) ? " active" : "") + '" data-m="' + i + '">' + (i + 1) + '월</button>';
    $("pickerMonths").innerHTML = html;
    $("pickerMonths").querySelectorAll(".pm").forEach(function (btn) {
      btn.addEventListener("click", function () { state.month = new Date(state.pickerYear, +btn.dataset.m, 1); state.selectedDay = null; closePicker(); renderAll(); });
    });
  }

  /* ================= 메뉴 드로어 ================= */
  function setupMenu() {
    $("menuBtn").addEventListener("click", function () { state.menuOpen = true; $("menuOverlay").hidden = false; updateFab(); });
    $("menuOverlay").addEventListener("click", function (e) { if (e.target === $("menuOverlay")) { state.menuOpen = false; $("menuOverlay").hidden = true; updateFab(); } });
    document.querySelectorAll(".menu-item").forEach(function (item) {
      item.addEventListener("click", function () { state.menuOpen = false; $("menuOverlay").hidden = true; switchView(item.dataset.view); });
    });
  }

  /* ================= 공통 셋업 ================= */
  function setupDashToggle() {
    document.querySelectorAll("#dashToggle .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { state.dashScope = btn.dataset.dscope; state.selectedDay = null; renderDashboard(); });
    });
  }
  function setupPicker() {
    $("currentMonth").addEventListener("click", openPicker);
    $("pickerPrevYear").addEventListener("click", function () { state.pickerYear--; renderPicker(); });
    $("pickerNextYear").addEventListener("click", function () { state.pickerYear++; renderPicker(); });
    $("pickerOverlay").addEventListener("click", function (e) { if (e.target === $("pickerOverlay")) closePicker(); });
  }

  function renderAll() { renderMonthLabel(); renderDashboard(); renderList(); }

  function init() {
    document.querySelectorAll(".tab").forEach(function (t) { t.addEventListener("click", function () { switchView(t.dataset.view); }); });
    $("prevMonth").addEventListener("click", function () { changeMonth(-1); });
    $("nextMonth").addEventListener("click", function () { changeMonth(1); });
    setupForm(); setupListControls(); setupDashToggle(); setupPicker(); setupMenu(); setupAssets();
    $("fab").addEventListener("click", function () { switchView("add"); });
    updateFab();

    generateRecurring(); // 앱 열 때 밀린 정기 거래 자동 등록

    if (state.transactions.length === 0 && state.recurring.length === 0) {
      var today = todayStr();
      state.transactions = [
        { id: "demo1", date: today, scope: "business", type: "income",  category: "용역/수수료 수입", amount: 1500000, memo: "예시: 클라이언트 용역비" },
        { id: "demo2", date: today, scope: "business", type: "expense", category: "소프트웨어·구독",   amount: 29000,   memo: "예시: 협업툴 구독" },
        { id: "demo3", date: today, scope: "personal", type: "expense", category: "식비",             amount: 12000,   memo: "예시: 점심" }
      ];
      save(TX_KEY, state.transactions);
    }
    renderAll();
  }
  document.addEventListener("DOMContentLoaded", init);
})();