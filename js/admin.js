import {
  SUBMISSIONS,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  db,
} from "./firebase.js";

const ADMIN_PASSWORD = "lastridehunter";
const LS_KEY = "lrl_admin_ok";

const $ = (id) => document.getElementById(id);

// Login
if (sessionStorage.getItem(LS_KEY) === "yes") {
  showAdmin();
}

$("pw-go").addEventListener("click", tryLogin);
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });

function tryLogin() {
  if ($("pw").value === ADMIN_PASSWORD) {
    sessionStorage.setItem(LS_KEY, "yes");
    showAdmin();
  } else {
    $("pw-error").classList.remove("hidden");
  }
}

function showAdmin() {
  $("login-screen").classList.add("hidden");
  $("admin-screen").classList.remove("hidden");
  initAdmin();
}

// Tabs
document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["people", "plan", "export"].forEach((t) => $(`tab-${t}`).classList.toggle("hidden", t !== btn.dataset.tab));
  });
});

let currentSubs = [];

function initAdmin() {
  const q = query(SUBMISSIONS, orderBy("createdAt"));
  onSnapshot(q, (snap) => {
    currentSubs = [];
    snap.forEach((d) => currentSubs.push({ id: d.id, ...d.data() }));
    renderPeople();
    renderExport();
  });
}

function fmt(v) { return v == null || v === "" ? "—" : String(v); }

function renderPeople() {
  $("people-count").textContent = `${currentSubs.length} total`;
  const el = $("people");
  el.innerHTML = "";
  if (currentSubs.length === 0) {
    el.innerHTML = `<div class="empty-state">No submissions yet.</div>`;
    return;
  }

  for (const s of currentSubs) {
    const card = document.createElement("div");
    card.className = "person";
    const rows = [];
    if (s.role === "driver") {
      rows.push(["Capacity", `${s.capacity} seat(s)`]);
      rows.push(["Arrives", `${fmt(s.arriveDate)} ${fmt(s.arriveTime)}`]);
      rows.push(["Via airport", s.passingAirport ? `${s.passingAirport} @ ${s.passingAirportTime === "anytime" ? "anytime" : fmt(s.passingAirportTime)}` : "Direct"]);
      rows.push(["Sun. leave", s.sundayLatestLeave === "whenever" ? "Whenever" : `By ${fmt(s.sundayLatestLeave)}`]);
    } else if (s.mode === "flying") {
      rows.push(["Arrives", `${fmt(s.arriveDate)} ${fmt(s.arriveTime)} @ ${fmt(s.arriveAirport)}`]);
      rows.push(["Returns", `${fmt(s.returnDate)} ${fmt(s.returnTime)} from ${fmt(s.returnAirport)}`]);
    } else if (s.mode === "kentucky") {
      rows.push(["From", fmt(s.town)]);
    }

    card.innerHTML = `
      <h4>${escape(s.name)} <span class="role-tag ${s.role}">${s.role}${s.mode ? "/" + s.mode : ""}</span></h4>
      <div style="color:var(--ink-soft); font-size:0.8rem;">${escape(s.phone || "")}</div>
      <dl>${rows.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join("")}</dl>
      ${s.notes ? `<div style="font-size:0.8rem; font-style:italic; color:var(--ink-soft);">"${escape(s.notes)}"</div>` : ""}
      <div class="actions">
        <button class="btn btn-secondary" data-edit="${s.id}" style="padding:6px 12px; font-size:0.85rem;">Edit</button>
        <button class="btn btn-danger" data-del="${s.id}">Delete</button>
      </div>
    `;
    el.appendChild(card);
  }

  el.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.del;
      const s = currentSubs.find((x) => x.id === id);
      if (confirm(`Delete ${s?.name || "this entry"}?`)) {
        deleteDoc(doc(db, "submissions", id));
      }
    })
  );

  el.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEdit(b.dataset.edit))
  );
}

// EDITOR
const EDITABLE_FIELDS = [
  "name", "phone", "capacity",
  "arriveDate", "arriveTime",
  "passingAirport", "passingAirportTime",
  "sundayLatestLeave",
  "arriveAirport",
  "returnDate", "returnTime", "returnAirport",
  "town", "needsAirportRide",
  "notes",
];

function openEdit(id) {
  const s = currentSubs.find((x) => x.id === id);
  if (!s) return;
  $("edit-title").textContent = `Edit ${s.name}`;
  const body = $("edit-body");
  body.innerHTML = "";

  for (const f of EDITABLE_FIELDS) {
    if (!(f in s)) continue;
    const wrap = document.createElement("div");
    let inputHtml;
    const val = s[f] ?? "";
    if (typeof s[f] === "boolean") {
      inputHtml = `<select data-field="${f}">
        <option value="true" ${val ? "selected" : ""}>Yes</option>
        <option value="false" ${!val ? "selected" : ""}>No</option>
      </select>`;
    } else if (f === "notes") {
      inputHtml = `<textarea data-field="${f}">${escape(val)}</textarea>`;
    } else {
      inputHtml = `<input data-field="${f}" type="text" value="${escape(val)}" />`;
    }
    wrap.innerHTML = `<label>${f}</label>${inputHtml}`;
    body.appendChild(wrap);
  }

  $("edit-modal").classList.remove("hidden");
  $("edit-modal").dataset.id = id;
}

$("edit-cancel").addEventListener("click", () => $("edit-modal").classList.add("hidden"));

$("edit-save").addEventListener("click", async () => {
  const id = $("edit-modal").dataset.id;
  const s = currentSubs.find((x) => x.id === id);
  if (!s) return;

  const patch = {};
  $("edit-modal").querySelectorAll("[data-field]").forEach((el) => {
    const f = el.dataset.field;
    let v = el.value;
    if (typeof s[f] === "boolean") v = v === "true";
    if (typeof s[f] === "number") v = Number(v);
    patch[f] = v;
  });

  await setDoc(doc(db, "submissions", id), { ...s, ...patch }, { merge: false });
  $("edit-modal").classList.add("hidden");
});

function renderExport() {
  $("export-json").value = JSON.stringify(currentSubs, null, 2);
}

$("copy-json").addEventListener("click", () => {
  $("export-json").select();
  navigator.clipboard.writeText($("export-json").value);
  $("copy-json").textContent = "Copied!";
  setTimeout(() => ($("copy-json").textContent = "Copy JSON"), 1500);
});

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
