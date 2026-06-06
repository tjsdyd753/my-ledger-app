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

  // ▼ 세율 등 수치는 여기서 한 번에 수정하세요 ▼
  var VAT_RATE = 0.1;   // 부가가치세율 (10%)

  // 일정 색상 (네이버 캘린더처럼 색으로 구분)
  var SCHEDULE_COLORS = ["#3182F6", "#F04452", "#2D9D78", "#7C5CFC", "#F59E0B", "#EC4899"];

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
    photos: load(PHOTO_KEY, {}),       // { 거래id: [사진 데이터,...] } — 기기 로컬
    schedules: load(SCHED_KEY, []),    // 일정 [{id,date,time,title,memo,color}]
    month: new Date(),
    form: { scope: "business", type: "expense", repeat: "once", photos: [] },
    listFilter: "all",
    dashScope: "business",
    selectedDay: null,
    schedSelectedDay: null,
    schedColor: SCHEDULE_COLORS[0],
    schedScope: "business",
    schedFilter: "all",
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
        schedules: state.schedules
      }).catch(function (e) { console.warn("동기화 실패:", e); });
    } else {
      save(TX_KEY, state.transactions); save(CAT_KEY, state.categories);
      save(REC_KEY, state.recurring); save(AST_KEY, state.assets);
      save(ACAT_KEY, state.assetCategories); save(SCHED_KEY, state.schedules);
    }
  }
  // 사진은 항상 기기 로컬에만 저장
  function savePhotos() { save(PHOTO_KEY, state.photos); }
  function photosOf(id) { return state.photos[id] || []; }

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
    if (name === "schedule") renderSchedule();
    if (name === "vat") renderVat();
    updateFab();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  // 입력 화면이거나 메뉴가 열려 있으면 입력 버튼을 숨깁니다
  function updateFab() {
    $("fab").hidden = state.menuOpen || state.inputOpen;
  }
  // 입력 팝업 열기/닫기
  function openInput() {
    resetInputForm();
    state.inputOpen = true; $("inputOverlay").hidden = false; updateFab();
  }
  function closeInput() {
    state.inputOpen = false; $("inputOverlay").hidden = true; updateFab();
  }
  function resetInputForm() {
    $("txAmount").value = ""; $("txMemo").value = "";
    $("txDate").value = todayStr();
    state.form.photos = []; renderPhotoPreview();
    $("formMsg").textContent = "";
    // 반복은 항상 '한 번'으로 초기화
    state.form.repeat = "once";
    document.querySelectorAll(".rep-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.repeat === "once"); });
    var ed = $("catEditor"); if (ed) { ed.hidden = true; $("catEditToggle").textContent = "＋ 카테고리 추가·삭제"; }
  }

  /* ================= 월 이동 ================= */
  function changeMonth(delta) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
    state.selectedDay = null;
    state.schedSelectedDay = null;
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
    var byDay = {}, schedDay = {};
    state.transactions.forEach(function (t) {
      if (t.scope === scope && inMonth(t, state.month)) {
        var day = +t.date.slice(8, 10); if (!byDay[day]) byDay[day] = { inc: 0, exp: 0 };
        if (t.type === "income") byDay[day].inc += t.amount; else byDay[day].exp += t.amount;
      }
    });
    state.schedules.forEach(function (s) {
      if ((s.scope || "business") === scope && s.date.slice(0, 7) === ymKey(state.month)) schedDay[+s.date.slice(8, 10)] = true;
    });
    var today = new Date(), isThisMonth = today.getFullYear() === y && today.getMonth() === m, html = "";
    for (var b = 0; b < firstWeekday; b++) html += '<span class="cal-cell empty-cell"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = dKey(y, m, day), info = byDay[day], wd = new Date(y, m, day).getDay(), cls = "cal-cell";
      if (wd === 0) cls += " sun"; if (wd === 6) cls += " sat";
      if (isThisMonth && today.getDate() === day) cls += " today";
      if (state.selectedDay === key) cls += " selected";
      var dots = "";
      if (info) { if (info.inc > 0) dots += '<i class="cd income"></i>'; if (info.exp > 0) dots += '<i class="cd expense"></i>'; }
      if (schedDay[day]) dots += '<i class="cd sched"></i>';
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
    var dayLabel = state.selectedDay.slice(5).replace("-", "월 ") + "일";
    var txList = state.transactions.filter(function (t) { return t.scope === scope && t.date === state.selectedDay; }).sort(function (a, b) { return b.id.localeCompare(a.id); });
    var schedList = state.schedules.filter(function (s) { return (s.scope || "business") === scope && s.date === state.selectedDay; })
      .sort(function (a, b) { return (a.time || "99").localeCompare(b.time || "99"); });

    var html = '<div class="day-detail-head">' + dayLabel + '</div>';

    // 거래
    html += '<div class="day-sub">거래</div>';
    if (!txList.length) {
      html += '<p class="day-hint">기록된 거래가 없어요.</p>';
    } else {
      html += txList.map(function (t) {
        var sign = t.type === "income" ? "+" : "-";
        var ph = photosOf(t.id);
        var photo = ph.length ? '<button class="photo-btn" data-photo="' + t.id + '" aria-label="사진 보기">📷</button>' : '';
        return '<div class="day-row"><span class="day-cat">' + esc(t.category) + (t.memo ? ' · ' + esc(t.memo) : '') + '</span>' + photo + '<span class="tx-amt ' + t.type + '">' + sign + won(t.amount) + '</span><button class="tx-del" data-id="' + t.id + '" aria-label="삭제">×</button></div>';
      }).join("");
    }

    // 일정
    html += '<div class="day-sub">일정</div>';
    if (!schedList.length) {
      html += '<p class="day-hint">등록된 일정이 없어요.</p>';
    } else {
      html += schedList.map(function (s) {
        return '<div class="day-row"><span class="sched-bar" style="background:' + s.color + '"></span><span class="day-cat">' + (s.time ? '<b>' + s.time + '</b> ' : '') + esc(s.title) + (s.memo ? ' · ' + esc(s.memo) : '') + '</span></div>';
      }).join("");
    }

    box.innerHTML = html;

    box.querySelectorAll(".photo-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tx = state.transactions.filter(function (t) { return t.id === btn.dataset.photo; })[0];
        if (tx) openPhotos(photosOf(tx.id));
      });
    });
    box.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 거래를 삭제할까요?")) return;
        state.transactions = state.transactions.filter(function (t) { return t.id !== btn.dataset.id; });
        if (state.photos[btn.dataset.id]) { delete state.photos[btn.dataset.id]; savePhotos(); }
        persist(); renderAll();
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
        if (state.form.repeat === "once") {
          var tx = Object.assign({ id: uid(), date: date }, base);
          state.transactions.push(tx);
          persist();
          if (photos.length) { state.photos[tx.id] = photos; savePhotos(); }
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
    if (!box) return; // 사진 기능 비활성화 시
    box.innerHTML = state.form.photos.map(function (src, i) {
      return '<span class="photo-thumb"><img src="' + src + '" alt="첨부 사진"/><button type="button" class="photo-thumb-del" data-i="' + i + '" aria-label="삭제">✕</button></span>';
    }).join("");
    box.querySelectorAll(".photo-thumb-del").forEach(function (btn) {
      btn.addEventListener("click", function () { state.form.photos.splice(+btn.dataset.i, 1); renderPhotoPreview(); });
    });
  }
  function setupPhotoInput() {
    if (!$("txPhoto")) return; // 사진 기능 비활성화 시
    $("txPhoto").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      var jobs = files.map(function (f) { return resizeImage(f); });
      Promise.all(jobs).then(function (urls) {
        urls.forEach(function (u) { state.form.photos.push(u); });
        renderPhotoPreview();
      }).catch(function () { alert("사진을 불러오지 못했습니다."); });
      e.target.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
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
        if (!confirm("이 거래를 삭제할까요?")) return;
        state.transactions = state.transactions.filter(function (t) { return t.id !== btn.dataset.id; });
        if (state.photos[btn.dataset.id]) { delete state.photos[btn.dataset.id]; savePhotos(); }
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
        persist(); renderAssets();
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
      if (arr.indexOf(name) === -1) { arr.push(name); persist(); refreshAssetCategoryOptions(); }
      $("assetCatAddInput").value = "";
    });
    $("assetBalance").addEventListener("input", function (e) { var raw = onlyNum(e.target.value); e.target.value = raw ? raw.toLocaleString("ko-KR") : ""; });
    $("assetAddBtn").addEventListener("click", function () {
      var name = $("assetName").value.trim(), bal = onlyNum($("assetBalance").value);
      if (!name) { alert("자산 이름을 입력해 주세요."); return; }
      if (!bal || bal <= 0) { alert("금액을 올바르게 입력해 주세요."); return; }
      state.assets.push({ id: uid(), name: name, category: $("assetCategory").value, balance: bal, kind: state.assetKind });
      persist();
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
        persist(); renderRecurring();
      });
    });
  }

  /* ================= 부가세 계산기 ================= */
  function setupVat() {
    $("vatRateLabel").textContent = Math.round(VAT_RATE * 100);
    document.querySelectorAll("#vatModeSeg .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("#vatModeSeg .seg-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active"); renderVat();
      });
    });
    $("vatInput").addEventListener("input", function (e) {
      var raw = onlyNum(e.target.value); e.target.value = raw ? raw.toLocaleString("ko-KR") : "";
      renderVat();
    });
  }
  function renderVat() {
    var amount = onlyNum($("vatInput").value);
    var modeBtn = document.querySelector("#vatModeSeg .seg-btn.active");
    var mode = modeBtn ? modeBtn.dataset.vmode : "inclusive";
    var supply, tax, total;
    if (mode === "inclusive") {       // 입력값이 부가세가 포함된 금액
      supply = amount / (1 + VAT_RATE);
      tax = amount - supply;
      total = amount;
    } else {                          // 입력값이 공급가액(부가세 별도)
      supply = amount;
      tax = amount * VAT_RATE;
      total = amount + tax;
    }
    $("vatSupply").textContent = won(supply);
    $("vatTax").textContent = won(tax);
    $("vatTotal").textContent = won(total);
    renderVatAuto();
  }
  // 이번 달 사업 거래에서 부가세 자동 집계 (입력액=부가세 포함 금액으로 간주)
  function renderVatAuto() {
    var sales = 0, buy = 0;
    state.transactions.forEach(function (t) {
      if (t.scope === "business" && inMonth(t, state.month)) {
        if (t.type === "income") sales += t.amount; else buy += t.amount;
      }
    });
    var factor = VAT_RATE / (1 + VAT_RATE);   // 포함액에서 부가세 추출 비율 (10% → 1/11)
    var salesTax = sales * factor, buyTax = buy * factor;
    $("vatAutoMonth").textContent = (state.month.getMonth() + 1) + "월";
    $("vatSalesTotal").textContent = won(sales);
    $("vatSalesTax").textContent = won(salesTax);
    $("vatBuyTotal").textContent = won(buy);
    $("vatBuyTax").textContent = won(buyTax);
    $("vatPayable").textContent = won(salesTax - buyTax);
  }

  /* ================= 일정 (네이버 캘린더 스타일) ================= */
  function schedVisible(s) { return state.schedFilter === "all" || (s.scope || "business") === state.schedFilter; }

  function setupSchedule() {
    // 색상 선택 팔레트
    $("schedColors").innerHTML = SCHEDULE_COLORS.map(function (c) {
      return '<button type="button" class="sched-color" data-c="' + c + '" style="background:' + c + '"></button>';
    }).join("");
    function markColor() {
      $("schedColors").querySelectorAll(".sched-color").forEach(function (b) {
        b.classList.toggle("active", b.dataset.c === state.schedColor);
      });
    }
    $("schedColors").querySelectorAll(".sched-color").forEach(function (b) {
      b.addEventListener("click", function () { state.schedColor = b.dataset.c; markColor(); });
    });
    markColor();

    // 사업/개인 구분 토글
    document.querySelectorAll("#schedScopeSeg .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("#schedScopeSeg .seg-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active"); state.schedScope = btn.dataset.sscope;
      });
    });
    // 전체/사업/개인 필터
    document.querySelectorAll("#schedFilterBar .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#schedFilterBar .chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active"); state.schedFilter = chip.dataset.sfilter;
        renderSchedule();
      });
    });

    $("schedAddBtn").addEventListener("click", function () {
      var title = $("schedTitle").value.trim();
      if (!title) { alert("일정 제목을 입력해 주세요."); return; }
      var date = $("schedDate").value || state.schedSelectedDay || todayStr();
      state.schedules.push({
        id: uid(), date: date, time: $("schedTime").value || "", scope: state.schedScope,
        title: title, memo: $("schedMemo").value.trim(), color: state.schedColor
      });
      persist();
      $("schedTitle").value = ""; $("schedTime").value = ""; $("schedMemo").value = "";
      state.schedSelectedDay = date;
      renderSchedule();
    });
  }
  function renderSchedule() {
    $("schedMonthLabel").textContent = (state.month.getMonth() + 1) + "월";
    renderSchedCalendar();
    renderSchedDay();
  }
  function renderSchedCalendar() {
    var grid = $("schedCalGrid"), y = state.month.getFullYear(), m = state.month.getMonth();
    var firstWeekday = new Date(y, m, 1).getDay(), daysInMonth = new Date(y, m + 1, 0).getDate();
    var byDay = {};
    state.schedules.forEach(function (s) {
      if (schedVisible(s) && s.date.slice(0, 7) === ymKey(state.month)) {
        var day = +s.date.slice(8, 10); (byDay[day] = byDay[day] || []).push(s);
      }
    });
    var today = new Date(), isThisMonth = today.getFullYear() === y && today.getMonth() === m, html = "";
    for (var b = 0; b < firstWeekday; b++) html += '<span class="cal-cell empty-cell"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = dKey(y, m, day), evs = byDay[day], wd = new Date(y, m, day).getDay(), cls = "cal-cell";
      if (wd === 0) cls += " sun"; if (wd === 6) cls += " sat";
      if (isThisMonth && today.getDate() === day) cls += " today";
      if (state.schedSelectedDay === key) cls += " selected";
      var dots = "";
      if (evs) evs.slice(0, 3).forEach(function (e) { dots += '<i class="cd" style="background:' + e.color + '"></i>'; });
      html += '<button class="' + cls + '" data-date="' + key + '"><span class="cal-day">' + day + '</span><span class="cal-dots">' + dots + '</span></button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".cal-cell[data-date]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        state.schedSelectedDay = cell.dataset.date;
        $("schedDate").value = cell.dataset.date;
        renderSchedCalendar(); renderSchedDay();
      });
    });
  }
  function renderSchedDay() {
    var listBox = $("schedDayList");
    if (!state.schedSelectedDay) { $("schedDayTitle").textContent = "날짜를 선택하세요"; listBox.innerHTML = '<p class="day-hint">달력에서 날짜를 누르면 그 날의 일정이 보여요.</p>'; return; }
    $("schedDayTitle").textContent = state.schedSelectedDay.slice(5).replace("-", "월 ") + "일 일정";
    var list = state.schedules.filter(function (s) { return schedVisible(s) && s.date === state.schedSelectedDay; })
      .sort(function (a, b) { return (a.time || "99").localeCompare(b.time || "99"); });
    if (!list.length) { listBox.innerHTML = '<p class="day-hint">아직 일정이 없어요. 아래에서 추가해 보세요.</p>'; return; }
    listBox.innerHTML = list.map(function (s) {
      var scopeKo = (s.scope || "business") === "business" ? "사업" : "개인";
      return '<div class="sched-item"><span class="sched-bar" style="background:' + s.color + '"></span>' +
        '<div class="sched-main"><div class="sched-title">' + (s.time ? '<b>' + s.time + '</b> ' : '') + esc(s.title) + '</div>' +
        '<div class="sched-memo"><span class="scope-tag">' + scopeKo + '</span>' + (s.memo ? ' · ' + esc(s.memo) : '') + '</div></div>' +
        '<button class="tx-del" data-id="' + s.id + '" aria-label="삭제">×</button></div>';
    }).join("");
    listBox.querySelectorAll(".tx-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("이 일정을 삭제할까요?")) return;
        state.schedules = state.schedules.filter(function (s) { return s.id !== btn.dataset.id; });
        persist(); renderSchedule();
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
      btn.addEventListener("click", function () { state.month = new Date(state.pickerYear, +btn.dataset.m, 1); state.selectedDay = null; state.schedSelectedDay = null; closePicker(); renderAll(); });
    });
  }

  /* ================= 메뉴 드로어 ================= */
  function setupMenu() {
    $("menuBtn").addEventListener("click", function () { state.menuOpen = true; $("menuOverlay").hidden = false; updateFab(); });
    $("menuOverlay").addEventListener("click", function (e) { if (e.target === $("menuOverlay")) { state.menuOpen = false; $("menuOverlay").hidden = true; updateFab(); } });
    document.querySelectorAll(".menu-item").forEach(function (item) {
      if (item.id === "logoutBtn") return; // 로그아웃은 별도 처리(setupAuth)
      item.addEventListener("click", function () {
        state.menuOpen = false; $("menuOverlay").hidden = true;
        if (item.dataset.view === "add") { openInput(); }
        else { switchView(item.dataset.view); }
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
      } else {
        // 처음 로그인한 새 사용자: 빈 상태로 시작 (테스트 데이터 없음)
        state.transactions = [];
        state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
        state.recurring = [];
        state.assets = [];
        state.assetCategories = JSON.parse(JSON.stringify(DEFAULT_ASSET_CATS));
        state.schedules = [];
        persist();
      }
      state.selectedDay = null; state.schedSelectedDay = null;
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

  function renderAll() { renderMonthLabel(); renderDashboard(); renderList(); renderSchedule(); renderVatAuto(); }

  function init() {
    document.querySelectorAll(".tab").forEach(function (t) { t.addEventListener("click", function () { switchView(t.dataset.view); }); });
    $("prevMonth").addEventListener("click", function () { changeMonth(-1); });
    $("nextMonth").addEventListener("click", function () { changeMonth(1); });
    setupForm(); setupListControls(); setupDashToggle(); setupPicker(); setupMenu(); setupAssets();
    setupVat(); setupSchedule();
    $("fab").addEventListener("click", function () { openInput(); });
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
})();
