import { SUBMISSIONS, OVERRIDES_DOC, onSnapshot, query, orderBy } from "./firebase.js";
import { planArrivals, planDepartures, helpers } from "./scheduler.js";
import { AIRPORTS } from "./airports.js";

const { fmtTime, fmtDate, toMin } = helpers;
const $ = (id) => document.getElementById(id);

let overrides = null;

function snapToList(snap) {
  const arr = [];
  snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  return arr;
}

function render(submissions) {
  $("loading").classList.add("hidden");
  $("plan-content").classList.remove("hidden");

  const driverCount = submissions.filter((s) => s.role === "driver").length;
  const paxCount = submissions.filter((s) => s.role === "passenger").length;
  $("arrival-meta").textContent = `${driverCount} drivers · ${paxCount} passengers`;

  // ARRIVALS
  const { rides: arrRides, directDrivers, unassigned: arrUnassigned } = planArrivals(submissions);
  const arrivalEl = $("arrivals");
  arrivalEl.innerHTML = "";

  if (arrRides.length === 0 && directDrivers.length === 0) {
    arrivalEl.innerHTML = `<div class="empty-state">No rides yet. Get folks to submit.</div>`;
  } else {
    // Sort by date then time
    const sorted = [...arrRides].sort(
      (a, b) => a.date.localeCompare(b.date) || a.pickupTime - b.pickupTime
    );
    for (const r of sorted) {
      arrivalEl.appendChild(renderRide(r, "arrival"));
    }
    for (const d of directDrivers) {
      arrivalEl.appendChild(renderRide(d, "direct"));
    }
  }

  // DEPARTURES
  const { rides: depRides, unassigned: depUnassigned } = planDepartures(submissions);
  const departureEl = $("departures");
  departureEl.innerHTML = "";

  const depCount = depRides.length;
  $("departure-meta").textContent = depCount === 0 ? "Nothing scheduled" : `${depCount} airport runs`;

  if (depRides.length === 0) {
    departureEl.innerHTML = `<div class="empty-state">No Sunday airport runs yet.</div>`;
  } else {
    const sorted = [...depRides].sort(
      (a, b) => a.date.localeCompare(b.date) || a.leaveBy - b.leaveBy
    );
    for (const r of sorted) {
      departureEl.appendChild(renderRide(r, "departure"));
    }
  }

  // UNASSIGNED — merge arrival + departure entries for the same person
  const mergedById = new Map();
  for (const p of arrUnassigned) {
    mergedById.set(p.id, { person: p, arrivalReason: p.reason, departureReason: null });
  }
  for (const p of depUnassigned) {
    const existing = mergedById.get(p.id);
    if (existing) {
      // Use the departure record's data since it carries the return-flight fields
      existing.person = { ...existing.person, ...p };
      existing.departureReason = p.reason;
    } else {
      mergedById.set(p.id, { person: p, arrivalReason: null, departureReason: p.reason });
    }
  }

  const merged = [...mergedById.values()];
  if (merged.length > 0) {
    $("unassigned-section").classList.remove("hidden");
    const ul = $("unassigned");
    ul.innerHTML = "";
    for (const { person, arrivalReason, departureReason } of merged) {
      const card = document.createElement("div");
      card.className = "ride unassigned-card";
      const pills = [];
      const reasonLines = [];
      const detailLines = [];
      if (arrivalReason) {
        pills.push(`<span class="pill danger">Arrival</span>`);
        reasonLines.push(arrivalReason);
        detailLines.push(renderPassengerLine(person, "arrival"));
      }
      if (departureReason) {
        pills.push(`<span class="pill danger">Sunday departure</span>`);
        reasonLines.push(departureReason);
        detailLines.push(renderPassengerLine(person, "departure"));
      }
      card.innerHTML = `
        <h3>${escapeHtml(person.name)} ${pills.join(" ")}</h3>
        <div class="when">${reasonLines.map(escapeHtml).join("<br>")}</div>
        <div>${detailLines.join("<br>")}</div>
      `;
      ul.appendChild(card);
    }
  } else {
    $("unassigned-section").classList.add("hidden");
  }
}

function renderRide(r, kind) {
  const div = document.createElement("div");
  div.className = "ride";
  if (r.flags?.some((f) => f.level === "warn")) div.classList.add("warn");
  if (r.flags?.some((f) => f.level === "danger")) div.classList.add("conflict");

  let header, when, pillText, pillCls;

  if (kind === "arrival") {
    pillText = "Arrival";
    pillCls = "";
    header = `${r.driverName}'s car → ${r.airportName}`;
    const pickupStr = r.pickupAnytime ? "anytime" : fmtTime(r.pickupTime);
    when = `${fmtDate(r.date)} · pickup ${pickupStr} at ${r.airport}`;
  } else if (kind === "direct") {
    pillText = "Direct";
    pillCls = "green";
    header = `${r.driverName}'s car → straight to Cadiz`;
    const passingHint = r.passingAirport ? ` (passing ${r.passingAirport})` : "";
    when = r.leaveTime != null
      ? `${fmtDate(r.date)} · leaving for Airbnb ${fmtTime(r.leaveTime)}${passingHint}`
      : `${fmtDate(r.date)}${passingHint}`;
    if ((r.passengers || []).length === 0) div.classList.add("empty");
  } else {
    pillText = "Sunday";
    pillCls = "";
    header = `${r.driverName}'s car → ${r.airportName}`;
    when = `${fmtDate(r.date)} · leave Cadiz by ${fmtTime(r.leaveBy)}`;
  }

  div.innerHTML = `
    <h3>${escapeHtml(header)} <span class="pill ${pillCls}">${pillText}</span></h3>
    <div class="when">${escapeHtml(when)} · driver: ${escapeHtml(r.driverPhone || "")}</div>
    ${
      r.passengers && r.passengers.length > 0
        ? `<ul>${r.passengers.map((p) => `<li>${renderPassengerLine(p, kind)}</li>`).join("")}</ul>`
        : kind === "direct"
        ? `<div style="color:var(--ink-soft); font-style: italic; font-size:0.9rem;">No passengers — riding solo.</div>`
        : `<div style="color:var(--ink-soft); font-style: italic; font-size:0.9rem;">No passengers assigned.</div>`
    }
    ${(r.flags || []).map((f) => `<div class="flag ${f.level === "warn" ? "warn" : ""}">${escapeHtml(f.msg)}</div>`).join("")}
  `;
  return div;
}

function renderPassengerLine(p, kind) {
  if (p.mode === "flying" || p.arriveAirport) {
    if (kind === "departure") {
      const ret = p.returnTime && p.returnAirport
        ? ` flies out ${fmtDate(p.returnDate)} ${fmtTime(toMin(p.returnDate, p.returnTime))} from ${p.returnAirport}`
        : "";
      return `<strong>${escapeHtml(p.name)}</strong>${ret ? " ·" + ret : ""}`;
    }
    const arr = p.arriveTime && p.arriveAirport
      ? ` gets into ${p.arriveAirport} at ${fmtTime(toMin(p.arriveDate, p.arriveTime))}`
      : "";
    return `<strong>${escapeHtml(p.name)}</strong>${arr}`;
  }
  if (p.mode === "kentucky") {
    return `<strong>${escapeHtml(p.name)}</strong> (from ${escapeHtml(p.town || "KY")})`;
  }
  return `<strong>${escapeHtml(p.name)}</strong>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Live subscription
const q = query(SUBMISSIONS, orderBy("createdAt"));
onSnapshot(q, (snap) => {
  const subs = snapToList(snap);
  render(subs);
});
