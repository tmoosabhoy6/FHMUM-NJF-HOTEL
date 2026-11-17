import { createContext, useContext } from 'react';
import { DEFAULT_HOTEL_NAMES } from '../../shared/engine';
import type { HotelNames } from '../../shared/types';

/** The hotels' names as staff have set them ("Hotels and rooms"). */
export const NamesContext = createContext<HotelNames>(DEFAULT_HOTEL_NAMES);
export const useNames = () => useContext(NamesContext);
