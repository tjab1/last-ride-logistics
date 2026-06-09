// Drive time from each airport to the Airbnb in Cadiz, KY (in minutes).
// Pre-flight buffer = how early to arrive at airport before scheduled departure.
export const AIRPORTS = {
  CVG: { name: "Cincinnati (CVG)", driveMin: 270 },
  SDF: { name: "Louisville (SDF)", driveMin: 180 },
  BNA: { name: "Nashville (BNA)", driveMin: 105 },
  LEX: { name: "Lexington (LEX)", driveMin: 225 },
};

export const PREFLIGHT_BUFFER_MIN = 120;

export const PARTY_DATES = {
  arriveStart: "2026-07-09",
  arriveEnd: "2026-07-12",
  departStart: "2026-07-12",
  departEnd: "2026-07-13",
};
