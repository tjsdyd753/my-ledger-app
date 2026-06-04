/* ============================================
   결 Ledger · app.js  (순수 JavaScript, 빌드 불필요)
   데이터는 브라우저 localStorage에 저장됩니다.
   ============================================ */

(function () {
  "use strict";

  /* ---------- 저장소 ---------- */
  var STORAGE_KEY = "kyul.transactions.v1";

  function loadTx() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }
  function saveTx(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  /* ---------- 카테고리 정의 (세금 분류에 도움이 되도록 설계) ---------- */
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
    month: new Date(),          // 현재 보고 있는 달
    form: { scope: "business", type: "expense" },
    listFilter: "all"
  };

  /* ---------- 유틸 ---------- */
  function won(n) {
    var sign = n < 0 ? "-" : "";
    return sign + "₩" + Math.abs(Math.round(n)).toLocaleString("ko-KR");
  }
  function ymKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function inMonth(tx, d) {
    return tx.date.slice(0, 7) === ymKey(d);
  }
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
    renderAll();
  }
  function renderMonthLabel() {
    var d = state.month;
    $("currentMonth").textContent = d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0");
    $("dashMonthLabel").textContent = (d.getMonth() + 1) + "월";
  }

  /* ---------- 대시보드 ---------- */
  function renderDashboard() {
    var list = state.transactions.filter(function (t) { return inMonth(t, state.month); });

    var bizIn = 0, bizOut = 0, perIn = 0, perOut = 0;
    list.forEach(function (t) {
      if (t.scope === "business") {
        if (t.type === "income") bizIn += t.amount; else bizOut += t.amount;
      } else {
        if (t.type === "income") perIn += t.amount; else perOut += t.amount;
      }
    });

    $("kpiBizProfit").textContent = won(bizIn - bizOut);
    $("kpiBizIncome").textContent = "매출 " + won(bizIn);
    $("kpiBizExpense").textContent = "비용 " + won(bizOut);

    $("kpiPersonalBalance").textContent = won(perIn - perOut);
    $("kpiPersonalIncome").textContent = "수입 " + won(perIn);
    $("kpiPersonalExpense").textContent = "지출 " + won(perOut);

    $("kpiNetFlow").textContent = won((bizIn + perIn) - (bizOut + perOut));

    renderTrend();
    renderCategoryBreakdown(list);
  }

  // 최근 6개월 수입/지출 막대
  function renderTrend() {
    var chart = $("trendChart");
    chart.innerHTML = "";
    var months = [];
    for (var i = 5; i >= 0; i--) {
      months.push(new Date(state.month.getFullYear(), state.month.getMonth() - i, 1));
    }
    var data = months.map(function (m) {
      var inc = 0, exp = 0;
      state.transactions.forEach(function (t) {
        if (inMonth(t, m)) { if (t.type === "income") inc += t.amount; else exp += t.amount; }
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

  // 사업 비용 카테고리별 (세금 신고 참고)
  function renderCategoryBreakdown(list) {
    var box = $("categoryBreakdown");
    var sums = {};
    list.forEach(function (t) {
      if (t.scope === "business" && t.type === "expense") {
        sums[t.category] = (sums[t.category] || 0) + t.amount;
      }
    });
    var rows = Object.keys(sums).map(function (k) { return { name: k, amt: sums[k] }; })
                     .sort(function (a, b) { return b.amt - a.amt; });
    if (rows.length === 0) {
      box.innerHTML = '<p class="empty">이번 달 기록된 사업 비용이 없습니다.</p>';
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

  /* ---------- 입력 폼 ---------- */
  function refreshCategoryOptions() {
    var sel = $("txCategory");
    var opts = CATEGORIES[state.form.scope][state.form.type];
    sel.innerHTML = opts.map(function (o) { return '<option>' + o + '</option>'; }).join("");
  }

  function setupForm() {
    // 구분(개인/사업) 버튼
    document.querySelectorAll(".seg-btn[data-scope]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".seg-btn[data-scope]").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.form.scope = btn.dataset.scope;
        refreshCategoryOptions();
      });
    });
    // 유형(수입/지출) 버튼
    document.querySelectorAll(".type-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".type-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.form.type = btn.dataset.type;
        refreshCategoryOptions();
      });
    });
    // 금액 천단위 콤마
    $("txAmount").addEventListener("input", function (e) {
      var raw = e.target.value.replace(/[^0-9]/g, "");
      e.target.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
    });
    // 오늘 날짜 기본값
    $("txDate").value = new Date().toISOString().slice(0, 10);

    // 저장
    $("txForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var amount = Number($("txAmount").value.replace(/[^0-9]/g, ""));
      var msg = $("formMsg");
      if (!amount || amount <= 0) {
        msg.textContent = "금액을 올바르게 입력해 주세요.";
        msg.className = "form-msg err";
        return;
      }
      state.transactions.push({
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        date: $("txDate").value || new Date().toISOString().slice(0, 10),
        scope: state.form.scope,
        type: state.form.type,
        category: $("txCategory").value,
        amount: amount,
        memo: $("txMemo").value.trim()
      });
      saveTx(state.transactions);

      msg.textContent = "✓ 저장되었습니다.";
      msg.className = "form-msg ok";
      $("txAmount").value = "";
      $("txMemo").value = "";
      renderAll();
      setTimeout(function () { msg.textContent = ""; }, 2000);
    });

    refreshCategoryOptions();
  }

  /* ---------- 내역 ---------- */
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
        '<div class="tx-amt ' + t.type + '">' + sign + won(t.amount).replace("₩", "₩") + '</div>' +
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

  /* ---------- CSV 내보내기 (세금/회계 자료용) ---------- */
  function exportCSV() {
    var list = state.transactions.filter(function (t) { return inMonth(t, state.month); });
    if (list.length === 0) { alert("이번 달 내보낼 거래가 없습니다."); return; }
    var header = ["날짜", "구분", "유형", "카테고리", "금액", "메모"];
    var rows = list.map(function (t) {
      return [
        t.date,
        t.scope === "business" ? "사업" : "개인",
        t.type === "income" ? "수입" : "지출",
        t.category,
        t.amount,
        '"' + (t.memo || "").replace(/"/g, '""') + '"'
      ].join(",");
    });
    var csv = "\uFEFF" + header.join(",") + "\n" + rows.join("\n"); // BOM: 엑셀 한글 깨짐 방지
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "결_" + ymKey(state.month) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
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

    // 처음 실행 시 예시 데이터 한 번 넣기 (둘러보기용)
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
