/**
 * 超长任务Agent树形双生子模块化执行系统
 * 二级执行模块：超长任务分步落地执行 - 第14阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IExecuteModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

export interface Level2StepExecuteModuleOptions {
  stepTimeoutMs?: number;
  enableStepRetry?: boolean;
  maxStepRetries?: number;
}

export interface Step {
  id: string;
  name: string;
  status: StatusCode;
  startTime?: number;
  endTime?: number;
  result?: unknown;
  error?: string;
}

export abstract class Level2StepExecuteModule implements IExecuteModule {
  public readonly type: 'execute' = 'execute';
  public readonly moduleId: ModuleId = 'level2-step-execute';
  public readonly moduleName: string = '超长任务分步落地执行模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level1-execute';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level2StepExecuteModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _steps: Map<string, Step> = new Map();
  private _currentStepId?: string;

  constructor(options: Level2StepExecuteModuleOptions = {}) {
    this._options = { stepTimeoutMs: options.stepTimeoutMs ?? 10000, enableStepRetry: options.enableStepRetry ?? true, maxStepRetries: options.maxStepRetries ?? 3 };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level2StepExecuteModuleOptions };
      await this._onInit(params);
      if (this.childModules) {
        for (const child of this.childModules) {
          const childResult = await child.init({ moduleId: child.moduleId, moduleName: child.moduleName, version: child.version, parentModuleId: this.moduleId, globalTaskParam: this._globalTaskParam });
          if (!childResult.success) throw new InitError(`子模块初始化失败`, child.moduleId);
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
      return { outputId: this._generateId(), data: { error: error instanceof Error ? error.message : String(error) }, dataType: 'error', timestamp: Date.now(), status: 'failed', executionTimeMs: Date.now() - startTime };
    }
  }

  public async check(state: ModuleState): Promise<CheckResult> {
    const startTime = Date.now();
    const checks = [this._checkSyntax(state), this._checkSemantic(state)];
    const customChecks = await this._onCheck(state);
    checks.push(...customChecks);
    if (this.childModules) {
      for (const child of this.childModules) {
        const childCheck = await child.check(child.getCurrentState());
        checks.push({ name: `子模块 ${child.moduleId} 状态校验`, passed: childCheck.passed, type: 'integrity' });
      }
    }
    return { passed: checks.every(c => c.passed), checks, checkedAt: Date.now(), checkTimeMs: Date.now() - startTime };
  }

  public async snapshot(): Promise<SnapshotData> {
    const serializedState = JSON.stringify({ ...this._state, data: { ...this._state.data, steps: Array.from(this._steps.entries()), currentStepId: this._currentStepId } });
    return { snapshotId: this._generateId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState, compression: 'none', encrypted: false, sizeBytes: serializedState.length, checksum: this._calculateChecksum(serializedState), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level2', 'execute', 'step'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const startTime = Date.now();
    try {
      const parsed = JSON.parse(snapshot.serializedState);
      this._state = parsed;
      this._stateVersion = parsed.version;
      if (parsed.data.steps) this._steps = new Map(parsed.data.steps);
      if (parsed.data.currentStepId) this._currentStepId = parsed.data.currentStepId;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - startTime };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - startTime };
    }
  }

  public async execute(input: ModuleInput): Promise<ModuleOutput> { return this.run(input); }
  public async processResult(output: ModuleOutput): Promise<void> { await this._onProcessResult(output); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo {
    return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '超长任务分步落地执行模块', createdAt: Date.now(), capabilities: ['step-execution', 'step-retry', 'step-tracking'], dependencies: ['level1-execute'] };
  }

  public addStep(step: Step): void { this._steps.set(step.id, step); }
  public getStep(id: string): Step | undefined { return this._steps.get(id); }
  public getAllSteps(): Step[] { return Array.from(this._steps.values()); }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onProcessResult(output: ModuleOutput): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._generateId(), moduleId: this.moduleId, status: 'pending', data: { stepCount: 0, completedSteps: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { stepCount: this._steps.size, completedSteps: Array.from(this._steps.values()).filter(s => s.status === 'completed').length }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _calculateChecksum(data: string): string { let hash = 0; for (let i = 0; i < data.length; i++) hash = ((hash << 5) - hash) + data.charCodeAt(i), hash = hash & hash; return hash.toString(16); }
  private _generateId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level2StepExecuteModule;
