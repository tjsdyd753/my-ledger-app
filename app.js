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
  var PHOTO_KEY = "kyul.photos.v1";   // 사진은 기기에만 저장(동기화 안 함)
  var SCHED_KEY = "kyul.schedules.v1";
  var SAL_KEY   = "kyul.salary.v1";

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
  var DEFAULT_SALARY = {
    monthly: 0,
    cats: [
      { id: "fixed",     name: "고정지출",    color: "#F4A823", emoji: "🏠", items: [] },
      { id: "savings",   name: "적금",        color: "#27AE60", emoji: "🏦", items: [] },
      { id: "invest",    name: "투자",        color: "#26A69A", emoji: "📈", items: [] },
      { id: "living",    name: "생활비·부가세", color: "#E57373", emoji: "🛒", items: [] },
      { id: "emergency", name: "비상금",      color: "#00BCD4", emoji: "🆘", items: [] }
    ]
  };

  /* ---------- 상태 ---------- */
  var state = {
    transactions: load(TX_KEY, []),
    categories:   load(CAT_KEY, JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))),
    recurring:    load(REC_KEY, []),
    assets:       load(AST_KEY, []),
    assetCategories: load(ACAT_KEY, JSON.parse(JSON.stringify(DEFAULT_ASSET_CATS))),
    photos: load(PHOTO_KEY, {}),       // { 거래id: [사진 데이터,...] } — 기기 로컬
    schedules: load(SCHED_KEY, []),
    salary:    load(SAL_KEY, JSON.parse(JSON.stringify(DEFAULT_SALARY))),
    month: new Date(),
    form: { scope: "personal", type: "expense", repeat: "once", photos: [], editId: null },
    listFilter: "all",
    dashScope: "personal",
    selectedDay: todayStr(),
    pickerYear: null,
    assetKind: "asset",
    currentView: "dashboard",
    menuOpen: false,
    inputOpen: false,
    cloudMode: false   // 로그인(클라우드) 모드 여부
  };

  var db = null, udoc = null;  // Firestore 핸들

  // 텍스트 데이터 저장: 로그인 시 클라우드(계정별 1문서), 아니면 브라우저
  function persist() {
    if (state.cloudMode && udoc) {
      udoc.set({
        transactions: state.transactions,
        categories: state.categories,
        recurring: state.recurring,
        assets: state.assets,
        assetCategories: state.assetCategories,
        schedules: state.schedules,
        salary: state.salary
      }).catch(function (e) { console.warn("동기화 실패:", e); });
    } else {
      save(TX_KEY, state.transactions); save(CAT_KEY, state.categories);
      save(REC_KEY, state.recurring); save(AST_KEY, state.assets);
      save(ACAT_KEY, state.assetCategories);
      save(SCHED_KEY, state.schedules);
      save(SAL_KEY, state.salary);
    }
  }
  // 사진은 항상 기기 로컬에만 저장
  function savePhotos() { save(PHOTO_KEY, state.photos); }
  function photosOf(id) { return state.photos[id] || []; }

  /* ---------- 유틸 ---------- */
  function won(n) { var s = n < 0 ? "-" : ""; return s + "₩" + Math.abs(Math.round(n)).toLocaleString("ko-KR"); }
  function wonCompact(n) {
    var abs = Math.abs(Math.round(n)), sign = n < 0 ? "-" : "";
    function fmt(v) { return (Math.round(v * 10) / 10).toString().replace(/\.0$/, ""); }
    if (abs >= 100000000) return sign + "₩" + fmt(abs / 100000000) + "억";
    if (abs >= 10000)     return sign + "₩" + fmt(abs / 10000) + "만";
    return sign + "₩" + abs.toLocaleString("ko-KR");
  }
  function pct(n) { return (Math.round(n * 10) / 10) + "%"; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function dKey(y, m, day) { return y + "-" + pad(m + 1) + "-" + pad(day); }
  function inMonth(tx, d) { return tx.date.slice(0, 7) === ymKey(d); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uid() { return Date.now() + "-" + Math.random().toString(36).slice(2, 7); }
  function onlyNum(s) { return Number(String(s).replace(/[^0-9]/g, "")); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  var SCHED_COLORS = { blue: "#3182F6", green: "#20C997", orange: "#FF9500", red: "#F04452", purple: "#7C5CFC" };
  function schedColor(c) { return SCHED_COLORS[c] || "#3182F6"; }
  var schedState = { editId: null, color: "blue", scope: "personal" };

  /* ================= 화면 전환 ================= */
  function switchView(name) {
    state.currentView = name;
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.view === name); });
    if (name === "assets") renderAssets();
    if (name === "recurring") renderRecurring();
    if (name === "vat") renderVatView();
    if (name === "salary") renderSalary();
    if (name === "fincalc") renderFinCalc();
    updateFab();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function renderVatView() {
    var box = $("vatViewContent"); if (!box) return;
    var month = state.month, year = month.getFullYear(), monthNum = month.getMonth() + 1;
    var mInc = 0, mExp = 0;
    state.transactions.forEach(function (t) {
      if (t.scope !== "business" || !inMonth(t, month)) return;
      if (t.type === "income") mInc += t.amount; else mExp += t.amount;
    });
    var mVatOut = Math.round(mInc * 0.1), mVatIn = Math.round(mExp * 0.1), mVatDue = mVatOut - mVatIn;
    var isFirstHalf = monthNum <= 6;
    var halfStart = isFirstHalf ? 1 : 7, halfEnd = isFirstHalf ? 6 : 12;
    var halfLabel = isFirstHalf ? "상반기" : "하반기";
    var reportInfo = isFirstHalf ? (year + "년 7월 신고") : ((year + 1) + "년 1월 신고");
    var hInc = 0, hExp = 0;
    state.transactions.forEach(function (t) {
      if (t.scope !== "business") return;
      var p = t.date.split("-"), ty = +p[0], tm = +p[1];
      if (ty === year && tm >= halfStart && tm <= halfEnd) { if (t.type === "income") hInc += t.amount; else hExp += t.amount; }
    });
    var hVatOut = Math.round(hInc * 0.1), hVatIn = Math.round(hExp * 0.1), hVatDue = hVatOut - hVatIn;
    function vc(v) { return v > 0 ? "positive" : (v < 0 ? "negative" : ""); }
    function vt(v) { return v > 0 ? won(v) : (v < 0 ? "환급 " + won(-v) : won(0)); }
    var monthRows = "";
    for (var mo = halfStart; mo <= halfEnd; mo++) {
      var moInc = 0, moExp = 0;
      state.transactions.forEach(function (t) {
        if (t.scope !== "business") return;
        var p = t.date.split("-"), ty = +p[0], tm = +p[1];
        if (ty === year && tm === mo) { if (t.type === "income") moInc += t.amount; else moExp += t.amount; }
      });
      var moVatOut = Math.round(moInc * 0.1), moVatIn = Math.round(moExp * 0.1), moVatDue = moVatOut - moVatIn;
      monthRows += '<div class="vat-month-row' + (mo === monthNum ? " current" : "") + '">' +
        '<span class="vat-month-label">' + mo + '월</span>' +
        '<span class="vat-month-amt income">+' + won(moVatOut) + '</span>' +
        '<span class="vat-month-amt expense">−' + won(moVatIn) + '</span>' +
        '<span class="vat-month-due ' + vc(moVatDue) + '">' + vt(moVatDue) + '</span></div>';
    }
    var calcHtml =
      '<div class="panel">' +
      '<h3>부가세 계산기</h3>' +
      '<div class="seg vat-calc-seg" id="vatCalcSeg">' +
        '<button class="seg-btn active" data-mode="excl">공급가액 입력</button>' +
        '<button class="seg-btn" data-mode="incl">세금 포함 금액 입력</button>' +
      '</div>' +
      '<div class="field" style="margin-top:14px"><label for="vatCalcInput">금액 (원)</label>' +
        '<input type="number" id="vatCalcInput" class="vat-calc-input" placeholder="금액을 입력하세요" inputmode="numeric" min="0"></div>' +
      '<div class="vat-calc-result">' +
        '<div class="vat-row"><span class="vat-label">공급가액</span><span class="vat-amt" id="vatCalcBase">—</span></div>' +
        '<div class="vat-row"><span class="vat-label">부가세 (10%)</span><span class="vat-amt income" id="vatCalcTax">—</span></div>' +
        '<div class="vat-row vat-total"><span class="vat-label">합계</span><span class="vat-amt" id="vatCalcTotal">—</span></div>' +
      '</div></div>';
    box.innerHTML =
      calcHtml +
      '<div class="panel"><div class="vat-block"><div class="vat-block-title">' + monthNum + '월 당 월</div>' +
      '<div class="vat-row"><span class="vat-label">매출세액 (매출×10%)</span><span class="vat-amt income">+' + won(mVatOut) + '</span></div>' +
      '<div class="vat-row"><span class="vat-label">매입세액 (비용×10%)</span><span class="vat-amt expense">−' + won(mVatIn) + '</span></div>' +
      '<div class="vat-row vat-total"><span class="vat-label">납부 예상액</span><span class="vat-amt ' + vc(mVatDue) + '">' + vt(mVatDue) + '</span></div></div></div>' +
      '<div class="panel"><h3>' + year + '년 ' + halfLabel + ' (' + halfStart + '~' + halfEnd + '월) <span class="vat-tag">' + reportInfo + '</span></h3>' +
      '<div class="vat-month-header"><span>월</span><span>매출세액</span><span>매입세액</span><span>납부예상</span></div>' +
      monthRows +
      '<div class="vat-divider"></div>' +
      '<div class="vat-row vat-total"><span class="vat-label">' + halfLabel + ' 합계</span><span class="vat-amt ' + vc(hVatDue) + '">' + vt(hVatDue) + '</span></div>' +
      '<p class="vat-note muted">매출·비용에 단순 10%를 적용한 추정치입니다. 실제 납부액은 세금계산서·공제 여부에 따라 달라질 수 있습니다.</p></div>' +
      '<p class="vat-disclaimer">본 앱의 세액 계산 결과는 입력된 자료를 바탕으로 한 단순 참고용(시뮬레이션)이며, 실제 신고 세액과 다를 수 있으므로 정확한 세금은 세무사나 홈택스를 통해 확인하시기 바랍니다.</p>';
    var lbl = $("vatViewMonthLabel"); if (lbl) lbl.textContent = monthNum + "월";

    var calcMode = "excl";
    function updateCalc() {
      var val = parseFloat(($("vatCalcInput").value || "").replace(/,/g, "")) || 0;
      var base, tax, total;
      if (calcMode === "excl") {
        base = Math.round(val);
        tax = Math.round(val * 0.1);
        total = base + tax;
      } else {
        base = Math.round(val / 1.1);
        tax = Math.round(val) - base;
        total = Math.round(val);
      }
      $("vatCalcBase").textContent  = val ? won(base)  : "—";
      $("vatCalcTax").textContent   = val ? won(tax)   : "—";
      $("vatCalcTotal").textContent = val ? won(total) : "—";
    }
    $("vatCalcInput").addEventListener("input", updateCalc);
    box.querySelectorAll("#vatCalcSeg .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        calcMode = btn.dataset.mode;
        box.querySelectorAll("#vatCalcSeg .seg-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        updateCalc();
      });
    });
  }
  // 입력 화면이거나 메뉴가 열려 있으면 입력 버튼을 숨깁니다
  function updateFab() {
    var noFab = ["assets", "recurring", "vat", "salary", "fincalc"];
    $("fab").hidden = state.menuOpen || state.inputOpen || noFab.indexOf(state.currentView) !== -1;
  }
  var inInputMode = "tx";
  var inSchedColor = "blue";
  var inSchedScope = "personal";
  var inSchedEditId = null;
  var assetEditId = null;

  function switchInputMode(mode) {
    inInputMode = mode;
    $("txForm").style.display = (mode === "tx") ? "block" : "none";
    $("inlineSchedSection").style.display = (mode === "sched") ? "block" : "none";
    document.querySelectorAll("#inputModeSeg .seg-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.imode === mode);
    });
    // 탭 전환 시 구분(scope) 값 동기화
    if (mode === "sched") {
      inSchedScope = state.form.scope;
      document.querySelectorAll("#inSchedScopeSeg .seg-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.scope === inSchedScope);
      });
    } else if (mode === "tx") {
      state.form.scope = inSchedScope;
      document.querySelectorAll(".seg-btn[data-scope]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.scope === state.form.scope);
      });
      refreshCategoryOptions();
    }
  }

  function resetInlineSchedForm() {
    $("inSchedTitle").value = "";
    $("inSchedDate").value = todayStr();
    $("inSchedStartTime").value = "";
    $("inSchedEndTime").value = "";
    $("inSchedMemo").value = "";
    inSchedEditId = null;
    inSchedScope = "personal";
    $("inSchedDelete").hidden = true;
    $("inSchedMsg").textContent = "";
    inSchedColor = "blue";
    document.querySelectorAll("#inSchedColors .sched-color-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.color === "blue");
    });
    document.querySelectorAll("#inSchedScopeSeg .seg-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.scope === "personal");
    });
  }

  // 입력 팝업 열기/닫기
  // FAB: 모드 토글 보임, 타이틀 없음
  function openInput() {
    resetInputForm();
    resetInlineSchedForm();
    $("inputModalTitle").textContent = "";
    $("inputModeSeg").style.display = "";
    switchInputMode("tx");
    state.inputOpen = true; $("inputOverlay").hidden = false; updateFab();
  }
  // 메뉴 거래 입력: 모드 토글 숨김, 타이틀 "거래 입력"
  function openInputDirect() {
    resetInputForm();
    resetInlineSchedForm();
    $("inputModalTitle").textContent = "거래 입력";
    $("inputModeSeg").style.display = "none";
    switchInputMode("tx");
    state.inputOpen = true; $("inputOverlay").hidden = false; updateFab();
  }
  function closeInput() {
    state.inputOpen = false; $("inputOverlay").hidden = true; updateFab();
  }
  function resetInputForm() {
    $("txAmount").value = ""; $("txMemo").value = "";
    $("txDate").value = state.selectedDay || todayStr();
    state.form.photos = []; renderPhotoPreview();
    $("formMsg").textContent = "";
    state.form.repeat = "once";
    state.form.editId = null;
    state.form.scope = "personal";
    document.querySelectorAll(".seg-btn[data-scope]").forEach(function (b) { b.classList.toggle("active", b.dataset.scope === "personal"); });
    var submitBtn = $("txForm") && $("txForm").querySelector(".btn-primary");
    if (submitBtn) submitBtn.textContent = "저장";
    document.querySelectorAll(".rep-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.repeat === "once"); });
    var ed = $("catEditor"); if (ed) { ed.hidden = true; $("catEditToggle").textContent = "＋ 카테고리 추가·삭제"; }
  }
  function openInputEdit(tx) {
    resetInputForm();
    switchInputMode("tx");
    $("inputModalTitle").textContent = "거래 수정";
    $("inputModeSeg").style.display = "none";
    state.form.scope = tx.scope;
    document.querySelectorAll(".seg-btn[data-scope]").forEach(function (b) { b.classList.toggle("active", b.dataset.scope === tx.scope); });
    state.form.type = tx.type;
    document.querySelectorAll(".type-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.type === tx.type); });
    refreshCategoryOptions();
    $("txCategory").value = tx.category;
    $("txAmount").value = tx.amount.toLocaleString("ko-KR");
    $("txDate").value = tx.date;
    $("txMemo").value = tx.memo || "";
    state.form.photos = (state.photos[tx.id] || []).slice();
    renderPhotoPreview();
    state.form.editId = tx.id;
    var submitBtn = $("txForm").querySelector(".btn-primary");
    if (submitBtn) submitBtn.textContent = "수정 저장";
    state.inputOpen = true; $("inputOverlay").hidden = false; updateFab();
  }

  /* ================= 월 이동 ================= */
  function changeMonth(delta) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
    state.selectedDay = null;
    generateRecurring();
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
    var today = todayStr();
    // 현재 보고 있는 달의 마지막 날까지도 생성 (미래 날짜 포함, 달력에 표시)
    var vm = state.month;
    var endOfViewedMonth = vm.getFullYear() + "-" + pad(vm.getMonth() + 1) + "-" + pad(new Date(vm.getFullYear(), vm.getMonth() + 1, 0).getDate());
    var cutoff = endOfViewedMonth > today ? endOfViewedMonth : today;
    var touched = false;
    state.recurring.forEach(function (r) {
      var guard = 0;
      while (r.nextDate <= cutoff && guard < 600) {
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
    if (touched) { persist(); }
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
    renderTodaySchedule(scope); renderKPI(scope, t); renderTrend(scope); renderCategory(scope); renderVatPanel(); renderCalendar(scope); renderDayDetail(scope);
  }
  function renderTodaySchedule(scope) {
    var panel = $("todaySchedPanel");
    var td = new Date(), todayKey = todayStr();
    var scheds = state.schedules.filter(function(s) {
      return s.date === todayKey && (s.scope || "business") === scope;
    }).sort(function(a, b) {
      if (!a.startTime && !b.startTime) return 0;
      if (!a.startTime) return 1;
      if (!b.startTime) return -1;
      return a.startTime.localeCompare(b.startTime);
    });
    var dateLabel = (td.getMonth() + 1) + "월 " + td.getDate() + "일";
    var head = '<div class="today-sched-head"><span class="today-sched-title">📅 오늘 일정</span><span class="today-sched-date">' + dateLabel + '</span></div>';
    if (!scheds.length) {
      panel.innerHTML = head + '<p class="today-sched-empty">오늘 등록된 일정이 없습니다</p>';
      return;
    }
    var items = scheds.map(function(s) {
      var timeStr = s.startTime ? (s.startTime + (s.endTime ? " ~ " + s.endTime : "")) : "";
      return '<div class="today-sched-item">' +
        '<span class="today-sched-dot" style="background:' + schedColor(s.color) + '"></span>' +
        (timeStr ? '<span class="today-sched-time">' + timeStr + '</span>' : '') +
        '<span class="today-sched-name">' + esc(s.title) + '</span>' +
        (s.memo ? '<span class="today-sched-memo">· ' + esc(s.memo) + '</span>' : '') +
        '</div>';
    }).join("");
    panel.innerHTML = head + '<div class="today-sched-list">' + items + '</div>';
  }
  function renderKPI(scope, t) {
    var isBiz = scope === "business";
    var rate = t.inc > 0 ? (t.net / t.inc * 100) : 0;
    var cards = isBiz
      ? [{ label: "매출", value: wonCompact(t.inc), tone: "income" }, { label: "비용", value: wonCompact(t.exp), tone: "expense" },
         { label: "순이익", value: wonCompact(t.net), tone: "highlight" }, { label: "이익률", value: t.inc > 0 ? pct(rate) : "—", tone: "plain", sub: "순이익 ÷ 매출" }]
      : [{ label: "수입", value: wonCompact(t.inc), tone: "income" }, { label: "지출", value: wonCompact(t.exp), tone: "expense" },
         { label: "이번 달 수지", value: wonCompact(t.net), tone: "highlight" }, { label: "저축률", value: t.inc > 0 ? pct(rate) : "—", tone: "plain", sub: "남은 돈 ÷ 수입" }];
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
    var byDaySched = {};
    state.schedules.forEach(function (s) {
      var p = s.date.split("-"), sy = +p[0], sm = +p[1], sd = +p[2];
      var sScope = s.scope || "business";
      if (sy === y && sm === m + 1 && sScope === scope) { if (!byDaySched[sd]) byDaySched[sd] = []; byDaySched[sd].push(s); }
    });
    var today = new Date(), isThisMonth = today.getFullYear() === y && today.getMonth() === m, html = "";
    for (var b = 0; b < firstWeekday; b++) html += '<span class="cal-cell empty-cell"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = dKey(y, m, day), info = byDay[day], wd = new Date(y, m, day).getDay(), cls = "cal-cell";
      if (wd === 0) cls += " sun"; if (wd === 6) cls += " sat";
      if (isThisMonth && today.getDate() === day) cls += " today";
      if (state.selectedDay === key) cls += " selected";
      var dots = ""; if (info) { if (info.inc > 0) dots += '<i class="cd income"></i>'; if (info.exp > 0) dots += '<i class="cd expense"></i>'; }
      (byDaySched[day] || []).slice(0, 2).forEach(function (s) { dots += '<i class="cd" style="background:' + schedColor(s.color) + '"></i>'; });
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
    if (!state.selectedDay) { box.innerHTML = '<p class="day-hint">날짜를 누르면 그 날의 거래와 일정을 볼 수 있어요.</p>'; return; }
    var txList = state.transactions.filter(function (t) { return t.scope === scope && t.date === state.selectedDay; }).sort(function (a, b) { return b.id.localeCompare(a.id); });
    var schedList = state.schedules.filter(function (s) { return s.date === state.selectedDay && (s.scope || "business") === scope; });
    var dateLabel = state.selectedDay.slice(5).replace("-", "월 ") + "일";
    var html = '<div class="day-detail-head">' + dateLabel + '</div>';
    if (schedList.length) {
      html += '<div class="day-section-title">📅 일정</div>';
      html += schedList.map(function (s) {
        var timeStr = s.startTime ? (s.startTime + (s.endTime ? " ~ " + s.endTime : "")) : "";
        return '<div class="day-row sched-row"><i class="day-sched-dot" style="background:' + schedColor(s.color) + '"></i><span class="day-cat">' + (timeStr ? '<span class="sched-time">' + timeStr + '</span> ' : '') + esc(s.title) + (s.memo ? ' <span class="muted">· ' + esc(s.memo) + '</span>' : '') + '</span><button class="day-edit-btn" data-sid="' + s.id + '" aria-label="수정">✏️</button><button class="tx-del sched-del" data-sid="' + s.id + '" aria-label="삭제">×</button></div>';
      }).join("");
    }
    if (txList.length) {
      html += '<div class="day-section-title">💰 거래</div>';
      html += txList.map(function (t) {
        var sign = t.type === "income" ? "+" : "-";
        var ph = photosOf(t.id);
        var photo = ph.length ? '<button class="photo-btn" data-photo="' + t.id + '">📷</button>' : '';
        return '<div class="day-row"><span class="day-cat">' + esc(t.category) + (t.memo ? ' <span class="muted">· ' + esc(t.memo) + '</span>' : '') + '</span>' + photo + '<span class="tx-amt ' + t.type + '">' + sign + won(t.amount) + '</span><button class="day-edit-btn" data-id="' + t.id + '" aria-label="수정">✏️</button><button class="tx-del" data-id="' + t.id + '" aria-label="삭제">×</button></div>';
      }).join("");
    }
    if (!txList.length && !schedList.length) html += '<p class="day-hint">이 날은 기록된 내용이 없어요.</p>';
    box.innerHTML = html;
    box.querySelectorAll(".day-edit-btn[data-sid]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var s = state.schedules.filter(function (x) { return x.id === btn.dataset.sid; })[0];
        if (s) openSchedModal(s.date, s);
      });
    });
    box.querySelectorAll(".day-edit-btn[data-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tx = state.transactions.filter(function (t) { return t.id === btn.dataset.id; })[0];
        if (tx) openInputEdit(tx);
      });
    });
    box.querySelectorAll(".photo-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tx = state.transactions.filter(function (t) { return t.id === btn.dataset.photo; })[0];
        if (tx) openPhotos(photosOf(tx.id));
      });
    });
    box.querySelectorAll(".tx-del[data-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var delId = btn.dataset.id;
        var delTx = state.transactions.filter(function (t) { return t.id === delId; })[0];
        var msg = delTx && delTx.recurringId ? "이 거래를 삭제할까요?\n정기 거래 규칙도 함께 중지됩니다." : "이 거래를 삭제할까요?";
        if (!confirm(msg)) return;
        state.transactions = state.transactions.filter(function (t) { return t.id !== delId; });
        if (state.photos[delId]) { delete state.photos[delId]; savePhotos(); }
        if (delTx && delTx.recurringId) {
          state.recurring = state.recurring.filter(function (r) { return r.id !== delTx.recurringId; });
        }
        persist(); renderAll();
      });
    });
    box.querySelectorAll(".sched-del[data-sid]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 일정을 삭제할까요?")) return;
        state.schedules = state.schedules.filter(function (s) { return s.id !== btn.dataset.sid; });
        persist(); renderCalendar(state.dashScope); renderDayDetail(state.dashScope);
      });
    });
  }

  /* ================= 간이 부가세 패널 ================= */
  function renderVatPanel() {
    var panel = $("vatPanel");
    if (!panel) return;
    if (state.dashScope !== "business") { panel.hidden = true; return; }
    panel.hidden = false;

    var month = state.month;
    var year = month.getFullYear();
    var monthNum = month.getMonth() + 1;

    // 당 월 집계
    var mInc = 0, mExp = 0;
    state.transactions.forEach(function (t) {
      if (t.scope !== "business" || !inMonth(t, month)) return;
      if (t.type === "income") mInc += t.amount; else mExp += t.amount;
    });
    var mVatOut = Math.round(mInc * 0.1);
    var mVatIn  = Math.round(mExp * 0.1);
    var mVatDue = mVatOut - mVatIn;

    // 상반기(1~6) / 하반기(7~12) 집계
    var isFirstHalf = monthNum <= 6;
    var halfStart   = isFirstHalf ? 1 : 7;
    var halfEnd     = isFirstHalf ? 6 : 12;
    var halfLabel   = isFirstHalf ? "상반기" : "하반기";
    var reportInfo  = isFirstHalf
      ? (year + "년 7월 신고")
      : ((year + 1) + "년 1월 신고");

    var hInc = 0, hExp = 0;
    state.transactions.forEach(function (t) {
      if (t.scope !== "business") return;
      var parts = t.date.split("-"), txY = +parts[0], txM = +parts[1];
      if (txY === year && txM >= halfStart && txM <= halfEnd) {
        if (t.type === "income") hInc += t.amount; else hExp += t.amount;
      }
    });
    var hVatOut = Math.round(hInc * 0.1);
    var hVatIn  = Math.round(hExp * 0.1);
    var hVatDue = hVatOut - hVatIn;

    function vatClass(v) { return v > 0 ? "positive" : (v < 0 ? "negative" : ""); }
    function vatText(v)  { return v > 0 ? won(v) : (v < 0 ? "환급 " + won(-v) : won(0)); }

    panel.innerHTML =
      '<h3>간이 부가세 계산 <small class="muted">(추정)</small></h3>' +

      '<div class="vat-block">' +
        '<div class="vat-block-title">' + monthNum + '월 당 월</div>' +
        '<div class="vat-row"><span class="vat-label">매출세액 (매출×10%)</span><span class="vat-amt income">+' + won(mVatOut) + '</span></div>' +
        '<div class="vat-row"><span class="vat-label">매입세액 (비용×10%)</span><span class="vat-amt expense">−' + won(mVatIn) + '</span></div>' +
        '<div class="vat-row vat-total"><span class="vat-label">납부 예상액</span><span class="vat-amt ' + vatClass(mVatDue) + '">' + vatText(mVatDue) + '</span></div>' +
      '</div>' +

      '<div class="vat-divider"></div>' +

      '<div class="vat-block">' +
        '<div class="vat-block-title">' + year + '년 ' + halfLabel + ' (' + halfStart + '~' + halfEnd + '월) <span class="vat-tag">' + reportInfo + '</span></div>' +
        '<div class="vat-row"><span class="vat-label">매출세액 합계</span><span class="vat-amt income">+' + won(hVatOut) + '</span></div>' +
        '<div class="vat-row"><span class="vat-label">매입세액 합계</span><span class="vat-amt expense">−' + won(hVatIn) + '</span></div>' +
        '<div class="vat-row vat-total"><span class="vat-label">납부 예상액 합계</span><span class="vat-amt ' + vatClass(hVatDue) + '">' + vatText(hVatDue) + '</span></div>' +
      '</div>' +

      '<p class="vat-note muted">매출·비용에 단순 10%를 적용한 추정치입니다. 세금계산서·공제 업종·간이과세 여부에 따라 실제 납부액은 달라질 수 있습니다.</p>';
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
        persist(); refreshCategoryOptions();
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
      if (arr.indexOf(name) === -1) { arr.push(name); persist(); refreshCategoryOptions(); }
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
      var photos = state.form.photos.slice();

      try {
        if (state.form.editId) {
          // 수정 모드
          state.transactions = state.transactions.map(function (t) {
            if (t.id !== state.form.editId) return t;
            return Object.assign({}, t, { scope: base.scope, type: base.type, category: base.category, amount: base.amount, memo: base.memo, date: date });
          });
          persist();
          if (photos.length) { state.photos[state.form.editId] = photos; savePhotos(); }
          msg.textContent = "✓ 수정되었습니다.";
        } else if (state.form.repeat === "once") {
          var tx = Object.assign({ id: uid(), date: date }, base);
          state.transactions.push(tx);
          persist();
          if (photos.length) { state.photos[tx.id] = photos; savePhotos(); }
          msg.textContent = "✓ 저장되었습니다.";
        } else {
          var dup = state.recurring.some(function (x) {
            return x.scope === base.scope && x.type === base.type && x.category === base.category &&
                   x.amount === base.amount && x.memo === base.memo &&
                   x.interval === state.form.repeat && x.startDate === date;
          });
          if (!dup) {
            var rule = Object.assign({ id: uid(), interval: state.form.repeat, startDate: date, nextDate: date }, base);
            state.recurring.push(rule); persist();
          }
          generateRecurring();
          msg.textContent = "✓ 정기 거래로 등록했습니다 (" + (state.form.repeat === "monthly" ? "매월" : "매년") + ").";
        }
      } catch (err) {
        msg.textContent = "저장 중 문제가 발생했습니다."; msg.className = "form-msg err";
        return;
      }
      renderAll();
      closeInput();
    });
    refreshCategoryOptions();
  }

  /* ================= 사진 첨부 ================= */
  // 용량 절약을 위해 긴 변을 1024px로 줄이고 JPEG로 압축
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 1024, w = img.width, h = img.height;
          if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
          else if (h > max) { w = Math.round(w * max / h); h = max; }
          var c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", 0.7));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function renderPhotoPreview() {
    var box = $("photoPreview");
    if (!box) return; // 사진 첨부 비활성화 시 조기 종료
    box.innerHTML = state.form.photos.map(function (src, i) {
      return '<span class="photo-thumb"><img src="' + src + '" alt="첨부 사진"/><button type="button" class="photo-thumb-del" data-i="' + i + '" aria-label="삭제">✕</button></span>';
    }).join("");
    box.querySelectorAll(".photo-thumb-del").forEach(function (btn) {
      btn.addEventListener("click", function () { state.form.photos.splice(+btn.dataset.i, 1); renderPhotoPreview(); });
    });
  }
  function setupPhotoInput() {
    var photoInput = $("txPhoto");
    if (!photoInput) return; // 사진 첨부 비활성화 시 조기 종료
    photoInput.addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      var jobs = files.map(function (f) { return resizeImage(f); });
      Promise.all(jobs).then(function (urls) {
        urls.forEach(function (u) { state.form.photos.push(u); });
        renderPhotoPreview();
      }).catch(function () { alert("사진을 불러오지 못했습니다."); });
      e.target.value = "";
    });
  }
  function openPhotos(photos) {
    $("photoViewer").innerHTML = (photos || []).map(function (src) { return '<img src="' + src + '" alt="첨부 사진"/>'; }).join("");
    $("photoOverlay").hidden = false;
  }
  function closePhotos() { $("photoOverlay").hidden = true; $("photoViewer").innerHTML = ""; }

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
      var ph = photosOf(t.id);
      var photo = ph.length ? '<button class="photo-btn" data-photo="' + t.id + '" aria-label="사진 보기">📷' + (ph.length > 1 ? '<sup>' + ph.length + '</sup>' : '') + '</button>' : '';
      return '<div class="tx-item ' + t.scope + '"><div class="tx-badge">' + icon + '</div><div class="tx-main"><div class="tx-cat">' + esc(t.category) + (t.memo ? ' · ' + esc(t.memo) : '') + rec + '</div><div class="tx-meta"><span class="scope-tag">' + scopeKo + '</span> · ' + t.date + '</div></div>' + photo + '<div class="tx-amt ' + t.type + '">' + sign + won(t.amount) + '</div><button class="tx-del" data-id="' + t.id + '" aria-label="삭제">×</button></div>';
    }).join("");
    box.querySelectorAll(".photo-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tx = state.transactions.filter(function (t) { return t.id === btn.dataset.photo; })[0];
        if (tx) openPhotos(photosOf(tx.id));
      });
    });
    box.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var delId = btn.dataset.id;
        var delTx = state.transactions.filter(function (t) { return t.id === delId; })[0];
        var msg = delTx && delTx.recurringId ? "이 거래를 삭제할까요?\n정기 거래 규칙도 함께 중지됩니다." : "이 거래를 삭제할까요?";
        if (!confirm(msg)) return;
        state.transactions = state.transactions.filter(function (t) { return t.id !== delId; });
        if (state.photos[delId]) { delete state.photos[delId]; savePhotos(); }
        if (delTx && delTx.recurringId) {
          state.recurring = state.recurring.filter(function (r) { return r.id !== delTx.recurringId; });
        }
        persist(); renderAll();
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
    var header = ["날짜", "구분", "유형", "카테고리", "금액", "메모", "사진"];
    var rows = list.map(function (t) {
      var pn = photosOf(t.id).length;
      var photo = pn ? "📷 " + pn + "장" : "";
      return [t.date, t.scope === "business" ? "사업" : "개인", t.type === "income" ? "수입" : "지출", t.category, t.amount, '"' + (t.memo || "").replace(/"/g, '""') + '"', photo].join(",");
    });
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
        persist(); refreshAssetCategoryOptions();
      });
    });
  }
  function renderAssets() {
    var totalA = 0, totalL = 0;
    state.assets.forEach(function (a) { if (a.kind === "liability") totalL += a.balance; else totalA += a.balance; });
    var net = totalA - totalL;
    $("assetKpi").innerHTML =
      '<div class="kpi-card income"><span class="kpi-label">총자산</span><strong class="kpi-value">' + wonCompact(totalA) + '</strong></div>' +
      '<div class="kpi-card expense"><span class="kpi-label">총부채</span><strong class="kpi-value">' + wonCompact(totalL) + '</strong></div>' +
      '<div class="kpi-card highlight"><span class="kpi-label">순자산</span><strong class="kpi-value">' + wonCompact(net) + '</strong><span class="kpi-sub">자산 − 부채</span></div>';

    var box = $("assetBreakdown"), sums = {};
    state.assets.forEach(function (a) { if (a.kind !== "liability") sums[a.category] = (sums[a.category] || 0) + a.balance; });
    var rows = Object.keys(sums).map(function (k) { return { name: k, amt: sums[k] }; }).sort(function (a, b) { return b.amt - a.amt; });
    if (!rows.length) { box.innerHTML = '<p class="empty">등록된 자산이 없습니다.</p>'; }
    else { var max = rows[0].amt; box.innerHTML = rows.map(function (r) { return '<div class="cat-row"><span class="cat-name">' + esc(r.name) + '</span><span class="cat-bar"><span style="width:' + (r.amt / max * 100) + '%"></span></span><span class="cat-amt">' + won(r.amt) + '</span></div>'; }).join(""); }

    var listBox = $("assetList");
    if (!state.assets.length) { listBox.innerHTML = '<p class="empty">아래에서 자산을 추가해 보세요.</p>'; return; }
    listBox.innerHTML = state.assets.map(function (a) {
      var icon = a.kind === "liability" ? "💳" : "💰";
      return '<div class="tx-item"><div class="tx-badge">' + icon + '</div><div class="tx-main"><div class="tx-cat">' + esc(a.name) + '</div><div class="tx-meta"><span class="scope-tag">' + esc(a.category) + '</span> · ' + (a.kind === "liability" ? "부채" : "자산") + '</div></div><div class="tx-amt ' + (a.kind === "liability" ? "expense" : "income") + '">' + won(a.balance) + '</div><button class="day-edit-btn" data-id="' + a.id + '" aria-label="수정">✏️</button><button class="tx-del" data-id="' + a.id + '" aria-label="삭제">×</button></div>';
    }).join("");
    listBox.querySelectorAll(".day-edit-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var a = state.assets.filter(function (x) { return x.id === btn.dataset.id; })[0];
        if (!a) return;
        assetEditId = a.id;
        document.querySelectorAll("#assetKindSeg .seg-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.kind === a.kind); });
        state.assetKind = a.kind;
        refreshAssetCategoryOptions();
        $("assetName").value = a.name;
        $("assetBalance").value = a.balance.toLocaleString("ko-KR");
        setTimeout(function () { $("assetCategory").value = a.category; }, 0);
        $("assetFormTitle").textContent = "자산 수정";
        $("assetAddBtn").textContent = "수정 저장";
        $("assetCancelBtn").hidden = false;
        $("assetName").scrollIntoView({ behavior: "smooth", block: "center" });
        $("assetName").focus();
      });
    });
    listBox.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 자산을 삭제할까요?")) return;
        state.assets = state.assets.filter(function (a) { return a.id !== btn.dataset.id; });
        if (assetEditId === btn.dataset.id) resetAssetForm();
        persist(); renderAssets();
      });
    });
  }
  function resetAssetForm() {
    assetEditId = null;
    $("assetName").value = ""; $("assetBalance").value = "";
    $("assetFormTitle").textContent = "자산 추가";
    $("assetAddBtn").textContent = "자산 추가";
    $("assetCancelBtn").hidden = true;
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
      if (arr.indexOf(name) === -1) { arr.push(name); persist(); refreshAssetCategoryOptions(); }
      $("assetCatAddInput").value = "";
    });
    $("assetBalance").addEventListener("input", function (e) { var raw = onlyNum(e.target.value); e.target.value = raw ? raw.toLocaleString("ko-KR") : ""; });
    $("assetAddBtn").addEventListener("click", function () {
      var name = $("assetName").value.trim(), bal = onlyNum($("assetBalance").value);
      if (!name) { alert("자산 이름을 입력해 주세요."); return; }
      if (!bal || bal <= 0) { alert("금액을 올바르게 입력해 주세요."); return; }
      if (assetEditId) {
        state.assets = state.assets.map(function (a) {
          if (a.id !== assetEditId) return a;
          return { id: a.id, name: name, category: $("assetCategory").value, balance: bal, kind: state.assetKind };
        });
        resetAssetForm();
      } else {
        state.assets.push({ id: uid(), name: name, category: $("assetCategory").value, balance: bal, kind: state.assetKind });
        $("assetName").value = ""; $("assetBalance").value = "";
      }
      persist(); renderAssets();
    });
    $("assetCancelBtn").addEventListener("click", resetAssetForm);
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
        persist(); renderRecurring();
      });
    });
  }

  /* ================= 월급 배분표 ================= */
  function renderSalaryBudget() {
    var sal = state.salary, panel = $("salaryBudgetPanel"), cardsBox = $("salaryCatCards");
    if (!panel || !cardsBox) return;
    var totalAllocated = 0;
    sal.cats.forEach(function (c) { c.items.forEach(function (it) { totalAllocated += it.amount; }); });
    var monthly = sal.monthly || 0, remaining = monthly - totalAllocated;

    if (monthly > 0) {
      var barSegs = sal.cats.map(function (c) {
        var ct = c.items.reduce(function (s, it) { return s + it.amount; }, 0);
        var pct = Math.min(100, ct / monthly * 100);
        return pct > 0 ? '<div class="sal-seg" style="flex:' + pct.toFixed(2) + ';background:' + c.color + '"></div>' : '';
      }).join("") + '<div class="sal-seg" style="flex:' + Math.max(0, (remaining / monthly * 100)).toFixed(2) + ';background:var(--surface-2)"></div>';
      var legendHtml = sal.cats.map(function (c) {
        var ct = c.items.reduce(function (s, it) { return s + it.amount; }, 0);
        if (!ct) return '';
        return '<span class="sal-leg"><i style="background:' + c.color + '"></i>' + esc(c.name) + ' ' + Math.round(ct / monthly * 100) + '%</span>';
      }).filter(Boolean).join("");
      var over = remaining < 0;
      panel.innerHTML =
        '<div class="sal-kpi-row">' +
          '<div class="sal-kpi"><div class="sal-kpi-label">배분 완료</div><div class="sal-kpi-val">' + won(totalAllocated) + '</div></div>' +
          '<div class="sal-kpi-divider"></div>' +
          '<div class="sal-kpi"><div class="sal-kpi-label">' + (over ? '초과' : '잔여') + '</div><div class="sal-kpi-val ' + (over ? 'expense' : 'income') + '">' + won(Math.abs(remaining)) + '</div></div>' +
        '</div>' +
        '<div class="sal-bar-wrap"><div class="sal-bar">' + barSegs + '</div></div>' +
        (legendHtml ? '<div class="sal-legend">' + legendHtml + '</div>' : '');
    } else {
      panel.innerHTML = '<p class="empty">월급을 입력하면 배분 현황이 보여요.</p>';
    }

    cardsBox.innerHTML = sal.cats.map(function (c, ci) {
      var ct = c.items.reduce(function (s, it) { return s + it.amount; }, 0);
      var pct = monthly > 0 ? Math.min(100, ct / monthly * 100) : 0;
      var itemsHtml = c.items.length
        ? '<div class="sal-items">' + c.items.map(function (it) {
            return '<div class="sal-item"><span class="sal-item-name">' + esc(it.name) + '</span><span class="sal-item-amt">' + won(it.amount) + '</span><button class="tx-del" data-ci="' + ci + '" data-id="' + it.id + '">×</button></div>';
          }).join("") + '</div>' : '';
      return '<div class="sal-card">' +
        '<div class="sal-card-head" style="border-left-color:' + c.color + '">' +
          '<div class="sal-title-row">' +
            '<span class="sal-emoji">' + c.emoji + '</span>' +
            '<span class="sal-name">' + esc(c.name) + '</span>' +
            (ct > 0 ? '<span class="sal-cat-total">' + won(ct) + '</span>' + (monthly > 0 ? '<span class="sal-cat-pct">' + Math.round(pct) + '%</span>' : '') : '') +
          '</div>' +
          '<div class="sal-progress"><div class="sal-progress-fill" style="width:' + pct.toFixed(1) + '%;background:' + c.color + '"></div></div>' +
        '</div>' +
        itemsHtml +
        '<div class="sal-add-row" data-ci="' + ci + '">' +
          '<input type="text" class="sal-add-name" placeholder="항목 이름" autocomplete="off" />' +
          '<input type="text" class="sal-add-amt" inputmode="numeric" placeholder="금액" autocomplete="off" />' +
          '<button class="sal-add-btn" data-ci="' + ci + '">＋</button>' +
        '</div>' +
      '</div>';
    }).join("");

    cardsBox.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ci = +btn.dataset.ci;
        state.salary.cats[ci].items = state.salary.cats[ci].items.filter(function (it) { return it.id !== btn.dataset.id; });
        persist(); renderSalaryBudget();
      });
    });
    cardsBox.querySelectorAll(".sal-add-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ci = +btn.dataset.ci, row = btn.parentNode;
        var nameInp = row.querySelector(".sal-add-name"), amtInp = row.querySelector(".sal-add-amt");
        var name = nameInp.value.trim(), amt = onlyNum(amtInp.value);
        if (!name || !amt) return;
        state.salary.cats[ci].items.push({ id: uid(), name: name, amount: amt });
        persist(); renderSalaryBudget();
      });
    });
    cardsBox.querySelectorAll(".sal-add-amt").forEach(function (inp) {
      inp.addEventListener("input", function () { var r = onlyNum(inp.value); inp.value = r ? r.toLocaleString("ko-KR") : ""; });
      inp.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var ci = +inp.parentNode.dataset.ci, row = inp.parentNode;
        var name = row.querySelector(".sal-add-name").value.trim(), amt = onlyNum(inp.value);
        if (!name || !amt) return;
        state.salary.cats[ci].items.push({ id: uid(), name: name, amount: amt });
        persist(); renderSalaryBudget();
      });
    });
    cardsBox.querySelectorAll(".sal-add-name").forEach(function (inp) {
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.parentNode.querySelector(".sal-add-amt").focus(); });
    });
  }
  function renderSalary() {
    var sal = state.salary;
    $("salaryMonthly").value = sal.monthly ? sal.monthly.toLocaleString("ko-KR") : "";
    renderSalaryBudget();
  }
  function setupSalary() {
    $("salaryMonthly").addEventListener("input", function (e) {
      var raw = onlyNum(e.target.value);
      e.target.value = raw ? raw.toLocaleString("ko-KR") : "";
      state.salary.monthly = raw || 0;
      persist(); renderSalaryBudget();
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
      btn.addEventListener("click", function () { state.month = new Date(state.pickerYear, +btn.dataset.m, 1); state.selectedDay = null; closePicker(); generateRecurring(); renderAll(); });
    });
  }

  /* ================= 일정 모달 ================= */
  function openSchedModal(date, sched) {
    schedState.editId = sched ? sched.id : null;
    schedState.color  = sched ? (sched.color || "blue") : "blue";
    schedState.scope  = sched ? (sched.scope || "personal") : "personal";
    $("schedTitle").value      = sched ? sched.title : "";
    $("schedDate").value       = date || todayStr();
    $("schedStartTime").value  = sched ? (sched.startTime || "") : "";
    $("schedEndTime").value    = sched ? (sched.endTime   || "") : "";
    $("schedMemo").value       = sched ? (sched.memo || "") : "";
    $("schedModalTitle").textContent = sched ? "일정 수정" : "일정 등록";
    $("schedDelete").hidden = !sched;
    $("schedMsg").textContent = "";
    document.querySelectorAll("#schedScopeSeg .seg-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.scope === schedState.scope); });
    document.querySelectorAll(".sched-color-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.color === schedState.color); });
    $("schedOverlay").hidden = false;
  }
  function closeSchedModal() { $("schedOverlay").hidden = true; }
  function setupSchedModal() {
    $("schedClose").addEventListener("click", closeSchedModal);
    $("schedOverlay").addEventListener("click", function (e) { if (e.target === $("schedOverlay")) closeSchedModal(); });
    document.querySelectorAll("#schedScopeSeg .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        schedState.scope = btn.dataset.scope;
        document.querySelectorAll("#schedScopeSeg .seg-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.scope === schedState.scope); });
      });
    });
    document.querySelectorAll(".sched-color-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        schedState.color = btn.dataset.color;
        document.querySelectorAll(".sched-color-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.color === schedState.color); });
      });
    });
    $("schedForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var title = $("schedTitle").value.trim();
      if (!title) { $("schedMsg").textContent = "제목을 입력해 주세요."; $("schedMsg").className = "form-msg err"; return; }
      var obj = { scope: schedState.scope, date: $("schedDate").value || todayStr(), title: title, startTime: $("schedStartTime").value, endTime: $("schedEndTime").value, memo: $("schedMemo").value.trim(), color: schedState.color };
      if (schedState.editId) {
        state.schedules = state.schedules.map(function (s) { return s.id === schedState.editId ? Object.assign({}, s, obj) : s; });
      } else {
        state.schedules.push(Object.assign({ id: uid() }, obj));
      }
      persist(); closeSchedModal(); renderCalendar(state.dashScope); renderDayDetail(state.dashScope);
    });
    $("schedDelete").addEventListener("click", function () {
      if (!confirm("이 일정을 삭제할까요?")) return;
      state.schedules = state.schedules.filter(function (s) { return s.id !== schedState.editId; });
      persist(); closeSchedModal(); renderCalendar(state.dashScope); renderDayDetail(state.dashScope);
    });
  }

  /* ================= 메뉴 드로어 ================= */
  function setupMenu() {
    $("menuBtn").addEventListener("click", function () { state.menuOpen = true; $("menuOverlay").hidden = false; updateFab(); });
    $("menuOverlay").addEventListener("click", function (e) { if (e.target === $("menuOverlay")) { state.menuOpen = false; $("menuOverlay").hidden = true; updateFab(); } });
    document.querySelectorAll(".menu-item").forEach(function (item) {
      if (item.id === "logoutBtn") return; // 로그아웃은 별도 처리(setupAuth)
      item.addEventListener("click", function () {
        state.menuOpen = false; $("menuOverlay").hidden = true; updateFab();
        if (item.dataset.view === "add") {
          openInputDirect();
        } else if (item.dataset.view === "sched") {
          openSchedModal(todayStr(), null);
        } else {
          switchView(item.dataset.view);
        }
      });
    });
  }

  /* ================= Firebase 로그인 ================= */
  var firebaseConfig = {
    apiKey: "AIzaSyDPyTmu6FX6lx_QqL_yL4dGUfMDhjTLwQg",
    authDomain: "hansohn-app.firebaseapp.com",
    projectId: "hansohn-app",
    storageBucket: "hansohn-app.firebasestorage.app",
    messagingSenderId: "998852560556",
    appId: "1:998852560556:web:0da3e041651879321bc109",
    measurementId: "G-PZ8YJGR281"
  };
  var auth = null;

  function showLogin() { $("loginScreen").hidden = false; }
  function hideLogin() { $("loginScreen").hidden = true; }
  function renderMenuUser(user) {
    if (!user) { $("menuUser").innerHTML = ""; return; }
    var name = user.displayName || "사용자", email = user.email || "";
    var avatar = user.photoURL
      ? '<img src="' + user.photoURL + '" alt="프로필"/>'
      : '<span class="menu-avatar-fb">' + esc(name.slice(0, 1)) + '</span>';
    $("menuUser").innerHTML =
      '<div class="menu-avatar">' + avatar + '</div>' +
      '<div class="menu-user-info"><strong>' + esc(name) + '</strong><span>' + esc(email) + '</span></div>';
  }
  function setupAuth() {
    // 로컬 파일(file://)로 열었거나 Firebase 미로딩 시 → 로그인 없이 미리보기 모드
    if (typeof firebase === "undefined" || location.protocol === "file:") { hideLogin(); return false; }
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    $("googleLoginBtn").addEventListener("click", function () {
      auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
        .catch(function (e) { alert("로그인에 실패했습니다.\n" + (e && e.message ? e.message : "")); });
    });
    $("logoutBtn").addEventListener("click", function () {
      state.menuOpen = false; $("menuOverlay").hidden = true; updateFab();
      auth.signOut();
    });
    auth.onAuthStateChanged(function (user) {
      if (user) {
        state.cloudMode = true;
        udoc = db.collection("users").doc(user.uid);
        renderMenuUser(user); hideLogin();
        loadCloud();
      } else {
        state.cloudMode = false; udoc = null;
        renderMenuUser(null); showLogin();
      }
    });
    return true;
  }

  // 로그인한 사용자의 데이터를 클라우드에서 불러오기
  function loadCloud() {
    udoc.get().then(function (snap) {
      if (snap.exists) {
        var d = snap.data();
        state.transactions    = d.transactions    || [];
        state.categories      = d.categories       || JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
        state.recurring       = d.recurring        || [];
        state.assets          = d.assets           || [];
        state.assetCategories = d.assetCategories  || JSON.parse(JSON.stringify(DEFAULT_ASSET_CATS));
        state.schedules       = d.schedules        || [];
        state.salary          = d.salary           || JSON.parse(JSON.stringify(DEFAULT_SALARY));
      } else {
        // 처음 로그인한 새 사용자: 빈 상태로 시작 (테스트 데이터 없음)
        state.transactions = [];
        state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
        state.recurring = [];
        state.assets = [];
        state.assetCategories = JSON.parse(JSON.stringify(DEFAULT_ASSET_CATS));
        state.schedules = [];
        state.salary = JSON.parse(JSON.stringify(DEFAULT_SALARY));
        persist();
      }
      state.selectedDay = null;
      generateRecurring();        // 밀린 정기거래 채우기
      refreshCategoryOptions();
      refreshAssetCategoryOptions();
      renderAll();
    }).catch(function (e) {
      alert("데이터를 불러오지 못했습니다.\n" + (e && e.message ? e.message : ""));
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

  function hideSplash() {
    var splash = $("splashScreen");
    if (!splash) return;
    splash.classList.add("splash-hide");
    setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 520);
  }

  function init() {
    // 2.2초 뒤 스플래시 페이드 아웃
    setTimeout(hideSplash, 2200);
    document.querySelectorAll(".tab").forEach(function (t) { t.addEventListener("click", function () { switchView(t.dataset.view); }); });
    $("prevMonth").addEventListener("click", function () { changeMonth(-1); });
    $("nextMonth").addEventListener("click", function () { changeMonth(1); });
    setupForm(); setupListControls(); setupDashToggle(); setupPicker(); setupMenu(); setupAssets(); setupSchedModal(); setupSalary();
    $("fab").addEventListener("click", openInput);
    // 입력 모드 토글 (거래 / 일정)
    document.querySelectorAll("#inputModeSeg .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { switchInputMode(btn.dataset.imode); });
    });
    // 인라인 일정 구분 (사업/개인) 토글
    document.querySelectorAll("#inSchedScopeSeg .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        inSchedScope = btn.dataset.scope;
        document.querySelectorAll("#inSchedScopeSeg .seg-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
      });
    });
    // 인라인 일정 색상 선택
    document.querySelectorAll("#inSchedColors .sched-color-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        inSchedColor = btn.dataset.color;
        document.querySelectorAll("#inSchedColors .sched-color-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
      });
    });
    // 인라인 일정 저장
    $("inlineSchedForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var title = $("inSchedTitle").value.trim();
      if (!title) { $("inSchedMsg").textContent = "일정 제목을 입력해주세요."; return; }
      var obj = { title: title, scope: inSchedScope, date: $("inSchedDate").value || todayStr(), startTime: $("inSchedStartTime").value, endTime: $("inSchedEndTime").value, memo: $("inSchedMemo").value.trim(), color: inSchedColor };
      if (inSchedEditId) {
        var found = false;
        for (var i = 0; i < state.schedules.length; i++) {
          if (state.schedules[i].id === inSchedEditId) { state.schedules[i] = Object.assign({ id: inSchedEditId }, obj); found = true; break; }
        }
        if (!found) state.schedules.push(Object.assign({ id: uid() }, obj));
        inSchedEditId = null;
        $("inSchedDelete").hidden = true;
      } else {
        state.schedules.push(Object.assign({ id: uid() }, obj));
      }
      persist(); closeInput(); renderCalendar(state.dashScope); renderDayDetail(state.dashScope);
    });
    $("inSchedDelete").addEventListener("click", function () {
      if (!confirm("이 일정을 삭제할까요?")) return;
      state.schedules = state.schedules.filter(function (s) { return s.id !== inSchedEditId; });
      inSchedEditId = null;
      persist(); closeInput(); renderCalendar(state.dashScope); renderDayDetail(state.dashScope);
    });
    $("inputClose").addEventListener("click", function () { closeInput(); });
    $("inputOverlay").addEventListener("click", function (e) { if (e.target === $("inputOverlay")) closeInput(); });
    setupPhotoInput();
    $("photoClose").addEventListener("click", closePhotos);
    $("photoOverlay").addEventListener("click", function (e) { if (e.target === $("photoOverlay")) closePhotos(); });
    updateFab();

    var cloud = setupAuth();
    if (!cloud) {
      // 로컬 미리보기 모드: 브라우저에 저장된 데이터로 바로 표시
      generateRecurring();
      refreshCategoryOptions();
      renderAll();
    }
    // 클라우드 모드일 때는 로그인 후 loadCloud()에서 데이터를 불러와 렌더합니다.
  }
  document.addEventListener("DOMContentLoaded", init);

  /* ================= 금융 계산기 ================= */
  var _fcReady = false;
  function renderFinCalc() {
    if (_fcReady) return;
    _fcReady = true;
    // 탭 전환
    document.querySelectorAll(".fc-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".fc-tab").forEach(function (t) { t.classList.remove("active"); });
        document.querySelectorAll(".fc-panel").forEach(function (p) { p.hidden = true; });
        tab.classList.add("active");
        var panel = document.getElementById("fc-" + tab.dataset.calc);
        if (panel) panel.hidden = false;
      });
    });
    // 소형 세그먼트 (년/월, 단리/월복리)
    fcSetupSeg("dep-period-seg", function (btn) {
      var lbl = document.getElementById("dep-period-lbl");
      if (lbl) lbl.textContent = btn.dataset.unit === "year" ? "년" : "개월";
    });
    fcSetupSeg("sav-period-seg", function (btn) {
      var lbl = document.getElementById("sav-period-lbl");
      if (lbl) lbl.textContent = btn.dataset.unit === "year" ? "년" : "개월";
    });
    fcSetupSeg("loan-period-seg", function (btn) {
      var lbl = document.getElementById("loan-period-lbl");
      if (lbl) lbl.textContent = btn.dataset.unit === "year" ? "년" : "개월";
    });
    fcSetupSeg("dep-type-seg");
    fcSetupSeg("sav-type-seg");
    fcSetupSeg("dep-tax-seg");
    fcSetupSeg("sav-tax-seg");
    fcSetupSeg("loan-method-seg");
    // 금액 입력 → 천단위 콤마
    ["dep-amount", "sav-amount", "loan-amount", "pre-amount"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        var raw = el.value.replace(/[^0-9]/g, "");
        var cur = el.selectionStart, prevLen = el.value.length;
        el.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
        el.selectionStart = el.selectionEnd = cur + (el.value.length - prevLen);
      });
    });
    // 계산 버튼
    document.getElementById("dep-calc").addEventListener("click", fcCalcDeposit);
    document.getElementById("sav-calc").addEventListener("click", fcCalcSaving);
    document.getElementById("loan-calc").addEventListener("click", fcCalcLoan);
    document.getElementById("pre-calc").addEventListener("click", fcCalcPrepay);
    // 초기화 버튼
    document.querySelectorAll(".fc-btn-reset").forEach(function (btn) {
      btn.addEventListener("click", function () { fcReset(btn.dataset.panel); });
    });
  }
  function fcSetupSeg(id, onChange) {
    var seg = document.getElementById(id);
    if (!seg) return;
    seg.querySelectorAll(".fc-seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        seg.querySelectorAll(".fc-seg-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        if (onChange) onChange(btn);
      });
    });
  }
  function fcSegVal(id, attr) {
    var seg = document.getElementById(id);
    if (!seg) return null;
    var active = seg.querySelector(".fc-seg-btn.active");
    return active ? active.dataset[attr] : null;
  }
  function fcAmt(id) { var el = document.getElementById(id); return parseInt(el ? (el.value.replace(/[^0-9]/g, "") || "0") : "0", 10); }
  function fcNum(id) { return parseFloat((document.getElementById(id) || {}).value || "0") || 0; }
  function fcReset(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    panel.querySelectorAll("input").forEach(function (inp) { inp.value = ""; });
    panel.querySelectorAll(".fc-seg-sm, .fc-seg-full").forEach(function (seg) {
      seg.querySelectorAll(".fc-seg-btn").forEach(function (b, i) { b.classList.toggle("active", i === 0); });
    });
    var labels = { "dep-period-lbl": "년", "sav-period-lbl": "년", "loan-period-lbl": "년" };
    Object.keys(labels).forEach(function (k) { var el = document.getElementById(k); if (el) el.textContent = labels[k]; });
    var res = panel.querySelector(".fc-result");
    if (res) res.hidden = true;
  }
  function fcShowResult(id, rows) {
    var box = document.getElementById(id);
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<div class="fc-result-grid">' + rows.map(function (r) {
      var cls = r.cls === "highlight" ? " fc-res-highlight" : r.cls === "income" ? " fc-res-income" : r.cls === "expense" ? " fc-res-expense" : r.cls === "muted" ? " fc-res-muted" : "";
      return '<div class="fc-res-row"><span class="fc-res-label">' + r.label + '</span><span class="fc-res-value' + cls + '">' + r.value + '</span></div>';
    }).join("") + '</div>';
  }
  function fcShowError(id, msg) {
    var box = document.getElementById(id);
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<p class="fc-error">' + msg + '</p>';
  }
  // ── 예금 계산 ──
  function fcCalcDeposit() {
    var p = fcAmt("dep-amount"), period = fcNum("dep-period"), rate = fcNum("dep-rate") / 100;
    if (!p || !period || !rate) { fcShowError("dep-result", "금액, 기간, 이자율을 모두 입력해 주세요."); return; }
    var unit = fcSegVal("dep-period-seg", "unit") || "year";
    var rtype = fcSegVal("dep-type-seg", "rtype") || "simple";
    var taxRate = parseFloat(fcSegVal("dep-tax-seg", "tax") || "0.154");
    var months = unit === "year" ? period * 12 : period;
    var years = months / 12;
    var interest;
    if (rtype === "simple") {
      interest = Math.round(p * rate * years);
    } else {
      var mr = rate / 12;
      interest = Math.round(p * Math.pow(1 + mr, months)) - p;
    }
    var taxAmt = Math.round(interest * taxRate);
    var netInterest = interest - taxAmt;
    fcShowResult("dep-result", [
      { label: "예치금액", value: won(p) },
      { label: "세전이자", value: won(interest), cls: "income" },
      { label: "이자과세 (" + (taxRate * 100).toFixed(1) + "%)", value: taxAmt ? "-" + won(taxAmt) : "₩0", cls: taxAmt ? "expense" : "" },
      { label: "세후이자", value: won(netInterest), cls: "income" },
      { label: "만기수령액", value: won(p + netInterest), cls: "highlight" }
    ]);
  }
  // ── 적금 계산 ──
  function fcCalcSaving() {
    var monthly = fcAmt("sav-amount"), period = fcNum("sav-period"), rate = fcNum("sav-rate") / 100;
    if (!monthly || !period || !rate) { fcShowError("sav-result", "금액, 기간, 이자율을 모두 입력해 주세요."); return; }
    var unit = fcSegVal("sav-period-seg", "unit") || "year";
    var rtype = fcSegVal("sav-type-seg", "rtype") || "simple";
    var taxRate = parseFloat(fcSegVal("sav-tax-seg", "tax") || "0.154");
    var n = Math.round(unit === "year" ? period * 12 : period);
    var principal = monthly * n;
    var interest;
    if (rtype === "simple") {
      // 단리: 각 납입액이 각각 다른 기간동안 이자 적립
      interest = Math.round(monthly * (rate / 12) * (n * (n + 1) / 2));
    } else {
      var mr = rate / 12;
      var maturity = Math.round(monthly * (Math.pow(1 + mr, n) - 1) / mr * (1 + mr));
      interest = maturity - principal;
    }
    var taxAmt = Math.round(interest * taxRate);
    var netInterest = interest - taxAmt;
    fcShowResult("sav-result", [
      { label: "납입원금", value: won(principal) },
      { label: "세전이자", value: won(interest), cls: "income" },
      { label: "이자과세 (" + (taxRate * 100).toFixed(1) + "%)", value: taxAmt ? "-" + won(taxAmt) : "₩0", cls: taxAmt ? "expense" : "" },
      { label: "세후이자", value: won(netInterest), cls: "income" },
      { label: "만기수령액", value: won(principal + netInterest), cls: "highlight" }
    ]);
  }
  // ── 대출 계산 ──
  function fcCalcLoan() {
    var p = fcAmt("loan-amount"), period = fcNum("loan-period"), rate = fcNum("loan-rate") / 100;
    if (!p || !period || !rate) { fcShowError("loan-result", "금액, 기간, 금리를 모두 입력해 주세요."); return; }
    var unit = fcSegVal("loan-period-seg", "unit") || "year";
    var method = fcSegVal("loan-method-seg", "method") || "equal-payment";
    var n = Math.round(unit === "year" ? period * 12 : period);
    var mr = rate / 12;
    if (method === "equal-payment") {
      // 원리금균등
      var mp = Math.round(p * mr * Math.pow(1 + mr, n) / (Math.pow(1 + mr, n) - 1));
      var total = mp * n;
      fcShowResult("loan-result", [
        { label: "대출금액", value: won(p) },
        { label: "월 상환액", value: won(mp) },
        { label: "총 상환금액", value: won(total) },
        { label: "총 이자", value: won(total - p), cls: "expense" }
      ]);
    } else if (method === "equal-principal") {
      // 원금균등
      var mprincipal = Math.round(p / n);
      var firstPayment = mprincipal + Math.round(p * mr);
      var lastPayment = mprincipal + Math.round((p - mprincipal * (n - 1)) * mr);
      var totalInterest = Math.round(p * mr * (n + 1) / 2);
      fcShowResult("loan-result", [
        { label: "대출금액", value: won(p) },
        { label: "첫 달 상환액", value: won(firstPayment) },
        { label: "마지막 달 상환액", value: won(lastPayment) },
        { label: "총 상환금액", value: won(p + totalInterest) },
        { label: "총 이자", value: won(totalInterest), cls: "expense" }
      ]);
    } else {
      // 만기일시
      var monthlyInterest = Math.round(p * mr);
      var totalInterestBullet = Math.round(p * rate * (n / 12));
      fcShowResult("loan-result", [
        { label: "대출금액", value: won(p) },
        { label: "매월 이자", value: won(monthlyInterest) },
        { label: "만기 원금 상환", value: won(p) },
        { label: "총 이자", value: won(totalInterestBullet), cls: "expense" },
        { label: "총 납부액", value: won(p + totalInterestBullet), cls: "highlight" }
      ]);
    }
  }
  // ── 중도상환수수료 계산 ──
  function fcCalcPrepay() {
    var amount = fcAmt("pre-amount"), feeRate = fcNum("pre-rate") / 100;
    var startStr = (document.getElementById("pre-start") || {}).value;
    var repayStr = (document.getElementById("pre-repay") || {}).value;
    var endStr = (document.getElementById("pre-end") || {}).value;
    var exemptYears = fcNum("pre-exempt");
    if (!amount || !feeRate || !startStr || !repayStr || !endStr) {
      fcShowError("pre-result", "모든 항목을 입력해 주세요."); return;
    }
    var startD = new Date(startStr), repayD = new Date(repayStr), endD = new Date(endStr);
    if (repayD <= startD || endD <= repayD) {
      fcShowError("pre-result", "날짜 순서를 확인해 주세요. (대출일 < 상환일 < 상환기일)"); return;
    }
    var MS = 1000 * 3600 * 24;
    var totalDays = Math.round((endD - startD) / MS);
    var elapsedDays = Math.round((repayD - startD) / MS);
    var remainDays = totalDays - elapsedDays;
    // 면제기간 확인
    if (exemptYears > 0 && elapsedDays <= Math.round(exemptYears * 365)) {
      fcShowResult("pre-result", [
        { label: "상환금액", value: won(amount) },
        { label: "경과일수", value: elapsedDays + "일" },
        { label: "면제기간", value: exemptYears + "년 이내" },
        { label: "중도상환수수료", value: "₩0", cls: "income" }
      ]);
      return;
    }
    var fee = Math.round(amount * feeRate * (remainDays / totalDays));
    fcShowResult("pre-result", [
      { label: "상환금액", value: won(amount) },
      { label: "잔여일수", value: remainDays + "일" },
      { label: "총 대출기간", value: totalDays + "일" },
      { label: "중도상환수수료", value: won(fee), cls: "expense" }
    ]);
  }

})();

