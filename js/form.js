import { SUBMISSIONS, addDoc, serverTimestamp } from "./firebase.js";

const $ = (id) => document.getElementById(id);

let role = null;
let passengerMode = null;
let driverAirport = null;
let sundayMode = null;
let kyNeedsRide = null;

function setActive(container, target) {
  container.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === target));
}

// Role picker
$("role-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-role]");
  if (!btn) return;
  role = btn.dataset.role;
  setActive($("role-picker"), btn);
  $("entry-form").classList.remove("hidden");
  $("driver-fields").classList.toggle("hidden", role !== "driver");
  $("passenger-fields").classList.toggle("hidden", role !== "passenger");
});

// Driver airport
$("driver-airport-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-airport]");
  if (!btn) return;
  driverAirport = btn.dataset.airport;
  setActive($("driver-airport-picker"), btn);
  $("driver-airport-time-wrap").classList.toggle("hidden", driverAirport === "none");
});

// Sunday picker
$("sunday-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sunday]");
  if (!btn) return;
  sundayMode = btn.dataset.sunday;
  setActive($("sunday-picker"), btn);
  $("sunday-time-wrap").classList.toggle("hidden", sundayMode !== "time");
});

// Passenger mode
$("passenger-mode-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  passengerMode = btn.dataset.mode;
  setActive($("passenger-mode-picker"), btn);
  $("flying-fields").classList.toggle("hidden", passengerMode !== "flying");
  $("kentucky-fields").classList.toggle("hidden", passengerMode !== "kentucky");
});

// Return-same-airport
$("return-same-airport").addEventListener("change", (e) => {
  $("return-airport-wrap").classList.toggle("hidden", e.target.checked);
});

// KY needs ride
$("ky-needs-ride-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-needs]");
  if (!btn) return;
  kyNeedsRide = btn.dataset.needs;
  setActive($("ky-needs-ride-picker"), btn);
  $("ky-return-fields").classList.toggle("hidden", kyNeedsRide !== "yes");
});

function showError(msg) {
  const el = $("form-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearError() {
  $("form-error").classList.add("hidden");
}

function val(id) { return $(id).value.trim(); }

$("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const name = val("name");
  const phone = val("phone");
  if (!name) return showError("Name is required.");
  if (!phone) return showError("Phone is required.");

  const base = {
    role,
    name,
    phone,
    createdAt: serverTimestamp(),
  };

  let payload;

  if (role === "driver") {
    const capacity = parseInt(val("capacity"), 10);
    if (!capacity || capacity < 1) return showError("How many seats?");
    const arriveDate = val("driver-arrive-date");
    const arriveTime = val("driver-arrive-time");
    if (!arriveDate || !arriveTime) return showError("When are you arriving at the Airbnb?");
    if (!driverAirport) return showError("Pick whether you're stopping at an airport on the way.");
    if (!sundayMode) return showError("Tell us about your Sunday departure.");
    if (sundayMode === "time" && !val("sunday-leave-time")) return showError("What time can you leave Sunday?");
    if (driverAirport !== "none" && !val("driver-airport-time"))
      return showError("What time would you be at the airport?");

    payload = {
      ...base,
      capacity,
      arriveDate,
      arriveTime,
      passingAirport: driverAirport === "none" ? null : driverAirport,
      passingAirportTime: driverAirport === "none" ? null : val("driver-airport-time"),
      sundayLatestLeave: sundayMode === "whenever" ? "whenever" : val("sunday-leave-time"),
      notes: val("driver-notes"),
    };
  } else if (role === "passenger") {
    if (!passengerMode) return showError("Flying in or already in KY?");
    if (passengerMode === "flying") {
      const ad = val("arrive-date"), at = val("arrive-time"), aa = val("arrive-airport");
      const rd = val("return-date"), rt = val("return-time");
      if (!ad || !at) return showError("When does your flight get in?");
      if (!aa) return showError("Which arrival airport?");
      if (!rd || !rt) return showError("When does your return flight leave?");
      const sameReturn = $("return-same-airport").checked;
      const ra = sameReturn ? aa : val("return-airport");
      if (!ra) return showError("Which return airport?");

      payload = {
        ...base,
        mode: "flying",
        arriveDate: ad,
        arriveTime: at,
        arriveAirport: aa,
        returnDate: rd,
        returnTime: rt,
        returnAirport: ra,
        sameReturnAirport: sameReturn,
        notes: val("passenger-notes"),
      };
    } else {
      const town = val("ky-town");
      const ad = val("ky-arrive-date"), at = val("ky-arrive-time");
      if (!town) return showError("What town are you in?");
      if (!ad || !at) return showError("When are you getting to the Airbnb?");
      if (!kyNeedsRide) return showError("Do you need a ride to the airport Sunday?");
      let returnInfo = {};
      if (kyNeedsRide === "yes") {
        const rd = val("ky-return-date"), rt = val("ky-return-time"), ra = val("ky-return-airport");
        if (!rd || !rt || !ra) return showError("Fill in your return flight info.");
        returnInfo = { returnDate: rd, returnTime: rt, returnAirport: ra };
      }

      payload = {
        ...base,
        mode: "kentucky",
        town,
        arriveDate: ad,
        arriveTime: at,
        needsAirportRide: kyNeedsRide === "yes",
        ...returnInfo,
        notes: val("passenger-notes"),
      };
    }
  } else {
    return showError("Pick driver or passenger first.");
  }

  const btn = $("submit-btn");
  btn.disabled = true;
  btn.textContent = "Locking in...";
  try {
    await addDoc(SUBMISSIONS, payload);
    $("form-card").classList.add("hidden");
    $("success-card").classList.remove("hidden");
  } catch (err) {
    showError("Submit failed: " + err.message);
    btn.disabled = false;
    btn.textContent = "Lock it in";
  }
});

$("reset-btn").addEventListener("click", () => location.reload());
$("add-another-btn").addEventListener("click", () => location.reload());
