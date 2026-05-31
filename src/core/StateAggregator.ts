/**
 * 超长任务Agent树形双生子模块化执行系统
 * 层级状态聚合器 - 第19阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { IBaseModule, ModuleId, ModuleState } from './interfaces';

/**
 * 聚合状态
 */
export interface AggregatedState {
  moduleId: ModuleId;
  state: ModuleState;
  childStates: Record<ModuleId, AggregatedState>;
  aggregatedAt: number;
}

/**
 * 层级状态聚合器
 * 
 * 职责：
 * 1. 多级模块状态的向上聚合
 * 2. 状态的向下分发
 * 3. 全链路状态视图
 */
export class StateAggregator {
  private _modules: Map<ModuleId, IBaseModule> = new Map();

  /**
   * 注册模块
   */
  public register(module: IBaseModule): void {
    this._modules.set(module.moduleId, module);
  }

  /**
   * 向上聚合状态
   */
  public aggregateUp(leafModuleId: ModuleId): AggregatedState {
    const module = this._modules.get(leafModuleId);
    if (!module) {
      throw new Error(`模块未找到: ${leafModuleId}`);
    }

    return this._aggregateRecursive(module);
  }

  /**
   * 从根向下聚合状态
   */
  public aggregateDown(rootModuleId: ModuleId): AggregatedState {
    return this.aggregateUp(rootModuleId);
  }

  /**
   * 获取完整状态树
   */
  public getFullStateTree(): Record<ModuleId, AggregatedState> {
    const result: Record<ModuleId, AggregatedState> = {};
    
    for (const [moduleId, module] of this._modules) {
      if (!module.parentModuleId) {
        // 根模块
        result[moduleId] = this._aggregateRecursive(module);
      }
    }

    return result;
  }

  /**
   * 向下分发状态更新
   */
  public async dispatchDown(parentModuleId: ModuleId, stateUpdate: Partial<ModuleState>): Promise<void> {
    const parent = this._modules.get(parentModuleId);
    if (!parent || !parent.childModules) return;

    for (const child of parent.childModules) {
      // 这里可以实现状态分发逻辑
      console.log(`分发状态更新到子模块: ${child.moduleId}`);
    }
  }

  private _aggregateRecursive(module: IBaseModule): AggregatedState {
    const childStates: Record<ModuleId, AggregatedState> = {};

    if (module.childModules) {
      for (const child of module.childModules) {
        childStates[child.moduleId] = this._aggregateRecursive(child);
      }
    }

    return {
      moduleId: module.moduleId,
      state: module.getCurrentState(),
      childStates,
      aggregatedAt: Date.now()
    };
  }
}

export default StateAggregator;
