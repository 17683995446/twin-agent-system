/**
 * 超长任务Agent树形双生子模块化执行系统
 * 模块生命周期管理器 - 第17阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { IBaseModule, ModuleId, ModuleState, StatusCode } from './interfaces';

/**
 * 生命周期状态
 */
export type LifecycleState = 'created' | 'initializing' | 'initialized' | 'running' | 'paused' | 'resuming' | 'stopping' | 'stopped' | 'destroyed';

/**
 * 生命周期事件
 */
export interface LifecycleEvent {
  moduleId: ModuleId;
  from: LifecycleState;
  to: LifecycleState;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 模块生命周期管理器
 * 
 * 职责：
 * 1. 管理模块的初始化、运行、暂停、恢复、销毁生命周期
 * 2. 生命周期事件监听
 * 3. 状态转换验证
 */
export class LifecycleManager {
  private _moduleStates: Map<ModuleId, LifecycleState> = new Map();
  private _eventListeners: Array<(event: LifecycleEvent) => void> = [];
  private _eventHistory: LifecycleEvent[] = [];

  /**
   * 有效的状态转换
   */
  private static readonly VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
    created: ['initializing'],
    initializing: ['initialized', 'destroyed'],
    initialized: ['running', 'destroyed'],
    running: ['paused', 'stopping'],
    paused: ['resuming', 'stopping'],
    resuming: ['running'],
    stopping: ['stopped'],
    stopped: ['destroyed'],
    destroyed: []
  };

  /**
   * 注册模块
   */
  public register(module: IBaseModule): void {
    this._moduleStates.set(module.moduleId, 'created');
  }

  /**
   * 获取模块生命周期状态
   */
  public getState(moduleId: ModuleId): LifecycleState | undefined {
    return this._moduleStates.get(moduleId);
  }

  /**
   * 转换状态
   */
  public async transition(moduleId: ModuleId, to: LifecycleState): Promise<boolean> {
    const from = this._moduleStates.get(moduleId);
    if (!from) {
      throw new Error(`模块未注册: ${moduleId}`);
    }

    // 验证状态转换
    if (!LifecycleManager.VALID_TRANSITIONS[from].includes(to)) {
      throw new Error(`无效的状态转换: ${from} -> ${to}`);
    }

    // 执行状态转换
    this._moduleStates.set(moduleId, to);

    // 记录事件
    const event: LifecycleEvent = {
      moduleId,
      from,
      to,
      timestamp: Date.now()
    };
    this._recordEvent(event);

    return true;
  }

  /**
   * 添加生命周期事件监听器
   */
  public onLifecycleEvent(listener: (event: LifecycleEvent) => void): void {
    this._eventListeners.push(listener);
  }

  /**
   * 获取事件历史
   */
  public getEventHistory(moduleId?: ModuleId): LifecycleEvent[] {
    if (moduleId) {
      return this._eventHistory.filter(e => e.moduleId === moduleId);
    }
    return [...this._eventHistory];
  }

  private _recordEvent(event: LifecycleEvent): void {
    this._eventHistory.push(event);
    
    // 通知监听器
    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (e) {
        // 忽略监听器错误
      }
    }

    // 限制历史记录大小
    if (this._eventHistory.length > 1000) {
      this._eventHistory = this._eventHistory.slice(-500);
    }
  }
}

export default LifecycleManager;
