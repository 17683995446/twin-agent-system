/**
 * 第42阶段：执行队列管理
 * Execution Queue Management
 * 
 * 管理待执行任务的队列：
 * - 优先级队列
 * - 队列持久化
 * - 并发控制
 * - 队列统计
 */

import { ModuleInput, ModuleContext } from './interfaces';
import { ExecutionStatus } from './ExecutionContext';

// 队列项状态
export enum QueueItemStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying'
}

// 队列项优先级
export enum QueuePriority {
  CRITICAL = 0,   // 最高优先级，立即执行
  HIGH = 1,       // 高优先级
  NORMAL = 2,     // 普通优先级
  LOW = 3,        // 低优先级
  BACKGROUND = 4  // 后台任务
}

// 队列项
export interface QueueItem {
  id: string;
  taskId: string;
  moduleId: string;
  input: ModuleInput;
  context?: ModuleContext;
  priority: QueuePriority;
  status: QueueItemStatus;
  createdAt: number;
  scheduledAt?: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
  timeout: number;
  metadata: Record<string, any>;
  dependencies: string[];  // 依赖的其他队列项ID
  tags: string[];
}

// 队列配置
export interface QueueConfig {
  maxSize?: number;
  maxConcurrent?: number;
  defaultPriority?: QueuePriority;
  defaultTimeout?: number;
  defaultMaxRetries?: number;
  enablePersistence?: boolean;
  persistenceInterval?: number;
}

// 队列统计
export interface QueueStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgWaitTime: number;
  avgExecutionTime: number;
  throughput: number;
}

// 队列事件
export interface QueueEvent {
  type: 'item_added' | 'item_removed' | 'item_started' | 'item_completed' | 'item_failed' | 'item_cancelled' | 'queue_cleared';
  itemId?: string;
  timestamp: number;
  data?: any;
}

// 队列存储接口
export interface QueueStorage {
  save(items: QueueItem[]): Promise<void>;
  load(): Promise<QueueItem[]>;
}

// 内存存储实现
export class MemoryQueueStorage implements QueueStorage {
  private _items: QueueItem[] = [];

  async save(items: QueueItem[]): Promise<void> {
    this._items = [...items];
  }

  async load(): Promise<QueueItem[]> {
    return [...this._items];
  }
}

// 执行队列
export class ExecutionQueue {
  private _items: Map<string, QueueItem> = new Map();
  private _pendingQueue: string[] = [];  // 待执行队列（按优先级排序）
  private _runningItems: Set<string> = new Set();
  private _config: Required<QueueConfig>;
  private _storage: QueueStorage | null = null;
  private _eventListeners: Set<(event: QueueEvent) => void> = new Set();
  private _stats: {
    completedCount: number;
    failedCount: number;
    totalWaitTime: number;
    totalExecutionTime: number;
    lastThroughputTime: number;
    lastThroughputCount: number;
  };

  constructor(config: QueueConfig = {}, storage?: QueueStorage) {
    this._config = {
      maxSize: config.maxSize ?? 10000,
      maxConcurrent: config.maxConcurrent ?? 10,
      defaultPriority: config.defaultPriority ?? QueuePriority.NORMAL,
      defaultTimeout: config.defaultTimeout ?? 300000, // 5分钟
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      enablePersistence: config.enablePersistence ?? false,
      persistenceInterval: config.persistenceInterval ?? 60000
    };

    this._storage = storage || null;
    this._stats = {
      completedCount: 0,
      failedCount: 0,
      totalWaitTime: 0,
      totalExecutionTime: 0,
      lastThroughputTime: Date.now(),
      lastThroughputCount: 0
    };
  }

  // ==================== 队列操作 ====================

  /**
   * 添加项到队列
   */
  public async enqueue(
    taskId: string,
    moduleId: string,
    input: ModuleInput,
    options: {
      priority?: QueuePriority;
      timeout?: number;
      maxRetries?: number;
      dependencies?: string[];
      tags?: string[];
      metadata?: Record<string, any>;
      context?: ModuleContext;
    } = {}
  ): Promise<QueueItem> {
    // 检查队列大小限制
    if (this._items.size >= this._config.maxSize) {
      throw new Error(`Queue is full (max size: ${this._config.maxSize})`);
    }

    const item: QueueItem = {
      id: this._generateId(),
      taskId,
      moduleId,
      input,
      context: options.context,
      priority: options.priority ?? this._config.defaultPriority,
      status: QueueItemStatus.PENDING,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: options.maxRetries ?? this._config.defaultMaxRetries,
      timeout: options.timeout ?? this._config.defaultTimeout,
      metadata: options.metadata ?? {},
      dependencies: options.dependencies ?? [],
      tags: options.tags ?? []
    };

    // 添加到队列
    this._items.set(item.id, item);
    this._insertToPendingQueue(item.id);
    
    this._notifyEvent('item_added', item.id, { priority: item.priority });
    
    return item;
  }

  /**
   * 批量入队
   */
  public async enqueueBatch(
    items: Array<{
      taskId: string;
      moduleId: string;
      input: ModuleInput;
      options?: Parameters<ExecutionQueue['enqueue']>[3];
    }>
  ): Promise<QueueItem[]> {
    const results: QueueItem[] = [];
    for (const item of items) {
      const queued = await this.enqueue(item.taskId, item.moduleId, item.input, item.options);
      results.push(queued);
    }
    return results;
  }

  /**
   * 从队列取出下一个待执行项
   */
  public dequeue(): QueueItem | null {
    // 检查并发限制
    if (this._runningItems.size >= this._config.maxConcurrent) {
      return null;
    }

    // 找到下一个可执行的项
    while (this._pendingQueue.length > 0) {
      const itemId = this._pendingQueue.shift()!;
      const item = this._items.get(itemId);

      if (!item) continue;

      // 检查依赖是否满足
      if (!this._checkDependencies(item)) {
        // 依赖未满足，放回队列末尾
        this._pendingQueue.push(itemId);
        return null;
      }

      // 检查是否达到并发限制
      if (this._runningItems.size >= this._config.maxConcurrent) {
        this._pendingQueue.unshift(itemId);
        return null;
      }

      // 标记为运行中
      item.status = QueueItemStatus.RUNNING;
      item.startedAt = Date.now();
      this._runningItems.add(itemId);
      
      this._notifyEvent('item_started', itemId);
      return item;
    }

    return null;
  }

  /**
   * 查看队列头部（不移除）
   */
  public peek(): QueueItem | null {
    if (this._pendingQueue.length === 0) {
      return null;
    }
    return this._items.get(this._pendingQueue[0]) || null;
  }

  /**
   * 获取队列项
   */
  public getItem(itemId: string): QueueItem | undefined {
    return this._items.get(itemId);
  }

  /**
   * 标记项完成
   */
  public complete(itemId: string, result?: any): boolean {
    const item = this._items.get(itemId);
    if (!item) return false;

    item.status = QueueItemStatus.COMPLETED;
    item.completedAt = Date.now();
    item.metadata.result = result;

    this._runningItems.delete(itemId);
    this._updateStats(item);
    
    this._notifyEvent('item_completed', itemId, { result });
    return true;
  }

  /**
   * 标记项失败
   */
  public fail(itemId: string, error: Error): boolean {
    const item = this._items.get(itemId);
    if (!item) return false;

    item.retryCount++;
    
    if (item.retryCount < item.maxRetries) {
      // 重试
      item.status = QueueItemStatus.RETRYING;
      item.metadata.lastError = error.message;
      this._runningItems.delete(itemId);
      this._insertToPendingQueue(itemId);
    } else {
      // 最终失败
      item.status = QueueItemStatus.FAILED;
      item.completedAt = Date.now();
      item.metadata.error = error.message;
      this._runningItems.delete(itemId);
      this._stats.failedCount++;
      this._notifyEvent('item_failed', itemId, { error: error.message });
    }

    return true;
  }

  /**
   * 取消项
   */
  public cancel(itemId: string): boolean {
    const item = this._items.get(itemId);
    if (!item) return false;

    if (item.status === QueueItemStatus.COMPLETED || 
        item.status === QueueItemStatus.FAILED) {
      return false;
    }

    item.status = QueueItemStatus.CANCELLED;
    item.completedAt = Date.now();
    
    this._runningItems.delete(itemId);
    this._pendingQueue = this._pendingQueue.filter(id => id !== itemId);
    
    this._notifyEvent('item_cancelled', itemId);
    return true;
  }

  /**
   * 移除项
   */
  public remove(itemId: string): boolean {
    const item = this._items.get(itemId);
    if (!item) return false;

    this._runningItems.delete(itemId);
    this._pendingQueue = this._pendingQueue.filter(id => id !== itemId);
    this._items.delete(itemId);
    
    this._notifyEvent('item_removed', itemId);
    return true;
  }

  /**
   * 清空队列
   */
  public clear(): void {
    this._items.clear();
    this._pendingQueue = [];
    this._runningItems.clear();
    this._notifyEvent('queue_cleared');
  }

  // ==================== 查询操作 ====================

  /**
   * 获取队列大小
   */
  public size(): number {
    return this._pendingQueue.length;
  }

  /**
   * 获取运行中数量
   */
  public runningCount(): number {
    return this._runningItems.size;
  }

  /**
   * 获取总项数
   */
  public totalSize(): number {
    return this._items.size;
  }

  /**
   * 检查队列是否为空
   */
  public isEmpty(): boolean {
    return this._pendingQueue.length === 0;
  }

  /**
   * 检查是否已满
   */
  public isFull(): boolean {
    return this._items.size >= this._config.maxSize;
  }

  /**
   * 获取所有待执行项
   */
  public getPendingItems(): QueueItem[] {
    return this._pendingQueue
      .map(id => this._items.get(id))
      .filter((item): item is QueueItem => item !== undefined);
  }

  /**
   * 获取所有运行中项
   */
  public getRunningItems(): QueueItem[] {
    return Array.from(this._runningItems)
      .map(id => this._items.get(id))
      .filter((item): item is QueueItem => item !== undefined);
  }

  /**
   * 按状态获取项
   */
  public getItemsByStatus(status: QueueItemStatus): QueueItem[] {
    return Array.from(this._items.values())
      .filter(item => item.status === status);
  }

  /**
   * 按优先级获取项
   */
  public getItemsByPriority(priority: QueuePriority): QueueItem[] {
    return Array.from(this._items.values())
      .filter(item => item.priority === priority);
  }

  /**
   * 按标签获取项
   */
  public getItemsByTag(tag: string): QueueItem[] {
    return Array.from(this._items.values())
      .filter(item => item.tags.includes(tag));
  }

  /**
   * 按任务ID获取项
   */
  public getItemsByTask(taskId: string): QueueItem[] {
    return Array.from(this._items.values())
      .filter(item => item.taskId === taskId);
  }

  // ==================== 优先级操作 ====================

  /**
   * 更新项优先级
   */
  public updatePriority(itemId: string, priority: QueuePriority): boolean {
    const item = this._items.get(itemId);
    if (!item || item.status !== QueueItemStatus.PENDING) {
      return false;
    }

    item.priority = priority;
    
    // 重新排序
    this._pendingQueue = this._pendingQueue.filter(id => id !== itemId);
    this._insertToPendingQueue(itemId);
    
    return true;
  }

  /**
   * 批量更新优先级
   */
  public updatePriorities(updates: Array<{ itemId: string; priority: QueuePriority }>): number {
    let count = 0;
    for (const update of updates) {
      if (this.updatePriority(update.itemId, update.priority)) {
        count++;
      }
    }
    return count;
  }

  // ==================== 统计 ====================

  /**
   * 获取队列统计
   */
  public getStats(): QueueStats {
    const now = Date.now();
    const timeDiff = (now - this._stats.lastThroughputTime) / 1000;
    const throughput = timeDiff > 0 
      ? (this._stats.completedCount - this._stats.lastThroughputCount) / timeDiff 
      : 0;

    const completedItems = this.getItemsByStatus(QueueItemStatus.COMPLETED);
    const avgWaitTime = completedItems.length > 0
      ? completedItems.reduce((sum, item) => sum + ((item.startedAt || 0) - item.createdAt), 0) / completedItems.length
      : 0;

    const avgExecutionTime = completedItems.length > 0
      ? completedItems.reduce((sum, item) => sum + ((item.completedAt || 0) - (item.startedAt || 0)), 0) / completedItems.length
      : 0;

    return {
      total: this._items.size,
      pending: this._pendingQueue.length,
      running: this._runningItems.size,
      completed: completedItems.length,
      failed: this.getItemsByStatus(QueueItemStatus.FAILED).length,
      cancelled: this.getItemsByStatus(QueueItemStatus.CANCELLED).length,
      avgWaitTime,
      avgExecutionTime,
      throughput
    };
  }

  private _updateStats(item: QueueItem): void {
    this._stats.completedCount++;
    if (item.startedAt) {
      this._stats.totalWaitTime += item.startedAt - item.createdAt;
    }
    if (item.startedAt && item.completedAt) {
      this._stats.totalExecutionTime += item.completedAt - item.startedAt;
    }
  }

  // ==================== 持久化 ====================

  /**
   * 保存队列状态
   */
  public async save(): Promise<void> {
    if (!this._storage) return;
    await this._storage.save(Array.from(this._items.values()));
  }

  /**
   * 加载队列状态
   */
  public async load(): Promise<void> {
    if (!this._storage) return;
    
    const items = await this._storage.load();
    this._items.clear();
    this._pendingQueue = [];
    this._runningItems.clear();

    for (const item of items) {
      this._items.set(item.id, item);
      
      if (item.status === QueueItemStatus.PENDING || 
          item.status === QueueItemStatus.QUEUED ||
          item.status === QueueItemStatus.RETRYING) {
        this._insertToPendingQueue(item.id);
      } else if (item.status === QueueItemStatus.RUNNING) {
        // 运行中的项需要重新执行
        item.status = QueueItemStatus.PENDING;
        this._insertToPendingQueue(item.id);
      }
    }
  }

  // ==================== 事件监听 ====================

  /**
   * 添加事件监听器
   */
  public addEventListener(listener: (event: QueueEvent) => void): () => void {
    this._eventListeners.add(listener);
    return () => this._eventListeners.delete(listener);
  }

  private _notifyEvent(type: QueueEvent['type'], itemId?: string, data?: any): void {
    const event: QueueEvent = {
      type,
      itemId,
      timestamp: Date.now(),
      data
    };

    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Queue event listener error:', error);
      }
    }
  }

  // ==================== 私有方法 ====================

  private _insertToPendingQueue(itemId: string): void {
    const item = this._items.get(itemId);
    if (!item) return;

    // 按优先级插入到正确位置
    let inserted = false;
    for (let i = 0; i < this._pendingQueue.length; i++) {
      const existingItem = this._items.get(this._pendingQueue[i]);
      if (existingItem && existingItem.priority > item.priority) {
        this._pendingQueue.splice(i, 0, itemId);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this._pendingQueue.push(itemId);
    }

    item.status = QueueItemStatus.QUEUED;
    item.scheduledAt = Date.now();
  }

  private _checkDependencies(item: QueueItem): boolean {
    if (item.dependencies.length === 0) {
      return true;
    }

    for (const depId of item.dependencies) {
      const depItem = this._items.get(depId);
      if (!depItem || depItem.status !== QueueItemStatus.COMPLETED) {
        return false;
      }
    }

    return true;
  }

  private _generateId(): string {
    return `qi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出工厂函数
export function createExecutionQueue(config?: QueueConfig, storage?: QueueStorage): ExecutionQueue {
  return new ExecutionQueue(config, storage);
}
