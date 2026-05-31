/**
 * 超长任务Agent树形双生子模块化执行系统
 * 状态快照管理器 - 第6阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { SnapshotData, ModuleId, ModuleState } from './interfaces';

/**
 * 快照存储接口
 */
export interface SnapshotStorage {
  save(snapshot: SnapshotData): Promise<void>;
  load(snapshotId: string): Promise<SnapshotData | null>;
  list(moduleId?: ModuleId): Promise<SnapshotData[]>;
  delete(snapshotId: string): Promise<boolean>;
}

/**
 * 内存快照存储（默认实现）
 */
export class MemorySnapshotStorage implements SnapshotStorage {
  private _snapshots: Map<string, SnapshotData> = new Map();

  async save(snapshot: SnapshotData): Promise<void> {
    this._snapshots.set(snapshot.snapshotId, snapshot);
  }

  async load(snapshotId: string): Promise<SnapshotData | null> {
    return this._snapshots.get(snapshotId) || null;
  }

  async list(moduleId?: ModuleId): Promise<SnapshotData[]> {
    const all = Array.from(this._snapshots.values());
    return moduleId ? all.filter(s => s.moduleId === moduleId) : all;
  }

  async delete(snapshotId: string): Promise<boolean> {
    return this._snapshots.delete(snapshotId);
  }
}

/**
 * 快照管理器
 * 
 * 职责：
 * 1. 管理状态快照的创建、存储、检索
 * 2. 支持序列化与反序列化
 * 3. 快照版本管理
 * 4. 增量快照支持
 */
export class SnapshotManager {
  private _storage: SnapshotStorage;
  private _snapshots: Map<string, SnapshotData> = new Map();
  private _maxSnapshots: number = 100;

  constructor(storage?: SnapshotStorage) {
    this._storage = storage || new MemorySnapshotStorage();
  }

  /**
   * 创建快照
   */
  public async createSnapshot(
    moduleId: ModuleId,
    state: ModuleState,
    options?: {
      compression?: 'none' | 'gzip' | 'lz4';
      encrypted?: boolean;
      metadata?: SnapshotData['metadata'];
    }
  ): Promise<SnapshotData> {
    const serializedState = JSON.stringify(state);
    const snapshot: SnapshotData = {
      snapshotId: this._generateSnapshotId(),
      moduleId,
      createdAt: Date.now(),
      version: '1.0.0',
      state: { ...state },
      serializedState,
      compression: options?.compression || 'none',
      encrypted: options?.encrypted || false,
      sizeBytes: serializedState.length,
      checksum: this._calculateChecksum(serializedState),
      metadata: options?.metadata
    };

    await this._storage.save(snapshot);
    this._snapshots.set(snapshot.snapshotId, snapshot);
    await this._cleanupOldSnapshots(moduleId);

    return snapshot;
  }

  /**
   * 加载快照
   */
  public async loadSnapshot(snapshotId: string): Promise<SnapshotData | null> {
    // 先检查内存缓存
    if (this._snapshots.has(snapshotId)) {
      return this._snapshots.get(snapshotId)!;
    }
    // 从存储加载
    return this._storage.load(snapshotId);
  }

  /**
   * 验证快照完整性
   */
  public validateSnapshot(snapshot: SnapshotData): boolean {
    const calculated = this._calculateChecksum(snapshot.serializedState);
    return calculated === snapshot.checksum;
  }

  /**
   * 获取模块的所有快照
   */
  public async getSnapshots(moduleId?: ModuleId): Promise<SnapshotData[]> {
    return this._storage.list(moduleId);
  }

  /**
   * 删除快照
   */
  public async deleteSnapshot(snapshotId: string): Promise<boolean> {
    this._snapshots.delete(snapshotId);
    return this._storage.delete(snapshotId);
  }

  /**
   * 获取最新快照
   */
  public async getLatestSnapshot(moduleId: ModuleId): Promise<SnapshotData | null> {
    const snapshots = await this._storage.list(moduleId);
    if (snapshots.length === 0) return null;
    return snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  private async _cleanupOldSnapshots(moduleId: ModuleId): Promise<void> {
    const snapshots = await this._storage.list(moduleId);
    if (snapshots.length > this._maxSnapshots) {
      const toDelete = snapshots
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, snapshots.length - this._maxSnapshots);
      for (const snapshot of toDelete) {
        await this._storage.delete(snapshot.snapshotId);
      }
    }
  }

  private _generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private _calculateChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

export default SnapshotManager;
