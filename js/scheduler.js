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

  // Sort drivers by absolute airport-pass datetime
  const driversByPass = drivers
    .filter((d) => d.passingAirport && d.passingAirportTime && d.arriveDate)
    .map((d) => ({
      ...d,
      _absPass: toAbs(d.arriveDate, d.passingAirportTime),
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
    for (const p of taken) {
      const waitMin = d._absPass - (p._absLand + DEPLANE_BUFFER_MIN);
      if (waitMin >= LONG_WAIT_FLAG_MIN) {
        flags.push({
          level: "warn",
          msg: `${p.name} lands ${fmtDate(p.arriveDate)} ${fmtTime(toMin(p.arriveDate, p.arriveTime))} — ${Math.round(waitMin / 60)}h before pickup.`,
        });
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
      pickupTime: toMin(d.arriveDate, d.passingAirportTime),
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
// For each passenger who needs a Sunday airport ride:
//   - compute must-leave-Cadiz-by = flightTime - airportDriveMin - PREFLIGHT_BUFFER_MIN
//   - find drivers who can leave Cadiz at-or-before that time AND go to that airport
//   - greedy: assign tightest-deadline passenger first

export function planDepartures(submissions) {
  const drivers = submissions.filter((s) => s.role === "driver");
  const passengers = submissions.filter((s) => {
    if (s.role !== "passenger") return false;
    if (s.mode === "flying") return true;
    if (s.mode === "kentucky" && s.needsAirportRide) return true;
    return false;
  });

  // Annotate each passenger with mustLeaveBy (minutes from midnight on returnDate)
  const enriched = passengers
    .filter((p) => p.returnDate && p.returnTime && p.returnAirport)
    .map((p) => {
      const flightMin = toMin(p.returnDate, p.returnTime);
      const driveMin = AIRPORTS[p.returnAirport]?.driveMin ?? 240;
      const mustLeaveBy = flightMin - driveMin - PREFLIGHT_BUFFER_MIN;
      return { ...p, mustLeaveBy, flightMin, driveMin };
    });

  // Drivers: remaining capacity, latest leave time (whenever = very late)
  const remaining = {};
  drivers.forEach((d) => (remaining[d.id] = d.capacity || 0));

  const driverLatestLeave = (d) => {
    if (!d.sundayLatestLeave || d.sundayLatestLeave === "whenever") return 24 * 60 - 1;
    return toMin("2026-07-12", d.sundayLatestLeave);
  };

  // Sort passengers by tightest deadline (earliest mustLeaveBy)
  enriched.sort((a, b) => a.mustLeaveBy - b.mustLeaveBy);

  const rides = []; // {airport, date, leaveBy, passengers, driverId, flags}
  const unassigned = [];

  // Index drivers by airport availability (a driver can serve any airport — but only one trip)
  // For v1, each driver does one Sunday airport run.
  const driverAssignedAirport = {};

  for (const p of enriched) {
    // Find an existing ride going to same airport on same day where we can squeeze in
    let ride = rides.find(
      (r) =>
        r.airport === p.returnAirport &&
        r.date === p.returnDate &&
        remaining[r.driverId] > 0 &&
        // ride's leaveBy must still be feasible for this passenger
        r.leaveBy <= p.mustLeaveBy
    );

    if (ride) {
      ride.passengers.push(p);
      ride.leaveBy = Math.min(ride.leaveBy, p.mustLeaveBy);
      remaining[ride.driverId]--;
      continue;
    }

    // Find a driver who can take this passenger
    const candidate = drivers.find((d) => {
      if (remaining[d.id] <= 0) return false;
      // If driver already assigned an airport, must match
      if (driverAssignedAirport[d.id] && driverAssignedAirport[d.id] !== p.returnAirport) return false;
      // Driver's latest-leave must be at-or-before passenger's mustLeaveBy
      // ("latest leave" means the driver can leave NO LATER than this — so they're flexible to leave earlier)
      if (driverLatestLeave(d) < p.mustLeaveBy) return false;
      return true;
    });

    if (!candidate) {
      unassigned.push({
        ...p,
        reason: `No driver can leave Cadiz by ${fmtTime(p.mustLeaveBy)} for ${p.returnAirport}`,
      });
      continue;
    }

    driverAssignedAirport[candidate.id] = p.returnAirport;
    ride = {
      type: "departure",
      driverId: candidate.id,
      driverName: candidate.name,
      driverPhone: candidate.phone,
      airport: p.returnAirport,
      airportName: AIRPORTS[p.returnAirport]?.name || p.returnAirport,
      date: p.returnDate,
      leaveBy: p.mustLeaveBy,
      passengers: [p],
      flags: [],
    };
    rides.push(ride);
    remaining[candidate.id]--;
  }

  return { rides, unassigned };
}

export const helpers = { fmtTime, fmtDate, toMin };
