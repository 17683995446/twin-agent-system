/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级管控模块：长路径偏差检测 - 第25阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IControlModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 执行路径点 */
export interface PathPoint {
  stepId: string;
  goal: string;
  timestamp: number;
  status: StatusCode;
}

/** 偏差报告 */
export interface DeviationReport {
  detectedAt: number;
  currentGoal: string;
  originalGoal: string;
  deviationScore: number; // 0-1, 0=完全对齐, 1=完全偏离
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  suggestion: string;
}

export interface Level3DeviationDetectModuleOptions {
  maxHistoryPoints?: number;
  deviationThreshold?: number;
  autoCorrect?: boolean;
}

/**
 * 三级管控模块：长路径偏差检测模块
 * 
 * 职责：
 * 1. 历史链路回溯
 * 2. 当前目标对齐校验
 * 3. 偏差预警与修正建议
 * 
 * 结构（双子结构）：
 * - 四级管控：历史链路回溯模块
 * - 四级执行：当前目标对齐校验模块
 */
export abstract class Level3DeviationDetectModule implements IControlModule {
  public readonly type: 'control' = 'control';
  public readonly moduleId: ModuleId = 'level3-deviation-detect';
  public readonly moduleName: string = '长路径偏差检测模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-plan-verify';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3DeviationDetectModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _pathHistory: PathPoint[] = [];
  private _originalGoal: string = '';
  private _deviationReports: DeviationReport[] = [];

  constructor(options: Level3DeviationDetectModuleOptions = {}) {
    this._options = { maxHistoryPoints: options.maxHistoryPoints ?? 500, deviationThreshold: options.deviationThreshold ?? 0.5, autoCorrect: options.autoCorrect ?? true };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (this._globalTaskParam?.description) this._originalGoal = this._globalTaskParam.description;
      if (params.config) this._options = { ...this._options, ...params.config as Level3DeviationDetectModuleOptions };
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
      // 记录路径点
      const point: PathPoint = { stepId: input.inputId, goal: (input.metadata?.goal as string) || '', timestamp: Date.now(), status: 'running' };
      this._pathHistory.push(point);
      if (this._pathHistory.length > this._options.maxHistoryPoints) this._pathHistory = this._pathHistory.slice(-this._options.maxHistoryPoints / 2);
      // 检测偏差
      const report = this._detectDeviation(point);
      if (report.severity !== 'none') this._deviationReports.push(report);
      const result = await this._onRun(input);
      this._updateState('completed');
      return { ...result, executionTimeMs: Date.now() - startTime, metadata: { ...result.metadata, deviationReport: report } };
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
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, pathHistory: this._pathHistory.slice(-100), originalGoal: this._originalGoal, deviationReports: this._deviationReports.slice(-20) } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'control', 'deviation'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.pathHistory) this._pathHistory = p.data.pathHistory;
      if (p.data.originalGoal) this._originalGoal = p.data.originalGoal;
      if (p.data.deviationReports) this._deviationReports = p.data.deviationReports;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async validate(input: ModuleInput): Promise<CheckResult> { return { passed: true, checks: [{ name: '输入有效', passed: true, type: 'syntax' as const }], checkedAt: Date.now(), checkTimeMs: 0 }; }
  public async monitor(childState: ModuleState): Promise<void> { await this._onMonitor(childState); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '长路径偏差检测模块', createdAt: Date.now(), capabilities: ['path-tracing', 'deviation-detection', 'goal-alignment'], dependencies: ['level2-plan-verify'] }; }

  public setOriginalGoal(goal: string): void { this._originalGoal = goal; }
  public getPathHistory(limit: number = 100): PathPoint[] { return this._pathHistory.slice(-limit); }
  public getDeviationReports(limit: number = 20): DeviationReport[] { return this._deviationReports.slice(-limit); }

  private _detectDeviation(current: PathPoint): DeviationReport {
    if (!this._originalGoal || !current.goal) {
      return { detectedAt: Date.now(), currentGoal: current.goal, originalGoal: this._originalGoal, deviationScore: 0, severity: 'none', suggestion: '' };
    }
    // 简化的偏差计算（子类可实现更复杂的语义对齐算法）
    const score = this._calculateDeviationScore(this._originalGoal, current.goal);
    const severity = score < 0.2 ? 'none' : score < 0.4 ? 'low' : score < this._options.deviationThreshold ? 'medium' : score < 0.8 ? 'high' : 'critical';
    return { detectedAt: Date.now(), currentGoal: current.goal, originalGoal: this._originalGoal, deviationScore: score, severity, suggestion: severity !== 'none' ? `偏差度 ${score.toFixed(2)}，建议重新对齐目标` : '' };
  }

  private _calculateDeviationScore(original: string, current: string): number {
    if (original === current) return 0;
    // 基于关键词重叠的简化计算
    const origWords = new Set(original.toLowerCase().split(/\s+/));
    const currWords = new Set(current.toLowerCase().split(/\s+/));
    let overlap = 0;
    for (const w of currWords) { if (origWords.has(w)) overlap++; }
    return 1 - (overlap / Math.max(origWords.size, currWords.size));
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onValidate(input: ModuleInput): Promise<CheckResult['checks']>;
  protected abstract _onMonitor(childState: ModuleState): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { pathLength: 0, deviationCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { pathLength: this._pathHistory.length, deviationCount: this._deviationReports.length }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3DeviationDetectModule;
