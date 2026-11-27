# FH-MUM NJF Hotel Accommodation Planner

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

**Saved for everyone.** The Najaf pull, hotel pax overrides, room requests,
hotel choices, settings and date ranges are stored in the shared Cloudflare
D1 database (`najaf-stays`, binding `DB`, `server/state.mjs`). Edits save as
you make them, and the Najaf bookings and approval proposals update immediately.
Devices read the shared copy when opened or brought back into view, and every
15 seconds while active. Edits to different fields on the same tour can be
saved concurrently. The header shows when an edit is saving, saved, or retrying.
`npm run dev` keeps the same data in `.data/state.json`.

The repo is connected to the Worker (Workers & Pages → najaf-stays → Settings →
Build): every push to `main` builds with `npm run build` and deploys with
`npx wrangler deploy`.

`npm test` runs the planner, room-request and NKERP-reading tests.

## How a plan is made

1. **Pull.** Pick the first night (and a last night, or leave it open for
   everything approved within the planning horizon). A successful refresh
   updates the saved hotel plan and preserves staff edits.
   The server compares each itinerary to the previous dates and route for the
   same NKERP tour ID. Changed itineraries and newly pending re-approvals are
   highlighted after the pull. The server signs in to NKERP and reads:
   - **General search → Groups** for the office: every tour with its status,
     ports, flights and sub-venue plans. Approved tours (Approved, Current,
     Completed) with a Najaf stay in the range go on.
   - **Pending tours**, including approved tours that were updated and wait
     for re-approval (NKERP lists them as Pending with no plans until it
     re-approves them). The Najaf Approvals tab proposes Najaf hotel stays for them.
     The pull reads their sub-venue plans, and "See the pending tours" on the plan lists them (status, trip
     dates, ports, latest Najaf dates if any, guests who will need a hotel);
     the Excel file has a "Pending tours" sheet. They join the plan by
     themselves once NKERP approves them and the data is pulled again.
   - **Each tour's guest list**, person by person. A guest marked
     "accommodation not required" needs a bed from us, whether or not the rest
     of the tour is housed by NKERP. Cancelled, inactive and dummy guests are
     left out; infants are counted apart (they share a bed). An approved tour
     whose guest list NKERP has not filled in yet (common a few weeks out) is
     counted from the tour's own totals (guests who need a hotel / housed by
     NKERP), marked in the Groups table, until the list is there.
2. **Plan.** The page opens straight on the plan, in the same order as the
   Excel file: a chart of guests per hotel for every night against the Ruya
   beds, with a summary per hotel; the daily plan; the bookings to make; and
   the groups. The bar under the header jumps to each section. The daily plan
   has two views: **By night** (click a night, or its column in the chart, to
   see the Ruya rooms floor by floor) and **By room** (every Ruya room against
   every night, each tour's stay as a bar in that tour's colour; click a bar
   to choose its rooms). A tour keeps the same tag colour everywhere. Under
   each arrival and departure date: "(subvenue)" for a Karbala transfer, else
   the flight code and time.
3. **Hotel pax and rooms.** Edit the number of guests who need a hotel in
   the Groups table. Enter zero to skip booking for that tour, or use
   **Use NKERP** to remove the override. The row shows the original count
   and the override. Type rooms or use **Choose rooms** for exact Ruya
   rooms. These edits save by exact tour ID, and the Najaf plan recalculates
   after each change. The Groups table can be narrowed to groups outside
   Ruya, groups changed in NKERP, or groups with no rooms typed, and searched
   by tour or group leader.
4. **Hotel messages.** One message per group in the team's format (`shared/messages.ts`),
   by check-in date, filtered by hotel, with a Copy button on each and "Copy
   all" per date. Two types: requirements only, or with the planned room
   numbers on each room line (`- Room no. 106, 107`). "Download Excel" exports the plan; its "Bookings to make" sheet has one row per tour per hotel (first and last night, nights, guests, arrival and departure flight or subvenue).

## Tour change alerts

Every 15 minutes the Worker's cron (`triggers.crons` in `wrangler.jsonc`)
pulls NKERP again for the saved Najaf and Karbala ranges, exactly like
**Pull again**, so the plan stays current without anyone opening the app.
Each pull, automatic or by hand, compares every tour ID with the previous pull
(`server/pull.mjs`) and reports:

- **Hotel pax** (guests marked "accommodation not required") and **Faiz
  accommodation** (guests NKERP houses), e.g. 4 guests moving to Faiz
  accommodation: hotel pax 42 → 38, Faiz accommodation 10 → 14
- **Infants** in the hotel, **dates** (Najaf/Karbala stays), **flights** in
  and out, and **status** (approved, pending, awaiting re-approval, cancelled)

Only tours with guests in a hotel before or after the change are reported.
The plan already uses the new data. In the app, changed rows are coloured and
listed at the top of the Najaf, Karbala and Approvals pages until someone
clicks **Mark seen** (shared for everyone, cleared after 14 days). An email
goes out at once, e.g. "Tour 2696: hotel pax changed from 42 to 38", one
email per check listing every change. If Gmail fails, the changes wait and go
with the next check. "Hotels and rooms" shows the last check and email.

A staff pull that is running makes the check skip that turn. Code:
`server/alerts.mjs` (check, email text), `server/gmail.mjs` (Gmail API),
`src/components/TourChanges.tsx` (banner, badges).

### Turning on the emails (once)

The Worker sends through the Gmail API as your Gmail account, with the
`gmail.send` permission only (it cannot read mail).

1. In <https://console.cloud.google.com/>: create a project, enable the
   **Gmail API**, set up the OAuth consent screen (External, add yourself as a
   test user) and **publish it** ("In production"). Unpublished apps get
   sign-ins that expire after 7 days. Then create an OAuth client of type
   **Desktop app**.
2. On your computer, in this repo: `npm install`, `npx wrangler login`, then
   `npm run gmail:setup`. Paste the client ID and secret, allow access in the
   browser, and enter the address(es) that should get the alerts. It sends a
   test email and saves `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
   `GMAIL_REFRESH_TOKEN` and `ALERT_EMAIL_TO` as Worker secrets.

Without these secrets the check still runs and highlights changes in the app.
To change how often it runs, edit the cron and `CHECK_MINUTES` in
`server/alerts.mjs`. Locally, `AUTO_CHECK=1` in `.env` runs the same check.

## Karbala Hotel Messages tab

A message generator only: no hotels and no room plan. Pull Karbala from NKERP
(same rules as Najaf: approved tours, guests marked "accommodation not
required", pending tours listed apart). Each group shows its tour, leader,
hotel pax, arrival, departure, nights and rooms asked for. Type the rooms and
the messages below update by themselves, one per group in the team's format
with `KARBALA (03 NIGHT)` in the heading, by check-in date, with Copy and
"Copy all" per day. Saved for everyone under the `karbala*` keys. Code:
`shared/karbala.ts`, `src/lib/karbala.ts`, `src/screens/Karbala.tsx`.

## Najaf Approvals tab

Open **Najaf Approvals** after a Najaf pull and select the tour arrival dates.
The proposal keeps the approved Najaf plan and its exact room assignments
fixed. It compares both city orders for pending hotel groups, using their
saved pax and room requirements where available. Each trip has two contiguous
stays. Even trips split equally, and odd trips give Karbala one extra night.

The planner looks for the most Ruya guest-nights while keeping each group
together. It also shows Araf and Hotel C placements, tours needing review, and
projected Najaf occupancy by night. Pull a wider range if a tour departs
beyond the saved capacity coverage. Use **Copy proposal** to review the
dates before approving in NKERP. Use **Edit pending hotel pax** to change the
number of hotel guests on a tour or restore its NKERP count. A flight that
could affect the final hotel night is flagged for staff to confirm. If the
joint search reaches its limit, the app labels its best feasible proposal.

### Typed rooms: how they are read (`shared/roomSpec.ts`)

Bed size first, then rooms, as the team writes them:

| Written | Means |
| --- | --- |
| `02 beds x 06 Rooms = 12 beds` | six 2-bed rooms (the `= 12 beds` is checked) |
| `2x6`, `2 X 6` | six 2-bed rooms |
| `6 rooms of 2 beds` | six 2-bed rooms (the words decide) |
| `2 x 5-bed` | two 5-bed rooms |
| `2,2,3` | two 2-bed rooms and one 3-bed room |

### Planning rules (`shared/engine.ts`)

- Hotels fill in order: Ruya, Araf, then Hotel C (no limit).
- A group is one tour's guests who need a hotel. It is never split across
  hotels and never moves mid-stay, so a hotel needs room for the whole group
  on every night of its stay.
- A group sleeps from its Najaf arrival date to the night before it leaves. If
  Najaf is the second half of the trip and the group flies Iraqi Airways out of
  Najaf Airport or Baghdad Airport, the departure day counts as a night too.
- Beds freed by a departure go to arrivals on the same date. Groups are placed
  in arrival order, larger groups first on the same date.
- A group gets exactly the Ruya rooms it asked for or none. If it cannot, the
  whole group goes to Araf and the reason is flagged as either **rooms not
  available in Ruya** (the beds were there, the rooms were not) or **Ruya is
  full** (not enough beds). With no request, the tightest set of rooms is used.
- Staff can keep a group in a chosen hotel, or choose its exact Ruya rooms
  ("Choose rooms" in the Groups table). Rooms chosen by hand go first and
  everyone else is planned around them; a clash, a room not in the plan or
  too few beds is flagged.
- The plan starts on 1 Dec. Groups that reached Najaf earlier are covered by
  the opening balance (rooms 109, 110, 201 and 202), so they are left out of
  the plan.

## Hotel data (`shared/config.ts`)

- **Ruya:** every room from the hotel's sheet (33 rooms, 93 beds). Rooms 310,
  312 and 314 (one 2-, 3- and 4-bed room) are left out, so the plan uses
  **84 beds**. Rooms can be put back or left out under "Hotels and rooms".
- **Opening balance:** rooms 109, 110, 201 and 202 are taken on 1 Dec and
  free from 2 Dec.
- **Araf:** 100 beds.
- **Names:** the three hotels can be renamed under "Hotels and rooms"; the new
  names show everywhere, including the Excel file.

## NKERP access

Read-only, on the account's scheduling role. `server/nkerp/client.mjs` can
only call General search → Groups (POST), a tour's guest list
(`GET api/tours/getApplicants/{id}`) and a tour's sub-venue plans
(`GET api/tours/getTourSubVenue/{id}`); there is no save, release or email
call in the code. The scheduled check uses the same read-only calls.
