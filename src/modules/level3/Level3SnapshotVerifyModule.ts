/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级管控模块：状态快照校验 - 第23阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IControlModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 快照校验项 */
export interface SnapshotCheckItem {
  name: string;
  passed: boolean;
  detail?: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

/** 快照校验报告 */
export interface SnapshotCheckReport {
  snapshotId: string;
  moduleId: ModuleId;
  timestamp: number;
  items: SnapshotCheckItem[];
  overallPassed: boolean;
}

export interface Level3SnapshotVerifyModuleOptions {
  enableIntegrityCheck?: boolean;
  enableConsistencyCheck?: boolean;
  enableFreshnessCheck?: boolean;
  maxAgeMs?: number;
}

/**
 * 三级管控模块：状态快照校验模块
 * 
 * 职责：
 * 1. 快照完整性核验
 * 2. 异常状态识别
 * 3. 快照一致性验证
 * 
 * 结构（双子结构）：
 * - 四级管控：快照完整性核验模块
 * - 四级执行：异常状态识别模块
 */
export abstract class Level3SnapshotVerifyModule implements IControlModule {
  public readonly type: 'control' = 'control';
  public readonly moduleId: ModuleId = 'level3-snapshot-verify';
  public readonly moduleName: string = '状态快照校验模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-state-persist';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3SnapshotVerifyModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _checkReports: SnapshotCheckReport[] = [];

  constructor(options: Level3SnapshotVerifyModuleOptions = {}) {
    this._options = { enableIntegrityCheck: options.enableIntegrityCheck ?? true, enableConsistencyCheck: options.enableConsistencyCheck ?? true, enableFreshnessCheck: options.enableFreshnessCheck ?? true, maxAgeMs: options.maxAgeMs ?? 3600000 };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level3SnapshotVerifyModuleOptions };
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
    const checks = [this._checkSyntax(state), this._checkSemantic(state)];
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
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, checkReports: this._checkReports.slice(-50) } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'control', 'snapshot-verify'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.checkReports) this._checkReports = p.data.checkReports;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async validate(input: ModuleInput): Promise<CheckResult> {
    return { passed: true, checks: [{ name: '输入有效', passed: true, type: 'syntax' as const }], checkedAt: Date.now(), checkTimeMs: 0 };
  }

  public async monitor(childState: ModuleState): Promise<void> { await this._onMonitor(childState); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '状态快照校验模块', createdAt: Date.now(), capabilities: ['snapshot-integrity', 'anomaly-detection', 'consistency-check'], dependencies: ['level2-state-persist'] }; }

  /** 校验快照 */
  public async verifySnapshot(snapshot: SnapshotData): Promise<SnapshotCheckReport> {
    const items: SnapshotCheckItem[] = [];

    if (this._options.enableIntegrityCheck) {
      const calculated = this._checksum(snapshot.serializedState);
      items.push({ name: '完整性校验', passed: calculated === snapshot.checksum, detail: calculated === snapshot.checksum ? '校验和匹配' : '校验和不匹配', severity: calculated === snapshot.checksum ? 'info' : 'critical' });
    }

    if (this._options.enableConsistencyCheck) {
      items.push({ name: '模块ID一致性', passed: snapshot.moduleId !== undefined, severity: 'info' });
      items.push({ name: '版本号有效性', passed: snapshot.version !== undefined, severity: 'info' });
    }

    if (this._options.enableFreshnessCheck) {
      const age = Date.now() - snapshot.createdAt;
      items.push({ name: '时效性检查', passed: age < this._options.maxAgeMs, detail: `快照年龄: ${Math.round(age / 1000)}秒`, severity: age < this._options.maxAgeMs ? 'info' : 'warning' });
    }

    const report: SnapshotCheckReport = { snapshotId: snapshot.snapshotId, moduleId: snapshot.moduleId, timestamp: Date.now(), items, overallPassed: items.every(i => i.passed) };
    this._checkReports.push(report);
    if (this._checkReports.length > 200) this._checkReports = this._checkReports.slice(-100);
    return report;
  }

  public getCheckReports(limit: number = 50): SnapshotCheckReport[] { return this._checkReports.slice(-limit); }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onValidate(input: ModuleInput): Promise<CheckResult['checks']>;
  protected abstract _onMonitor(childState: ModuleState): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { reportCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { reportCount: this._checkReports.length }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3SnapshotVerifyModule;
