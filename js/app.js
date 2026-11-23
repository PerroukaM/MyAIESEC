import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ALLOWED_DOMAIN } from "./config.js";


// ---------- helpers ----------
function el(tag, props, ...kids) {
  const n = document.createElement(tag); const late = {};
  if (props) for (const k in props) {
    const v = props[k]; if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("--")) n.style.setProperty(k, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "disabled") late[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; n.append(c instanceof Node ? c : String(c)); }
  for (const k in late) n[k] = late[k];
  return n;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("lcp:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lcp:" + k, JSON.stringify(v)); } catch {} }
};
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDay = s => parseYmd(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtLong = s => parseYmd(s).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const fmtDue = due => due ? `${fmtDay(due.slice(0, 10))}${due.length > 10 ? ", " + due.slice(11, 16) : ""}` : "";
const fmtStamp = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const todayStr = () => ymd(new Date());

const STANDARD_TEAMS = [
  { name: "Executive Board", short: "EB", color: 7 },
  { name: "Outgoing Global Volunteer", short: "oGV", color: 1 },
  { name: "Incoming Global Volunteer", short: "iGV", color: 4 },
  { name: "Global Talent & Teacher", short: "GTa/GTe", color: 5 },
  { name: "Talent Management", short: "TM", color: 2 },
  { name: "Marketing", short: "MKT", color: 3 },
  { name: "Business Development", short: "BD", color: 0 },
  { name: "Finance & Legal", short: "F&L", color: 6 }
];

// ---------- state ----------
const S = {
  db: null, status: "connecting", readonly: false, slow: false, error: null, email: "", displayName: "",
  teams: [], members: [], events: [], tasks: [], comments: [],
  tab: ["calendar", "agendas", "teams"].includes(location.hash.slice(1)) ? location.hash.slice(1) : store.get("tab", "calendar"),
  month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  selected: todayStr(),
  hidden: new Set(store.get("hidden", [])),
  showDeadlines: store.get("deadlines", true),
  agendaTeam: store.get("agendaTeam", ""),
  hideDone: store.get("hideDone", false),
  pickedMe: store.get("me", ""),
  // The signed-in person's member record: matched by email, else the member they picked.
  get me() {
    const linked = this.members.find(m => (m.email || "").toLowerCase() === this.email);
    if (linked) return linked.id;
    return this.members.some(m => m.id === this.pickedMe) ? this.pickedMe : "";
  },
  get linked() { return this.members.some(m => (m.email || "").toLowerCase() === this.email); }
};
const teamById = id => S.teams.find(t => t.id === id);
const memberById = id => S.members.find(m => m.id === id);
const sortedTeams = () => [...S.teams].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(b.name));
const membersOf = tid => S.members.filter(m => m.teamId === tid).sort((a, b) => String(a.name).localeCompare(b.name));
const assignees = t => Array.isArray(t.memberIds) && t.memberIds.length ? t.memberIds : (t.memberId ? [t.memberId] : []);
const teamsOfTask = t => [...new Set(assignees(t).map(id => memberById(id)?.teamId).filter(Boolean))];
const teamOfTask = t => teamsOfTask(t)[0] || "";
const namesOf = ids => ids.map(id => memberById(id)?.name || "Someone").join(", ");
const tcVar = tid => { const t = teamById(tid); return t ? `var(--t${(t.color ?? 0) % 8})` : "var(--muted)"; };
const teamLabel = tid => { const t = teamById(tid); return t ? (t.short || t.name) : "Whole LC"; };
const commentsOf = tid => S.comments.filter(c => c.taskId === tid).sort((a, b) => String(a.at).localeCompare(String(b.at)));
function dueState(t) {
  if (t.done) return "done"; if (!t.due) return "";
  const d = new Date(t.due.length > 10 ? t.due : t.due + "T23:59");
  const diff = d - Date.now();
  if (diff < 0) return "overdue"; if (diff < 48 * 3600e3) return "soon"; return "";
}
function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const ad = a.due || "9999", bd = b.due || "9999";
    return a.done ? bd.localeCompare(ad) : ad.localeCompare(bd);
  });
}

// ---------- writes ----------
let toastTimer;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: "toast", role: "status", text: msg }); document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3200);
}
async function write(fn, okMsg) {
  if (!S.db) { toast("Not connected yet. Try again in a moment."); return false; }
  try { await fn(S.db); if (okMsg) toast(okMsg); return true; }
  catch (e) {
    if (e?.code === "permission-denied") toast(`Couldn't save. Only @${ALLOWED_DOMAIN} accounts can make changes.`);
    else if (e?.code === "resource-exhausted") toast("The planner hit its free usage limit for today. Try again tomorrow.");
    else toast("Couldn't save. Check your connection and try again.");
    return false;
  }
}

// ---------- rendering ----------
let raf = 0;
function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); modalRefresh?.(); }); }

function render() {
  document.body.classList.toggle("readonly", S.readonly);
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  renderMe();
  const main = document.getElementById("main");
  const nodes = [];
  const b = banner(); if (b) nodes.push(b);
  if (S.tab === "calendar") nodes.push(viewCalendar());
  else if (S.tab === "agendas") nodes.push(viewAgendas());
  else nodes.push(viewTeams());
  main.replaceChildren(...nodes);
}

function banner() {
  if (S.error) return el("div", { class: "banner" }, el("strong", { text: "Couldn't load the planner. " }), `Reload the page. If it keeps happening, make sure you signed in with your @${ALLOWED_DOMAIN} account.`);
  if (S.slow) return el("div", { class: "banner" }, el("strong", { text: "Still loading. " }), "The shared planner hasn't answered yet, so what you see may be out of date.");
  if (S.status === "connecting") return el("div", { class: "banner", text: "Connecting to the shared planner…" });
  if (S.members.length && !S.linked) return el("div", { class: "banner" }, el("strong", { text: "Which member are you? " }), "Pick your name in \u201cI am\u201d at the top. If your member entry has no email yet, it gets linked to your account so you're recognised automatically next time.");
  return null;
}

function memberOptions(select, value, emptyLabel) {
  select.replaceChildren(el("option", { value: "", text: emptyLabel }));
  for (const t of sortedTeams()) {
    const ms = membersOf(t.id); if (!ms.length) continue;
    select.append(el("optgroup", { label: t.short ? `${t.short} · ${t.name}` : t.name }, ms.map(m => el("option", { value: m.id, text: m.name }))));
  }
  select.value = memberById(value) ? value : "";
}
function renderMe() {
  const s = document.getElementById("me-select");
  document.getElementById("whoami").hidden = S.linked || !S.members.length;
  if (document.activeElement === s) return;
  memberOptions(s, S.me, S.members.length ? "Choose yourself" : "No members yet");
}
function setMe(id) {
  S.pickedMe = id; store.set("me", id);
  const m = memberById(id);
  if (m && !S.agendaTeam) S.agendaTeam = m.teamId;
  if (m && !m.email && S.email) write(db => db.doc("members/" + m.id).update({ email: S.email }), `Linked ${S.email} to ${m.name}`);
  render();
}

// ---------- calendar ----------
function itemsOn(day) {
  const vis = tid => !S.hidden.has(tid || "_lc");
  const ev = S.events.filter(e => e.date === day && vis(e.teamId)).map(e => ({ kind: "event", time: e.allDay ? "" : (e.start || ""), obj: e, teamId: e.teamId || "" }));
  const tk = !S.showDeadlines ? [] : S.tasks.filter(t => t.due && t.due.slice(0, 10) === day).map(t => {
    const ts = teamsOfTask(t); const shown = ts.length ? ts.find(vis) : (vis("") ? "" : undefined);
    return shown === undefined ? null : { kind: "task", time: t.due.slice(11, 16), obj: t, teamId: shown };
  }).filter(Boolean);
  return [...ev, ...tk].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

function viewCalendar() {
  const m = S.month;
  const label = m.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const shift = n => { S.month = new Date(m.getFullYear(), m.getMonth() + n, 1); render(); };

  const toolbar = el("div", { class: "toolbar" },
    el("button", { class: "btn icon", type: "button", "aria-label": "Previous month", onclick: () => shift(-1), text: "‹" }),
    el("button", { class: "btn", type: "button", text: "Today", onclick: () => { const d = new Date(); S.month = new Date(d.getFullYear(), d.getMonth(), 1); S.selected = todayStr(); render(); } }),
    el("button", { class: "btn icon", type: "button", "aria-label": "Next month", onclick: () => shift(1), text: "›" }),
    el("h2", { text: label }),
    el("span", { class: "grow" }),
    el("button", { class: "btn primary w", type: "button", text: "+ New event", onclick: () => eventModal(null, S.selected) })
  );

  const myTeam = memberById(S.me)?.teamId;
  const allIds = ["_lc", ...S.teams.map(t => t.id)];
  const setHidden = h => { S.hidden = new Set(h); store.set("hidden", [...S.hidden]); render(); };
  const chip = (id, text, tc) => el("button", { class: "chip", type: "button", "--tc": tc, "aria-pressed": String(!S.hidden.has(id)), text,
    onclick: () => { const h = new Set(S.hidden); h.has(id) ? h.delete(id) : h.add(id); setHidden(h); } });
  const filters = el("div", { class: "toolbar" },
    el("span", { class: "label", text: "Showing" }),
    el("div", { class: "chips" },
      chip("_lc", "Whole LC", "var(--muted)"),
      sortedTeams().map(t => chip(t.id, t.short || t.name, tcVar(t.id)))),
    el("span", { class: "grow" }),
    myTeam ? el("button", { class: "btn ghost", type: "button", text: "My team only", onclick: () => setHidden(allIds.filter(id => id !== myTeam && id !== "_lc")) }) : null,
    el("button", { class: "btn ghost", type: "button", text: "All teams", onclick: () => setHidden([]) }),
    el("label", { class: "check" }, el("input", { type: "checkbox", id: "deadlines-toggle", checked: S.showDeadlines, onchange: e => { S.showDeadlines = e.target.checked; store.set("deadlines", S.showDeadlines); render(); } }), "Task deadlines")
  );

  // grid
  const start = new Date(m); const offset = (m.getDay() + 6) % 7; start.setDate(1 - offset);
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const today = todayStr();
  const days = el("div", { class: "days" });
  for (let i = 0; i < cells; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = ymd(d); const items = itemsOn(ds);
    const shown = items.slice(0, 3);
    const cls = ["day", d.getMonth() !== m.getMonth() && "out", ds === today && "today", ds === S.selected && "sel"].filter(Boolean).join(" ");
    days.append(el("button", { class: cls, type: "button", "aria-label": `${fmtLong(ds)}, ${items.length} item${items.length === 1 ? "" : "s"}`, onclick: () => { S.selected = ds; render(); } },
      el("span", { class: "num", text: d.getDate() }),
      el("div", { class: "pills" }, shown.map(it => el("div", { class: `pill ${it.kind === "task" ? "task" : ""} ${it.obj.done ? "done" : ""}`, "--tc": tcVar(it.teamId), text: `${it.time ? it.time + " " : ""}${it.obj.title}` }))),
      items.length > 3 ? el("span", { class: "more", text: `+${items.length - 3} more` }) : null
    ));
  }
  const month = el("div", { class: "month" },
    el("div", { class: "dow" }, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(x => el("div", { text: x }))), days);

  // day panel
  const items = itemsOn(S.selected);
  const panel = el("aside", { class: "panel", "aria-label": "Selected day" },
    el("div", { class: "toolbar" }, el("h3", { class: "grow", text: fmtLong(S.selected) }),
      el("button", { class: "btn w", type: "button", text: "+ Event", onclick: () => eventModal(null, S.selected) })),
    items.length ? el("div", { style: "display:grid;gap:4px" }, items.map(it => {
      const o = it.obj;
      if (it.kind === "event") return el("button", { class: "item", type: "button", "--tc": tcVar(it.teamId), onclick: () => eventModal(o) },
        el("time", { text: o.allDay ? "All day" : (o.start || "") }),
        el("div", {}, el("div", { class: "t", text: o.title }),
          el("div", { class: "sub" }, el("span", { class: "tag", "--tc": tcVar(it.teamId), text: teamLabel(it.teamId) }),
            !o.allDay && o.end ? el("span", { text: `until ${o.end}` }) : null, o.location ? el("span", { text: o.location }) : null)));
      const ids = assignees(o);
      return el("button", { class: "item", type: "button", "--tc": tcVar(it.teamId), onclick: () => taskModal(o) },
        el("time", { text: it.time || "Due" }),
        el("div", {}, el("div", { class: "t", style: o.done ? "text-decoration:line-through;color:var(--muted)" : "", text: o.title }),
          el("div", { class: "sub" }, el("span", { class: "tag", "--tc": tcVar(it.teamId), text: teamLabel(it.teamId) }),
            el("span", { text: `Deadline · ${ids.length ? namesOf(ids) : "Unassigned"}` }), o.done ? el("span", { text: "Done" }) : null)));
    })) : el("p", { class: "empty", text: S.teams.length ? "Nothing on this day." : "No events yet. Add your first one, or set up your teams in the Teams tab." })
  );

  return el("section", { style: "display:grid;gap:12px" }, toolbar, filters, el("div", { class: "cal-layout" }, month, panel));
}

// ---------- agendas ----------
function viewAgendas() {
  const teams = sortedTeams();
  if (!teams.length) return emptyTeams();
  if (!teamById(S.agendaTeam)) S.agendaTeam = memberById(S.me)?.teamId || teams[0].id;
  const tid = S.agendaTeam;
  const pick = el("div", { class: "toolbar" },
    el("span", { class: "label", text: "Team" }),
    el("div", { class: "chips" }, teams.map(t => el("button", { class: "chip", type: "button", "--tc": tcVar(t.id), "aria-pressed": String(t.id === tid), text: t.short || t.name,
      onclick: () => { S.agendaTeam = t.id; store.set("agendaTeam", t.id); render(); } }))));

  const team = teamById(tid);
  const ms = membersOf(tid);
  if (S.me && ms.some(m => m.id === S.me)) ms.sort((a, b) => (b.id === S.me) - (a.id === S.me));
  const teamTasks = S.tasks.filter(t => assignees(t).some(id => ms.some(m => m.id === id)));
  const open = teamTasks.filter(t => !t.done);
  const overdue = open.filter(t => dueState(t) === "overdue").length;
  const soon = open.filter(t => dueState(t) === "soon").length;

  const head = el("div", { class: "toolbar" },
    el("h2", { text: team.name }),
    el("div", { class: "summary" },
      el("span", { class: "stat" }, el("b", { text: open.length }), "open"),
      el("span", { class: `stat ${overdue ? "bad" : ""}` }, el("b", { text: overdue }), "overdue"),
      el("span", { class: "stat" }, el("b", { text: soon }), "due in 48h"),
      el("span", { class: "stat" }, el("b", { text: teamTasks.length - open.length }), "done")),
    el("span", { class: "grow" }),
    el("label", { class: "check" }, el("input", { type: "checkbox", id: "hide-done", checked: S.hideDone, onchange: e => { S.hideDone = e.target.checked; store.set("hideDone", S.hideDone); render(); } }), "Hide done"),
    el("button", { class: "btn primary w", type: "button", text: "+ New task", onclick: () => taskModal(null, ms.find(m => m.id === S.me)?.id || ms[0]?.id) })
  );

  if (!ms.length) return el("section", { style: "display:grid;gap:14px" }, pick, head,
    el("div", { class: "hero-empty" }, el("h2", { text: `No one in ${team.short || team.name} yet` }),
      el("p", { text: "Add the team's members, then each person gets their own agenda here." }),
      el("button", { class: "btn primary w", type: "button", text: "+ Add member", onclick: () => memberModal(null, tid) })));

  const cards = el("div", { class: "cards" }, ms.map(m => {
    const all = S.tasks.filter(t => assignees(t).includes(m.id));
    const done = all.filter(t => t.done).length;
    const list = sortTasks(S.hideDone ? all.filter(t => !t.done) : all);
    return el("article", { class: `card ${m.id === S.me ? "me" : ""}` },
      el("div", { class: "card-h" },
        el("div", { class: "row" }, el("h3", { text: m.name }), m.id === S.me ? el("span", { class: "you", text: "You" }) : null),
        m.role ? el("span", { class: "role", text: m.role }) : null,
        el("div", { class: "prog" }, el("div", { class: "track" }, el("div", { class: "fill", style: `width:${all.length ? Math.round(done / all.length * 100) : 0}%` })), `${done}/${all.length} done`)),
      list.length ? el("ul", { class: "tasks" }, list.map(t => taskRow(t, m.id))) : el("p", { class: "empty", style: "padding:10px 14px;margin:0", text: all.length ? "All done." : "No tasks yet." }),
      el("div", { class: "card-f w" }, el("button", { class: "btn ghost", type: "button", text: "+ Add task", onclick: () => taskModal(null, m.id) })));
  }));
  return el("section", { style: "display:grid;gap:14px" }, pick, head, cards);
}

function taskRow(t, ownerId) {
  const st = dueState(t); const n = commentsOf(t.id).length;
  const others = assignees(t).filter(id => id !== ownerId);
  return el("li", { class: `task ${t.done ? "done" : ""}` },
    el("input", { type: "checkbox", checked: !!t.done, disabled: S.readonly, "aria-label": `Mark "${t.title}" as ${t.done ? "not done" : "done"}`,
      onchange: e => write(db => db.doc("tasks/" + t.id).update({ done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null })) }),
    el("button", { class: "task-main", type: "button", onclick: () => taskModal(t) },
      el("span", { class: "task-title", text: t.title }),
      el("span", { class: "meta" },
        t.due ? el("span", { class: `due ${st}`, text: (st === "overdue" ? "Overdue · " : "") + fmtDue(t.due) }) : el("span", { text: "No deadline" }),
        others.length ? el("span", { class: "with", text: `with ${namesOf(others)}` }) : null,
        n ? el("span", { text: `${n} comment${n === 1 ? "" : "s"}` }) : null)));
}

// ---------- teams ----------
function emptyTeams() {
  return el("div", { class: "hero-empty" },
    el("h2", { text: "Set up your LC's teams" }),
    el("p", { text: "Teams hold members, and every member gets an agenda. Start with the usual AIESEC functional areas and rename or remove any you don't use, or create your own." }),
    el("div", { class: "actions w" },
      el("button", { class: "btn primary", type: "button", text: "Add standard AIESEC teams", onclick: () => write(async db => { let i = 0; for (const t of STANDARD_TEAMS) await db.collection("teams").add({ ...t, order: i++ }); }, "Teams added") }),
      el("button", { class: "btn", type: "button", text: "+ Create a team", onclick: () => teamModal(null) })));
}
function viewTeams() {
  const teams = sortedTeams();
  if (!teams.length) return emptyTeams();
  return el("section", { style: "display:grid;gap:14px" },
    el("div", { class: "toolbar" }, el("h2", { class: "grow", text: "Teams & members" }),
      el("button", { class: "btn w", type: "button", text: "+ New team", onclick: () => teamModal(null) })),
    el("div", { class: "roster" }, teams.map(t => {
      const ms = membersOf(t.id);
      return el("article", { class: "team", "--tc": tcVar(t.id) },
        el("div", { class: "team-h" }, el("h3", { text: t.name }), t.short ? el("span", { class: "code", text: t.short }) : null,
          el("button", { class: "btn ghost w", type: "button", text: "Edit", onclick: () => teamModal(t) })),
        ms.length ? el("ul", { class: "mlist" }, ms.map(m => el("li", {},
          el("span", {}, m.name, m.role ? el("small", { text: ` · ${m.role}` }) : null),
          el("button", { class: "btn ghost w", type: "button", text: "Edit", onclick: () => memberModal(m) })))) : el("p", { class: "empty", style: "margin:0", text: "No members yet." }),
        el("div", { class: "w" }, el("button", { class: "btn", type: "button", text: "+ Add member", onclick: () => memberModal(null, t.id) })));
    })));
}

// ---------- modal ----------
let modalRefresh = null, lastFocus = null;
function closeModal() { document.querySelector(".scrim")?.remove(); modalRefresh = null; lastFocus?.focus?.(); }
function openModal(title, body, refresh) {
  closeModal(); lastFocus = document.activeElement;
  const m = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    el("div", { class: "modal-h" }, el("h2", { text: title }), el("button", { class: "btn ghost icon", type: "button", "aria-label": "Close", text: "✕", onclick: closeModal })), body);
  const scrim = el("div", { class: "scrim", onclick: e => { if (e.target === scrim) closeModal(); } }, m);
  document.body.append(scrim); modalRefresh = refresh || null;
  setTimeout(() => m.querySelector("input[type=text], textarea, select")?.focus(), 0);
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
function field(label, input) { return el("label", { class: "field" }, el("span", { class: "field-label", text: label }), input); }
function confirmBtn(label, onConfirm) {
  let armed = false, t;
  const b = el("button", { class: "btn danger ghost w", type: "button", text: label, onclick: () => {
    if (!armed) { armed = true; b.textContent = "Click again to confirm"; t = setTimeout(() => { armed = false; b.textContent = label; }, 4000); }
    else { clearTimeout(t); onConfirm(); } } });
  return b;
}
function teamSelect(id, value, withLc) {
  const s = el("select", { id }, withLc ? el("option", { value: "", text: "Whole LC" }) : null, sortedTeams().map(t => el("option", { value: t.id, text: t.short ? `${t.short} · ${t.name}` : t.name })));
  s.value = value || (withLc ? "" : sortedTeams()[0]?.id || ""); return s;
}

function eventModal(ev, date) {
  const e = ev || {};
  const title = el("input", { type: "text", id: "ev-title", value: e.title || "", placeholder: "e.g. General Assembly, oGV info session", maxlength: "140" });
  const team = teamSelect("ev-team", ev ? e.teamId : (memberById(S.me)?.teamId || ""), true);
  const d = el("input", { type: "date", id: "ev-date", value: e.date || date || todayStr() });
  const allDay = el("input", { type: "checkbox", id: "ev-allday", checked: !!e.allDay });
  const st = el("input", { type: "time", id: "ev-start", value: e.start || "18:00" });
  const en = el("input", { type: "time", id: "ev-end", value: e.end || "19:00" });
  const times = el("div", { class: "two" }, field("Starts", st), field("Ends", en));
  const loc = el("input", { type: "text", id: "ev-loc", value: e.location || "", placeholder: "Room, building or video link", maxlength: "200" });
  const notes = el("textarea", { id: "ev-notes", placeholder: "Agenda, what to prepare, who presents", maxlength: "4000" }); notes.value = e.notes || "";
  const err = el("p", { class: "err", hidden: true });
  const sync = () => { times.hidden = allDay.checked; }; allDay.addEventListener("change", sync); sync();
  const save = async () => {
    if (!title.value.trim()) { err.textContent = "Give the event a title."; err.hidden = false; return; }
    if (!d.value) { err.textContent = "Pick a date."; err.hidden = false; return; }
    const data = { title: title.value.trim(), teamId: team.value, date: d.value, allDay: allDay.checked, start: allDay.checked ? "" : st.value, end: allDay.checked ? "" : en.value, location: loc.value.trim(), notes: notes.value.trim(), createdBy: e.createdBy || S.me || "" };
    const ok = await write(db => ev ? db.doc("events/" + ev.id).set(data) : db.collection("events").add(data), ev ? "Event updated" : "Event added");
    if (ok) { S.selected = d.value; const dd = parseYmd(d.value); S.month = new Date(dd.getFullYear(), dd.getMonth(), 1); closeModal(); render(); }
  };
  const form = el("form", { class: "form", onsubmit: x => { x.preventDefault(); save(); } },
    field("Title", title), el("div", { class: "two" }, field("Team", team), field("Date", d)),
    el("label", { class: "check" }, allDay, "All day"), times, field("Location", loc), field("Notes", notes), err,
    el("div", { class: "actions" },
      ev ? confirmBtn("Delete event", async () => { if (await write(db => db.doc("events/" + ev.id).delete(), "Event deleted")) closeModal(); }) : null,
      el("span", { class: "grow" }),
      el("button", { class: "btn", type: "button", text: "Cancel", onclick: closeModal }),
      el("button", { class: "btn primary w", type: "submit", text: ev ? "Save" : "Add event" })));
  if (S.readonly) form.querySelectorAll("input,select,textarea").forEach(i => i.disabled = true);
  openModal(ev ? "Event" : "New event", form);
}

function taskModal(task, memberId) {
  const t = task || {};
  const title = el("input", { type: "text", id: "tk-title", value: t.title || "", placeholder: "What needs to be done", maxlength: "200" });
  let picked = task ? [...assignees(t)] : (memberId ? [memberId] : []);
  const pickedBox = el("div", { class: "chips" });
  const adder = el("select", { id: "tk-add", "aria-label": "Add member to this task" });
  const drawPicked = () => {
    pickedBox.replaceChildren(...picked.map(id => { const mm = memberById(id); return el("span", { class: "chip person", "--tc": tcVar(mm?.teamId) },
      mm ? mm.name : "Someone",
      S.readonly ? null : el("button", { class: "x", type: "button", "aria-label": `Remove ${mm ? mm.name : "member"} from this task`, text: "×", onclick: () => { picked = picked.filter(x => x !== id); drawPicked(); } })); }));
    memberOptions(adder, "", picked.length ? "+ Add member" : "+ Choose a person");
    adder.querySelectorAll("option").forEach(o => { if (o.value && picked.includes(o.value)) o.remove(); });
    adder.querySelectorAll("optgroup").forEach(g => { if (!g.children.length) g.remove(); });
    adder.hidden = S.readonly || adder.options.length < 2;
  };
  adder.addEventListener("change", () => { if (adder.value) { picked.push(adder.value); drawPicked(); adder.focus(); } });
  drawPicked();
  const who = el("div", { class: "assignees" }, pickedBox, adder);
  const dd = el("input", { type: "date", id: "tk-date", value: t.due ? t.due.slice(0, 10) : "" });
  const tt = el("input", { type: "time", id: "tk-time", value: t.due && t.due.length > 10 ? t.due.slice(11, 16) : "" });
  const notes = el("textarea", { id: "tk-notes", placeholder: "Details, links, definition of done", maxlength: "4000" }); notes.value = t.notes || "";
  const done = el("input", { type: "checkbox", id: "tk-done", checked: !!t.done });
  const err = el("p", { class: "err", hidden: true });
  const save = async () => {
    if (!title.value.trim()) { err.textContent = "Describe the task."; err.hidden = false; return; }
    if (!picked.length) { err.textContent = "Add at least one member."; err.hidden = false; return; }
    if (tt.value && !dd.value) { err.textContent = "Add a date for the deadline time."; err.hidden = false; return; }
    const data = { title: title.value.trim(), memberIds: [...picked], memberId: picked[0], due: dd.value ? dd.value + (tt.value ? "T" + tt.value : "") : "", notes: notes.value.trim(), done: done.checked,
      doneAt: done.checked ? (t.doneAt || new Date().toISOString()) : null, createdAt: t.createdAt || new Date().toISOString(), createdBy: t.createdBy || S.me || "" };
    const ok = await write(db => task ? db.doc("tasks/" + task.id).set(data) : db.collection("tasks").add(data), task ? "Task updated" : "Task added");
    if (ok) { const m = memberById(picked[0]); if (m && !task) { S.agendaTeam = m.teamId; store.set("agendaTeam", m.teamId); } closeModal(); render(); }
  };
  const form = el("form", { class: "form", onsubmit: x => { x.preventDefault(); save(); } },
    field("Task", title), el("div", { class: "field" }, el("span", { class: "field-label", text: "Members" }), who),
    el("div", { class: "two" }, field("Deadline date", dd), field("Deadline time", tt)),
    field("Notes", notes), el("label", { class: "check" }, done, "Done"), err,
    el("div", { class: "actions" },
      task ? confirmBtn("Delete task", async () => {
        if (await write(async db => { for (const c of commentsOf(task.id)) await db.doc("comments/" + c.id).delete(); await db.doc("tasks/" + task.id).delete(); }, "Task deleted")) closeModal();
      }) : null,
      el("span", { class: "grow" }),
      el("button", { class: "btn", type: "button", text: "Cancel", onclick: closeModal }),
      el("button", { class: "btn primary w", type: "submit", text: task ? "Save" : "Add task" })));
  if (S.readonly) form.querySelectorAll("input,select,textarea").forEach(i => i.disabled = true);

  let refresh = null; const body = el("div", { style: "display:grid;gap:14px" }, form);
  if (task) {
    const list = el("div", { style: "display:grid;gap:8px" });
    const text = el("textarea", { id: "cm-text", placeholder: "Progress update, question or blocker", maxlength: "2000", style: "min-height:56px" });
    const postingAs = el("span", { class: "field-label" });
    const fill = () => {
      if (!S.tasks.some(x => x.id === task.id)) { list.replaceChildren(el("p", { class: "err", text: "This task was deleted." })); return; }
      const cs = commentsOf(task.id);
      list.replaceChildren(...(cs.length ? cs.map(c => { const a = memberById(c.by); return el("div", { class: "comment" },
        el("div", { class: "who" }, el("b", { text: a ? a.name : (c.byName || c.byEmail || "Someone") }), el("span", { text: fmtStamp(c.at) })), el("p", { text: c.text })); })
        : [el("p", { class: "empty", style: "margin:0", text: "No comments yet. Post updates here to keep track of progress." })]));
      postingAs.textContent = `Posting as ${memberById(S.me)?.name || S.displayName || S.email}`;
    };
    const post = async () => {
      const v = text.value.trim(); if (!v) return;
      if (await write(db => db.collection("comments").add({ taskId: task.id, text: v, by: S.me || "", byEmail: S.email, byName: S.displayName || "", at: new Date().toISOString() }))) text.value = "";
    };
    text.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } });
    body.append(el("div", { class: "comments-box" },
      el("span", { class: "label", text: "Comments" }), list,
      el("div", { class: "w", style: "display:grid;gap:8px" }, text,
        el("div", { class: "actions" }, postingAs, el("span", { class: "grow" }),
          el("button", { class: "btn primary", type: "button", text: "Post comment", onclick: post })))));
    fill(); refresh = fill;
  }
  openModal(task ? "Task" : "New task", body, refresh);
}

function teamModal(team) {
  const t = team || {};
  const name = el("input", { type: "text", id: "tm-name", value: t.name || "", placeholder: "e.g. Outgoing Global Volunteer", maxlength: "80" });
  const short = el("input", { type: "text", id: "tm-short", value: t.short || "", placeholder: "e.g. oGV", maxlength: "12" });
  let color = t.color ?? (S.teams.length % 8);
  const sw = el("div", { class: "swatches", role: "group", "aria-label": "Team colour" });
  const drawSw = () => sw.replaceChildren(...[0, 1, 2, 3, 4, 5, 6, 7].map(i => el("button", { class: "swatch", type: "button", "--tc": `var(--t${i})`, "aria-label": `Colour ${i + 1}`, "aria-pressed": String(i === color), onclick: () => { color = i; drawSw(); } })));
  drawSw();
  const err = el("p", { class: "err", hidden: true });
  const save = async () => {
    if (!name.value.trim()) { err.textContent = "Give the team a name."; err.hidden = false; return; }
    const data = { name: name.value.trim(), short: short.value.trim(), color, order: t.order ?? S.teams.length };
    if (await write(db => team ? db.doc("teams/" + team.id).set(data) : db.collection("teams").add(data), team ? "Team updated" : "Team created")) closeModal();
  };
  const hasMembers = team && membersOf(team.id).length > 0;
  openModal(team ? "Edit team" : "New team", el("form", { class: "form", onsubmit: x => { x.preventDefault(); save(); } },
    field("Name", name), field("Short code", short), el("div", { class: "field" }, el("span", { class: "field-label", text: "Colour" }), sw), err,
    el("div", { class: "actions" },
      team ? (hasMembers ? el("span", { class: "field-label", text: "Move or remove its members to delete this team." })
        : confirmBtn("Delete team", async () => { if (await write(db => db.doc("teams/" + team.id).delete(), "Team deleted")) closeModal(); })) : null,
      el("span", { class: "grow" }),
      el("button", { class: "btn", type: "button", text: "Cancel", onclick: closeModal }),
      el("button", { class: "btn primary", type: "submit", text: team ? "Save" : "Create team" }))));
}

function memberModal(member, teamId) {
  const m = member || {};
  const name = el("input", { type: "text", id: "mb-name", value: m.name || "", placeholder: "Full name", maxlength: "80" });
  const role = el("input", { type: "text", id: "mb-role", value: m.role || "", placeholder: "e.g. Team Leader, Member, VP", maxlength: "60" });
  const team = teamSelect("mb-team", member ? m.teamId : teamId, false);
  const email = el("input", { type: "text", id: "mb-email", value: m.email || "", placeholder: `name.surname@${ALLOWED_DOMAIN}`, maxlength: "120", autocomplete: "off", inputmode: "email" });
  const err = el("p", { class: "err", hidden: true });
  const save = async () => {
    if (!name.value.trim()) { err.textContent = "Enter the member's name."; err.hidden = false; return; }
    const em = email.value.trim().toLowerCase();
    if (em && !em.endsWith("@" + ALLOWED_DOMAIN)) { err.textContent = `Use their @${ALLOWED_DOMAIN} address.`; err.hidden = false; return; }
    if (em && S.members.some(x => x.id !== m.id && (x.email || "").toLowerCase() === em)) { err.textContent = "Another member already has this email."; err.hidden = false; return; }
    const data = { name: name.value.trim(), role: role.value.trim(), teamId: team.value, email: em };
    if (await write(db => member ? db.doc("members/" + member.id).set(data) : db.collection("members").add(data), member ? "Member updated" : "Member added")) closeModal();
  };
  const theirs = member ? S.tasks.filter(t => assignees(t).includes(member.id)) : [];
  const nTasks = theirs.filter(t => assignees(t).length === 1).length;
  openModal(member ? "Edit member" : "Add member", el("form", { class: "form", onsubmit: x => { x.preventDefault(); save(); } },
    field("Name", name), el("div", { class: "two" }, field("Role", role), field("Team", team)),
    field("AIESEC email (links this member to their sign-in)", email), err,
    el("div", { class: "actions" },
      member ? confirmBtn(nTasks ? `Remove (and their ${nTasks} task${nTasks === 1 ? "" : "s"})` : "Remove member", async () => {
        const ok = await write(async db => {
          for (const t of theirs) {
            const rest = assignees(t).filter(id => id !== member.id);
            if (rest.length) { await db.doc("tasks/" + t.id).update({ memberIds: rest, memberId: rest[0] }); continue; }
            for (const c of commentsOf(t.id)) await db.doc("comments/" + c.id).delete();
            await db.doc("tasks/" + t.id).delete();
          }
          await db.doc("members/" + member.id).delete();
        }, "Member removed");
        if (ok) { if (S.me === member.id) setMe(""); closeModal(); }
      }) : null,
      el("span", { class: "grow" }),
      el("button", { class: "btn", type: "button", text: "Cancel", onclick: closeModal }),
      el("button", { class: "btn primary", type: "submit", text: member ? "Save" : "Add member" }))));
}

// ---------- wiring ----------
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => { S.tab = b.dataset.tab; store.set("tab", S.tab); try { history.replaceState(null, "", "#" + S.tab); } catch {} render(); }));
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (["calendar", "agendas", "teams"].includes(h)) { S.tab = h; render(); } });
document.getElementById("me-select").addEventListener("change", e => setMe(e.target.value));

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);
// Thin wrapper so the rest of the app uses one small API.
const dbApi = {
  collection: c => ({
    add: d => addDoc(collection(fs, c), d),
    onSnapshot: (next, err) => onSnapshot(collection(fs, c), next, err)
  }),
  doc: p => ({
    set: d => setDoc(doc(fs, p), d),
    update: d => updateDoc(doc(fs, p), d),
    delete: () => deleteDoc(doc(fs, p))
  })
};

const authEl = document.getElementById("auth"), appEl = document.getElementById("app");
const authMsg = document.getElementById("auth-msg"), authErr = document.getElementById("auth-err");
const signInBtn = document.getElementById("sign-in"), signOutAuthBtn = document.getElementById("sign-out-auth");
const allowed = email => !!email && email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
let unsubs = [];

signInBtn.addEventListener("click", async () => {
  authErr.hidden = true;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: "select_account" });
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request") return;
    authErr.textContent = e?.code === "auth/popup-blocked" ? "Your browser blocked the sign-in window. Allow pop-ups for this site and try again." : "Sign-in didn't work. Try again.";
    authErr.hidden = false;
  }
});
const doSignOut = () => signOut(auth);
signOutAuthBtn.addEventListener("click", doSignOut);
document.getElementById("sign-out").addEventListener("click", doSignOut);

onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = []; S.db = null; closeModal();
  if (!user) {
    appEl.hidden = true; authEl.hidden = false;
    authMsg.textContent = `Sign in with your @${ALLOWED_DOMAIN} Google account to open the team planner.`;
    signInBtn.hidden = false; signOutAuthBtn.hidden = true;
    return;
  }
  if (!allowed(user.email) || !user.emailVerified) {
    appEl.hidden = true; authEl.hidden = false;
    authMsg.textContent = `You're signed in as ${user.email}. This planner is only for @${ALLOWED_DOMAIN} accounts. Sign out and use your AIESEC account.`;
    signInBtn.hidden = true; signOutAuthBtn.hidden = false;
    return;
  }
  S.email = user.email.toLowerCase(); S.displayName = user.displayName || "";
  document.getElementById("account-email").textContent = S.email;
  authEl.hidden = true; appEl.hidden = false;
  start();
});

function start() {
  S.db = dbApi; S.status = "connecting"; S.error = null; S.slow = false;
  const cols = ["teams", "members", "events", "tasks", "comments"];
  const pending = new Set(cols);
  const timer = setTimeout(() => { if (pending.size) { S.slow = true; render(); } }, 10000);
  for (const c of cols) {
    unsubs.push(dbApi.collection(c).onSnapshot(snap => {
      S[c] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!snap.metadata.fromCache && pending.delete(c) && !pending.size) { clearTimeout(timer); S.slow = false; S.status = "ready"; }
      scheduleRender();
    }, () => { clearTimeout(timer); S.error = true; S.slow = false; scheduleRender(); }));
  }
  render();
}
