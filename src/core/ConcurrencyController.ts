/**
 * 第46阶段：并发控制
 * Concurrency Controller
 * 
 * 实现并发执行的控制机制：
 * - 信号量（Semaphore）
 * - 限流器（Rate Limiter）
 * - 并发池（Concurrency Pool）
 * - 资源锁（Resource Lock）
 */

// ==================== 信号量 ====================

export class Semaphore {
  private _permits: number;
  private _maxPermits: number;
  private _waitQueue: Array<{ resolve: (value: boolean) => void; reject: (error: Error) => void }> = [];

  constructor(permits: number) {
    this._permits = permits;
    this._maxPermits = permits;
  }

  /**
   * 获取许可
   */
  public async acquire(timeout?: number): Promise<boolean> {
    if (this._permits > 0) {
      this._permits--;
      return true;
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this._waitQueue.push(waiter);

      if (timeout) {
        setTimeout(() => {
          const index = this._waitQueue.indexOf(waiter);
          if (index >= 0) {
            this._waitQueue.splice(index, 1);
            reject(new Error(`Semaphore acquire timeout (${timeout}ms)`));
          }
        }, timeout);
      }
    });
  }

  /**
   * 释放许可
   */
  public release(): void {
    if (this._waitQueue.length > 0) {
      const waiter = this._waitQueue.shift()!;
      waiter.resolve(true);
    } else {
      if (this._permits < this._maxPermits) {
        this._permits++;
      }
    }
  }

  /**
   * 尝试获取（不等待）
   */
  public tryAcquire(): boolean {
    if (this._permits > 0) {
      this._permits--;
      return true;
    }
    return false;
  }

  /**
   * 获取当前可用许可数
   */
  public get available(): number {
    return this._permits;
  }

  /**
   * 获取等待队列长度
   */
  public get queueLength(): number {
    return this._waitQueue.length;
  }

  /**
   * 使用许可执行操作
   */
  public async withPermit<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    await this.acquire(timeout);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ==================== 限流器 ====================

export enum RateLimiterType {
  TOKEN_BUCKET = 'token_bucket',
  LEAKY_BUCKET = 'leaky_bucket',
  SLIDING_WINDOW = 'sliding_window',
  FIXED_WINDOW = 'fixed_window'
}

export interface RateLimiterConfig {
  type: RateLimiterType;
  rate: number;           // 速率（请求数/秒）
  capacity?: number;      // 桶容量
  windowSize?: number;    // 窗口大小（毫秒）
}

export class RateLimiter {
  private _type: RateLimiterType;
  private _rate: number;
  private _capacity: number;
  private _tokens: number;
  private _lastRefill: number;
  private _windowSize: number;
  private _requests: number[] = [];

  constructor(config: RateLimiterConfig) {
    this._type = config.type;
    this._rate = config.rate;
    this._capacity = config.capacity ?? config.rate;
    this._tokens = this._capacity;
    this._lastRefill = Date.now();
    this._windowSize = config.windowSize ?? 1000;
  }

  /**
   * 尝试获取许可
   */
  public tryAcquire(count: number = 1): boolean {
    switch (this._type) {
      case RateLimiterType.TOKEN_BUCKET:
        return this._tokenBucketTryAcquire(count);
      case RateLimiterType.LEAKY_BUCKET:
        return this._leakyBucketTryAcquire(count);
      case RateLimiterType.SLIDING_WINDOW:
        return this._slidingWindowTryAcquire(count);
      case RateLimiterType.FIXED_WINDOW:
        return this._fixedWindowTryAcquire(count);
      default:
        return this._tokenBucketTryAcquire(count);
    }
  }

  /**
   * 等待获取许可
   */
  public async acquire(count: number = 1): Promise<void> {
    while (!this.tryAcquire(count)) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * 获取当前可用令牌数
   */
  public get availableTokens(): number {
    this._refillTokens();
    return Math.floor(this._tokens);
  }

  /**
   * 重置限流器
   */
  public reset(): void {
    this._tokens = this._capacity;
    this._lastRefill = Date.now();
    this._requests = [];
  }

  private _tokenBucketTryAcquire(count: number): boolean {
    this._refillTokens();
    if (this._tokens >= count) {
      this._tokens -= count;
      return true;
    }
    return false;
  }

  private _leakyBucketTryAcquire(count: number): boolean {
    this._refillTokens();
    if (this._tokens >= count) {
      this._tokens -= count;
      return true;
    }
    return false;
  }

  private _slidingWindowTryAcquire(count: number): boolean {
    const now = Date.now();
    const windowStart = now - this._windowSize;
    
    // 清理过期请求
    this._requests = this._requests.filter(t => t > windowStart);
    
    if (this._requests.length + count <= this._rate) {
      for (let i = 0; i < count; i++) {
        this._requests.push(now);
      }
      return true;
    }
    return false;
  }

  private _fixedWindowTryAcquire(count: number): boolean {
    const now = Date.now();
    const windowStart = Math.floor(now / this._windowSize) * this._windowSize;
    
    // 清理上一个窗口的请求
    this._requests = this._requests.filter(t => t >= windowStart);
    
    if (this._requests.length + count <= this._rate) {
      for (let i = 0; i < count; i++) {
        this._requests.push(now);
      }
      return true;
    }
    return false;
  }

  private _refillTokens(): void {
    const now = Date.now();
    const elapsed = (now - this._lastRefill) / 1000;
    const refill = elapsed * this._rate;
    
    this._tokens = Math.min(this._capacity, this._tokens + refill);
    this._lastRefill = now;
  }
}

// ==================== 并发池 ====================

export interface ConcurrencyPoolConfig {
  maxConcurrent: number;
  maxQueueSize?: number;
  timeout?: number;
  onExecute?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface PoolTask<T> {
  id: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
  createdAt: number;
}

export class ConcurrencyPool {
  private _semaphore: Semaphore;
  private _config: Required<ConcurrencyPoolConfig>;
  private _queue: PoolTask<any>[] = [];
  private _running: Set<string> = new Set();
  private _completed: number = 0;
  private _failed: number = 0;

  constructor(config: ConcurrencyPoolConfig) {
    this._config = {
      maxConcurrent: config.maxConcurrent,
      maxQueueSize: config.maxQueueSize ?? 10000,
      timeout: config.timeout ?? 300000,
      onExecute: config.onExecute ?? ((fn) => fn())
    };
    this._semaphore = new Semaphore(this._config.maxConcurrent);
  }

  /**
   * 提交任务到池
   */
  public async submit<T>(
    fn: () => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    if (this._queue.length >= this._config.maxQueueSize) {
      throw new Error('Concurrency pool queue is full');
    }

    return new Promise((resolve, reject) => {
      const task: PoolTask<T> = {
        id: this._generateId(),
        fn,
        resolve,
        reject,
        priority,
        createdAt: Date.now()
      };

      this._queue.push(task);
      this._queue.sort((a, b) => b.priority - a.priority);
      
      this._processQueue();
    });
  }

  /**
   * 批量提交任务
   */
  public async submitAll<T>(
    fns: Array<() => Promise<T>>,
    priority: number = 0
  ): Promise<T[]> {
    return Promise.all(fns.map(fn => this.submit(fn, priority)));
  }

  /**
   * 获取池状态
   */
  public getStats(): {
    running: number;
    queued: number;
    completed: number;
    failed: number;
    available: number;
  } {
    return {
      running: this._running.size,
      queued: this._queue.length,
      completed: this._completed,
      failed: this._failed,
      available: this._semaphore.available
    };
  }

  /**
   * 清空队列
   */
  public clearQueue(): number {
    const count = this._queue.length;
    for (const task of this._queue) {
      task.reject(new Error('Queue cleared'));
    }
    this._queue = [];
    return count;
  }

  /**
   * 等待所有任务完成
   */
  public async drain(): Promise<void> {
    while (this._running.size > 0 || this._queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async _processQueue(): Promise<void> {
    while (this._queue.length > 0 && this._semaphore.tryAcquire()) {
      const task = this._queue.shift();
      if (!task) {
        this._semaphore.release();
        continue;
      }

      this._running.add(task.id);
      
      this._executeTask(task).finally(() => {
        this._running.delete(task.id);
        this._semaphore.release();
        this._processQueue();
      });
    }
  }

  private async _executeTask<T>(task: PoolTask<T>): Promise<void> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Task timeout (${this._config.timeout}ms)`)), this._config.timeout);
      });

      const result = await Promise.race([
        this._config.onExecute(task.fn),
        timeoutPromise
      ]);

      this._completed++;
      task.resolve(result);
    } catch (error) {
      this._failed++;
      task.reject(error as Error);
    }
  }

  private _generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ==================== 资源锁 ====================

export interface LockOptions {
  timeout?: number;
  retryInterval?: number;
}

export class ResourceLock {
  private _locks: Map<string, { holder: string; acquiredAt: number; timeout: number }> = new Map();
  private _waitQueues: Map<string, Array<{ holder: string; resolve: () => void; reject: (error: Error) => void }>> = new Map();

  /**
   * 获取锁
   */
  public async acquire(
    resourceId: string,
    holder: string,
    options: LockOptions = {}
  ): Promise<boolean> {
    const timeout = options.timeout ?? 30000;
    const existing = this._locks.get(resourceId);

    if (!existing) {
      this._locks.set(resourceId, { holder, acquiredAt: Date.now(), timeout });
      return true;
    }

    if (existing.holder === holder) {
      return true; // 重入锁
    }

    // 等待锁释放
    return new Promise((resolve, reject) => {
      const queue = this._waitQueues.get(resourceId) || [];
      queue.push({ holder, resolve: () => resolve(true), reject });
      this._waitQueues.set(resourceId, queue);

      if (options.timeout) {
        setTimeout(() => {
          const q = this._waitQueues.get(resourceId);
          if (q) {
            const index = q.findIndex(w => w.holder === holder);
            if (index >= 0) {
              q.splice(index, 1);
              reject(new Error(`Lock acquire timeout for resource: ${resourceId}`));
            }
          }
        }, options.timeout);
      }
    });
  }

  /**
   * 释放锁
   */
  public release(resourceId: string, holder: string): boolean {
    const existing = this._locks.get(resourceId);
    
    if (!existing || existing.holder !== holder) {
      return false;
    }

    this._locks.delete(resourceId);

    // 唤醒等待者
    const queue = this._waitQueues.get(resourceId);
    if (queue && queue.length > 0) {
      const waiter = queue.shift()!;
      this._locks.set(resourceId, {
        holder: waiter.holder,
        acquiredAt: Date.now(),
        timeout: 30000
      });
      waiter.resolve();
    }

    return true;
  }

  /**
   * 检查锁状态
   */
  public isLocked(resourceId: string): boolean {
    const existing = this._locks.get(resourceId);
    if (!existing) return false;
    
    // 检查是否超时
    if (Date.now() - existing.acquiredAt > existing.timeout) {
      this._locks.delete(resourceId);
      return false;
    }
    
    return true;
  }

  /**
   * 获取锁持有者
   */
  public getHolder(resourceId: string): string | undefined {
    return this._locks.get(resourceId)?.holder;
  }

  /**
   * 强制释放锁
   */
  public forceRelease(resourceId: string): boolean {
    return this._locks.delete(resourceId);
  }

  /**
   * 使用锁执行操作
   */
  public async withLock<T>(
    resourceId: string,
    holder: string,
    fn: () => Promise<T>,
    options?: LockOptions
  ): Promise<T> {
    await this.acquire(resourceId, holder, options);
    try {
      return await fn();
    } finally {
      this.release(resourceId, holder);
    }
  }
}

// ==================== 并发控制器 ====================

export interface ConcurrencyControllerConfig {
  maxConcurrent?: number;
  rateLimit?: number;
  rateLimiterType?: RateLimiterType;
}

export class ConcurrencyController {
  private _semaphore: Semaphore;
  private _rateLimiter: RateLimiter | null;
  private _pool: ConcurrencyPool;
  private _lock: ResourceLock;

  constructor(config: ConcurrencyControllerConfig = {}) {
    const maxConcurrent = config.maxConcurrent ?? 10;
    
    this._semaphore = new Semaphore(maxConcurrent);
    this._rateLimiter = config.rateLimit
      ? new RateLimiter({
          type: config.rateLimiterType ?? RateLimiterType.TOKEN_BUCKET,
          rate: config.rateLimit
        })
      : null;
    
    this._pool = new ConcurrencyPool({ maxConcurrent });
    this._lock = new ResourceLock();
  }

  /**
   * 获取执行许可
   */
  public async acquire(timeout?: number): Promise<boolean> {
    if (this._rateLimiter) {
      await this._rateLimiter.acquire();
    }
    return this._semaphore.acquire(timeout);
  }

  /**
   * 释放执行许可
   */
  public release(): void {
    this._semaphore.release();
  }

  /**
   * 在并发控制下执行
   */
  public async execute<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    await this.acquire(timeout);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * 提交任务到池
   */
  public submit<T>(fn: () => Promise<T>, priority?: number): Promise<T> {
    return this._pool.submit(fn, priority);
  }

  /**
   * 获取资源锁
   */
  public getLock(): ResourceLock {
    return this._lock;
  }

  /**
   * 获取信号量
   */
  public getSemaphore(): Semaphore {
    return this._semaphore;
  }

  /**
   * 获取限流器
   */
  public getRateLimiter(): RateLimiter | null {
    return this._rateLimiter;
  }

  /**
   * 获取并发池
   */
  public getPool(): ConcurrencyPool {
    return this._pool;
  }

  /**
   * 获取状态
   */
  public getStats(): {
    semaphore: { available: number; queueLength: number };
    pool: { running: number; queued: number; completed: number; failed: number };
    rateLimiter: { availableTokens: number } | null;
  } {
    return {
      semaphore: {
        available: this._semaphore.available,
        queueLength: this._semaphore.queueLength
      },
      pool: this._pool.getStats(),
      rateLimiter: this._rateLimiter
        ? { availableTokens: this._rateLimiter.availableTokens }
        : null
    };
  }
}

// 导出工厂函数
export function createConcurrencyController(config?: ConcurrencyControllerConfig): ConcurrencyController {
  return new ConcurrencyController(config);
}

export function createSemaphore(permits: number): Semaphore {
  return new Semaphore(permits);
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  return new RateLimiter(config);
}

export function createConcurrencyPool(config: ConcurrencyPoolConfig): ConcurrencyPool {
  return new ConcurrencyPool(config);
}

export function createResourceLock(): ResourceLock {
  return new ResourceLock();
}
