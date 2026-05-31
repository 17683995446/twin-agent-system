/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级执行模块：运行规则动态约束 - 第22阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IExecuteModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 约束规则 */
export interface ConstraintRule {
  id: string;
  name: string;
  type: 'rate_limit' | 'resource_limit' | 'behavior' | 'content';
  priority: number;
  evaluate: (input: ModuleInput, context: ConstraintContext) => Promise<ConstraintResult>;
}

/** 约束上下文 */
export interface ConstraintContext {
  executionCount: number;
  lastExecutionTime: number;
  resourceUsage: { cpu: number; memory: number };
}

/** 约束结果 */
export interface ConstraintResult {
  satisfied: boolean;
  message?: string;
  action?: 'allow' | 'throttle' | 'reject' | 'modify';
  modifiedInput?: ModuleInput;
}

/** 违规记录 */
export interface ViolationRecord {
  ruleId: string;
  inputId: string;
  timestamp: number;
  action: string;
  message: string;
}

export interface Level3RuleConstraintModuleOptions {
  maxRules?: number;
  violationThreshold?: number;
  autoCorrect?: boolean;
}

/**
 * 三级执行模块：运行规则动态约束模块
 * 
 * 职责：
 * 1. 实时违规检测
 * 2. 行为修正指令生成
 * 3. 动态规则加载与执行
 * 
 * 结构（双子结构）：
 * - 四级管控：实时违规检测模块
 * - 四级执行：行为修正指令生成模块
 */
export abstract class Level3RuleConstraintModule implements IExecuteModule {
  public readonly type: 'execute' = 'execute';
  public readonly moduleId: ModuleId = 'level3-rule-constraint';
  public readonly moduleName: string = '运行规则动态约束模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-rule-control';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3RuleConstraintModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _rules: Map<string, ConstraintRule> = new Map();
  private _violations: ViolationRecord[] = [];
  private _context: ConstraintContext = { executionCount: 0, lastExecutionTime: 0, resourceUsage: { cpu: 0, memory: 0 } };

  constructor(options: Level3RuleConstraintModuleOptions = {}) {
    this._options = { maxRules: options.maxRules ?? 30, violationThreshold: options.violationThreshold ?? 10, autoCorrect: options.autoCorrect ?? true };
    this._state = this._createInitialState();
    this._loadDefaultRules();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level3RuleConstraintModuleOptions };
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
      this._context.executionCount++;
      this._context.lastExecutionTime = Date.now();
      const constraintResult = await this._evaluateConstraints(input);
      let finalInput = input;
      if (!constraintResult.satisfied && constraintResult.action === 'modify' && constraintResult.modifiedInput && this._options.autoCorrect) {
        finalInput = constraintResult.modifiedInput;
      }
      if (!constraintResult.satisfied && constraintResult.action === 'reject') {
        throw new ExecutionError(`约束检查拒绝: ${constraintResult.message}`, this.moduleId);
      }
      const result = await this._onRun(finalInput);
      this._updateState('completed');
      return { ...result, executionTimeMs: Date.now() - startTime };
    } catch (error) {
      this._updateState('failed');
      return { outputId: this._genId(), data: { error: error instanceof Error ? error.message : String(error) }, dataType: 'error', timestamp: Date.now(), status: 'failed', executionTimeMs: Date.now() - startTime };
    }
  }

  public async check(state: ModuleState): Promise<CheckResult> {
    const startTime = Date.now();
    const checks = [this._checkSyntax(state), this._checkSemantic(state), this._checkViolationThreshold()];
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
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, rules: Array.from(this._rules.entries()), violations: this._violations.slice(-50), context: this._context } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'execute', 'constraint'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.rules) this._rules = new Map(p.data.rules);
      if (p.data.violations) this._violations = p.data.violations;
      if (p.data.context) this._context = p.data.context;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async execute(input: ModuleInput): Promise<ModuleOutput> { return this.run(input); }
  public async processResult(output: ModuleOutput): Promise<void> { await this._onProcessResult(output); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '运行规则动态约束模块', createdAt: Date.now(), capabilities: ['constraint-evaluation', 'violation-detection', 'auto-correction'], dependencies: ['level2-rule-control'] }; }

  public addRule(rule: ConstraintRule): boolean { if (this._rules.size >= this._options.maxRules) return false; this._rules.set(rule.id, rule); return true; }
  public removeRule(id: string): boolean { return this._rules.delete(id); }
  public getViolations(limit: number = 50): ViolationRecord[] { return this._violations.slice(-limit); }

  private async _evaluateConstraints(input: ModuleInput): Promise<ConstraintResult> {
    const sorted = Array.from(this._rules.values()).sort((a, b) => b.priority - a.priority);
    for (const rule of sorted) {
      const result = await rule.evaluate(input, this._context);
      if (!result.satisfied) {
        this._violations.push({ ruleId: rule.id, inputId: input.inputId, timestamp: Date.now(), action: result.action || 'reject', message: result.message || '约束未满足' });
        if (this._violations.length > 500) this._violations = this._violations.slice(-250);
        return result;
      }
    }
    return { satisfied: true, action: 'allow' };
  }

  private _loadDefaultRules(): void {
    this._rules.set('constraint-execution-count', { id: 'constraint-execution-count', name: '执行次数检查', type: 'rate_limit', priority: 100, evaluate: async () => ({ satisfied: true, action: 'allow' }) });
    this._rules.set('constraint-content-safety', { id: 'constraint-content-safety', name: '内容安全检查', type: 'content', priority: 90, evaluate: async () => ({ satisfied: true, action: 'allow' }) });
  }

  private _checkViolationThreshold(): CheckResult['checks'][0] {
    const exceeded = this._violations.length >= this._options.violationThreshold;
    return { name: '违规阈值检查', passed: !exceeded, type: 'security', error: exceeded ? `违规次数 ${this._violations.length} 超过阈值 ${this._options.violationThreshold}` : undefined };
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onProcessResult(output: ModuleOutput): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { ruleCount: 0, violationCount: 0, executionCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { ruleCount: this._rules.size, violationCount: this._violations.length, executionCount: this._context.executionCount }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3RuleConstraintModule;
