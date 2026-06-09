import { AIRPORTS, PREFLIGHT_BUFFER_MIN } from "./airports.js";

// Window in minutes — passengers arriving within this much of each other (same airport, same day)
// can share a ride.
const ARRIVAL_CLUSTER_MIN = 90;
// Buffer between flight arrival and pickup (deplaning, bags, etc.)
const DEPLANE_BUFFER_MIN = 30;

function toMin(date, time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
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
// For each flying passenger, find a driver who:
//   - is passing the same airport
//   - is at the airport at-or-after passenger arrival + DEPLANE_BUFFER_MIN
//   - has remaining capacity
// Greedy: passengers sorted by arrival time, assigned to earliest-available driver.

export function planArrivals(submissions) {
  const drivers = submissions.filter((s) => s.role === "driver");
  const flying = submissions.filter(
    (s) => s.role === "passenger" && s.mode === "flying"
  );

  // Driver state: remaining capacity by id
  const remaining = {};
  drivers.forEach((d) => (remaining[d.id] = d.capacity || 0));

  // Group passengers by airport+date, sort by time
  const byAirportDate = {};
  flying.forEach((p) => {
    const key = `${p.arriveAirport}|${p.arriveDate}`;
    (byAirportDate[key] ||= []).push(p);
  });
  Object.values(byAirportDate).forEach((arr) =>
    arr.sort((a, b) => toMin(a.arriveDate, a.arriveTime) - toMin(b.arriveDate, b.arriveTime))
  );

  // Build rides
  const rides = []; // {driverId, airport, date, pickupTime (min), passengers: [], flags: []}
  const unassigned = [];

  for (const [key, passengers] of Object.entries(byAirportDate)) {
    const [airport, date] = key.split("|");
    // Find candidate drivers for this airport+date
    const candidates = drivers
      .filter((d) => d.passingAirport === airport && d.arriveDate === date)
      .sort((a, b) => toMin(date, a.passingAirportTime) - toMin(date, b.passingAirportTime));

    let didx = 0;
    let currentRide = null;

    for (const p of passengers) {
      const pTime = toMin(date, p.arriveTime) + DEPLANE_BUFFER_MIN;

      // Continue current ride if within cluster window AND driver still has room
      if (
        currentRide &&
        remaining[currentRide.driverId] > 0 &&
        pTime - currentRide.pickupTime <= ARRIVAL_CLUSTER_MIN
      ) {
        currentRide.passengers.push(p);
        currentRide.pickupTime = Math.max(currentRide.pickupTime, pTime);
        remaining[currentRide.driverId]--;
        continue;
      }

      // Otherwise, find a driver who can be at the airport by pTime, has room
      let chosen = null;
      for (let i = didx; i < candidates.length; i++) {
        const d = candidates[i];
        const dTime = toMin(date, d.passingAirportTime);
        if (remaining[d.id] > 0 && dTime >= pTime - 30) {
          chosen = d;
          didx = i;
          break;
        }
      }

      if (!chosen) {
        // Fallback: any driver at this airport on this date with remaining capacity
        chosen = candidates.find((d) => remaining[d.id] > 0);
      }

      if (!chosen) {
        unassigned.push({ ...p, reason: `No driver passing ${airport} on ${fmtDate(date)}` });
        continue;
      }

      const dTime = toMin(date, chosen.passingAirportTime);
      const pickupTime = Math.max(dTime, pTime);
      currentRide = {
        type: "arrival",
        driverId: chosen.id,
        driverName: chosen.name,
        driverPhone: chosen.phone,
        airport,
        airportName: AIRPORTS[airport]?.name || airport,
        date,
        pickupTime,
        passengers: [p],
        flags: [],
      };
      if (dTime < pTime - 30) {
        currentRide.flags.push({
          level: "warn",
          msg: `Driver was at airport at ${fmtTime(dTime)} but ${p.name} doesn't land until ${fmtTime(toMin(date, p.arriveTime))}. Driver may need to wait.`,
        });
      }
      rides.push(currentRide);
      remaining[chosen.id]--;
    }
  }

  // Drivers with no airport assignment (direct to Airbnb)
  const directDrivers = drivers
    .filter((d) => !rides.some((r) => r.driverId === d.id))
    .map((d) => ({
      type: "direct",
      driverId: d.id,
      driverName: d.name,
      driverPhone: d.phone,
      date: d.arriveDate,
      pickupTime: d.arriveTime ? toMin(d.arriveDate, d.arriveTime) : null,
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
