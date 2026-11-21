/** A group's city stay and the guest count used by the planner. */
export interface Group {
  id: string;
  tourId: number;
  planId: number;
  ref: string;
  /** Short tour number shown everywhere, e.g. "2152". */
  tourNo: string;
  office: string;
  leader: string;
  /**
   * Guests who need a bed from us: every active guest on the tour marked
   * "accommodation not required" in NKERP, infants not counted (no bed).
   */
  pax: number;
  /** The NKERP hotel pax when the planner is using a staff override. */
  nkerpPax?: number;
  /** The NKERP count when the staff override was first entered. */
  paxBefore?: number;
  /** Infants among those guests (they share a bed, so they are not in `pax`). */
  infants: number;
  /** All active guests on the tour. */
  paxTotal: number;
  /** Guests NKERP houses itself ("accommodation required"). */
  paxNkerpHoused: number;
  /** NKERP tour status, e.g. "Approved", "Current". */
  status: string;
  /** Najaf arrival date, YYYY-MM-DD. */
  checkIn: string;
  /** Najaf departure date, YYYY-MM-DD. */
  checkOut: string;
  arrivalAt: string | null;
  departureAt: string | null;
  arrival: { kind: 'airport' | 'transfer' | 'unknown'; place: string; flight: string | null };
  departure: { kind: 'airport' | 'transfer' | 'unknown'; place: string; flight: string | null; airline: string | null };
  /** Came to Najaf from Karbala, so Najaf is the second half of the trip. */
  secondLeg: boolean;
  notes: string[];
}

export type Venue = 'najaf' | 'karbala';

export interface DateChange {
  tourNo: string;
  before: string[];
  after: string[];
  at: string;
}

export interface PullMeta {
  source: 'nkerp' | 'sample';
  /** The city pulled (absent on pulls made before the Karbala tab: Najaf). */
  venue?: Venue;
  office: string;
  from: string;
  to: string | null;
  through: string;
  fetchedAt: string;
  /** Approved Najaf stays in the range, whatever their accommodation. */
  approvedStays: number;
  /** Last night the source search covers, even when no stays were found. */
  coveredThrough?: string;
  /** Of those, stays where NKERP houses every guest (not planned here). */
  nkerpHousedOnly: number;
  /** Tours in the range that are not approved yet (Pending, Draft…), so not planned. */
  notApproved: number;
  /** Previously approved tours that were updated and still await NKERP re-approval. */
  reapproval?: number;
  /** Tour IDs that changed itinerary on this pull, including tours that moved out of the range. */
  changes?: (DateChange & { tourId: number })[];
  reapprovals?: Record<number, DateChange>;
  /** Exact owners of pre-existing room requests saved by display number. */
  legacyInputKeys?: Record<number, string>;
  awaiting?: { tourId: number; tourNo: string }[];
  /** Tours in the range that are not approved yet, with what NKERP says about them. */
  pending?: PendingTour[];
  /** Guest lists read, one per tour. */
  toursRead: number;
  requests: number;
  seconds: number;
}

export type HotelId = 'ruya' | 'araf' | 'c';

/** One line of the Ruya room list: how many rooms have this many beds. */
export interface RoomType {
  beds: number;
  count: number;
  /** Real room numbers, when known. Otherwise rooms are numbered per size. */
  labels?: string[];
}

export interface Room {
  id: string;
  beds: number;
  label: string;
}

export interface Settings {
  ruyaCapacity: number;
  arafCapacity: number;
  /** Ruya room list. Empty means "not provided yet": Ruya is planned by head count only. */
  rooms: RoomType[];
  /** Count the departure day as a night for second-leg groups flying Iraqi Airways out of Najaf. */
  departureDayRule: boolean;
  /** Display names of the three hotels (the plan's first, second and overflow hotel). */
  names?: HotelNames;
}

export type HotelNames = Record<HotelId, string>;

/** One Ruya room as listed on the hotel's sheet. */
export interface RuyaRoom {
  no: string;
  beds: number;
  floor: number;
}

/** What a person typed for one group. */
export interface GroupInput {
  /** Number of guests to book for this tour in this city. Zero skips allocation. */
  pax?: number;
  paxBefore?: number;
  /** Rooms needed in Ruya, as typed or pasted. */
  spec?: string;
  /** Keep this group in a chosen hotel instead of letting the planner decide. */
  pin?: HotelId | null;
  /** Exact Ruya room numbers chosen by hand. Puts the group in Ruya in these rooms. */
  roomNos?: string[];
}

/** Guests already in a hotel that the pull does not cover (the opening balance). */
export interface Hold {
  id: string;
  label: string;
  hotel: HotelId;
  pax: number;
  /** First night, YYYY-MM-DD. */
  from: string;
  /** Check-out date (the night before is the last night). */
  to: string;
  /** Bed counts of the Ruya rooms held, when known. */
  rooms?: number[];
  /** Exact Ruya room numbers held (takes precedence over `rooms`). */
  roomLabels?: string[];
}

/** Why a group is where it is. */
export type Reason =
  | 'fits' //          placed in Ruya
  | 'room-mix' //      Ruya had the beds but not the rooms asked for
  | 'ruya-full' //     Ruya did not have enough beds
  | 'araf-full' //     Araf was full as well
  | 'pinned' //        a person chose the hotel
  | 'held'; //         opening balance

export interface Placement {
  groupId: string;
  hotel: HotelId;
  reason: Reason;
  /** One plain sentence explaining the reason. */
  detail: string;
  /** Every night the group sleeps in Najaf, in order. */
  nights: string[];
  /** True when the departure day counts as a night (Iraqi Airways rule). */
  staysDepartureDay: boolean;
  /** Ruya rooms given to the group, when the room list is known. */
  rooms: Room[];
  /** Bed counts asked for, largest first. Null when nothing was typed. */
  spec: number[] | null;
  /** Where the rooms came from: typed or pasted request, the planner's suggestion, or chosen by hand. */
  specSource: 'typed' | 'suggested' | 'manual' | 'none';
  /** Beds blocked in Ruya (can exceed pax when a bed stays empty). */
  beds: number;
  /** A pinned group that does not actually fit. */
  overbooked: boolean;
  /** Already in Najaf before the planning range starts. */
  carriedOver: boolean;
  /** Problems with the typed room request, if any. */
  specIssue: string | null;
}

export interface HotelDay {
  pax: number;
  groups: string[];
  /** Ruya only: beds blocked and rooms in use. */
  beds: number;
  rooms: number;
}

export interface DayRow {
  date: string;
  hotels: Record<HotelId, HotelDay>;
  arrivals: string[];
  departures: string[];
  /** Guests in all hotels. */
  total: number;
}

/** A run of consecutive nights when Araf or Hotel C is needed. */
export interface Booking {
  hotel: HotelId;
  from: string;
  /** Last night of the run. */
  lastNight: string;
  nights: number;
  peak: number;
  groupIds: string[];
  /** The run split wherever the head count changes. */
  steps: { from: string; lastNight: string; pax: number }[];
}

export interface Plan {
  range: { from: string; to: string };
  capacity: { ruya: number; araf: number };
  /** All Ruya rooms, when the room list is known. */
  rooms: Room[];
  placements: Record<string, Placement>;
  /**
   * Groups that reached Najaf before the planning start. They are housed
   * under the earlier arrangement (the opening balance), so they are not
   * placed unless someone keeps them in a hotel by hand.
   */
  before: string[];
  days: DayRow[];
  bookings: Booking[];
  totals: {
    groups: number;
    guests: number;
    byHotel: Record<HotelId, { groups: number; guests: number; guestNights: number; peak: number }>;
    flagged: number;
  };
}

/** A tour that is not approved yet (shown in the "Pending tours" table, not planned). */
export interface PendingTour {
  tourId: number;
  ref: string;
  tourNo: string;
  /** NKERP status, e.g. "Pending" or "Draft". */
  status: string;
  reapproval: boolean;
  /** Arrival in and departure from Iraq, YYYY-MM-DD. */
  start: string | null;
  end: string | null;
  entryPort: string;
  exitPort: string;
  /** Sub-venue order, e.g. "Karbala → Najaf". Empty when NKERP has no plans yet. */
  route: string;
  /** Najaf stays from the tour's latest plans, when it has any. */
  najaf: { checkIn: string; checkOut: string }[];
  /** Stays in the city that was pulled (Najaf or Karbala). Absent on older pulls: use `najaf`. */
  stays?: { checkIn: string; checkOut: string }[];
  pax: number;
  /** Guests marked "accommodation not required" (infants not counted), as NKERP counts them for the tour. */
  needHotel: number | null;
  /** Guests NKERP houses. */
  housed: number | null;
  remarks: string;
  departureFlight?: string | null;
  departureAirline?: string | null;
  /** Guests on the applicant list whose accommodation choice is unresolved. */
  unclassified?: number;
  hotelPaxSource?: 'applicants' | 'tour';
}
