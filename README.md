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

The repo is connected to the Worker (Workers & Pages → najaf-stays → Settings →
Build): every push to `main` builds with `npm run build` and deploys with
`npx wrangler deploy`.

`npm test` runs the planner, room-request and NKERP-reading tests.

## How a plan is made

1. **Pull.** Pick the first night (and a last night, or leave it open for
   everything approved so far). The server signs in to NKERP and reads:
   - **General search → Groups** for the office: every tour with its status,
     ports, flights and sub-venue plans. Approved tours (Approved, Current,
     Completed) with a Najaf stay in the range go on.
   - **Tours awaiting re-approval.** An approved tour that is updated shows as
     Pending with no plans until NKERP re-approves it. For pending tours the
     pull reads the tour's sub-venue plans; if it is awaiting re-approval it
     is planned with its latest dates (marked in the Groups table). Tours that
     were never approved are not planned; "See the pending tours" on the plan
     lists them (trip dates, ports, Najaf dates if any, guests who will need a
     hotel), and the Excel file has a "Pending tours" sheet.
   - **Each tour's guest list**, person by person. A guest marked
     "accommodation not required" needs a bed from us, whether or not the rest
     of the tour is housed by NKERP. Cancelled, inactive and dummy guests are
     left out; infants are counted apart (they share a bed).
2. **Plan.** The page opens straight on the plan, laid out like the Excel
   file: a summary per hotel, the daily plan (click a night to see the Ruya
   rooms floor by floor), the bookings to make, and the groups.
3. **Room requests.** "Room requests" takes the WhatsApp messages as they are,
   one or many at once, matches each to its tour and checks it against NKERP
   (guests, dates, totals). Rooms can also be typed in the Groups table.
   Changes show in the Groups table at once; **Refresh plan** rebuilds the plan
   with them (a bar says how many tours changed). "Download Excel" exports the
   plan.

### Room requests: how they are read (`shared/roomSpec.ts`)

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
  Najaf Airport, the departure day counts as a night too.
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

## NKERP access

Read-only, on the account's scheduling role. `server/nkerp/client.mjs` can
only call General search → Groups (POST), a tour's guest list
(`GET api/tours/getApplicants/{id}`) and a tour's sub-venue plans
(`GET api/tours/getTourSubVenue/{id}`); there is no save, release or email
call in the code.

## Saved on each device

Room requests, hotel choices and which Ruya rooms are left out are saved in the
browser, per device, keyed by tour number so they survive a new pull.
