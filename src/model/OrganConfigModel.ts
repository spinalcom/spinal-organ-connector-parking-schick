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

import { spinalCore, Model } from 'spinal-core-connectorjs_type';

/**
 * Persisted organ configuration stored in the SpinalHub.
 * Created once and reloaded on subsequent restarts.
 */
export class OrganConfigModel extends Model {
  digitalTwinPath: spinal.Str;
  pullInterval: spinal.Val;
  lastSync: spinal.Val;
  restart: spinal.Bool;

  constructor() {
    super();
    this.add_attr('digitalTwinPath', '/__users__/admin/Digital twin');
    this.add_attr('restart', false);
    this.add_attr('pullInterval', 10000);
    this.add_attr('lastSync', 0);
  }

  /** Apply values from environment variables (called only on first creation). */
  initEnv(): void {
    if (process.env.DIGITALTWIN_PATH)
      this.digitalTwinPath.set(process.env.DIGITALTWIN_PATH);
    if (process.env.PULL_INTERVAL)
      this.pullInterval.set(Number(process.env.PULL_INTERVAL));
  }

  updateSync(): void {
    this.lastSync.set(Date.now());
  }

  /** Bind the restart flag so that setting it to true exits the process (pm2 restarts it). */
  bindRestart(): void {
    this.restart.bind(() => {
      if (this.restart.get() === true) {
        console.log('[OrganConfig] Restart requested via BOS flag');
        process.exit(0);
      }
    });
  }
}

spinalCore.register_models(OrganConfigModel);
