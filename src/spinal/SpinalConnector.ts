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

import { FileSystem, File, Ptr, spinalCore } from 'spinal-core-connectorjs';
import ConfigFile from 'spinal-lib-organ-monitoring';

const configJson = require('../../config');

/**
 * Singleton that owns the SpinalHub TCP connection.
 * Must be instantiated before any graph load/store operation.
 */
export class SpinalConnector {
  private static instance: SpinalConnector | null = null;
  public readonly conn: spinal.FileSystem;

  private constructor() {
    const cfg = configJson.spinalhub;
    let url = `${cfg.protocol}://${cfg.userID}:${cfg.userPassword}@${cfg.host}`;
    if (cfg.port) url += `:${cfg.port}/`;
    this.conn = spinalCore.connect(url);

    ConfigFile.init(
      this.conn,
      configJson.organ.name,
      'Connector',
      cfg.host,
      parseInt(cfg.port as string, 10)
    );
  }

  static getInstance(): SpinalConnector {
    if (!SpinalConnector.instance) {
      SpinalConnector.instance = new SpinalConnector();
    }
    return SpinalConnector.instance;
  }

  /** Load a model from the hub by path. Rejects if the path does not exist. */
  load<T extends spinal.Model>(path: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      spinalCore.load(
        this.conn,
        path,
        (model: T) => resolve(model),
        () => reject(new Error(`[SpinalConnector] Cannot load: ${path}`))
      );
    });
  }

  /** Store a model at the given path, creating the file if necessary. */
  store<T extends spinal.Model>(path: string, model: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      spinalCore.store(this.conn, model, path, () => resolve(), () => reject());
    });
  }
}
