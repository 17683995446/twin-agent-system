/**
 * 第53阶段：状态快照管理
 * State Snapshot Manager
 * 
 * 管理状态快照：
 * - 快照创建与存储
 * - 增量快照
 * - 快照压缩
 * - 快照恢复
 */

import { IStateStorage, StorageItem } from './StateStorage';
import { StateSerializer, SerializationFormat } from './StateSerialization';

// 快照类型
export enum SnapshotType {
  FULL = 'full',
  INCREMENTAL = 'incremental',
  DIFF = 'diff'
}

// 快照元数据
export interface SnapshotMetadata {
  id: string;
  type: SnapshotType;
  timestamp: number;
  parentId?: string;
  size: number;
  checksum: string;
  tags: string[];
  description?: string;
}

// 快照
export interface Snapshot {
  metadata: SnapshotMetadata;
  data: any;
  diff?: Map<string, { old: any; new: any }>;
}

// 快照配置
export interface SnapshotConfig {
  storage: IStateStorage;
  serializer?: StateSerializer;
  maxSnapshots?: number;
  compressionEnabled?: boolean;
  autoCleanup?: boolean;
}

// ==================== 状态快照管理器 ====================

export class StateSnapshotManager {
  private _storage: IStateStorage;
  private _serializer: StateSerializer;
  private _config: {
    maxSnapshots: number;
    compressionEnabled: boolean;
    autoCleanup: boolean;
  };
  private _snapshots: Map<string, Snapshot> = new Map();
  private _snapshotHistory: SnapshotMetadata[] = [];
  private _lastFullSnapshot: string | null = null;

  constructor(config: SnapshotConfig) {
    this._storage = config.storage;
    this._serializer = config.serializer || new StateSerializer();
    this._config = {
      maxSnapshots: config.maxSnapshots ?? 100,
      compressionEnabled: config.compressionEnabled ?? true,
      autoCleanup: config.autoCleanup ?? true
    };
  }

  /**
   * 创建完整快照
   */
  public async createFullSnapshot(
    state: Map<string, any>,
    options: { description?: string; tags?: string[] } = {}
  ): Promise<Snapshot> {
    const id = this._generateId();
    const timestamp = Date.now();

    // 序列化状态
    const serialized = this._serializer.serialize(Object.fromEntries(state), {
      compress: this._config.compressionEnabled
    });

    const metadata: SnapshotMetadata = {
      id,
      type: SnapshotType.FULL,
      timestamp,
      size: serialized.size,
      checksum: serialized.checksum,
      tags: options.tags || [],
      description: options.description
    };

    const snapshot: Snapshot = {
      metadata,
      data: serialized.data
    };

    // 存储
    await this._storage.set(`snapshot:${id}`, snapshot);
    this._snapshots.set(id, snapshot);
    this._snapshotHistory.push(metadata);
    this._lastFullSnapshot = id;

    // 自动清理
    if (this._config.autoCleanup) {
      this._cleanupOldSnapshots();
    }

    return snapshot;
  }

  /**
   * 创建增量快照
   */
  public async createIncrementalSnapshot(
    state: Map<string, any>,
    previousState: Map<string, any>,
    options: { description?: string; tags?: string[] } = {}
  ): Promise<Snapshot> {
    if (!this._lastFullSnapshot) {
      return this.createFullSnapshot(state, options);
    }

    const id = this._generateId();
    const timestamp = Date.now();

    // 计算差异
    const diff = new Map<string, { old: any; new: any }>();
    
    for (const [key, value] of state) {
      if (!previousState.has(key) || previousState.get(key) !== value) {
        diff.set(key, {
          old: previousState.get(key),
          new: value
        });
      }
    }

    for (const [key] of previousState) {
      if (!state.has(key)) {
        diff.set(key, {
          old: previousState.get(key),
          new: undefined
        });
      }
    }

    const serialized = this._serializer.serialize(Object.fromEntries(diff), {
      compress: this._config.compressionEnabled
    });

    const metadata: SnapshotMetadata = {
      id,
      type: SnapshotType.INCREMENTAL,
      timestamp,
      parentId: this._lastFullSnapshot,
      size: serialized.size,
      checksum: serialized.checksum,
      tags: options.tags || [],
      description: options.description
    };

    const snapshot: Snapshot = {
      metadata,
      data: serialized.data,
      diff
    };

    await this._storage.set(`snapshot:${id}`, snapshot);
    this._snapshots.set(id, snapshot);
    this._snapshotHistory.push(metadata);

    return snapshot;
  }

  /**
   * 获取快照
   */
  public async getSnapshot(id: string): Promise<Snapshot | null> {
    if (this._snapshots.has(id)) {
      return this._snapshots.get(id)!;
    }

    const item = await this._storage.get<Snapshot>(`snapshot:${id}`);
    if (item) {
      this._snapshots.set(id, item.value);
      return item.value;
    }

    return null;
  }

  /**
   * 从快照恢复状态
   */
  public async restoreFromSnapshot(id: string): Promise<Map<string, any>> {
    const snapshot = await this.getSnapshot(id);
    if (!snapshot) {
      throw new Error(`Snapshot '${id}' not found`);
    }

    let state: Map<string, any>;

    if (snapshot.metadata.type === SnapshotType.FULL) {
      const data = this._serializer.deserialize(snapshot.data);
      state = new Map(Object.entries(data));
    } else {
      // 增量快照需要先恢复父快照
      if (!snapshot.metadata.parentId) {
        throw new Error('Incremental snapshot has no parent');
      }

      state = await this.restoreFromSnapshot(snapshot.metadata.parentId);

      // 应用差异
      const diff = this._serializer.deserialize(snapshot.data);
      for (const [key, change] of Object.entries(diff)) {
        if ((change as any).new === undefined) {
          state.delete(key);
        } else {
          state.set(key, (change as any).new);
        }
      }
    }

    return state;
  }

  /**
   * 列出所有快照
   */
  public async listSnapshots(options: {
    type?: SnapshotType;
    tags?: string[];
    limit?: number;
  } = {}): Promise<SnapshotMetadata[]> {
    let snapshots = [...this._snapshotHistory].sort((a, b) => b.timestamp - a.timestamp);

    if (options.type) {
      snapshots = snapshots.filter(s => s.type === options.type);
    }

    if (options.tags && options.tags.length > 0) {
      snapshots = snapshots.filter(s => 
        options.tags!.some(tag => s.tags.includes(tag))
      );
    }

    if (options.limit) {
      snapshots = snapshots.slice(0, options.limit);
    }

    return snapshots;
  }

  /**
   * 删除快照
   */
  public async deleteSnapshot(id: string): Promise<boolean> {
    await this._storage.delete(`snapshot:${id}`);
    this._snapshots.delete(id);
    this._snapshotHistory = this._snapshotHistory.filter(s => s.id !== id);
    
    if (this._lastFullSnapshot === id) {
      this._lastFullSnapshot = null;
    }
    
    return true;
  }

  /**
   * 清理旧快照
   */
  private _cleanupOldSnapshots(): void {
    if (this._snapshotHistory.length <= this._config.maxSnapshots) {
      return;
    }

    const toRemove = this._snapshotHistory.length - this._config.maxSnapshots;
    const sorted = [...this._snapshotHistory].sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < toRemove; i++) {
      this.deleteSnapshot(sorted[i].id);
    }
  }

  /**
   * 获取快照统计
   */
  public getStats(): {
    total: number;
    full: number;
    incremental: number;
    totalSize: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    const full = this._snapshotHistory.filter(s => s.type === SnapshotType.FULL).length;
    const incremental = this._snapshotHistory.filter(s => s.type === SnapshotType.INCREMENTAL).length;
    const totalSize = this._snapshotHistory.reduce((sum, s) => sum + s.size, 0);
    const timestamps = this._snapshotHistory.map(s => s.timestamp);

    return {
      total: this._snapshotHistory.length,
      full,
      incremental,
      totalSize,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null
    };
  }

  private _generateId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export function createStateSnapshotManager(config: SnapshotConfig): StateSnapshotManager {
  return new StateSnapshotManager(config);
}
