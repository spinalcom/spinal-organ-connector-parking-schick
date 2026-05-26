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

import {
  InputDataEndpoint as IInputDataEndpoint,
  InputDataEndpointDataType,
  InputDataEndpointType,
  SpinalBmsEndpoint,
} from 'spinal-model-bmsnetwork';

function genUID(prefix: string): string {
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${prefix}-${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

export class InputDataEndpoint implements IInputDataEndpoint {
  public id: string;
  public name: string;
  public path: string;
  public currentValue: number | string | boolean;
  public unit: string;
  public dataType: InputDataEndpointDataType;
  public type: InputDataEndpointType;
  public nodeTypeName: string;
  public timeseries: any[];
  public idx: number;

  constructor(
    name = 'endpoint',
    currentValue: number | string | boolean = 0,
    unit = '',
    dataType = InputDataEndpointDataType.Integer,
    type = InputDataEndpointType.Other,
    id = genUID('InputDataEndpoint'),
    path = ''
  ) {
    this.nodeTypeName = SpinalBmsEndpoint.nodeTypeName;
    this.id = id;
    this.name = name;
    this.path = path;
    this.currentValue = currentValue;
    this.unit = unit;
    this.dataType = dataType;
    this.type = type;
    this.timeseries = [];
    this.idx = 0;
  }
}

export { InputDataEndpointDataType, InputDataEndpointType };
