/* ============================================
   한손 · app.js  (순수 JavaScript, 빌드 불필요)
   데이터는 브라우저 localStorage에 저장됩니다.
   ============================================ */

(function () {
  "use strict";

  /* ---------- 저장소 ---------- */
  var STORAGE_KEY = "kyul.transactions.v1";
  function loadTx() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveTx(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }

  /* ---------- 카테고리 (세금 분류에 도움되도록 설계) ---------- */
  var CATEGORIES = {
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

  /* ---------- 상태 ---------- */
  var state = {
    transactions: loadTx(),
    month: new Date(),
    form: { scope: "business", type: "expense" },
    listFilter: "all",
    dashScope: "business",   // 대시보드에서 보고 있는 영역
    selectedDay: null,       // 달력에서 선택한 날짜 (YYYY-MM-DD)
    pickerYear: null         // 연/월 선택창에서 임시로 보는 연도
  };

  /* ---------- 유틸 ---------- */
  function won(n) {
    var s = n < 0 ? "-" : "";
    return s + "₩" + Math.abs(Math.round(n)).toLocaleString("ko-KR");
  }
  function pct(n) { return (Math.round(n * 10) / 10) + "%"; }
  function ymKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function dKey(y, m, day) { return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
  function inMonth(tx, d) { return tx.date.slice(0, 7) === ymKey(d); }
  function $(id) { return document.getElementById(id); }

  /* ---------- 화면 전환 (탭) ---------- */
  function switchView(name) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.id === "view-" + name);
    });
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === name);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- 월 이동 ---------- */
  function changeMonth(delta) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
    state.selectedDay = null;
    renderAll();
  }
  function renderMonthLabel() {
    var d = state.month;
    $("currentMonth").textContent = d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0");
    $("dashMonthLabel").textContent = (d.getMonth() + 1) + "월";
  }

  /* ================= 대시보드 ================= */

  function scopeTotals(scope) {
    var inc = 0, exp = 0;
    state.transactions.forEach(function (t) {
      if (t.scope === scope && inMonth(t, state.month)) {
        if (t.type === "income") inc += t.amount; else exp += t.amount;
      }
    });
    return { inc: inc, exp: exp, net: inc - exp };
  }

  function renderDashboard() {
    var scope = state.dashScope;
    var isBiz = scope === "business";

    // 토글 버튼 상태
    document.querySelectorAll("#dashToggle .seg-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.dscope === scope);
    });

    // 제목/라벨 텍스트
    $("dashTitle").textContent = isBiz ? "사업 대시보드" : "개인 가계부";
    $("trendTitle").textContent = isBiz ? "최근 6개월 매출·비용" : "최근 6개월 수입·지출";
    $("legendIncome").textContent = isBiz ? "매출" : "수입";
    $("legendExpense").textContent = isBiz ? "비용" : "지출";
    $("catTitle").innerHTML = (isBiz ? "비용 카테고리" : "지출 카테고리") + ' <small class="muted">(많이 쓴 순)</small>';

    var t = scopeTotals(scope);
    renderKPI(scope, t);
    renderTrend(scope);
    renderCategory(scope);
    renderCalendar(scope);
    renderDayDetail(scope);
  }

  // KPI 4종 — 사업은 매출/비용/순이익/이익률, 개인은 수입/지출/수지/저축률
  function renderKPI(scope, t) {
    var isBiz = scope === "business";
    var rate = t.inc > 0 ? (t.net / t.inc * 100) : 0;
    var cards = isBiz
      ? [
          { label: "매출", value: won(t.inc), tone: "income" },
          { label: "비용", value: won(t.exp), tone: "expense" },
          { label: "순이익", value: won(t.net), tone: "highlight" },
          { label: "이익률", value: t.inc > 0 ? pct(rate) : "—", tone: "plain", sub: "순이익 ÷ 매출" }
        ]
      : [
          { label: "수입", value: won(t.inc), tone: "income" },
          { label: "지출", value: won(t.exp), tone: "expense" },
          { label: "이번 달 수지", value: won(t.net), tone: "highlight" },
          { label: "저축률", value: t.inc > 0 ? pct(rate) : "—", tone: "plain", sub: "남은 돈 ÷ 수입" }
        ];

    $("kpiGrid").innerHTML = cards.map(function (c) {
      return '<div class="kpi-card ' + c.tone + '">' +
        '<span class="kpi-label">' + c.label + '</span>' +
        '<strong class="kpi-value">' + c.value + '</strong>' +
        (c.sub ? '<span class="kpi-sub">' + c.sub + '</span>' : '') +
      '</div>';
    }).join("");
  }

  // 최근 6개월 추세 (선택한 영역만)
  function renderTrend(scope) {
    var chart = $("trendChart");
    chart.innerHTML = "";
    var months = [];
    for (var i = 5; i >= 0; i--) months.push(new Date(state.month.getFullYear(), state.month.getMonth() - i, 1));

    var data = months.map(function (m) {
      var inc = 0, exp = 0;
      state.transactions.forEach(function (tx) {
        if (tx.scope === scope && inMonth(tx, m)) {
          if (tx.type === "income") inc += tx.amount; else exp += tx.amount;
        }
      });
      return { m: m, inc: inc, exp: exp };
    });
    var max = Math.max(1, Math.max.apply(null, data.map(function (d) { return Math.max(d.inc, d.exp); })));

    data.forEach(function (d) {
      var col = document.createElement("div");
      col.className = "trend-col";
      col.innerHTML =
        '<div class="trend-bars">' +
          '<i class="income" style="height:' + (d.inc / max * 100) + '%"></i>' +
          '<i class="expense" style="height:' + (d.exp / max * 100) + '%"></i>' +
        '</div>' +
        '<span class="trend-label">' + (d.m.getMonth() + 1) + '월</span>';
      chart.appendChild(col);
    });
  }

  // 카테고리별 지출/비용 (선택한 영역의 expense)
  function renderCategory(scope) {
    var box = $("categoryBreakdown");
    var sums = {};
    state.transactions.forEach(function (t) {
      if (t.scope === scope && t.type === "expense" && inMonth(t, state.month)) {
        sums[t.category] = (sums[t.category] || 0) + t.amount;
      }
    });
    var rows = Object.keys(sums).map(function (k) { return { name: k, amt: sums[k] }; })
                     .sort(function (a, b) { return b.amt - a.amt; });
    if (rows.length === 0) {
      box.innerHTML = '<p class="empty">이번 달 기록된 ' + (scope === "business" ? "비용" : "지출") + '이 없습니다.</p>';
      return;
    }
    var max = rows[0].amt;
    box.innerHTML = rows.map(function (r) {
      return '<div class="cat-row">' +
        '<span class="cat-name">' + r.name + '</span>' +
        '<span class="cat-bar"><span style="width:' + (r.amt / max * 100) + '%"></span></span>' +
        '<span class="cat-amt">' + won(r.amt) + '</span>' +
      '</div>';
    }).join("");
  }

  /* ---------- 일별 달력 ---------- */
  function renderCalendar(scope) {
    var grid = $("calendarGrid");
    var y = state.month.getFullYear(), m = state.month.getMonth();
    var firstWeekday = new Date(y, m, 1).getDay();      // 0=일
    var daysInMonth = new Date(y, m + 1, 0).getDate();

    // 날짜별 집계
    var byDay = {};
    state.transactions.forEach(function (t) {
      if (t.scope === scope && inMonth(t, state.month)) {
        var day = Number(t.date.slice(8, 10));
        if (!byDay[day]) byDay[day] = { inc: 0, exp: 0 };
        if (t.type === "income") byDay[day].inc += t.amount; else byDay[day].exp += t.amount;
      }
    });

    var today = new Date();
    var isThisMonth = today.getFullYear() === y && today.getMonth() === m;
    var html = "";

    for (var b = 0; b < firstWeekday; b++) html += '<span class="cal-cell empty-cell"></span>';

    for (var day = 1; day <= daysInMonth; day++) {
      var key = dKey(y, m, day);
      var info = byDay[day];
      var weekday = new Date(y, m, day).getDay();
      var cls = "cal-cell";
      if (weekday === 0) cls += " sun";
      if (weekday === 6) cls += " sat";
      if (isThisMonth && today.getDate() === day) cls += " today";
      if (state.selectedDay === key) cls += " selected";

      var dots = "";
      if (info) {
        if (info.inc > 0) dots += '<i class="cd income"></i>';
        if (info.exp > 0) dots += '<i class="cd expense"></i>';
      }
      html += '<button class="' + cls + '" data-date="' + key + '">' +
                '<span class="cal-day">' + day + '</span>' +
                '<span class="cal-dots">' + dots + '</span>' +
              '</button>';
    }
    grid.innerHTML = html;

    grid.querySelectorAll(".cal-cell[data-date]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        state.selectedDay = (state.selectedDay === cell.dataset.date) ? null : cell.dataset.date;
        renderCalendar(state.dashScope);
        renderDayDetail(state.dashScope);
      });
    });
  }

  // 선택한 날짜의 거래 목록
  function renderDayDetail(scope) {
    var box = $("dayDetail");
    if (!state.selectedDay) {
      box.innerHTML = '<p class="day-hint">날짜를 누르면 그 날의 거래를 볼 수 있어요.</p>';
      return;
    }
    var list = state.transactions.filter(function (t) {
      return t.scope === scope && t.date === state.selectedDay;
    }).sort(function (a, b) { return b.id.localeCompare(a.id); });

    var dateLabel = state.selectedDay.slice(5).replace("-", "월 ") + "일";
    var head = '<div class="day-detail-head">' + dateLabel + '</div>';

    if (list.length === 0) {
      box.innerHTML = head + '<p class="day-hint">이 날은 기록된 거래가 없어요.</p>';
      return;
    }
    box.innerHTML = head + list.map(function (t) {
      var sign = t.type === "income" ? "+" : "-";
      return '<div class="day-row">' +
        '<span class="day-cat">' + t.category + (t.memo ? ' · ' + t.memo : '') + '</span>' +
        '<span class="tx-amt ' + t.type + '">' + sign + won(t.amount) + '</span>' +
      '</div>';
    }).join("");
  }

  /* ================= 입력 폼 ================= */
  function refreshCategoryOptions() {
    var sel = $("txCategory");
    var opts = CATEGORIES[state.form.scope][state.form.type];
    sel.innerHTML = opts.map(function (o) { return '<option>' + o + '</option>'; }).join("");
  }
  function setupForm() {
    document.querySelectorAll(".seg-btn[data-scope]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".seg-btn[data-scope]").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.form.scope = btn.dataset.scope;
        refreshCategoryOptions();
      });
    });
    document.querySelectorAll(".type-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".type-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.form.type = btn.dataset.type;
        refreshCategoryOptions();
      });
    });
    $("txAmount").addEventListener("input", function (e) {
      var raw = e.target.value.replace(/[^0-9]/g, "");
      e.target.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
    });
    $("txDate").value = new Date().toISOString().slice(0, 10);

    $("txForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var amount = Number($("txAmount").value.replace(/[^0-9]/g, ""));
      var msg = $("formMsg");
      if (!amount || amount <= 0) {
        msg.textContent = "금액을 올바르게 입력해 주세요."; msg.className = "form-msg err"; return;
      }
      state.transactions.push({
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        date: $("txDate").value || new Date().toISOString().slice(0, 10),
        scope: state.form.scope, type: state.form.type,
        category: $("txCategory").value, amount: amount,
        memo: $("txMemo").value.trim()
      });
      saveTx(state.transactions);
      msg.textContent = "✓ 저장되었습니다."; msg.className = "form-msg ok";
      $("txAmount").value = ""; $("txMemo").value = "";
      renderAll();
      setTimeout(function () { msg.textContent = ""; }, 2000);
    });
    refreshCategoryOptions();
  }

  /* ================= 내역 ================= */
  function renderList() {
    var box = $("txList");
    var list = state.transactions
      .filter(function (t) { return inMonth(t, state.month); })
      .filter(function (t) { return state.listFilter === "all" || t.scope === state.listFilter; })
      .sort(function (a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });

    if (list.length === 0) {
      box.innerHTML = '<p class="empty">표시할 거래가 없습니다. 입력 탭에서 기록을 추가해 보세요.</p>';
      return;
    }
    box.innerHTML = list.map(function (t) {
      var icon = t.scope === "business" ? "💼" : "🏠";
      var scopeKo = t.scope === "business" ? "사업" : "개인";
      var sign = t.type === "income" ? "+" : "-";
      return '<div class="tx-item ' + t.scope + '">' +
        '<div class="tx-badge">' + icon + '</div>' +
        '<div class="tx-main">' +
          '<div class="tx-cat">' + t.category + (t.memo ? ' · ' + t.memo : '') + '</div>' +
          '<div class="tx-meta"><span class="scope-tag">' + scopeKo + '</span> · ' + t.date + '</div>' +
        '</div>' +
        '<div class="tx-amt ' + t.type + '">' + sign + won(t.amount) + '</div>' +
        '<button class="tx-del" data-id="' + t.id + '" aria-label="삭제">×</button>' +
      '</div>';
    }).join("");

    box.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 거래를 삭제할까요?")) return;
        state.transactions = state.transactions.filter(function (t) { return t.id !== btn.dataset.id; });
        saveTx(state.transactions);
        renderAll();
      });
    });
  }
  function setupListControls() {
    document.querySelectorAll(".chip[data-filter]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".chip[data-filter]").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        state.listFilter = chip.dataset.filter;
        renderList();
      });
    });
    $("exportBtn").addEventListener("click", exportCSV);
  }

  /* ---------- CSV 내보내기 ---------- */
  function exportCSV() {
    var list = state.transactions.filter(function (t) { return inMonth(t, state.month); });
    if (list.length === 0) { alert("이번 달 내보낼 거래가 없습니다."); return; }
    var header = ["날짜", "구분", "유형", "카테고리", "금액", "메모"];
    var rows = list.map(function (t) {
      return [t.date, t.scope === "business" ? "사업" : "개인", t.type === "income" ? "수입" : "지출",
              t.category, t.amount, '"' + (t.memo || "").replace(/"/g, '""') + '"'].join(",");
    });
    var csv = "\uFEFF" + header.join(",") + "\n" + rows.join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "한손_" + ymKey(state.month) + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ================= 연/월 선택 바텀시트 ================= */
  function openPicker() {
    state.pickerYear = state.month.getFullYear();
    renderPicker();
    $("pickerOverlay").hidden = false;
  }
  function closePicker() { $("pickerOverlay").hidden = true; }

  function renderPicker() {
    $("pickerYearLabel").textContent = state.pickerYear;
    var curY = state.month.getFullYear(), curM = state.month.getMonth();
    var grid = $("pickerMonths");
    var html = "";
    for (var i = 0; i < 12; i++) {
      var active = (state.pickerYear === curY && i === curM) ? " active" : "";
      html += '<button class="pm' + active + '" data-m="' + i + '">' + (i + 1) + '월</button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".pm").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.month = new Date(state.pickerYear, Number(btn.dataset.m), 1);
        state.selectedDay = null;
        closePicker();
        renderAll();
      });
    });
  }
  function setupPicker() {
    $("currentMonth").addEventListener("click", openPicker);
    $("pickerPrevYear").addEventListener("click", function () { state.pickerYear--; renderPicker(); });
    $("pickerNextYear").addEventListener("click", function () { state.pickerYear++; renderPicker(); });
    $("pickerOverlay").addEventListener("click", function (e) {
      if (e.target === $("pickerOverlay")) closePicker();   // 바깥(어두운 부분) 클릭 시 닫기
    });
  }

  /* ---------- 대시보드 토글 ---------- */
  function setupDashToggle() {
    document.querySelectorAll("#dashToggle .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.dashScope = btn.dataset.dscope;
        state.selectedDay = null;
        renderDashboard();
      });
    });
  }

  /* ---------- 전체 렌더 ---------- */
  function renderAll() {
    renderMonthLabel();
    renderDashboard();
    renderList();
  }

  /* ---------- 초기화 ---------- */
  function init() {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { switchView(t.dataset.view); });
    });
    $("prevMonth").addEventListener("click", function () { changeMonth(-1); });
    $("nextMonth").addEventListener("click", function () { changeMonth(1); });

    setupForm();
    setupListControls();
    setupDashToggle();
    setupPicker();

    if (state.transactions.length === 0) {
      var today = new Date().toISOString().slice(0, 10);
      state.transactions = [
        { id: "demo1", date: today, scope: "business", type: "income",  category: "용역/수수료 수입", amount: 1500000, memo: "예시: 클라이언트 용역비" },
        { id: "demo2", date: today, scope: "business", type: "expense", category: "소프트웨어·구독",   amount: 29000,   memo: "예시: 협업툴 구독" },
        { id: "demo3", date: today, scope: "personal", type: "expense", category: "식비",             amount: 12000,   memo: "예시: 점심" }
      ];
      saveTx(state.transactions);
    }
    renderAll();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
