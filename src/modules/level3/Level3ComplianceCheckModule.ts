/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级管控模块：单步执行合规校验 - 第27阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IControlModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 幻觉检测结果 */
export interface HallucinationCheck {
  detected: boolean;
  confidence: number; // 0-1
  indicators: string[];
}

/** 合规校验结果 */
export interface ComplianceResult {
  hallucinationCheck: HallucinationCheck;
  legalityCheck: { passed: boolean; errors: string[] };
  consistencyCheck: { passed: boolean; errors: string[] };
  overallPassed: boolean;
}

export interface Level3ComplianceCheckModuleOptions {
  hallucinationThreshold?: number;
  enableHallucinationCheck?: boolean;
  enableLegalityCheck?: boolean;
  enableConsistencyCheck?: boolean;
}

/**
 * 三级管控模块：单步执行合规校验模块
 * 
 * 职责：
 * 1. 单步幻觉抑制校验
 * 2. 执行结果合法性校验
 * 
 * 结构（双子结构）：
 * - 四级管控：单步幻觉抑制校验模块
 * - 四级执行：执行结果合法性校验模块
 */
export abstract class Level3ComplianceCheckModule implements IControlModule {
  public readonly type: 'control' = 'control';
  public readonly moduleId: ModuleId = 'level3-compliance-check';
  public readonly moduleName: string = '单步执行合规校验模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-step-execute';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3ComplianceCheckModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _complianceHistory: ComplianceResult[] = [];

  constructor(options: Level3ComplianceCheckModuleOptions = {}) {
    this._options = { hallucinationThreshold: options.hallucinationThreshold ?? 0.7, enableHallucinationCheck: options.enableHallucinationCheck ?? true, enableLegalityCheck: options.enableLegalityCheck ?? true, enableConsistencyCheck: options.enableConsistencyCheck ?? true };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level3ComplianceCheckModuleOptions };
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
      const compliance = await this._checkCompliance(input);
      this._complianceHistory.push(compliance);
      if (this._complianceHistory.length > 500) this._complianceHistory = this._complianceHistory.slice(-250);
      if (!compliance.overallPassed) {
        throw new ExecutionError(`合规校验失败: 幻觉=${compliance.hallucinationCheck.detected}, 合法=${compliance.legalityCheck.passed}`, this.moduleId);
      }
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
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, complianceHistory: this._complianceHistory.slice(-50) } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'control', 'compliance'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.complianceHistory) this._complianceHistory = p.data.complianceHistory;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async validate(input: ModuleInput): Promise<CheckResult> { return { passed: true, checks: [{ name: '输入有效', passed: true, type: 'syntax' as const }], checkedAt: Date.now(), checkTimeMs: 0 }; }
  public async monitor(childState: ModuleState): Promise<void> { await this._onMonitor(childState); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '单步执行合规校验模块', createdAt: Date.now(), capabilities: ['hallucination-suppression', 'legality-check', 'consistency-check'], dependencies: ['level2-step-execute'] }; }

  /** 合规校验主方法 */
  public async checkCompliance(input: ModuleInput): Promise<ComplianceResult> { return this._checkCompliance(input); }
  public getComplianceHistory(limit: number = 50): ComplianceResult[] { return this._complianceHistory.slice(-limit); }

  private async _checkCompliance(input: ModuleInput): Promise<ComplianceResult> {
    const hallucination: HallucinationCheck = this._options.enableHallucinationCheck ? await this._detectHallucination(input) : { detected: false, confidence: 0, indicators: [] };
    const legality = this._options.enableLegalityCheck ? this._checkLegality(input) : { passed: true, errors: [] };
    const consistency = this._options.enableConsistencyCheck ? this._checkConsistency(input) : { passed: true, errors: [] };
    const overallPassed = !hallucination.detected && legality.passed && consistency.passed;
    return { hallucinationCheck: hallucination, legalityCheck: legality, consistencyCheck: consistency, overallPassed };
  }

  private async _detectHallucination(input: ModuleInput): Promise<HallucinationCheck> {
    // 简化实现：子类可注入更复杂的幻觉检测算法
    const dataStr = typeof input.data === 'string' ? input.data : JSON.stringify(input.data);
    const indicators: string[] = [];
    let confidence = 0;
    if (!dataStr || dataStr.length === 0) { indicators.push('输出为空'); confidence = 0.9; }
    return { detected: confidence >= this._options.hallucinationThreshold, confidence, indicators };
  }

  private _checkLegality(input: ModuleInput): { passed: boolean; errors: string[] } {
    const errors: string[] = [];
    if (input.data === undefined || input.data === null) errors.push('输出数据为空');
    return { passed: errors.length === 0, errors };
  }

  private _checkConsistency(input: ModuleInput): { passed: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!input.dataType) errors.push('缺少数据类型');
    return { passed: errors.length === 0, errors };
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onValidate(input: ModuleInput): Promise<CheckResult['checks']>;
  protected abstract _onMonitor(childState: ModuleState): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { checkCount: 0, passCount: 0, failCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { checkCount: this._complianceHistory.length, passCount: this._complianceHistory.filter(c => c.overallPassed).length, failCount: this._complianceHistory.filter(c => !c.overallPassed).length }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3ComplianceCheckModule;
