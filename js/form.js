import { SUBMISSIONS, addDoc, serverTimestamp } from "./firebase.js";

const $ = (id) => document.getElementById(id);

let role = null;
let passengerMode = null;
let driverAirport = null;
let sundayMode = null;
let airportHelp = null; // "yes" or "no"
let airportTimeMode = null; // "time" or "anytime"

function setActive(container, target) {
  container.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === target));
}

function showTakeover(src, durationMs, after) {
  const el = $("takeover");
  $("takeover-img").src = src;
  el.classList.remove("hidden");
  setTimeout(() => {
    el.classList.add("hidden");
    if (after) after();
  }, durationMs);
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

// Airport help (Down / Naw cheif)
$("driver-airport-help-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-help]");
  if (!btn) return;
  airportHelp = btn.dataset.help;
  setActive($("driver-airport-help-picker"), btn);

  if (airportHelp === "no") {
    // Hide the "Down" button and lock the "Naw cheif" button to the joke text
    btn.textContent = "I'm a good boy and don't have a choice";
    btn.disabled = true;
    const yesBtn = $("driver-airport-help-picker").querySelector('[data-help="yes"]');
    if (yesBtn) yesBtn.classList.add("hidden");
    showTakeover("img/takeover.png", 3000);
  }
  $("driver-airport-pick-wrap").classList.remove("hidden");
});

// Driver airport
$("driver-airport-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-airport]");
  if (!btn) return;
  driverAirport = btn.dataset.airport;
  setActive($("driver-airport-picker"), btn);
});

// Airport time mode (Set a time / Anytime)
$("airport-time-picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-airport-time]");
  if (!btn) return;
  airportTimeMode = btn.dataset.airportTime;
  setActive($("airport-time-picker"), btn);
  $("driver-airport-time-wrap").classList.toggle("hidden", airportTimeMode !== "time");
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
    if (!arriveDate || !arriveTime) return showError("When are you leaving for the Airbnb?");
    if (!airportHelp) return showError("Can you grab people from the airport?");
    if (!driverAirport) return showError("Which airport are you swinging by?");
    if (!airportTimeMode) return showError("What time can you be at the airport?");
    if (airportTimeMode === "time" && !val("driver-airport-time"))
      return showError("Pick a time or choose 'Anytime'.");
    if (!sundayMode) return showError("Tell us about your Sunday departure.");
    if (sundayMode === "time" && !val("sunday-leave-time")) return showError("What time can you leave Sunday?");

    payload = {
      ...base,
      capacity,
      arriveDate,
      arriveTime,
      passingAirport: driverAirport,
      passingAirportTime: airportTimeMode === "anytime" ? "anytime" : val("driver-airport-time"),
      airportHelpWilling: airportHelp === "yes",
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
      if (!town) return showError("What town are you in?");

      payload = {
        ...base,
        mode: "kentucky",
        town,
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

$("reset-btn").addEventListener("click", () => showTakeover("img/startover.jpg", 3000, () => location.reload()));
$("add-another-btn").addEventListener("click", () => location.reload());
