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

import { resolve as pathResolve } from 'path';
import {
  SpinalGraph,
  SpinalGraphService,
  SpinalNode,
  SpinalContext,
} from 'spinal-env-viewer-graph-service';
import { NetworkService } from 'spinal-model-bmsnetwork';
import { attributeService } from 'spinal-env-viewer-plugin-documentation-service';

import { SpinalConnector } from './SpinalConnector';
import { OrganConfigModel } from '../model/OrganConfigModel';
import { InputDataDevice } from '../model/InputDataDevice';
import {
  InputDataEndpoint,
  InputDataEndpointDataType,
  InputDataEndpointType,
} from '../model/InputDataEndpoint';
import { SchickClient } from '../api/SchickClient';
import { IParkingEntry, ISpace } from '../api/types';

const configJson = require('../../config');

// ── Runtime cache ─────────────────────────────────────────────────────────────

interface DeviceCache {
  node: SpinalNode<any>;
  endpoints: Map<string, SpinalNode<any>>;
}

// ── SyncService ───────────────────────────────────────────────────────────────

/**
 * Mirrors the Schick Signal-Park API into the Spinal BOS as virtual BMS devices.
 *
 * Structure created under the Virtual Network:
 *   Group "Parkings"  – one device per entry from /api/parkings
 *   Group "Spaces"    – one device per entry from /api/Spaces
 *
 * Idempotent: on restart, existing devices are found by schickId embedded in
 * their name ({prefix}_{id}_{name}) and reused without recreation.
 */
export class SyncService {
  private graph!: SpinalGraph<any>;
  private config!: OrganConfigModel;
  private nwService: NetworkService;
  private nwContext!: SpinalContext<any>;
  private nwVirtual!: SpinalNode<any>;
  private spacesGroup!: SpinalNode<any>;   // "Spaces" group device
  private typeGroups = new Map<string, SpinalNode<any>>(); // type → group device (site, parking, level…)

  private readonly schickClient: SchickClient;
  private running = false;

  private parkingCache = new Map<number, DeviceCache>(); // schickId → cache
  private spaceCache   = new Map<number, DeviceCache>(); // schickId → cache
  private warnedDisappeared = new Set<number>();         // parking ids no longer in API

  constructor() {
    this.nwService = new NetworkService(true);
    this.schickClient = new SchickClient(
      process.env.CLIENT_BASE_URL!,
      process.env.CLIENT_USER!,
      process.env.CLIENT_PASSWORD!
    );
  }

  // ── Public interface ──────────────────────────────────────────────────────

  async init(): Promise<void> {
    await this.boot();
    await this.initGroups();
    await this.loadExistingParkings();
    await this.loadExistingSpaces();
    await this.schickClient.ensureToken();
    await this.initParkings();
    await this.initSpaces();
    this.config.updateSync();
    console.log(`[init] Complete – ${this.parkingCache.size} parkings, ${this.spaceCache.size} spaces`);
  }

  async run(): Promise<void> {
    this.running = true;
    const interval = this.config.pullInterval.get() as number;
    console.log(`[run] Loop started – interval ${interval} ms`);

    while (this.running) {
      const tickStart = Date.now();
      try {
        await this.schickClient.ensureToken();
        await this.syncParkings();
        await this.syncSpaces();
        this.config.updateSync();
        // console.log(`[run] Tick done in ${Date.now() - tickStart} ms`);
      } catch (err: any) {
        if (!err?.response) {
          console.error('[run] Network error – backing off 60 s:', err?.message ?? err);
          await this.sleep(60000);
          continue;
        }
        console.error('[run] Tick error:', err?.response?.status, err?.message ?? err);
      }
      const elapsed = Date.now() - tickStart;
      await this.sleep(Math.max(0, interval - elapsed));
    }
    console.log('[run] Loop stopped');
  }

  stop(): void { this.running = false; }

  // ── Boot ──────────────────────────────────────────────────────────────────

  private async boot(): Promise<void> {
    const connector = SpinalConnector.getInstance();
    const loadPath = pathResolve(configJson.organ.configPath, configJson.organ.name);
    try {
      this.config = await connector.load<OrganConfigModel>(loadPath);
      console.log('[init] Config loaded from hub');
    } catch {
      console.log('[init] Config not found – creating');
      this.config = new OrganConfigModel();
      this.config.initEnv();
      await connector.store(loadPath, this.config);
    }
    this.config.bindRestart();

    console.log('[init] Loading graph from', this.config.digitalTwinPath.get());
    this.graph = await connector.load<SpinalGraph<any>>(this.config.digitalTwinPath.get());
    console.log('[init] Graph loaded');

    await this.nwService.init(this.graph, {
      contextName: process.env.NETWORK_NAME!,
      contextType: 'Network',
      networkName: process.env.VIRTUAL_NETWORK_NAME!,
      networkType: 'NetworkVirtual',
    });

    this.nwContext = await this.resolveContextByName(process.env.NETWORK_NAME!);
    const contextChildren = await this.nwContext.getChildrenInContext();
    const virtualNode = contextChildren.find(
      (n) => n.getName().get() === process.env.VIRTUAL_NETWORK_NAME!
    );
    if (!virtualNode) {
      throw new Error(`[init] Virtual network '${process.env.VIRTUAL_NETWORK_NAME}' not found`);
    }
    this.nwVirtual = virtualNode;
    SpinalGraphService._addNode(this.nwVirtual);
    console.log('[init] Network nodes resolved');
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  private async initGroups(): Promise<void> {
    this.spacesGroup = await this.getOrCreateGroupDevice('Spaces');
    console.log('[init] Spaces group resolved');
  }

  private async getOrCreateGroupDevice(name: string): Promise<SpinalNode<any>> {
    const children = await this.nwVirtual.getChildrenInContext(this.nwContext);
    const found = children.find((n) => n.getName().get() === name);
    if (found) { SpinalGraphService._addNode(found); return found; }
    console.log(`[init] Creating group device: ${name}`);
    return this.createDevice(this.nwVirtual, name, 'Group');
  }

  /** Get or create the group device for a parking type (one group per type). */
  private async getOrCreateTypeGroup(type: string): Promise<SpinalNode<any>> {
    const existing = this.typeGroups.get(type);
    if (existing) return existing;
    const group = await this.getOrCreateGroupDevice(type);
    this.typeGroups.set(type, group);
    return group;
  }

  // ── Load existing devices from BOS ────────────────────────────────────────

  private async loadExistingParkings(): Promise<void> {
    // Each child of the virtual network (except "Spaces") is a parking type group
    const groups = await this.nwVirtual.getChildrenInContext(this.nwContext);
    for (const group of groups) {
      const groupName = group.getName().get();
      if (groupName === 'Spaces') continue;
      SpinalGraphService._addNode(group);
      this.typeGroups.set(groupName, group);
      const children = await group.getChildren('hasBmsDevice');
      for (const node of children) {
        const id = this.extractSchickId(node.getName().get());
        if (id === null) continue;
        SpinalGraphService._addNode(node);
        const endpoints = await this.loadExistingEndpoints(node);
        this.parkingCache.set(id, { node, endpoints });
      }
    }
    console.log(`[init] ${this.parkingCache.size} existing parking devices loaded from BOS`);
  }

  private async loadExistingSpaces(): Promise<void> {
    const children = await this.spacesGroup.getChildren('hasBmsDevice');
    for (const node of children) {
      const id = this.extractSchickId(node.getName().get());
      if (id === null) continue;
      SpinalGraphService._addNode(node);
      const endpoints = await this.loadExistingEndpoints(node);
      this.spaceCache.set(id, { node, endpoints });
    }
    console.log(`[init] ${this.spaceCache.size} existing space devices loaded from BOS`);
  }

  private async loadExistingEndpoints(node: SpinalNode<any>): Promise<Map<string, SpinalNode<any>>> {
    const map = new Map<string, SpinalNode<any>>();
    const children = await node.getChildren('hasBmsEndpoint');
    for (const ep of children) {
      map.set(ep.getName().get(), ep);
      SpinalGraphService._addNode(ep);
    }
    return map;
  }

  // ── Init: first pass from API ─────────────────────────────────────────────

  private async initParkings(): Promise<void> {
    let parkings: IParkingEntry[];
    try {
      parkings = await this.schickClient.getParkings();
    } catch (err: any) {
      console.error('[schick] GET /api/parkings failed:', err?.message ?? err);
      return;
    }
    console.log(`[init] ${parkings.length} parking entries from API`);
    for (const p of parkings) { await this.syncParking(p); }
  }

  private async initSpaces(): Promise<void> {
    let spaces: ISpace[];
    try {
      spaces = await this.schickClient.getSpaces();
    } catch (err: any) {
      console.error('[schick] GET /api/Spaces failed:', err?.message ?? err);
      return;
    }
    console.log(`[init] ${spaces.length} space entries from API`);
    for (const s of spaces) { await this.ensureSpaceDevice(s.id, s.name); }
  }

  // ── Run: parkings ─────────────────────────────────────────────────────────

  private async syncParkings(): Promise<void> {
    let parkings: IParkingEntry[];
    try {
      parkings = await this.schickClient.getParkings();
    } catch (err: any) {
      console.error('[schick] GET /api/parkings failed:', err?.message ?? err);
      return;
    }
    // Warn once per id that disappeared from the API response
    const currentIds = new Set(parkings.map((p) => p.id));
    for (const [id] of this.parkingCache) {
      if (!currentIds.has(id) && !this.warnedDisappeared.has(id)) {
        console.warn(`[run] Parking id=${id} no longer in API – device kept in BOS`);
        this.warnedDisappeared.add(id);
      }
    }
    for (const p of parkings) { await this.syncParking(p); }
  }

  // ── Run: spaces ───────────────────────────────────────────────────────────

  private async syncSpaces(): Promise<void> {
    // SpacesState may reveal new spaces → process sequentially for safe device creation
    try {
      const states = await this.schickClient.getSpacesState();
      for (const s of states) { await this.ensureSpaceDevice(s.id, s.name); }
      await Promise.all(
        states.map((s) => this.setEp(this.spaceCache.get(s.id), 'state', s.state))
      );
    } catch (err: any) {
      console.error('[schick] GET /api/SpacesState failed:', err?.message ?? err);
    }

    try {
      const closures = await this.schickClient.getSpacesClosure();
      await Promise.all(
        closures.map((c) => this.setEp(this.spaceCache.get(c.id), 'closed', c.closed ? 1 : 0))
      );
    } catch (err: any) {
      console.error('[schick] GET /api/SpacesClosure failed:', err?.message ?? err);
    }

    try {
      const reservations = await this.schickClient.getSpacesReservation();
      await Promise.all(
        reservations.map((r) => this.setEp(this.spaceCache.get(r.id), 'reserved', r.reserved ? 1 : 0))
      );
    } catch (err: any) {
      console.error('[schick] GET /api/SpacesReservation failed:', err?.message ?? err);
    }
  }

  // ── Parking device sync ───────────────────────────────────────────────────

  private async syncParking(entry: IParkingEntry): Promise<void> {
    let cache = this.parkingCache.get(entry.id);

    if (!cache) {
      const group = await this.getOrCreateTypeGroup(entry.type);
      const deviceName = `${entry.type}_${entry.id}_${entry.name}`;
      console.log(`[spinal] Creating parking device: ${deviceName}`);
      const node = await this.createDevice(group, deviceName, entry.type);
      cache = { node, endpoints: new Map() };
      this.parkingCache.set(entry.id, cache);
    }

    // Static attributes (idempotent update)
    await attributeService.createOrUpdateAttrsAndCategories(cache.node, 'Schick', {
      schickId:   String(entry.id),
      schickType: entry.type,
      schickName: entry.name,
      lastSync:   new Date().toISOString(),
    });

    // Ensure base endpoints exist (created once, idempotent)
    await this.ensureParkingBaseEndpoints(cache);

    // Dynamically ensure category endpoints for EVERY category (including capacity = 0)
    for (const cat of entry.categoriesInfo) {
      const catKey = this.catSafe(cat.name);
      if (!cache.endpoints.has(`cat_${catKey}_capacity`)) {
        console.log(`[spinal] Category '${cat.name}' on parking ${entry.id} – creating endpoints`);
        await this.ensureCategoryEndpoints(cache, catKey);
      }
    }

    // Compute global totals
    let totalCapacity = 0, totalOccupied = 0, totalVacant = 0, totalAvailable = 0;
    for (const cat of entry.categoriesInfo) {
      totalCapacity  += cat.capacity;
      totalOccupied  += cat.occupied;
      totalVacant    += cat.vacant;
      totalAvailable += cat.available;
    }
    const fillingRate = totalCapacity > 0
      ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

    // Update all endpoint values in parallel
    const updates: Promise<void>[] = [
      this.setEp(cache, 'closed',         entry.closed   ? 1 : 0),
      this.setEp(cache, 'reserved',       entry.reserved ? 1 : 0),
      this.setEp(cache, 'ledOff',         entry.ledOff   ? 1 : 0),
      this.setEp(cache, 'counted',        entry.counted  ? 1 : 0),
      this.setEp(cache, 'totalCapacity',  totalCapacity),
      this.setEp(cache, 'totalOccupied',  totalOccupied),
      this.setEp(cache, 'totalVacant',    totalVacant),
      this.setEp(cache, 'totalAvailable', totalAvailable),
      this.setEp(cache, 'fillingRate',    fillingRate),
    ];

    for (const cat of entry.categoriesInfo) {
      const k = this.catSafe(cat.name);
      updates.push(
        this.setEp(cache, `cat_${k}_capacity`,    cat.capacity),
        this.setEp(cache, `cat_${k}_occupied`,    cat.occupied),
        this.setEp(cache, `cat_${k}_vacant`,      cat.vacant),
        this.setEp(cache, `cat_${k}_available`,   cat.available),
        this.setEp(cache, `cat_${k}_reserved`,    cat.reserved),
        this.setEp(cache, `cat_${k}_closed`,      cat.closed),
        this.setEp(cache, `cat_${k}_fillingRate`, cat.fillingRate),
        this.setEp(cache, `cat_${k}_arrivals`,    cat.arrivals),
        this.setEp(cache, `cat_${k}_departures`,  cat.departures),
      );
    }

    await Promise.all(updates);
  }

  private async ensureParkingBaseEndpoints(cache: DeviceCache): Promise<void> {
    const defs: Array<{ name: string; unit?: string }> = [
      { name: 'closed' }, { name: 'reserved' }, { name: 'ledOff' }, { name: 'counted' },
      { name: 'totalCapacity' }, { name: 'totalOccupied' },
      { name: 'totalVacant' }, { name: 'totalAvailable' },
      { name: 'fillingRate', unit: '%' },
    ];
    for (const def of defs) {
      if (!cache.endpoints.has(def.name)) {
        cache.endpoints.set(def.name,
          await this.createEndpoint(cache.node, def.name, 0, def.unit ?? ''));
      }
    }
  }

  private async ensureCategoryEndpoints(cache: DeviceCache, catKey: string): Promise<void> {
    const suffixes = [
      'capacity', 'occupied', 'vacant', 'available',
      'reserved', 'closed', 'fillingRate', 'arrivals', 'departures',
    ];
    for (const suffix of suffixes) {
      const epName = `cat_${catKey}_${suffix}`;
      if (!cache.endpoints.has(epName)) {
        const unit = suffix === 'fillingRate' ? '%' : '';
        cache.endpoints.set(epName, await this.createEndpoint(cache.node, epName, 0, unit));
      }
    }
  }

  // ── Space device sync ─────────────────────────────────────────────────────

  /** Create space device and cache it if not already known. Idempotent. */
  private async ensureSpaceDevice(id: number, name: string): Promise<void> {
    if (this.spaceCache.has(id)) return;

    const deviceName = `space_${id}_${name}`;
    console.log(`[spinal] Creating space device: ${deviceName}`);
    const node = await this.createDevice(this.spacesGroup, deviceName, 'space');
    const endpoints = new Map<string, SpinalNode<any>>();

    await attributeService.createOrUpdateAttrsAndCategories(node, 'Schick', {
      schickId:   String(id),
      schickName: name,
      lastSync:   new Date().toISOString(),
    });

    for (const def of [
      { name: 'state',    initialValue: 0 },
      { name: 'closed',   initialValue: 0 },
      { name: 'reserved', initialValue: 0 },
    ]) {
      endpoints.set(def.name, await this.createEndpoint(node, def.name, def.initialValue));
    }

    this.spaceCache.set(id, { node, endpoints });
  }

  // ── BOS helpers ───────────────────────────────────────────────────────────

  private async createDevice(
    parent: SpinalNode<any>, name: string, type: string
  ): Promise<SpinalNode<any>> {
    const model = new InputDataDevice(name, type);
    const ref = await this.nwService.createNewBmsDevice(parent.getId().get(), model);
    return SpinalGraphService.getRealNode(ref.id.get());
  }

  private async createEndpoint(
    deviceNode: SpinalNode<any>, name: string,
    initialValue: number | string = 0, unit = ''
  ): Promise<SpinalNode<any>> {
    const model = new InputDataEndpoint(
      name, initialValue, unit,
      InputDataEndpointDataType.Integer,
      InputDataEndpointType.Other
    );
    const ref = await this.nwService.createNewBmsEndpoint(deviceNode.getId().get(), model);
    return SpinalGraphService.getRealNode(ref.id.get());
  }

  /** Set an endpoint value. Silently skips if cache or endpoint is missing. */
  private async setEp(
    cache: DeviceCache | undefined, name: string, value: number
  ): Promise<void> {
    const ep = cache?.endpoints.get(name);
    if (!ep) return;
    SpinalGraphService._addNode(ep);
    await this.nwService.setEndpointValue(ep.getId().get(), value);
  }

  // ── Graph helpers ─────────────────────────────────────────────────────────

  private async resolveContextByName(name: string): Promise<SpinalContext<any>> {
    const children = await this.graph.getChildren();
    for (const ctx of children) {
      if (ctx.info.name.get() === name) {
        SpinalGraphService._addNode(ctx);
        return ctx as SpinalContext<any>;
      }
    }
    throw new Error(`[init] Context '${name}' not found in graph`);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /**
   * Extract Schick id from device name formatted as "{prefix}_{id}_{...}".
   * "site_1_Schick LABO" → 1    "space_6_1 - 001" → 6
   */
  private extractSchickId(deviceName: string): number | null {
    const parts = deviceName.split('_');
    if (parts.length < 3) return null;
    const id = parseInt(parts[1], 10);
    return isNaN(id) ? null : id;
  }

  /**
   * Normalise category name to a safe endpoint key segment.
   * "Public" → "public"   "Handicapped" → "handicapped"
   */
  private catSafe(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
