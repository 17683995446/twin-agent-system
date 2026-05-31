/**
 * 超长任务Agent树形双生子模块化执行系统
 * 二级管控模块：长任务分层规划校验 - 第13阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IControlModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

export interface Level2PlanVerifyModuleOptions {
  enablePathCheck?: boolean;
  enableGoalAlignment?: boolean;
  maxPlanDepth?: number;
}

export interface PlanNode {
  id: string;
  name: string;
  parentId?: string;
  children: string[];
  status: StatusCode;
  goal: string;
}

export abstract class Level2PlanVerifyModule implements IControlModule {
  public readonly type: 'control' = 'control';
  public readonly moduleId: ModuleId = 'level2-plan-verify';
  public readonly moduleName: string = '长任务分层规划校验模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level1-execute';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level2PlanVerifyModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _planTree: Map<string, PlanNode> = new Map();
  private _deviationLogs: Array<{ timestamp: number; expected: string; actual: string; deviation: number }> = [];

  constructor(options: Level2PlanVerifyModuleOptions = {}) {
    this._options = { enablePathCheck: options.enablePathCheck ?? true, enableGoalAlignment: options.enableGoalAlignment ?? true, maxPlanDepth: options.maxPlanDepth ?? 10 };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level2PlanVerifyModuleOptions };
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
    const serializedState = JSON.stringify({ ...this._state, data: { ...this._state.data, planTree: Array.from(this._planTree.entries()), deviationLogs: this._deviationLogs.slice(-50) } });
    return { snapshotId: this._generateId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState, compression: 'none', encrypted: false, sizeBytes: serializedState.length, checksum: this._calculateChecksum(serializedState), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level2', 'control', 'plan'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const startTime = Date.now();
    try {
      const parsed = JSON.parse(snapshot.serializedState);
      this._state = parsed;
      this._stateVersion = parsed.version;
      if (parsed.data.planTree) this._planTree = new Map(parsed.data.planTree);
      if (parsed.data.deviationLogs) this._deviationLogs = parsed.data.deviationLogs;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - startTime };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - startTime };
    }
  }

  public async validate(input: ModuleInput): Promise<CheckResult> {
    const checks = [{ name: '输入有效性', passed: input.data !== undefined, type: 'syntax' as const }];
    const customChecks = await this._onValidate(input);
    checks.push(...customChecks);
    return { passed: checks.every(c => c.passed), checks, checkedAt: Date.now(), checkTimeMs: 0 };
  }

  public async monitor(childState: ModuleState): Promise<void> {
    await this._onMonitor(childState);
  }

  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo {
    return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '长任务分层规划校验模块', createdAt: Date.now(), capabilities: ['plan-verification', 'path-check', 'goal-alignment'], dependencies: ['level1-execute'] };
  }

  public addPlanNode(node: PlanNode): void { this._planTree.set(node.id, node); }
  public getPlanNode(id: string): PlanNode | undefined { return this._planTree.get(id); }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onValidate(input: ModuleInput): Promise<CheckResult['checks']>;
  protected abstract _onMonitor(childState: ModuleState): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._generateId(), moduleId: this.moduleId, status: 'pending', data: { nodeCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { nodeCount: this._planTree.size }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _calculateChecksum(data: string): string { let hash = 0; for (let i = 0; i < data.length; i++) hash = ((hash << 5) - hash) + data.charCodeAt(i), hash = hash & hash; return hash.toString(16); }
  private _generateId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level2PlanVerifyModule;
