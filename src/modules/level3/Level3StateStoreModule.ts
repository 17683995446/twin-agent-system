/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级执行模块：分层状态存储写入 - 第24阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IExecuteModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 存储层级 */
export type StorageTier = 'hot' | 'warm' | 'cold';

/** 存储条目 */
export interface StorageEntry {
  key: string;
  moduleId: ModuleId;
  data: unknown;
  tier: StorageTier;
  createdAt: number;
  accessedAt: number;
  sizeBytes: number;
}

/** 存储统计 */
export interface StorageStats {
  totalEntries: number;
  totalSizeBytes: number;
  hotCount: number;
  warmCount: number;
  coldCount: number;
}

export interface Level3StateStoreModuleOptions {
  maxHotEntries?: number;
  maxWarmEntries?: number;
  promotionThreshold?: number;
  autoDemote?: boolean;
}

/**
 * 三级执行模块：分层状态存储写入模块
 * 
 * 职责：
 * 1. 短期状态缓存（热存储）
 * 2. 长期持久化落库（冷存储）
 * 3. 存储层级自动迁移
 * 
 * 结构（双子结构）：
 * - 四级管控：短期状态缓存模块
 * - 四级执行：长期持久化落库模块
 */
export abstract class Level3StateStoreModule implements IExecuteModule {
  public readonly type: 'execute' = 'execute';
  public readonly moduleId: ModuleId = 'level3-state-store';
  public readonly moduleName: string = '分层状态存储写入模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-state-persist';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3StateStoreModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _hotStore: Map<string, StorageEntry> = new Map();
  private _warmStore: Map<string, StorageEntry> = new Map();
  private _coldStore: Map<string, StorageEntry> = new Map();

  constructor(options: Level3StateStoreModuleOptions = {}) {
    this._options = { maxHotEntries: options.maxHotEntries ?? 100, maxWarmEntries: options.maxWarmEntries ?? 500, promotionThreshold: options.promotionThreshold ?? 3, autoDemote: options.autoDemote ?? true };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level3StateStoreModuleOptions };
      await this._onInit(params);
      if (this.childModules) {
        for (const child of this.childModules) {
          const r = await child.init({ moduleId: child.moduleId, moduleName: child.moduleName, version: child.version, parentModuleId: this.moduleId, globalTaskParam: this._globalTaskParam });
          if (!r.success) throw new InitError(`子模块初始化失败`, child.moduleId);
        }
      }
      this._updateState('pending');
      this._initialized = true;
      return { success: true, instanceId: `instance_${this.moduleId}_${Date.now()}`, initialState: this._state, initTimeMs: Date.now() - startTime };
    } catch (error) {
      this._updateState('failed');
      return { success: false, error: error instanceof Error ? error.message : String(error), errorCode: 'INIT_ERROR', initTimeMs: Date.now() - startTime };
    }
  }

  public async run(input: ModuleInput): Promise<ModuleOutput> {
    const startTime = Date.now();
    try {
      if (!this._initialized) throw new ExecutionError('模块未初始化', this.moduleId);
      this._updateState('running');
      const result = await this._onRun(input);
      this._updateState('completed');
      return { ...result, executionTimeMs: Date.now() - startTime };
    } catch (error) {
      this._updateState('failed');
      return { outputId: this._genId(), data: { error: error instanceof Error ? error.message : String(error) }, dataType: 'error', timestamp: Date.now(), status: 'failed', executionTimeMs: Date.now() - startTime };
    }
  }

  public async check(state: ModuleState): Promise<CheckResult> {
    const startTime = Date.now();
    const checks = [this._checkSyntax(state), this._checkSemantic(state), this._checkStorageHealth()];
    const custom = await this._onCheck(state);
    checks.push(...custom);
    if (this.childModules) {
      for (const child of this.childModules) {
        const cc = await child.check(child.getCurrentState());
        checks.push({ name: `子模块 ${child.moduleId} 状态校验`, passed: cc.passed, type: 'integrity' });
      }
    }
    return { passed: checks.every(c => c.passed), checks, checkedAt: Date.now(), checkTimeMs: Date.now() - startTime };
  }

  public async snapshot(): Promise<SnapshotData> {
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, hot: Array.from(this._hotStore.entries()), warm: Array.from(this._warmStore.entries()), cold: Array.from(this._coldStore.entries()) } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'execute', 'state-store'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.hot) this._hotStore = new Map(p.data.hot);
      if (p.data.warm) this._warmStore = new Map(p.data.warm);
      if (p.data.cold) this._coldStore = new Map(p.data.cold);
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async execute(input: ModuleInput): Promise<ModuleOutput> { return this.run(input); }
  public async processResult(output: ModuleOutput): Promise<void> { await this._onProcessResult(output); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '分层状态存储写入模块', createdAt: Date.now(), capabilities: ['tiered-storage', 'auto-promotion', 'auto-demotion'], dependencies: ['level2-state-persist'] }; }

  /** 写入热存储 */
  public writeToHot(key: string, moduleId: ModuleId, data: unknown): void {
    this._hotStore.set(key, { key, moduleId, data, tier: 'hot', createdAt: Date.now(), accessedAt: Date.now(), sizeBytes: JSON.stringify(data).length });
    if (this._hotStore.size > this._options.maxHotEntries) this._demoteOldest('hot');
  }

  /** 读取（自动查找各层级） */
  public read(key: string): StorageEntry | undefined {
    let entry = this._hotStore.get(key);
    if (entry) { entry.accessedAt = Date.now(); return entry; }
    entry = this._warmStore.get(key);
    if (entry) { entry.accessedAt = Date.now(); this._promote(key, 'warm'); return entry; }
    entry = this._coldStore.get(key);
    if (entry) { entry.accessedAt = Date.now(); this._promote(key, 'cold'); return entry; }
    return undefined;
  }

  /** 获取存储统计 */
  public getStats(): StorageStats {
    return {
      totalEntries: this._hotStore.size + this._warmStore.size + this._coldStore.size,
      totalSizeBytes: this._calcSize(this._hotStore) + this._calcSize(this._warmStore) + this._calcSize(this._coldStore),
      hotCount: this._hotStore.size,
      warmCount: this._warmStore.size,
      coldCount: this._coldStore.size
    };
  }

  private _promote(key: string, from: 'warm' | 'cold'): void {
    const store = from === 'warm' ? this._warmStore : this._coldStore;
    const entry = store.get(key);
    if (!entry) return;
    store.delete(key);
    entry.tier = from === 'cold' ? 'warm' : 'hot';
    entry.accessedAt = Date.now();
    if (from === 'cold') {
      this._warmStore.set(key, entry);
      if (this._warmStore.size > this._options.maxWarmEntries) this._demoteOldest('warm');
    } else {
      this._hotStore.set(key, entry);
      if (this._hotStore.size > this._options.maxHotEntries) this._demoteOldest('hot');
    }
  }

  private _demoteOldest(from: 'hot' | 'warm'): void {
    const store = from === 'hot' ? this._hotStore : this._warmStore;
    const target = from === 'hot' ? this._warmStore : this._coldStore;
    let oldest: string | undefined;
    let oldestTime = Infinity;
    for (const [k, v] of store) { if (v.accessedAt < oldestTime) { oldestTime = v.accessedAt; oldest = k; } }
    if (oldest) {
      const entry = store.get(oldest)!;
      store.delete(oldest);
      entry.tier = from === 'hot' ? 'warm' : 'cold';
      target.set(oldest, entry);
    }
  }

  private _calcSize(store: Map<string, StorageEntry>): number { let s = 0; for (const v of store.values()) s += v.sizeBytes; return s; }
  private _checkStorageHealth(): CheckResult['checks'][0] {
    const hotFull = this._hotStore.size >= this._options.maxHotEntries * 0.9;
    return { name: '热存储健康', passed: !hotFull, type: 'performance', error: hotFull ? '热存储接近上限' : undefined };
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onProcessResult(output: ModuleOutput): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { hotCount: 0, warmCount: 0, coldCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { hotCount: this._hotStore.size, warmCount: this._warmStore.size, coldCount: this._coldStore.size }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3StateStoreModule;
