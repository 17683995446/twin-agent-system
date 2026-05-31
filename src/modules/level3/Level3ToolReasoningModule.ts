/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级执行模块：工具与推理落地 - 第28阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IExecuteModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 工具定义 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; required: boolean; description: string }>;
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/** 工具调用结果 */
export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  executionTimeMs: number;
}

/** 推理步骤 */
export interface ReasoningStep {
  stepId: string;
  thought: string;
  action: string;
  actionInput: Record<string, unknown>;
  observation: unknown;
  timestamp: number;
}

export interface Level3ToolReasoningModuleOptions {
  maxTools?: number;
  maxReasoningSteps?: number;
  enableChainLogging?: boolean;
}

/**
 * 三级执行模块：工具与推理落地模块
 * 
 * 职责：
 * 1. 标准化工具调用
 * 2. LLM迭代推理
 * 3. 推理链记录
 * 
 * 结构（双子结构）：
 * - 四级管控：标准化工具调用模块
 * - 四级执行：LLM迭代推理模块
 */
export abstract class Level3ToolReasoningModule implements IExecuteModule {
  public readonly type: 'execute' = 'execute';
  public readonly moduleId: ModuleId = 'level3-tool-reasoning';
  public readonly moduleName: string = '工具与推理落地模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-step-execute';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3ToolReasoningModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _tools: Map<string, ToolDefinition> = new Map();
  private _reasoningChain: ReasoningStep[] = [];

  constructor(options: Level3ToolReasoningModuleOptions = {}) {
    this._options = { maxTools: options.maxTools ?? 20, maxReasoningSteps: options.maxReasoningSteps ?? 50, enableChainLogging: options.enableChainLogging ?? true };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level3ToolReasoningModuleOptions };
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
    const checks = [this._checkSyntax(state), this._checkSemantic(state), this._checkToolConsistency()];
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
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, tools: Array.from(this._tools.keys()), reasoningChain: this._reasoningChain.slice(-50) } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'execute', 'tool-reasoning'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.reasoningChain) this._reasoningChain = p.data.reasoningChain;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async execute(input: ModuleInput): Promise<ModuleOutput> { return this.run(input); }
  public async processResult(output: ModuleOutput): Promise<void> { await this._onProcessResult(output); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '工具与推理落地模块', createdAt: Date.now(), capabilities: ['tool-invocation', 'llm-reasoning', 'chain-logging'], dependencies: ['level2-step-execute'] }; }

  /** 注册工具 */
  public registerTool(tool: ToolDefinition): boolean { if (this._tools.size >= this._options.maxTools) return false; this._tools.set(tool.name, tool); return true; }

  /** 调用工具 */
  public async invokeTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this._tools.get(name);
    if (!tool) return { success: false, data: null, error: `工具未找到: ${name}`, executionTimeMs: 0 };
    const startTime = Date.now();
    try {
      const result = await tool.handler(params);
      return { ...result, executionTimeMs: Date.now() - startTime };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error), executionTimeMs: Date.now() - startTime };
    }
  }

  /** 记录推理步骤 */
  public addReasoningStep(step: ReasoningStep): void {
    this._reasoningChain.push(step);
    if (this._reasoningChain.length > this._options.maxReasoningSteps) this._reasoningChain = this._reasoningChain.slice(-this._options.maxReasoningSteps / 2);
  }

  /** 获取推理链 */
  public getReasoningChain(limit: number = 50): ReasoningStep[] { return this._reasoningChain.slice(-limit); }
  public getToolNames(): string[] { return Array.from(this._tools.keys()); }

  private _checkToolConsistency(): CheckResult['checks'][0] {
    const hasDuplicates = this._tools.size !== new Set(this._tools.keys()).size;
    return { name: '工具一致性校验', passed: !hasDuplicates, type: 'integrity', error: hasDuplicates ? '存在重复的工具名称' : undefined };
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onProcessResult(output: ModuleOutput): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { toolCount: 0, stepCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { toolCount: this._tools.size, stepCount: this._reasoningChain.length }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3ToolReasoningModule;
