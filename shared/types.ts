/** Facts about one group's stay in Najaf, exactly as pulled from NKERP. */
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

export interface PullMeta {
  source: 'nkerp' | 'sample';
  office: string;
  from: string;
  to: string | null;
  through: string;
  fetchedAt: string;
  /** Approved Najaf stays in the range, whatever their accommodation. */
  approvedStays: number;
  /** Of those, stays where NKERP houses every guest (not planned here). */
  nkerpHousedOnly: number;
  /** Tours in the range that are not approved yet (Pending, Draft…), so not planned. */
  notApproved: number;
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
}

/** One Ruya room as listed on the hotel's sheet. */
export interface RuyaRoom {
  no: string;
  beds: number;
  floor: number;
}

/** What a person typed for one group. */
export interface GroupInput {
  /** Rooms needed in Ruya, as typed or pasted. */
  spec?: string;
  /** What the pasted room-request message said, kept to check against NKERP. */
  message?: { hotelPax: number | null; from: string | null; to: string | null; leader: string | null };
  /** Keep this group in a chosen hotel instead of letting the planner decide. */
  pin?: HotelId | null;
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
  specSource: 'typed' | 'suggested' | 'none';
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
