/**
 * 第49阶段：执行超时处理
 * Execution Timeout Handler
 * 
 * 实现执行超时处理机制：
 * - 超时检测
 * - 超时策略
 * - 超时恢复
 * - 超时统计
 */

import { ExecutionContext, ExecutionStatus } from './ExecutionContext';

// 超时类型
export enum TimeoutType {
  EXECUTION = 'execution',
  STEP = 'step',
  OPERATION = 'operation',
  IDLE = 'idle',
  HEARTBEAT = 'heartbeat'
}

// 超时策略
export enum TimeoutStrategy {
  ABORT = 'abort',           // 中止执行
  RETRY = 'retry',           // 重试
  FALLBACK = 'fallback',     // 执行回退操作
  IGNORE = 'ignore',         // 忽略超时
  ESCALATE = 'escalate'      // 上报升级
}

// 超时配置
export interface TimeoutConfig {
  duration: number;
  type: TimeoutType;
  strategy: TimeoutStrategy;
  maxRetries?: number;
  retryDelay?: number;
  fallbackAction?: () => Promise<any>;
  onTimeout?: (context: ExecutionContext, timeout: TimeoutInfo) => Promise<void>;
}

// 超时信息
export interface TimeoutInfo {
  id: string;
  type: TimeoutType;
  startTime: number;
  timeoutAt: number;
  actualDuration: number;
  strategy: TimeoutStrategy;
  contextId: string;
  taskId?: string;
  stepId?: string;
  metadata: Record<string, any>;
}

// 超时事件
export interface TimeoutEvent {
  type: 'timeout_detected' | 'timeout_handled' | 'timeout_recovered';
  info: TimeoutInfo;
  timestamp: number;
  result?: any;
}

// 超时统计
export interface TimeoutStats {
  total: number;
  byType: Record<TimeoutType, number>;
  avgDuration: number;
  maxDuration: number;
  recoveryRate: number;
}

// 活跃的超时追踪
interface ActiveTimeout {
  id: string;
  config: TimeoutConfig;
  startTime: number;
  timer: NodeJS.Timeout;
  context: ExecutionContext;
  resolved: boolean;
  stepId?: string;
}

// ==================== 执行超时处理器 ====================

export class ExecutionTimeout {
  private _activeTimeouts: Map<string, ActiveTimeout> = new Map();
  private _timeoutHistory: TimeoutInfo[] = [];
  private _listeners: Set<(event: TimeoutEvent) => void> = new Set();
  private _defaultTimeout: number;
  private _heartbeatInterval: number;
  private _heartbeatTimer: NodeJS.Timeout | null = null;
  private _lastHeartbeat: Map<string, number> = new Map();

  constructor(options: {
    defaultTimeout?: number;
    heartbeatInterval?: number;
  } = {}) {
    this._defaultTimeout = options.defaultTimeout ?? 300000; // 5分钟
    this._heartbeatInterval = options.heartbeatInterval ?? 30000; // 30秒
  }

  // ==================== 超时管理 ====================

  /**
   * 设置超时
   */
  public setTimeout(
    context: ExecutionContext,
    config: Partial<TimeoutConfig> & { duration: number }
  ): string {
    const fullConfig: TimeoutConfig = {
      type: config.type ?? TimeoutType.EXECUTION,
      strategy: config.strategy ?? TimeoutStrategy.ABORT,
      maxRetries: config.maxRetries ?? 0,
      retryDelay: config.retryDelay ?? 1000,
      ...config
    };

    const id = this._generateId();
    const startTime = Date.now();

    const timer = setTimeout(async () => {
      const active = this._activeTimeouts.get(id);
      if (active && !active.resolved) {
        await this._handleTimeout(active);
      }
    }, fullConfig.duration);

    this._activeTimeouts.set(id, {
      id,
      config: fullConfig,
      startTime,
      timer,
      context,
      resolved: false
    });

    return id;
  }

  /**
   * 设置步骤超时
   */
  public setStepTimeout(
    context: ExecutionContext,
    stepId: string,
    duration: number,
    strategy: TimeoutStrategy = TimeoutStrategy.ABORT
  ): string {
    const id = this._generateId();
    const startTime = Date.now();

    const timer = setTimeout(async () => {
      const active = this._activeTimeouts.get(id);
      if (active && !active.resolved) {
        await this._handleTimeout(active);
      }
    }, duration);

    this._activeTimeouts.set(id, {
      id,
      config: { duration, type: TimeoutType.STEP, strategy },
      startTime,
      timer,
      context,
      resolved: false,
      stepId
    });

    return id;
  }

  /**
   * 清除超时
   */
  public clearTimeout(timeoutId: string): boolean {
    const active = this._activeTimeouts.get(timeoutId);
    if (!active) return false;

    clearTimeout(active.timer);
    active.resolved = true;
    this._activeTimeouts.delete(timeoutId);
    return true;
  }

  /**
   * 刷新超时（延长超时时间）
   */
  public refreshTimeout(timeoutId: string, additionalDuration: number): boolean {
    const active = this._activeTimeouts.get(timeoutId);
    if (!active || active.resolved) return false;

    clearTimeout(active.timer);
    
    const elapsed = Date.now() - active.startTime;
    const remaining = active.config.duration - elapsed + additionalDuration;

    if (remaining <= 0) {
      this._handleTimeout(active);
      return false;
    }

    active.timer = setTimeout(async () => {
      const a = this._activeTimeouts.get(timeoutId);
      if (a && !a.resolved) {
        await this._handleTimeout(a);
      }
    }, remaining);

    return true;
  }

  /**
   * 检查是否超时
   */
  public isTimeout(timeoutId: string): boolean {
    const active = this._activeTimeouts.get(timeoutId);
    if (!active) return false;
    return Date.now() - active.startTime > active.config.duration;
  }

  // ==================== 心跳机制 ====================

  /**
   * 启动心跳
   */
  public startHeartbeat(contextId: string): void {
    this._lastHeartbeat.set(contextId, Date.now());
    
    if (!this._heartbeatTimer) {
      this._heartbeatTimer = setInterval(() => {
        this._checkHeartbeats();
      }, this._heartbeatInterval);
    }
  }

  /**
   * 更新心跳
   */
  public updateHeartbeat(contextId: string): void {
    this._lastHeartbeat.set(contextId, Date.now());
  }

  /**
   * 停止心跳
   */
  public stopHeartbeat(contextId: string): void {
    this._lastHeartbeat.delete(contextId);
    
    if (this._lastHeartbeat.size === 0 && this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  private _checkHeartbeats(): void {
    const now = Date.now();
    
    for (const [contextId, lastBeat] of this._lastHeartbeat) {
      if (now - lastBeat > this._heartbeatInterval * 2) {
        this._notifyListeners('timeout_detected', {
          id: this._generateId(),
          type: TimeoutType.HEARTBEAT,
          startTime: lastBeat,
          timeoutAt: now,
          actualDuration: now - lastBeat,
          strategy: TimeoutStrategy.ABORT,
          contextId,
          metadata: { reason: 'heartbeat_missed' }
        });
      }
    }
  }

  // ==================== 超时处理 ====================

  private async _handleTimeout(active: ActiveTimeout): Promise<void> {
    if (active.resolved) return;
    
    active.resolved = true;
    this._activeTimeouts.delete(active.id);

    const timeoutInfo: TimeoutInfo = {
      id: active.id,
      type: active.config.type,
      startTime: active.startTime,
      timeoutAt: Date.now(),
      actualDuration: Date.now() - active.startTime,
      strategy: active.config.strategy,
      contextId: active.context.id,
      taskId: active.context.taskId,
      stepId: active.stepId,
      metadata: {}
    };

    this._timeoutHistory.push(timeoutInfo);
    this._notifyListeners('timeout_detected', timeoutInfo);

    // 执行超时策略
    await this._executeStrategy(active, timeoutInfo);
  }

  private async _executeStrategy(active: ActiveTimeout, info: TimeoutInfo): Promise<void> {
    const { config, context } = active;

    switch (config.strategy) {
      case TimeoutStrategy.ABORT:
        context.setStatus(ExecutionStatus.TIMEOUT);
        context.setMetadata('timeout_info', info);
        this._notifyListeners('timeout_handled', info, { action: 'aborted' });
        break;

      case TimeoutStrategy.RETRY:
        if (config.maxRetries && config.maxRetries > 0) {
          const retryCount = context.getMetadata('timeout_retry_count', 0);
          if (retryCount < config.maxRetries) {
            context.setMetadata('timeout_retry_count', retryCount + 1);
            await new Promise(resolve => setTimeout(resolve, config.retryDelay ?? 1000));
            this._notifyListeners('timeout_handled', info, { action: 'retry', retryCount: retryCount + 1 });
          } else {
            context.setStatus(ExecutionStatus.TIMEOUT);
            this._notifyListeners('timeout_handled', info, { action: 'max_retries_exceeded' });
          }
        }
        break;

      case TimeoutStrategy.FALLBACK:
        if (config.fallbackAction) {
          try {
            const result = await config.fallbackAction();
            this._notifyListeners('timeout_handled', info, { action: 'fallback', result });
          } catch (error) {
            context.setStatus(ExecutionStatus.FAILED);
            this._notifyListeners('timeout_handled', info, { action: 'fallback_failed', error });
          }
        }
        break;

      case TimeoutStrategy.IGNORE:
        this._notifyListeners('timeout_handled', info, { action: 'ignored' });
        break;

      case TimeoutStrategy.ESCALATE:
        context.setMetadata('timeout_escalated', true);
        context.setMetadata('timeout_info', info);
        this._notifyListeners('timeout_handled', info, { action: 'escalated' });
        break;
    }

    // 执行自定义超时处理
    if (config.onTimeout) {
      try {
        await config.onTimeout(context, info);
      } catch (error) {
        console.error('Custom timeout handler error:', error);
      }
    }
  }

  // ==================== 执行包装器 ====================

  /**
   * 带超时执行
   */
  public async executeWithTimeout<T>(
    fn: () => Promise<T>,
    context: ExecutionContext,
    options: {
      timeout?: number;
      type?: TimeoutType;
      strategy?: TimeoutStrategy;
      onTimeout?: () => Promise<T>;
    } = {}
  ): Promise<T> {
    const timeout = options.timeout ?? this._defaultTimeout;
    
    return new Promise<T>((resolve, reject) => {
      const timeoutId = this.setTimeout(context, {
        duration: timeout,
        type: options.type ?? TimeoutType.EXECUTION,
        strategy: options.strategy ?? TimeoutStrategy.ABORT,
        onTimeout: async () => {
          if (options.onTimeout) {
            try {
              resolve(await options.onTimeout());
            } catch (error) {
              reject(error);
            }
          } else {
            reject(new Error(`Execution timeout (${timeout}ms)`));
          }
        }
      });

      fn()
        .then(result => {
          this.clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          this.clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 带超时和重试执行
   */
  public async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: ExecutionContext,
    options: {
      timeout?: number;
      maxRetries?: number;
      retryDelay?: number;
    } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const retryDelay = options.retryDelay ?? 1000;
    
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeWithTimeout(fn, context, {
          timeout: options.timeout,
          strategy: TimeoutStrategy.ABORT
        });
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  // ==================== 统计与查询 ====================

  /**
   * 获取超时统计
   */
  public getStats(): TimeoutStats {
    const history = this._timeoutHistory;
    
    const byType: Record<TimeoutType, number> = {
      [TimeoutType.EXECUTION]: 0,
      [TimeoutType.STEP]: 0,
      [TimeoutType.OPERATION]: 0,
      [TimeoutType.IDLE]: 0,
      [TimeoutType.HEARTBEAT]: 0
    };

    for (const info of history) {
      byType[info.type]++;
    }

    const durations = history.map(h => h.actualDuration);
    const recovered = history.filter(h => h.strategy === TimeoutStrategy.RETRY || 
                                          h.strategy === TimeoutStrategy.FALLBACK).length;

    return {
      total: history.length,
      byType,
      avgDuration: durations.length > 0 
        ? durations.reduce((a, b) => a + b, 0) / durations.length 
        : 0,
      maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
      recoveryRate: history.length > 0 ? recovered / history.length : 0
    };
  }

  /**
   * 获取超时历史
   */
  public getHistory(options: {
    type?: TimeoutType;
    contextId?: string;
    limit?: number;
  } = {}): TimeoutInfo[] {
    let history = [...this._timeoutHistory];

    if (options.type) {
      history = history.filter(h => h.type === options.type);
    }
    if (options.contextId) {
      history = history.filter(h => h.contextId === options.contextId);
    }
    if (options.limit) {
      history = history.slice(-options.limit);
    }

    return history;
  }

  /**
   * 获取活跃超时数
   */
  public get activeCount(): number {
    return this._activeTimeouts.size;
  }

  // ==================== 事件监听 ====================

  /**
   * 添加监听器
   */
  public addListener(listener: (event: TimeoutEvent) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(type: TimeoutEvent['type'], info: TimeoutInfo, result?: any): void {
    const event: TimeoutEvent = {
      type,
      info,
      timestamp: Date.now(),
      result
    };

    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Timeout listener error:', error);
      }
    }
  }

  // ==================== 清理 ====================

  /**
   * 清除所有超时
   */
  public clearAll(): void {
    for (const [id, active] of this._activeTimeouts) {
      clearTimeout(active.timer);
    }
    this._activeTimeouts.clear();
  }

  /**
   * 销毁
   */
  public destroy(): void {
    this.clearAll();
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._lastHeartbeat.clear();
    this._listeners.clear();
  }

  private _generateId(): string {
    return `to_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出工厂函数
export function createExecutionTimeout(options?: {
  defaultTimeout?: number;
  heartbeatInterval?: number;
}): ExecutionTimeout {
  return new ExecutionTimeout(options);
}
