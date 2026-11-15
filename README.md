# Najaf stays

Hotel planning for FH Mumbai groups in Najaf. The app pulls every approved
group that arranges its own hotel from NKERP, then places each one in **Ruya**,
**Araf** or **Hotel C**, night by night, so the extra hotels can be booked in
advance.

## Run it

```bash
npm install
cp .env.example .env      # then fill in NKERP_LOGIN_ID and NKERP_PASSWORD
npm run dev               # http://localhost:8787
```

### Live site (Cloudflare)

<https://najaf-stays.tmoosabhoy6.workers.dev> runs on Cloudflare Workers
(`worker/index.mjs`, `wrangler.jsonc`). The Worker serves the app and runs the
NKERP pull. The NKERP login is stored as two Worker secrets, `NKERP_LOGIN_ID`
and `NKERP_PASSWORD`, which stay in place across deploys. The app has no
login of its own: anyone with the link can use it.

`npm run build` builds the app and bundles it into the Worker
(`scripts/embed-assets.mjs`); `npm run deploy` builds and deploys.

To deploy automatically on every push to `main`, connect the repo once in the
Cloudflare dashboard: Workers & Pages → najaf-stays → Settings → Build →
Connect, branch `main`, build command `npm run build`, deploy command
`npx wrangler deploy`.

`npm test` runs the planner and NKERP-reading tests.

## How a plan is made

1. **Pull.** Pick the first night (and a last night, or leave it open for
   everything approved so far). The server signs in to NKERP and reads:
   - the Najaf tour lists for the office (stay dates, ports, flight codes, the
     Karbala → Najaf leg, and "accommodation not required" guests), and
   - the transport dashboards day by day (arrivals, departures, sub-venue
     transfers) to confirm each departure and catch any group the lists missed.
2. **Groups.** Every tour found is listed. Type the rooms each one needs in
   Ruya (`5x2` = five 2-bed rooms, `2,2,3`, `2 x 5-bed`, `5x2 + 1x3`), or keep
   a group in a chosen hotel.
3. **Plan.** One column per night with the guests in each hotel, the list of
   bookings to make at Araf and Hotel C, and for any night who is in which
   hotel and which Ruya room. "Download Excel" exports all of it.

### Planning rules (`shared/engine.ts`)

- Hotels fill in order: Ruya, Araf, then Hotel C (no limit).
- A group is one tour's "accommodation not required" guests. It is never split
  across hotels and never moves mid-stay, so a hotel needs room for the whole
  group on every night of its stay.
- A group sleeps from its Najaf arrival date to the night before it leaves. If
  Najaf is the second half of the trip and the group flies Iraqi Airways out of
  Najaf Airport, the departure day counts as a night too.
- Beds freed by a departure go to arrivals on the same date. Groups are placed
  in arrival order, larger groups first on the same date.
- With Ruya's room list loaded, a group gets exactly the rooms it asked for or
  none. If it cannot, the whole group goes to Araf and the reason is flagged as
  either **rooms not available** (the beds were there, the rooms were not) or
  **Ruya is full** (not enough beds).

## Data still to be added (`shared/config.ts`)

| What | Where | Until then |
| --- | --- | --- |
| Ruya's room list | `RUYA_ROOMS` | Ruya is planned by head count (97 beds). A room list can also be typed in under "Hotels and rooms". |
| End-of-November running counts | `OPENING_BALANCE` | Groups already in Najaf on the first night are placed like everyone else. |
| The exact wording staff use for room requests | `shared/roomSpec.ts` | The forms listed above are understood. |

Capacities (Ruya 97, Araf 100) are in the same file.

## NKERP access

Read-only. `server/nkerp/client.mjs` can only call an explicit list of
list/search endpoints; there is no save, release or email call in the code.

## Saved on each device

Typed rooms and hotel choices are saved in the browser, per device.
