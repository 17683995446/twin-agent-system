/**
 * 第51阶段：状态存储抽象
 * State Storage Abstraction
 * 
 * 提供状态存储的抽象层：
 * - 存储接口定义
 * - 多后端支持（内存、文件、数据库）
 * - 存储适配器
 * - 连接管理
 */

// 存储类型
export enum StorageType {
  MEMORY = 'memory',
  FILE = 'file',
  REDIS = 'redis',
  MONGODB = 'mongodb',
  POSTGRES = 'postgres',
  CUSTOM = 'custom'
}

// 存储配置
export interface StorageConfig {
  type: StorageType;
  connectionString?: string;
  options?: Record<string, any>;
  poolSize?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

// 存储项
export interface StorageItem<T = any> {
  key: string;
  value: T;
  timestamp: number;
  ttl?: number;
  metadata?: Record<string, any>;
  version?: number;
}

// 查询选项
export interface QueryOptions {
  prefix?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  filters?: Array<{
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
    value: any;
  }>;
}

// 查询结果
export interface QueryResult<T> {
  items: StorageItem<T>[];
  total: number;
  hasMore: boolean;
}

// 批量操作结果
export interface BatchResult {
  successful: string[];
  failed: Array<{ key: string; error: string }>;
}

// ==================== 存储接口 ====================

export interface IStateStorage {
  // 基础操作
  get<T>(key: string): Promise<StorageItem<T> | null>;
  set<T>(key: string, value: T, options?: { ttl?: number; metadata?: Record<string, any> }): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;

  // 批量操作
  getMany<T>(keys: string[]): Promise<Map<string, StorageItem<T>>>;
  setMany<T>(items: Array<{ key: string; value: T; ttl?: number }>): Promise<BatchResult>;
  deleteMany(keys: string[]): Promise<BatchResult>;

  // 查询
  query<T>(options: QueryOptions): Promise<QueryResult<T>>;
  keys(pattern?: string): Promise<string[]>;

  // 生命周期
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // 工具
  clear(): Promise<void>;
  size(): Promise<number>;
}

// ==================== 内存存储 ====================

export class MemoryStorage implements IStateStorage {
  private _store: Map<string, StorageItem> = new Map();
  private _connected: boolean = false;

  async connect(): Promise<void> {
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected;
  }

  async get<T>(key: string): Promise<StorageItem<T> | null> {
    const item = this._store.get(key);
    if (!item) return null;
    
    // 检查TTL
    if (item.ttl && Date.now() > item.timestamp + item.ttl) {
      this._store.delete(key);
      return null;
    }
    
    return item as StorageItem<T>;
  }

  async set<T>(key: string, value: T, options?: { ttl?: number; metadata?: Record<string, any> }): Promise<void> {
    const item: StorageItem<T> = {
      key,
      value,
      timestamp: Date.now(),
      ttl: options?.ttl,
      metadata: options?.metadata,
      version: (this._store.get(key)?.version || 0) + 1
    };
    this._store.set(key, item);
  }

  async delete(key: string): Promise<boolean> {
    return this._store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const item = await this.get(key);
    return item !== null;
  }

  async getMany<T>(keys: string[]): Promise<Map<string, StorageItem<T>>> {
    const result = new Map<string, StorageItem<T>>();
    for (const key of keys) {
      const item = await this.get<T>(key);
      if (item) result.set(key, item);
    }
    return result;
  }

  async setMany<T>(items: Array<{ key: string; value: T; ttl?: number }>): Promise<BatchResult> {
    const result: BatchResult = { successful: [], failed: [] };
    for (const item of items) {
      try {
        await this.set(item.key, item.value, { ttl: item.ttl });
        result.successful.push(item.key);
      } catch (error) {
        result.failed.push({ key: item.key, error: (error as Error).message });
      }
    }
    return result;
  }

  async deleteMany(keys: string[]): Promise<BatchResult> {
    const result: BatchResult = { successful: [], failed: [] };
    for (const key of keys) {
      try {
        if (await this.delete(key)) {
          result.successful.push(key);
        }
      } catch (error) {
        result.failed.push({ key, error: (error as Error).message });
      }
    }
    return result;
  }

  async query<T>(options: QueryOptions): Promise<QueryResult<T>> {
    let items = Array.from(this._store.values());

    // 前缀过滤
    if (options.prefix) {
      items = items.filter(item => item.key.startsWith(options.prefix!));
    }

    // 过滤器
    if (options.filters) {
      for (const filter of options.filters) {
        items = items.filter(item => this._applyFilter(item, filter));
      }
    }

    // 排序
    if (options.orderBy) {
      items.sort((a, b) => {
        const aVal = (a as any)[options.orderBy!];
        const bVal = (b as any)[options.orderBy!];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return options.orderDirection === 'desc' ? -cmp : cmp;
      });
    }

    const total = items.length;

    // 分页
    if (options.offset) {
      items = items.slice(options.offset);
    }
    if (options.limit) {
      items = items.slice(0, options.limit);
    }

    return {
      items: items as StorageItem<T>[],
      total,
      hasMore: options.offset !== undefined && options.limit !== undefined 
        ? options.offset + options.limit < total 
        : false
    };
  }

  async keys(pattern?: string): Promise<string[]> {
    let keys = Array.from(this._store.keys());
    if (pattern) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      keys = keys.filter(k => regex.test(k));
    }
    return keys;
  }

  async clear(): Promise<void> {
    this._store.clear();
  }

  async size(): Promise<number> {
    return this._store.size;
  }

  private _applyFilter(item: StorageItem, filter: QueryOptions['filters']![0]): boolean {
    const value = (item as any)[filter.field];
    switch (filter.operator) {
      case 'eq': return value === filter.value;
      case 'neq': return value !== filter.value;
      case 'gt': return value > filter.value;
      case 'lt': return value < filter.value;
      case 'gte': return value >= filter.value;
      case 'lte': return value <= filter.value;
      case 'contains': return String(value).includes(filter.value);
      default: return true;
    }
  }
}

// ==================== 存储工厂 ====================

export class StorageFactory {
  private static _customStorages: Map<string, new (config: StorageConfig) => IStateStorage> = new Map();

  /**
   * 创建存储实例
   */
  static create(config: StorageConfig): IStateStorage {
    switch (config.type) {
      case StorageType.MEMORY:
        return new MemoryStorage();
      case StorageType.CUSTOM:
        if (config.options?.implementation) {
          const CustomImpl = this._customStorages.get(config.options.implementation);
          if (CustomImpl) return new CustomImpl(config);
        }
        throw new Error(`Custom storage implementation not found`);
      default:
        throw new Error(`Unsupported storage type: ${config.type}`);
    }
  }

  /**
   * 注册自定义存储
   */
  static register(name: string, implementation: new (config: StorageConfig) => IStateStorage): void {
    this._customStorages.set(name, implementation);
  }

  /**
   * 创建内存存储
   */
  static createMemory(): MemoryStorage {
    return new MemoryStorage();
  }
}

// ==================== 存储管理器 ====================

export class StorageManager {
  private _storages: Map<string, IStateStorage> = new Map();
  private _defaultStorage: string = 'default';

  /**
   * 注册存储
   */
  async register(name: string, config: StorageConfig, setDefault: boolean = false): Promise<IStateStorage> {
    const storage = StorageFactory.create(config);
    await storage.connect();
    this._storages.set(name, storage);
    
    if (setDefault || this._storages.size === 1) {
      this._defaultStorage = name;
    }
    
    return storage;
  }

  /**
   * 获取存储
   */
  get(name?: string): IStateStorage {
    const storageName = name || this._defaultStorage;
    const storage = this._storages.get(storageName);
    if (!storage) {
      throw new Error(`Storage '${storageName}' not found`);
    }
    return storage;
  }

  /**
   * 获取默认存储
   */
  getDefault(): IStateStorage {
    return this.get();
  }

  /**
   * 移除存储
   */
  async remove(name: string): Promise<boolean> {
    const storage = this._storages.get(name);
    if (!storage) return false;
    
    await storage.disconnect();
    this._storages.delete(name);
    return true;
  }

  /**
   * 关闭所有存储
   */
  async closeAll(): Promise<void> {
    for (const [name, storage] of this._storages) {
      await storage.disconnect();
    }
    this._storages.clear();
  }

  /**
   * 获取所有存储名称
   */
  getStorageNames(): string[] {
    return Array.from(this._storages.keys());
  }
}

// 导出
export function createStorage(config: StorageConfig): IStateStorage {
  return StorageFactory.create(config);
}

export function createMemoryStorage(): MemoryStorage {
  return new MemoryStorage();
}

export function createStorageManager(): StorageManager {
  return new StorageManager();
}
