// 우리집 가계부 — GitHub Pages + Firebase(Firestore, 익명 로그인)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, setDoc, addDoc, deleteDoc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const CATS = [["식비","--c1"],["교통","--c2"],["공과금","--c3"],["교육","--c4"],["의료","--c5"],["용돈","--c6"],["기타","--c7"]];
const catVar = Object.fromEntries(CATS);
const WEEK = "일월화수목금토";
const JOINED_KEY = "ledger-joined";
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
const digits = s => String(s || "").replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 12);
const fmtInput = s => { const d = digits(s); return d ? Number(d).toLocaleString("ko-KR") : ""; };
const store = {
  get(k){ try { return localStorage.getItem(k); } catch (e){ return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch (e){} },
  del(k){ try { localStorage.removeItem(k); } catch (e){} }
};

const state = { ym: todayStr().slice(0, 7), entries: [], budgets: {}, members: {}, loaded: false, uid: null };
let fs = null, auth = null, unsubEntries = null, unsubBudgets = null, unsubMembers = null, started = false;

function notice(msg){ const n = $("#notice"); n.textContent = msg || ""; n.hidden = !msg; }
let toastTimer = null;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }

function shiftMonth(ym, d){ let [y, m] = ym.split("-").map(Number); m += d; while (m < 1){ m += 12; y--; } while (m > 12){ m -= 12; y++; } return y + "-" + pad(m); }
function monthLabel(ym){ const [y, m] = ym.split("-"); return y + "년 " + Number(m) + "월"; }
function dayLabel(ds){ const [y, m, d] = ds.split("-").map(Number); return m + "월 " + d + "일 (" + WEEK[new Date(y, m - 1, d).getDay()] + ")"; }
function effectiveBudget(ym){
  if (state.budgets[ym] != null) return { amount: state.budgets[ym], from: ym };
  const keys = Object.keys(state.budgets).filter(k => k < ym).sort();
  if (!keys.length) return null;
  const k = keys[keys.length - 1];
  return { amount: state.budgets[k], from: k };
}

/* ---------------- 화면 그리기 ---------------- */
function render(){
  $("#monthLabel").textContent = monthLabel(state.ym);
  $("#listTitle").textContent = (state.ym === todayStr().slice(0, 7) ? "이번 달" : monthLabel(state.ym)) + " 내역";
  const inc = state.entries.filter(e => e.type === "income").reduce((a, e) => a + (e.amount || 0), 0);
  const exp = state.entries.filter(e => e.type !== "income").reduce((a, e) => a + (e.amount || 0), 0);
  const bal = inc - exp;
  $("#income").textContent = won(inc);
  $("#expense").textContent = won(exp);
  const balEl = $("#balance");
  balEl.textContent = (bal < 0 ? "−" : "") + won(Math.abs(bal));
  balEl.classList.toggle("neg", bal < 0);
  renderBudget(exp);
  renderChart(exp);
  renderList();
  const me = state.members[state.uid];
  $("#meName").textContent = me ? me + "(으)로 입력 중" : "";
}

function renderBudget(exp){
  const card = $("#budgetCard");
  const b = effectiveBudget(state.ym);
  $("#budgetInputLabel").textContent = monthLabel(state.ym) + " 지출 예산";
  if (!b || !b.amount){
    card.className = "card";
    $("#budgetEmpty").hidden = false; $("#budgetFilled").hidden = true;
    $("#expense").classList.remove("over");
    return;
  }
  $("#budgetEmpty").hidden = true; $("#budgetFilled").hidden = false;
  const pct = exp / b.amount * 100;
  const over = exp > b.amount;
  const warn = !over && pct >= 90;
  card.className = "card" + (over ? " over" : warn ? " warn" : "");
  $("#expense").classList.toggle("over", over);
  $("#budgetAmt").textContent = "예산 " + won(b.amount);
  const inh = $("#budgetInherit");
  if (b.from !== state.ym){ inh.hidden = false; inh.textContent = monthLabel(b.from) + "에 정한 예산을 이어서 쓰는 중"; } else inh.hidden = true;
  const bar = $("#budgetBar");
  bar.firstElementChild.style.width = Math.min(pct, 100) + "%";
  bar.setAttribute("aria-valuenow", String(Math.round(pct)));
  $("#budgetPct").textContent = (over ? "예산 초과 · " : "사용 ") + Math.round(pct) + "%";
  $("#budgetLeft").textContent = over ? won(exp - b.amount) + " 초과" : "남은 금액 " + won(b.amount - exp);
}

function renderChart(exp){
  const byCat = {};
  state.entries.filter(e => e.type !== "income").forEach(e => { const c = catVar[e.category] ? e.category : "기타"; byCat[c] = (byCat[c] || 0) + (e.amount || 0); });
  const rows = Object.entries(byCat).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]);
  const has = exp > 0 && rows.length > 0;
  $("#chartEmpty").hidden = has; $("#chart").hidden = !has;
  if (!has) return;
  const R = 70, C = 2 * Math.PI * R, gap = rows.length > 1 ? 2.5 : 0;
  let off = 0, svg = '<circle cx="100" cy="100" r="70" fill="none" style="stroke:var(--soft)" stroke-width="28"/>';
  rows.forEach(([cat, v]) => {
    const len = v / exp * C;
    svg += '<circle cx="100" cy="100" r="70" fill="none" style="stroke:var(' + catVar[cat] + ')" stroke-width="28" stroke-dasharray="' + Math.max(len - gap, 0.5).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 100 100)"/>';
    off += len;
  });
  const total = won(exp);
  const fs_ = total.length > 11 ? 14 : total.length > 9 ? 16 : 19;
  svg += '<text x="100" y="92" text-anchor="middle" style="fill:var(--muted)" font-size="13" font-family="IBM Plex Sans KR, sans-serif">총 지출</text>';
  svg += '<text x="100" y="116" text-anchor="middle" style="fill:var(--ink)" font-size="' + fs_ + '" font-weight="700" font-family="IBM Plex Sans KR, sans-serif">' + total + '</text>';
  $("#donut").innerHTML = svg;
  const ul = $("#legend"); ul.textContent = "";
  rows.forEach(([cat, v]) => {
    const li = document.createElement("li");
    li.innerHTML = '<span class="sw"></span><span class="n"></span><span class="v num"></span><span class="pct num"></span>';
    li.querySelector(".sw").style.background = "var(" + catVar[cat] + ")";
    li.querySelector(".n").textContent = cat;
    li.querySelector(".v").textContent = won(v);
    li.querySelector(".pct").textContent = Math.round(v / exp * 100) + "%";
    ul.appendChild(li);
  });
}

function renderList(){
  const list = $("#list"); list.textContent = "";
  const items = state.entries.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
  const empty = $("#listEmpty");
  empty.hidden = items.length > 0;
  empty.textContent = state.loaded ? "아직 적은 내역이 없어요." : "불러오는 중…";
  let curDay = null, box = null;
  items.forEach(e => {
    if (e.date !== curDay){
      curDay = e.date;
      const h = document.createElement("div"); h.className = "day"; h.textContent = dayLabel(e.date); list.appendChild(h);
      box = document.createElement("div"); box.className = "items"; list.appendChild(box);
    }
    const b = document.createElement("button");
    b.type = "button"; b.className = "item";
    b.innerHTML = '<span class="dot"></span><span class="t"><div class="cat"></div><div class="memo"></div><div class="who"></div></span><span class="a num"></span>';
    b.querySelector(".dot").style.background = "var(" + (catVar[e.category] || "--c7") + ")";
    b.querySelector(".cat").textContent = (e.type === "income" ? "수입 · " : "") + (e.category || "기타");
    const memo = b.querySelector(".memo"); memo.textContent = e.memo || ""; memo.hidden = !e.memo;
    const who = b.querySelector(".who");
    const nm = e.by === state.uid ? "나" : state.members[e.by];
    who.textContent = nm ? "입력: " + nm : ""; who.hidden = !nm;
    const a = b.querySelector(".a");
    a.textContent = (e.type === "income" ? "+" : "−") + won(e.amount || 0);
    if (e.type === "income") a.classList.add("in");
    b.addEventListener("click", () => openEntry(e));
    box.appendChild(b);
  });
}

/* ---------------- 입력 시트 ---------------- */
let editing = null, entryType = "expense", openSheetEl = null;
const chips = $("#chips");
CATS.forEach(([c, v]) => {
  const l = document.createElement("label"); l.className = "chip";
  l.innerHTML = '<input type="radio" name="cat"><span></span>';
  const inp = l.querySelector("input"); inp.value = c; inp.id = "cat-" + v.slice(2);
  const sp = l.querySelector("span"); sp.textContent = c; sp.style.setProperty("--dot", "var(" + v + ")");
  chips.appendChild(l);
});
function setType(t){ entryType = t; document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.type === t))); }
document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => setType(b.dataset.type)));
function setCat(c){ chips.querySelectorAll("input").forEach(i => { i.checked = i.value === c; }); }

function showSheet(el){ openSheetEl = el; $("#scrim").hidden = false; el.hidden = false; document.body.style.overflow = "hidden"; }
function closeSheet(){ if (openSheetEl) openSheetEl.hidden = true; openSheetEl = null; $("#scrim").hidden = true; document.body.style.overflow = ""; disarmDelete(); }
$("#scrim").addEventListener("click", closeSheet);
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
document.addEventListener("keydown", e => { if (e.key === "Escape" && openSheetEl) closeSheet(); });

function openEntry(e){
  editing = e || null;
  $("#entryTitle").textContent = e ? "내역 고치기" : "새 내역";
  setType(e ? (e.type === "income" ? "income" : "expense") : "expense");
  $("#amount").value = e ? fmtInput(e.amount) : "";
  $("#date").value = e ? e.date : (state.ym === todayStr().slice(0, 7) ? todayStr() : state.ym + "-01");
  setCat(e ? e.category : "식비");
  $("#memo").value = e ? (e.memo || "") : "";
  $("#entryErr").textContent = "";
  $("#deleteBtn").hidden = !e;
  showSheet($("#entrySheet"));
  if (!e) setTimeout(() => $("#amount").focus(), 60);
}
$("#fab").addEventListener("click", () => openEntry(null));
["#amount", "#budgetInput"].forEach(sel => $(sel).addEventListener("input", ev => { ev.target.value = fmtInput(ev.target.value); }));

function writeFailed(err){
  console.error(err);
  if (err && err.code === "permission-denied") toast("저장이 거부됐어요. 가족 코드가 바뀌었다면 ‘이 기기에서 나가기’ 후 다시 들어오세요.");
  else toast("저장하지 못했어요. 인터넷 연결을 확인하세요.");
}

// Firestore는 오프라인에서도 기기에 먼저 저장하고, 연결되면 서버로 보냅니다.
// 그래서 서버 응답을 기다리지 않고 바로 시트를 닫습니다.
$("#entrySheet").addEventListener("submit", ev => {
  ev.preventDefault();
  if (!fs) return;
  const err = $("#entryErr");
  const amount = Number(digits($("#amount").value));
  const date = $("#date").value;
  const catEl = chips.querySelector("input:checked");
  if (!amount){ err.textContent = "금액을 입력하세요."; $("#amount").focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){ err.textContent = "날짜를 선택하세요."; return; }
  if (!catEl){ err.textContent = "카테고리를 고르세요."; return; }
  const now = Date.now();
  const data = { date, month: date.slice(0, 7), type: entryType, amount, category: catEl.value, memo: $("#memo").value.trim().slice(0, 60), updatedAt: now };
  const wasEdit = !!editing;
  const p = wasEdit
    ? setDoc(doc(fs, "entries", editing.id), Object.assign({}, data, { createdAt: editing.createdAt || now, by: editing.by || state.uid }))
    : addDoc(collection(fs, "entries"), Object.assign({}, data, { createdAt: now, by: state.uid }));
  p.catch(writeFailed);
  closeSheet();
  if (data.month !== state.ym){ state.ym = data.month; subscribeMonth(); }
  toast(wasEdit ? "고쳤습니다" : "저장했습니다");
});

let deleteArmed = false, armTimer = null;
function disarmDelete(){ deleteArmed = false; clearTimeout(armTimer); const b = $("#deleteBtn"); b.classList.remove("armed"); b.textContent = "삭제"; }
$("#deleteBtn").addEventListener("click", () => {
  if (!editing || !fs) return;
  const b = $("#deleteBtn");
  if (!deleteArmed){ deleteArmed = true; b.classList.add("armed"); b.textContent = "한 번 더 누르면 삭제"; armTimer = setTimeout(disarmDelete, 3500); return; }
  deleteDoc(doc(fs, "entries", editing.id)).catch(writeFailed);
  closeSheet(); toast("삭제했습니다");
});

/* ---------------- 예산 ---------------- */
$("#editBudget").addEventListener("click", () => {
  const b = effectiveBudget(state.ym);
  $("#budgetInput").value = b && b.amount ? fmtInput(b.amount) : "";
  $("#budgetErr").textContent = "";
  showSheet($("#budgetSheet"));
  setTimeout(() => $("#budgetInput").focus(), 60);
});
function saveBudget(amount){
  if (!fs) return;
  setDoc(doc(fs, "budgets", state.ym), { amount, by: state.uid, updatedAt: Date.now() }).catch(writeFailed);
  closeSheet(); toast(amount ? "예산을 정했습니다" : "예산을 없앴습니다");
}
$("#budgetSheet").addEventListener("submit", ev => {
  ev.preventDefault();
  const amount = Number(digits($("#budgetInput").value));
  if (!amount){ $("#budgetErr").textContent = "예산 금액을 입력하세요. 예산을 없애려면 ‘예산 없음’을 누르세요."; return; }
  saveBudget(amount);
});
$("#clearBudget").addEventListener("click", () => saveBudget(0));

/* ---------------- 월 이동 ---------------- */
$("#prevMonth").addEventListener("click", () => { state.ym = shiftMonth(state.ym, -1); subscribeMonth(); });
$("#nextMonth").addEventListener("click", () => { state.ym = shiftMonth(state.ym, 1); subscribeMonth(); });

/* ---------------- 실시간 구독 ---------------- */
function onListenError(err){
  console.error(err);
  if (err && err.code === "permission-denied"){ stopApp(); store.del(JOINED_KEY); showJoin("가족 코드가 바뀌었거나 이 기기의 등록이 지워졌어요. 다시 들어와 주세요."); }
  else notice("데이터를 불러오지 못했어요. 인터넷 연결을 확인하세요.");
}
function subscribeMonth(){
  if (unsubEntries){ unsubEntries(); unsubEntries = null; }
  state.entries = []; state.loaded = false; render();
  const ym = state.ym;
  unsubEntries = onSnapshot(query(collection(fs, "entries"), where("month", "==", ym)), snap => {
    if (ym !== state.ym) return;
    state.entries = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    state.loaded = true; notice(""); render();
  }, onListenError);
}
function startApp(){
  if (started) return;
  started = true;
  $("#joinForm").hidden = true;
  $("#app").hidden = false; $("#monthNav").hidden = false; $("#fab").hidden = false;
  notice("");
  unsubMembers = onSnapshot(collection(fs, "members"), snap => {
    const m = {}; snap.docs.forEach(d => { const v = d.data(); if (v && v.name) m[d.id] = v.name; });
    state.members = m; render();
  }, onListenError);
  unsubBudgets = onSnapshot(collection(fs, "budgets"), snap => {
    const m = {}; snap.docs.forEach(d => { const v = d.data(); if (v && typeof v.amount === "number") m[d.id] = v.amount; });
    state.budgets = m; render();
  }, onListenError);
  subscribeMonth();
}
function stopApp(){
  [unsubEntries, unsubBudgets, unsubMembers].forEach(u => { if (u) u(); });
  unsubEntries = unsubBudgets = unsubMembers = null;
  started = false;
  closeSheet();
  $("#app").hidden = true; $("#monthNav").hidden = true; $("#fab").hidden = true;
}

/* ---------------- 가족 코드로 들어가기 ---------------- */
function showJoin(msg){
  notice(msg || "");
  $("#joinForm").hidden = false;
  $("#joinErr").textContent = "";
}
$("#joinForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const code = $("#joinCode").value.trim();
  const name = $("#joinName").value.trim().slice(0, 20);
  const err = $("#joinErr");
  if (!code){ err.textContent = "가족 코드를 입력하세요."; return; }
  if (!name){ err.textContent = "내역에 표시될 이름을 입력하세요."; return; }
  if (!state.uid){ err.textContent = "아직 연결 중이에요. 잠시 후 다시 눌러 주세요."; return; }
  const btn = $("#joinBtn"); btn.disabled = true; err.textContent = "";
  try {
    await setDoc(doc(fs, "members", state.uid), { name, code, joinedAt: Date.now() });
    store.set(JOINED_KEY, "1");
    startApp();
  } catch (e){
    console.error(e);
    err.textContent = e && e.code === "permission-denied" ? "가족 코드가 맞지 않아요. 다시 확인해 주세요." : "들어가지 못했어요. 인터넷 연결을 확인하세요.";
  } finally { btn.disabled = false; }
});

$("#leaveBtn").addEventListener("click", async () => {
  const b = $("#leaveBtn");
  if (b.dataset.armed !== "1"){ b.dataset.armed = "1"; b.textContent = "한 번 더 누르면 나가기"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "이 기기에서 나가기"; }, 3500); return; }
  stopApp(); store.del(JOINED_KEY);
  try { await signOut(auth); } catch (e){}
});

/* 회원 여부 확인: 회원이 아니면 규칙이 읽기를 거부합니다. */
async function isMember(uid){
  try { const s = await getDoc(doc(fs, "members", uid)); return s.exists(); }
  catch (e){
    if (e && e.code === "permission-denied") return false;
    return store.get(JOINED_KEY) === "1"; // 오프라인이면 이 기기에 남은 기록으로 판단
  }
}

/* ---------------- 시작 ---------------- */
function boot(){
  if (!firebaseConfig || !firebaseConfig.apiKey || /여기에|YOUR_/.test(firebaseConfig.apiKey)){
    notice("firebase-config.js에 Firebase 설정값을 아직 넣지 않았어요. 안내서의 2단계를 확인하세요.");
    return;
  }
  const app = initializeApp(firebaseConfig);
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e){ fs = getFirestore(app); }
  auth = getAuth(app);
  onAuthStateChanged(auth, async user => {
    if (!user){
      state.uid = null;
      try { await signInAnonymously(auth); }
      catch (e){
        console.error(e);
        notice(e && e.code === "auth/admin-restricted-operation"
          ? "Firebase에서 익명 로그인이 꺼져 있어요. 안내서의 3단계를 확인하세요."
          : "연결하지 못했어요. 인터넷 연결을 확인한 뒤 새로고침하세요.");
      }
      return;
    }
    state.uid = user.uid;
    if (await isMember(user.uid)) startApp();
    else showJoin();
  });
}
boot();
