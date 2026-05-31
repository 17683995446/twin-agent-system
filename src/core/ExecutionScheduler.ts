/**
 * 第43阶段：执行调度器
 * Execution Scheduler
 * 
 * 协调队列中任务的调度执行：
 * - 多种调度策略（FIFO、优先级、轮询、公平）
 * - 调度循环与事件驱动
 * - 暂停/恢复/停止生命周期控制
 * - 调度统计与健康检查
 */

import { ExecutionQueue, QueueItem, QueuePriority, QueueItemStatus, QueueEvent } from './ExecutionQueue';
import { ExecutionContext, ExecutionContextManager, ExecutionStatus, ExecutionPhase } from './ExecutionContext';
import { ModuleInput, ModuleOutput } from './interfaces';

// 调度器状态
export enum SchedulerStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error'
}

// 调度策略类型
export enum ScheduleStrategyType {
  FIFO = 'fifo',
  PRIORITY = 'priority',
  ROUND_ROBIN = 'round_robin',
  FAIR = 'fair',
  CUSTOM = 'custom'
}

// 调度器配置
export interface SchedulerConfig {
  strategy?: ScheduleStrategyType;
  pollingInterval?: number;
  maxConcurrentExecutions?: number;
  enableAutoRetry?: boolean;
  idleTimeout?: number;
  healthCheckInterval?: number;
  maxIdleCycles?: number;
}

// 调度事件
export interface SchedulerEvent {
  type: 'started' | 'paused' | 'resumed' | 'stopped' | 'error' | 'item_scheduled' | 'item_dispatched' | 'cycle_completed' | 'health_check';
  timestamp: number;
  data?: any;
}

// 调度策略接口
export interface IScheduleStrategy {
  readonly type: ScheduleStrategyType;
  selectNext(queue: ExecutionQueue, runningItems: Map<string, QueueItem>): QueueItem | null;
  reorder?(queue: ExecutionQueue, items: QueueItem[]): QueueItem[];
}

// 调度结果
export interface ScheduleResult {
  success: boolean;
  itemId?: string;
  error?: string;
  duration?: number;
}

// 健康检查结果
export interface HealthCheckResult {
  healthy: boolean;
  status: SchedulerStatus;
  runningItems: number;
  pendingItems: number;
  avgCycleTime: number;
  errorCount: number;
  lastError?: string;
  uptime: number;
}

// ==================== 调度策略实现 ====================

/** FIFO策略 - 先进先出 */
export class FifoStrategy implements IScheduleStrategy {
  readonly type = ScheduleStrategyType.FIFO;

  selectNext(queue: ExecutionQueue): QueueItem | null {
    return queue.dequeue();
  }
}

/** 优先级策略 - 按优先级调度 */
export class PriorityStrategy implements IScheduleStrategy {
  readonly type = ScheduleStrategyType.PRIORITY;

  selectNext(queue: ExecutionQueue): QueueItem | null {
    return queue.dequeue();
  }
}

/** 轮询策略 - 按任务分组轮询 */
export class RoundRobinStrategy implements IScheduleStrategy {
  readonly type = ScheduleStrategyType.ROUND_ROBIN;
  private _taskIndex: Map<string, number> = new Map();
  private _lastTaskId: string | null = null;

  selectNext(queue: ExecutionQueue): QueueItem | null {
    const pendingItems = queue.getPendingItems();
    if (pendingItems.length === 0) return null;

    // 按任务ID分组
    const taskGroups = new Map<string, QueueItem[]>();
    for (const item of pendingItems) {
      const group = taskGroups.get(item.taskId) || [];
      group.push(item);
      taskGroups.set(item.taskId, group);
    }

    // 轮询选择下一个任务组
    const taskIds = Array.from(taskGroups.keys());
    let startIndex = 0;
    
    if (this._lastTaskId) {
      const lastIndex = taskIds.indexOf(this._lastTaskId);
      if (lastIndex >= 0) {
        startIndex = (lastIndex + 1) % taskIds.length;
      }
    }

    // 找到下一个有可用项的任务组
    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[(startIndex + i) % taskIds.length];
      const items = taskGroups.get(taskId)!;
      if (items.length > 0) {
        this._lastTaskId = taskId;
        return queue.dequeue();
      }
    }

    return queue.dequeue();
  }
}

/** 公平策略 - 基于等待时间和优先级的综合调度 */
export class FairStrategy implements IScheduleStrategy {
  readonly type = ScheduleStrategyType.FAIR;

  selectNext(queue: ExecutionQueue): QueueItem | null {
    const pendingItems = queue.getPendingItems();
    if (pendingItems.length === 0) return null;

    const now = Date.now();
    
    // 计算每个项的综合得分（等待时间越长得分越高，优先级越高得分越高）
    let bestItem: QueueItem | null = null;
    let bestScore = -Infinity;

    for (const item of pendingItems) {
      const waitTime = now - item.createdAt;
      const priorityWeight = (5 - item.priority) * 1000; // 优先级权重
      const waitTimeWeight = Math.min(waitTime, 60000) / 60; // 等待时间权重（最大60秒）
      const score = priorityWeight + waitTimeWeight;

      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    return bestItem ? queue.dequeue() : null;
  }
}

// ==================== 执行调度器 ====================

export class ExecutionScheduler {
  private _queue: ExecutionQueue;
  private _contextManager: ExecutionContextManager;
  private _strategy: IScheduleStrategy;
  private _status: SchedulerStatus = SchedulerStatus.IDLE;
  private _config: Required<SchedulerConfig>;
  private _pollingTimer: NodeJS.Timeout | null = null;
  private _healthCheckTimer: NodeJS.Timeout | null = null;
  private _runningItems: Map<string, QueueItem> = new Map();
  private _eventListeners: Set<(event: SchedulerEvent) => void> = new Set();
  private _startedAt: number = 0;
  private _lastCycleTime: number = 0;
  private _cycleCount: number = 0;
  private _idleCycleCount: number = 0;
  private _errorCount: number = 0;
  private _lastError: string | null = null;
  private _executionHandler: ((item: QueueItem, context: ExecutionContext) => Promise<ModuleOutput>) | null = null;

  constructor(
    queue: ExecutionQueue,
    contextManager: ExecutionContextManager,
    config: SchedulerConfig = {}
  ) {
    this._queue = queue;
    this._contextManager = contextManager;
    this._config = {
      strategy: config.strategy ?? ScheduleStrategyType.PRIORITY,
      pollingInterval: config.pollingInterval ?? 100,
      maxConcurrentExecutions: config.maxConcurrentExecutions ?? 10,
      enableAutoRetry: config.enableAutoRetry ?? true,
      idleTimeout: config.idleTimeout ?? 30000,
      healthCheckInterval: config.healthCheckInterval ?? 10000,
      maxIdleCycles: config.maxIdleCycles ?? 300
    };

    this._strategy = this._createStrategy(this._config.strategy);
  }

  // ==================== 生命周期控制 ====================

  /**
   * 启动调度器
   */
  public start(): void {
    if (this._status === SchedulerStatus.RUNNING) {
      return;
    }

    this._status = SchedulerStatus.RUNNING;
    this._startedAt = Date.now();
    this._idleCycleCount = 0;
    this._cycleCount = 0;

    this._notifyEvent('started', { strategy: this._config.strategy });

    // 启动调度循环
    this._startPolling();

    // 启动健康检查
    this._startHealthCheck();
  }

  /**
   * 暂停调度器
   */
  public pause(): void {
    if (this._status !== SchedulerStatus.RUNNING) {
      return;
    }

    this._status = SchedulerStatus.PAUSED;
    this._stopPolling();
    this._notifyEvent('paused');
  }

  /**
   * 恢复调度器
   */
  public resume(): void {
    if (this._status !== SchedulerStatus.PAUSED) {
      return;
    }

    this._status = SchedulerStatus.RUNNING;
    this._idleCycleCount = 0;
    this._startPolling();
    this._notifyEvent('resumed');
  }

  /**
   * 停止调度器
   */
  public async stop(waitForCompletion: boolean = false): Promise<void> {
    if (this._status === SchedulerStatus.STOPPED || this._status === SchedulerStatus.STOPPING) {
      return;
    }

    this._status = SchedulerStatus.STOPPING;
    this._stopPolling();
    this._stopHealthCheck();

    if (waitForCompletion && this._runningItems.size > 0) {
      // 等待所有运行中的任务完成
      await this._waitForRunningItems();
    } else {
      // 取消所有运行中的任务
      for (const [itemId] of this._runningItems) {
        this._queue.cancel(itemId);
      }
    }

    this._status = SchedulerStatus.STOPPED;
    this._notifyEvent('stopped', { waitForCompletion });
  }

  // ==================== 执行处理 ====================

  /**
   * 注册执行处理器
   */
  public setExecutionHandler(
    handler: (item: QueueItem, context: ExecutionContext) => Promise<ModuleOutput>
  ): void {
    this._executionHandler = handler;
  }

  // ==================== 调度循环 ====================

  private _startPolling(): void {
    if (this._pollingTimer) return;
    
    this._pollingTimer = setInterval(() => {
      this._scheduleCycle().catch(error => {
        this._errorCount++;
        this._lastError = error.message;
        console.error('Schedule cycle error:', error);
      });
    }, this._config.pollingInterval);
  }

  private _stopPolling(): void {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  }

  private async _scheduleCycle(): Promise<void> {
    if (this._status !== SchedulerStatus.RUNNING) return;

    const cycleStart = Date.now();

    // 检查并发限制
    if (this._runningItems.size >= this._config.maxConcurrentExecutions) {
      return;
    }

    // 选择下一个要执行的项
    const item = this._strategy.selectNext(this._queue, this._runningItems);

    if (!item) {
      this._idleCycleCount++;
      
      // 空闲超时检查
      if (this._idleCycleCount >= this._config.maxIdleCycles) {
        this._notifyEvent('cycle_completed', {
          idle: true,
          idleCycles: this._idleCycleCount
        });
        // 可选：自动暂停
        return;
      }
      return;
    }

    this._idleCycleCount = 0;
    this._notifyEvent('item_scheduled', { itemId: item.id, taskId: item.taskId });

    // 创建执行上下文
    const context = this._contextManager.createContext(
      item.taskId,
      item.id,
      item.moduleId
    );
    context.setInput(item.input);
    context.setStatus(ExecutionStatus.RUNNING);
    context.setPhase(ExecutionPhase.EXECUTE);
    context.setMetadata('queueItemId', item.id);
    context.setMetadata('priority', item.priority);
    context.setMetadata('retryCount', item.retryCount);

    // 标记为运行中
    this._runningItems.set(item.id, item);
    this._notifyEvent('item_dispatched', { itemId: item.id });

    // 执行任务
    this._executeItem(item, context).catch(error => {
      console.error(`Item ${item.id} execution error:`, error);
    });

    // 更新循环统计
    this._lastCycleTime = Date.now() - cycleStart;
    this._cycleCount++;
  }

  private async _executeItem(item: QueueItem, context: ExecutionContext): Promise<void> {
    try {
      if (!this._executionHandler) {
        throw new Error('No execution handler registered');
      }

      // 执行超时控制
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Execution timeout (${item.timeout}ms)`)), item.timeout);
      });

      const result = await Promise.race([
        this._executionHandler(item, context),
        timeoutPromise
      ]);

      // 执行成功
      context.setOutput(result);
      context.setStatus(ExecutionStatus.COMPLETED);
      context.setPhase(ExecutionPhase.FINALIZE);
      this._queue.complete(item.id, result);

    } catch (error) {
      const err = error as Error;
      
      context.setStatus(ExecutionStatus.FAILED);
      context.setMetadata('error', err.message);

      // 标记失败（队列会自动重试）
      this._queue.fail(item.id, err);

      this._errorCount++;
      this._lastError = err.message;
    } finally {
      this._runningItems.delete(item.id);
    }
  }

  private async _waitForRunningItems(): Promise<void> {
    const maxWait = 60000; // 最大等待60秒
    const checkInterval = 500;
    let waited = 0;

    while (this._runningItems.size > 0 && waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }
  }

  // ==================== 健康检查 ====================

  private _startHealthCheck(): void {
    if (this._healthCheckTimer) return;

    this._healthCheckTimer = setInterval(() => {
      const health = this.getHealthCheck();
      this._notifyEvent('health_check', health);
    }, this._config.healthCheckInterval);
  }

  private _stopHealthCheck(): void {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
  }

  /**
   * 获取健康检查结果
   */
  public getHealthCheck(): HealthCheckResult {
    const stats = this._queue.getStats();
    const avgCycleTime = this._cycleCount > 0
      ? this._lastCycleTime
      : 0;

    return {
      healthy: this._status === SchedulerStatus.RUNNING && this._errorCount < 100,
      status: this._status,
      runningItems: this._runningItems.size,
      pendingItems: stats.pending,
      avgCycleTime,
      errorCount: this._errorCount,
      lastError: this._lastError || undefined,
      uptime: this._startedAt > 0 ? Date.now() - this._startedAt : 0
    };
  }

  // ==================== 策略管理 ====================

  /**
   * 切换调度策略
   */
  public setStrategy(strategyType: ScheduleStrategyType): void {
    this._strategy = this._createStrategy(strategyType);
    this._config.strategy = strategyType;
  }

  /**
   * 设置自定义策略
   */
  public setCustomStrategy(strategy: IScheduleStrategy): void {
    this._strategy = strategy;
    this._config.strategy = ScheduleStrategyType.CUSTOM;
  }

  /**
   * 获取当前策略
   */
  public getStrategy(): IScheduleStrategy {
    return this._strategy;
  }

  private _createStrategy(type: ScheduleStrategyType): IScheduleStrategy {
    switch (type) {
      case ScheduleStrategyType.FIFO:
        return new FifoStrategy();
      case ScheduleStrategyType.PRIORITY:
        return new PriorityStrategy();
      case ScheduleStrategyType.ROUND_ROBIN:
        return new RoundRobinStrategy();
      case ScheduleStrategyType.FAIR:
        return new FairStrategy();
      default:
        return new PriorityStrategy();
    }
  }

  // ==================== 查询 ====================

  public get status(): SchedulerStatus {
    return this._status;
  }

  public get runningCount(): number {
    return this._runningItems.size;
  }

  public get cycleCount(): number {
    return this._cycleCount;
  }

  public get errorCount(): number {
    return this._errorCount;
  }

  public get uptime(): number {
    return this._startedAt > 0 ? Date.now() - this._startedAt : 0;
  }

  // ==================== 事件监听 ====================

  public addEventListener(listener: (event: SchedulerEvent) => void): () => void {
    this._eventListeners.add(listener);
    return () => this._eventListeners.delete(listener);
  }

  private _notifyEvent(type: SchedulerEvent['type'], data?: any): void {
    const event: SchedulerEvent = {
      type,
      timestamp: Date.now(),
      data
    };

    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Scheduler event listener error:', error);
      }
    }
  }

  // ==================== 销毁 ====================

  public async destroy(): Promise<void> {
    await this.stop(false);
    this._eventListeners.clear();
    this._runningItems.clear();
  }
}

// 导出工厂函数
export function createExecutionScheduler(
  queue: ExecutionQueue,
  contextManager: ExecutionContextManager,
  config?: SchedulerConfig
): ExecutionScheduler {
  return new ExecutionScheduler(queue, contextManager, config);
}
