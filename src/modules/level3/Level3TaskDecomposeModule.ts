/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级执行模块：多级任务拆解规整 - 第26阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IExecuteModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 子任务定义 */
export interface SubTask {
  id: string;
  name: string;
  description: string;
  parentId?: string;
  priority: number;
  status: StatusCode;
  dependencies: string[];
  estimatedSteps: number;
  metadata?: Record<string, unknown>;
}

/** 拆解策略 */
export type DecomposeStrategy = 'sequential' | 'parallel' | 'dependency' | 'priority';

export interface Level3TaskDecomposeModuleOptions {
  maxSubTasks?: number;
  maxDepth?: number;
  defaultStrategy?: DecomposeStrategy;
}

/**
 * 三级执行模块：多级任务拆解规整模块
 * 
 * 职责：
 * 1. 超长篇任务拆分
 * 2. 子任务优先级排序
 * 3. 依赖关系管理
 * 
 * 结构（双子结构）：
 * - 四级管控：超长篇任务拆分模块
 * - 四级执行：子任务优先级排序模块
 */
export abstract class Level3TaskDecomposeModule implements IExecuteModule {
  public readonly type: 'execute' = 'execute';
  public readonly moduleId: ModuleId = 'level3-task-decompose';
  public readonly moduleName: string = '多级任务拆解规整模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-plan-verify';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3TaskDecomposeModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _subTasks: Map<string, SubTask> = new Map();
  private _strategy: DecomposeStrategy;

  constructor(options: Level3TaskDecomposeModuleOptions = {}) {
    this._options = { maxSubTasks: options.maxSubTasks ?? 1000, maxDepth: options.maxDepth ?? 10, defaultStrategy: options.defaultStrategy ?? 'sequential' };
    this._strategy = this._options.defaultStrategy;
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level3TaskDecomposeModuleOptions };
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
    const checks = [this._checkSyntax(state), this._checkSemantic(state), this._checkDependencyConsistency()];
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
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, subTasks: Array.from(this._subTasks.entries()), strategy: this._strategy } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'execute', 'decompose'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.subTasks) this._subTasks = new Map(p.data.subTasks);
      if (p.data.strategy) this._strategy = p.data.strategy;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async execute(input: ModuleInput): Promise<ModuleOutput> { return this.run(input); }
  public async processResult(output: ModuleOutput): Promise<void> { await this._onProcessResult(output); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '多级任务拆解规整模块', createdAt: Date.now(), capabilities: ['task-decomposition', 'priority-sorting', 'dependency-management'], dependencies: ['level2-plan-verify'] }; }

  public addSubTask(task: SubTask): boolean { if (this._subTasks.size >= this._options.maxSubTasks) return false; this._subTasks.set(task.id, task); return true; }
  public getSubTask(id: string): SubTask | undefined { return this._subTasks.get(id); }
  public getAllSubTasks(): SubTask[] { return Array.from(this._subTasks.values()); }
  public setStrategy(strategy: DecomposeStrategy): void { this._strategy = strategy; }

  /** 按优先级排序获取可执行子任务 */
  public getExecutableTasks(): SubTask[] {
    const completed = new Set<string>();
    for (const t of this._subTasks.values()) { if (t.status === 'completed') completed.add(t.id); }
    return Array.from(this._subTasks.values())
      .filter(t => t.status === 'pending' && t.dependencies.every(d => completed.has(d)))
      .sort((a, b) => b.priority - a.priority);
  }

  private _checkDependencyConsistency(): CheckResult['checks'][0] {
    const ids = new Set(this._subTasks.keys());
    let hasInvalid = false;
    for (const t of this._subTasks.values()) {
      for (const dep of t.dependencies) { if (!ids.has(dep)) { hasInvalid = true; break; } }
    }
    return { name: '依赖一致性校验', passed: !hasInvalid, type: 'integrity', error: hasInvalid ? '存在无效的依赖引用' : undefined };
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onProcessResult(output: ModuleOutput): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { subTaskCount: 0, completedCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { subTaskCount: this._subTasks.size, completedCount: Array.from(this._subTasks.values()).filter(t => t.status === 'completed').length }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3TaskDecomposeModule;
