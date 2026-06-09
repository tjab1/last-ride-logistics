import { AIRPORTS, PREFLIGHT_BUFFER_MIN } from "./airports.js";

// Buffer between flight arrival and pickup (deplaning, bags, etc.)
const DEPLANE_BUFFER_MIN = 30;
// Flag if driver-arrives more than this long after passenger lands (warn, don't block)
const LONG_WAIT_FLAG_MIN = 4 * 60;

function toMin(date, time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Absolute minutes for a (date, time). Used when comparing across days.
function toAbs(date, time) {
  if (!date || !time) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

// Shift an ISO date back by N days. "2026-07-13" - 1 → "2026-07-12"
function shiftDate(date, deltaDays) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

// Normalize a (date, minutes-since-midnight) where minutes may be negative or >=1440.
// Returns { date, minutes } where 0 <= minutes < 1440.
function normalizeDateTime(date, minutes) {
  let days = Math.floor(minutes / 1440);
  let mins = minutes - days * 1440;
  return { date: shiftDate(date, days), minutes: mins };
}

function fmtTime(mins) {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  let h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// --------------- ARRIVALS ---------------
// Each driver passing an airport picks up any passengers at that airport who landed
// before (or just after) the driver's pass time. Passengers arriving on earlier days
// are eligible for a later driver's pass — they just wait at/near the airport.
// Greedy: drivers in chronological order; each takes the earliest-arriving unassigned
// passengers at their airport up to capacity.

export function planArrivals(submissions) {
  const drivers = submissions.filter((s) => s.role === "driver");
  const flying = submissions.filter(
    (s) => s.role === "passenger" && s.mode === "flying"
  );

  // Assigned set: passenger ids that already have a ride
  const assigned = new Set();

  // Sort drivers by absolute airport-pass datetime.
  // "anytime" drivers get treated as end-of-day on their arriveDate (matches anyone
  // who landed earlier that day or before).
  const driversByPass = drivers
    .filter((d) => d.passingAirport && d.passingAirportTime && d.arriveDate)
    .map((d) => ({
      ...d,
      _isAnytime: d.passingAirportTime === "anytime",
      _absPass:
        d.passingAirportTime === "anytime"
          ? toAbs(d.arriveDate, "23:59")
          : toAbs(d.arriveDate, d.passingAirportTime),
    }))
    .sort((a, b) => a._absPass - b._absPass);

  const rides = [];

  for (const d of driversByPass) {
    const cap = d.capacity || 0;
    if (cap <= 0) continue;

    // Eligible passengers: same airport, not yet assigned, landed before driver passes
    // (with deplane buffer; allow 30 min grace so driver arriving slightly early counts).
    const eligible = flying
      .filter((p) => p.arriveAirport === d.passingAirport && !assigned.has(p.id))
      .map((p) => ({ ...p, _absLand: toAbs(p.arriveDate, p.arriveTime) }))
      .filter((p) => p._absLand != null && p._absLand + DEPLANE_BUFFER_MIN - 30 <= d._absPass)
      .sort((a, b) => a._absLand - b._absLand);

    if (eligible.length === 0) continue;

    const taken = eligible.slice(0, cap);
    const flags = [];
    if (!d._isAnytime) {
      for (const p of taken) {
        const waitMin = d._absPass - (p._absLand + DEPLANE_BUFFER_MIN);
        if (waitMin >= LONG_WAIT_FLAG_MIN) {
          flags.push({
            level: "warn",
            msg: `${p.name} lands ${fmtDate(p.arriveDate)} ${fmtTime(toMin(p.arriveDate, p.arriveTime))} — ${Math.round(waitMin / 60)}h before pickup.`,
          });
        }
      }
    }

    rides.push({
      type: "arrival",
      driverId: d.id,
      driverName: d.name,
      driverPhone: d.phone,
      airport: d.passingAirport,
      airportName: AIRPORTS[d.passingAirport]?.name || d.passingAirport,
      date: d.arriveDate,
      pickupTime: d._isAnytime ? null : toMin(d.arriveDate, d.passingAirportTime),
      pickupAnytime: d._isAnytime,
      passengers: taken,
      flags,
    });
    taken.forEach((p) => assigned.add(p.id));
  }

  // Anyone unassigned
  const unassigned = flying
    .filter((p) => !assigned.has(p.id))
    .map((p) => ({
      ...p,
      reason: `No driver swings by ${p.arriveAirport} after you land`,
    }));

  // Drivers with no airport pickup (no eligible passengers) — show as direct
  const directDrivers = drivers
    .filter((d) => !rides.some((r) => r.driverId === d.id))
    .map((d) => ({
      type: "direct",
      driverId: d.id,
      driverName: d.name,
      driverPhone: d.phone,
      date: d.arriveDate,
      leaveTime: d.arriveTime ? toMin(d.arriveDate, d.arriveTime) : null,
      passengers: [],
      flags: [],
      passingAirport: d.passingAirport,
    }));

  return { rides, directDrivers, unassigned };
}

// --------------- SUNDAY DEPARTURES ---------------
// Backtracking search over (passenger × driver/ride) assignments.
// Goal: maximize number of passengers served.
// Constraints:
//   - Each driver makes at most ONE Sunday airport run (they go home from the airport)
//   - A trip serves passengers all going to the same return airport
//   - Trip leave time = earliest deadline among its passengers (auto-feasible for all)
//   - Driver "latest leave on Sunday" must be ≥ the trip's leave time (i.e., they're
//     willing to be in Cadiz that late). A driver who can stay later is more flexible.

export function planDepartures(submissions) {
  const drivers = submissions.filter((s) => s.role === "driver");
  const allPassengers = submissions.filter((s) => {
    if (s.role !== "passenger") return false;
    if (s.mode === "flying") return true;
    if (s.mode === "kentucky" && s.needsAirportRide) return true;
    return false;
  });

  const enriched = allPassengers
    .filter((p) => p.returnDate && p.returnTime && p.returnAirport)
    .map((p) => {
      const flightMin = toMin(p.returnDate, p.returnTime);
      const driveMin = AIRPORTS[p.returnAirport]?.driveMin ?? 240;
      const mustLeaveBy = flightMin - driveMin - PREFLIGHT_BUFFER_MIN;
      const norm = normalizeDateTime(p.returnDate, mustLeaveBy);
      return { ...p, mustLeaveBy, flightMin, driveMin, leaveDate: norm.date, leaveMin: norm.minutes };
    });

  // Tightest-deadline first — drives pruning and produces stable output
  enriched.sort((a, b) => {
    if (a.leaveDate !== b.leaveDate) return a.leaveDate.localeCompare(b.leaveDate);
    return a.leaveMin - b.leaveMin;
  });

  // Driver's latest acceptable leave time, as absolute minutes anchored to Sun 7/12.
  // Lets us compare across midnight-spanning rides.
  const driverLatestAbs = (d) => {
    if (!d.sundayLatestLeave || d.sundayLatestLeave === "whenever") {
      // "Whenever" = no constraint. Use end-of-Monday as the cap.
      return toAbs("2026-07-13", "23:59");
    }
    return toAbs("2026-07-12", d.sundayLatestLeave);
  };

  const driverList = drivers.map((d) => ({
    ...d,
    _cap: d.capacity || 0,
    _latestAbs: driverLatestAbs(d),
  }));

  const best = { covered: -1, rides: [] };

  // Backtracking: for each passenger in tightest-deadline order, try (skip / add-to-ride / new-ride).
  function search(pIdx, rides, usedDriverIds) {
    const currentCovered = rides.reduce((s, r) => s + r.passengers.length, 0);
    const remaining = enriched.length - pIdx;
    if (currentCovered + remaining <= best.covered) return; // prune

    if (pIdx >= enriched.length) {
      if (currentCovered > best.covered) {
        best.covered = currentCovered;
        best.rides = rides.map((r) => ({
          driver: r.driver,
          airport: r.airport,
          leaveDate: r.leaveDate,
          leaveBy: r.leaveBy,
          passengers: [...r.passengers],
        }));
      }
      return;
    }

    const p = enriched[pIdx];

    // Option A: leave this passenger unassigned
    search(pIdx + 1, rides, usedDriverIds);

    // Option B: add to an existing compatible ride
    for (const ride of rides) {
      if (ride.airport !== p.returnAirport) continue;
      if (ride.leaveDate !== p.leaveDate) continue;
      if (ride.passengers.length >= ride.driver._cap) continue;
      // After adding p, ride.leaveBy might shift earlier; driver must still be willing
      const newLeaveBy = Math.min(ride.leaveBy, p.leaveMin);
      const newLeaveAbs = toAbs(ride.leaveDate, minToHHMM(newLeaveBy));
      if (newLeaveAbs > ride.driver._latestAbs) continue; // driver wants to leave earlier than this
      const oldLeaveBy = ride.leaveBy;
      ride.passengers.push(p);
      ride.leaveBy = newLeaveBy;
      search(pIdx + 1, rides, usedDriverIds);
      ride.passengers.pop();
      ride.leaveBy = oldLeaveBy;
    }

    // Option C: start a new ride with an unused driver
    for (const d of driverList) {
      if (usedDriverIds.has(d.id)) continue;
      if (d._cap < 1) continue;
      const newLeaveAbs = toAbs(p.leaveDate, minToHHMM(p.leaveMin));
      if (newLeaveAbs > d._latestAbs) continue; // driver wants to leave before passenger's deadline
      rides.push({
        driver: d,
        airport: p.returnAirport,
        leaveDate: p.leaveDate,
        leaveBy: p.leaveMin,
        passengers: [p],
      });
      usedDriverIds.add(d.id);
      search(pIdx + 1, rides, usedDriverIds);
      rides.pop();
      usedDriverIds.delete(d.id);
    }
  }

  search(0, [], new Set());

  const finalRides = best.rides.map((r) => ({
    type: "departure",
    driverId: r.driver.id,
    driverName: r.driver.name,
    driverPhone: r.driver.phone,
    airport: r.airport,
    airportName: AIRPORTS[r.airport]?.name || r.airport,
    date: r.leaveDate,
    leaveBy: r.leaveBy,
    passengers: r.passengers,
    flags: [],
  }));

  const assignedIds = new Set(finalRides.flatMap((r) => r.passengers.map((p) => p.id)));
  const unassigned = enriched
    .filter((p) => !assignedIds.has(p.id))
    .map((p) => ({
      ...p,
      reason: `No driver available to ${p.returnAirport} by ${fmtDate(p.leaveDate)} ${fmtTime(p.leaveMin)}`,
    }));

  return { rides: finalRides, unassigned };
}

function minToHHMM(m) {
  const h = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${h}:${mm}`;
}

export const helpers = { fmtTime, fmtDate, toMin };
