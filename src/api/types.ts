/*
 * Copyright 2024 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface ITokenResponse {
  access_token: string;
  token_type: string;
  /** Lifetime in seconds (typically 7199) */
  expires_in: number;
}

// ── Parkings  (/api/parkings returns a flat list of these) ────────────────────

export interface ICategoryInfo {
  id: number;
  name: string;
  capacity: number;
  reserved: number;
  closed: number;
  occupied: number;
  vacant: number;
  available: number;
  reservedVacant: number;
  reservedOnlyVacant: number;
  closedVacant: number;
  fillingRate: number;
  arrivals: number;
  departures: number;
}

export interface IParkingEntry {
  type: 'site' | 'parking' | 'level' | 'sector' | 'zone';
  id: number;
  name: string;
  closed: boolean;
  reserved: boolean;
  ledOff: boolean;
  counted: boolean;
  categoriesInfo: ICategoryInfo[];
}

// ── Spaces  (/api/Spaces returns only id + name) ──────────────────────────────

export interface ISpace {
  id: number;
  name: string;
}

// ── Real-time space state ─────────────────────────────────────────────────────

export interface ISpaceState {
  id: number;
  name: string;
  /** Raw integer from the API – semantics managed downstream, never decoded here */
  state: number;
}

export interface ISpaceClosure {
  id: number;
  name: string;
  closed: boolean;
}

export interface ISpaceReservation {
  id: number;
  name: string;
  reserved: boolean;
}
