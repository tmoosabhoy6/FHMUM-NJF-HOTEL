import type { Group, GroupInput, PullMeta } from '../../shared/types';

type Tour = Pick<Group, 'tourId' | 'tourNo'>;
export type TourInputs = Record<string, GroupInput>;
export type InputChange = { [K in keyof GroupInput]?: GroupInput[K] | null };

export const inputKey = ({ tourId }: Tour) => `tour-${tourId}`;
// Existing shared room requests were keyed by the display number.
export function legacyKey({ tourId, tourNo }: Tour, meta?: PullMeta) {
  return meta?.legacyInputKeys ? meta.legacyInputKeys[tourId] ?? null : String(Number(tourNo) || tourNo).trim();
}

export function tourInput(inputs: TourInputs, tour: Tour, meta?: PullMeta) {
  const legacy = legacyKey(tour, meta);
  return inputs[inputKey(tour)] ?? (legacy ? inputs[legacy] : undefined);
}

export function editInput(inputs: TourInputs, key: string, legacy: string | null, changes: InputChange): TourInputs {
  const input = { ...(inputs[key] ?? (legacy ? inputs[legacy] : undefined)) };
  for (const [field, value] of Object.entries(changes)) {
    if (value === null) delete input[field as keyof GroupInput];
    else Object.assign(input, { [field]: value });
  }
  return { ...inputs, [key]: input };
}

export function withHotelPax(groups: Group[], inputs: TourInputs, meta?: PullMeta): Group[] {
  return groups.map((group) => {
    const input = tourInput(inputs, group, meta);
    return input?.pax === undefined ? group : { ...group, pax: input.pax, nkerpPax: group.pax, paxBefore: input.paxBefore };
  });
}
