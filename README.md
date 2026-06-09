# last-ride-logistics

Static site to coordinate rides for Hunter's bachelor party (Cadiz, KY · July 9–13, 2026).

Guys submit their travel info, the site auto-builds a ride plan to/from the airport, and the admin page lets you edit anything by hand.

## Stack

- Static HTML/CSS/vanilla JS (no build step)
- Firebase Firestore for shared data (test-mode rules, gated by URL-secrecy)
- Hosted on GitHub Pages

## Pages

- `/` — submission form (driver or passenger)
- `/plan.html` — live ride plan, updates in realtime
- `/admin.html` — password-gated dashboard: edit/delete submissions, view raw JSON

## One-time setup

1. **Firestore rules** — Firebase Console → Firestore Database → Rules → paste contents of `firestore.rules` → Publish.
2. **Admin password** — change `ADMIN_PASSWORD` in `js/admin.js`. The current placeholder is in the file; rotate before sending out the public link.

## Deploying

GitHub Pages, branch `main`, root folder. Push and enable:

```bash
git add .
git commit -m "Initial scaffold"
git push -u origin main

gh repo edit --enable-pages --pages-branch main --pages-path /
```

Site will be at `https://tjab1.github.io/last-ride-logistics/`.

## Adjusting the scheduler

- `js/airports.js` — drive times from each airport to Cadiz, preflight buffer.
- `js/scheduler.js` — greedy arrival/departure matching logic. Knobs at the top: `ARRIVAL_CLUSTER_MIN`, `DEPLANE_BUFFER_MIN`.

## Notes

- Firebase config is committed and that's fine — it's public-by-design. Firestore rules are what gate the data.
- The admin password is client-side only. It's "security through a closed door," not a vault. Don't put anything sensitive in submissions.
