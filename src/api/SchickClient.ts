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

import axios, { AxiosInstance } from 'axios';
import {
  ITokenResponse,
  IParkingEntry,
  ISpace,
  ISpaceState,
  ISpaceClosure,
  ISpaceReservation,
} from './types';

/** Safety margin before token expiry (5 minutes). */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * HTTP client for the Schick Signal-Park WebSP REST API.
 * Handles Bearer-token auth with automatic refresh and 401 retry.
 * All calls are read-only (GET only).
 */
export class SchickClient {
  private readonly http: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0; // epoch ms

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string
  ) {
    this.http = axios.create({ baseURL: baseUrl });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', this.username);
    params.append('password', this.password);

    const res = await axios.post<ITokenResponse>(
      `${this.baseUrl}/WebSP/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    this.accessToken = res.data.access_token;
    this.tokenExpiresAt =
      Date.now() + res.data.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS;
    console.log(
      '[token] Authenticated – expires in ~',
      Math.round(res.data.expires_in / 60),
      'min'
    );
  }

  /** Refresh token if missing or expiring within the safety margin. */
  async ensureToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.authenticate();
    }
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  /**
   * Execute fn. On 401 force a token refresh and retry once.
   * On any other error, rethrow so the caller can decide.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.response?.status === 401) {
        console.log('[token] 401 – forcing refresh and retrying');
        this.accessToken = null;
        await this.authenticate();
        return fn();
      }
      throw err;
    }
  }

  // ── API calls (read-only GET) ─────────────────────────────────────────────

  async getParkings(): Promise<IParkingEntry[]> {
    await this.ensureToken();
    return this.withRetry(() =>
      this.http
        .get<IParkingEntry[]>('/WebSP/api/parkings', { headers: this.authHeaders() })
        .then((r) => r.data)
    );
  }

  async getSpaces(): Promise<ISpace[]> {
    await this.ensureToken();
    return this.withRetry(() =>
      this.http
        .get<ISpace[]>('/WebSP/api/Spaces', { headers: this.authHeaders() })
        .then((r) => r.data)
    );
  }

  async getSpacesState(): Promise<ISpaceState[]> {
    await this.ensureToken();
    return this.withRetry(() =>
      this.http
        .get<ISpaceState[]>('/WebSP/api/SpacesState', { headers: this.authHeaders() })
        .then((r) => r.data)
    );
  }

  async getSpacesClosure(): Promise<ISpaceClosure[]> {
    await this.ensureToken();
    return this.withRetry(() =>
      this.http
        .get<ISpaceClosure[]>('/WebSP/api/SpacesClosure', { headers: this.authHeaders() })
        .then((r) => r.data)
    );
  }

  async getSpacesReservation(): Promise<ISpaceReservation[]> {
    await this.ensureToken();
    return this.withRetry(() =>
      this.http
        .get<ISpaceReservation[]>('/WebSP/api/SpacesReservation', { headers: this.authHeaders() })
        .then((r) => r.data)
    );
  }
}
