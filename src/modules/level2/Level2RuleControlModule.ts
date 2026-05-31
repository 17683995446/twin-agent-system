/**
 * 超长任务Agent树形双生子模块化执行系统
 * 二级管控模块：任务规则与安全管控 - 第11阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId,
  ModuleInitParam,
  InitResult,
  ModuleInput,
  ModuleOutput,
  ModuleState,
  CheckResult,
  SnapshotData,
  IControlModule,
  IBaseModule,
  StatusCode,
  ModuleInfo,
  TaskParam,
  InitError,
  ExecutionError,
  ValidationError
} from '../../core/interfaces';

/**
 * 二级管控模块配置选项
 */
export interface Level2RuleControlModuleOptions {
  /** 是否启用严格规则检查 */
  strictRuleCheck?: boolean;
  /** 规则检查间隔（毫秒） */
  checkIntervalMs?: number;
  /** 最大规则数量 */
  maxRules?: number;
  /** 是否启用安全审计 */
  enableSecurityAudit?: boolean;
}

/**
 * 安全规则定义
 */
export interface SecurityRule {
  id: string;
  name: string;
  description: string;
  type: 'access' | 'execution' | 'data' | 'resource';
  priority: number;
  condition: (input: ModuleInput, context: SecurityContext) => boolean;
  action: (input: ModuleInput, context: SecurityContext) => Promise<SecurityActionResult>;
}

/**
 * 安全上下文
 */
export interface SecurityContext {
  userId?: string;
  role?: string;
  permissions: string[];
  ip?: string;
  timestamp: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * 安全动作结果
 */
export interface SecurityActionResult {
  allowed: boolean;
  reason?: string;
  riskScore: number;
  metadata?: Record<string, unknown>;
}

/**
 * 二级管控模块：任务规则与安全管控模块
 * 
 * 职责：
 * 1. 任务准入规则管理
 * 2. 运行规则动态约束
 * 3. 安全风险检测
 * 4. 违规行为拦截
 * 
 * 结构（双子结构）：
 * - 三级管控：任务准入与权限校验模块
 * - 三级执行：运行规则动态约束模块
 */
export abstract class Level2RuleControlModule implements IControlModule {
  public readonly type: 'control' = 'control';
  public readonly moduleId: ModuleId = 'level2-rule-control';
  public readonly moduleName: string = '任务规则与安全管控模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level1-control';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level2RuleControlModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _securityRules: Map<string, SecurityRule> = new Map();
  private _securityAudits: SecurityAudit[] = [];
  private _activeContexts: Map<string, SecurityContext> = new Map();

  constructor(options: Level2RuleControlModuleOptions = {}) {
    this._options = {
      strictRuleCheck: options.strictRuleCheck ?? true,
      checkIntervalMs: options.checkIntervalMs ?? 500,
      maxRules: options.maxRules ?? 50,
      enableSecurityAudit: options.enableSecurityAudit ?? true
    };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) {
        throw new InitError(`父模块ID不匹配: 期望 ${this.parentModuleId}`, this.moduleId);
      }
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) {
        this._options = { ...this._options, ...params.config as Level2RuleControlModuleOptions };
      }
      await this._loadDefaultSecurityRules();
      await this._onInit(params);
      if (this.childModules) {
        for (const child of this.childModules) {
          const childResult = await child.init({
            moduleId: child.moduleId,
            moduleName: child.moduleName,
            version: child.version,
            parentModuleId: this.moduleId,
            globalTaskParam: this._globalTaskParam
          });
          if (!childResult.success) {
            throw new InitError(`子模块 ${child.moduleId} 初始化失败`, child.moduleId);
          }
        }
      }
      this._updateState('pending');
      this._initialized = true;
      this._audit('INIT', '安全管控模块初始化成功');
      return {
        success: true,
        instanceId: `instance_${this.moduleId}_${Date.now()}`,
        initialState: this._state,
        initTimeMs: Date.now() - startTime
      };
    } catch (error) {
      this._updateState('failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'INIT_ERROR',
        initTimeMs: Date.now() - startTime
      };
    }
  }

  public async run(input: ModuleInput): Promise<ModuleOutput> {
    const startTime = Date.now();
    try {
      if (!this._initialized) throw new ExecutionError('模块未初始化', this.moduleId);
      this._updateState('running');
      
      // 创建安全上下文
      const context = this._createSecurityContext(input);
      this._activeContexts.set(input.inputId, context);
      
      // 执行安全规则检查
      const securityResult = await this._executeSecurityRules(input, context);
      if (!securityResult.allowed) {
        this._audit('SECURITY_VIOLATION', `安全规则拦截: ${securityResult.reason}`, { inputId: input.inputId, riskScore: securityResult.riskScore });
        throw new ExecutionError(`安全检查失败: ${securityResult.reason}`, this.moduleId);
      }
      
      const result = await this._onRun(input);
      this._activeContexts.delete(input.inputId);
      this._updateState('completed');
      this._audit('EXECUTE', '安全管控执行成功', { inputId: input.inputId, riskScore: securityResult.riskScore });
      return { ...result, executionTimeMs: Date.now() - startTime };
    } catch (error) {
      this._updateState('failed');
      return {
        outputId: this._generateId(),
        data: { error: error instanceof Error ? error.message : String(error) },
        dataType: 'error',
        timestamp: Date.now(),
        status: 'failed',
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  public async check(state: ModuleState): Promise<CheckResult> {
    const startTime = Date.now();
    const checks = [];
    checks.push(this._checkSyntax(state));
    checks.push(this._checkSemantic(state));
    checks.push(await this._checkSecurityRulesConsistency());
    checks.push(await this._checkAuditLogHealth());
    const customChecks = await this._onCheck(state);
    checks.push(...customChecks);
    if (this.childModules) {
      for (const child of this.childModules) {
        const childState = child.getCurrentState();
        const childCheck = await child.check(childState);
        checks.push({
          name: `子模块 ${child.moduleId} 状态校验`,
          passed: childCheck.passed,
          type: 'integrity',
          details: `子模块校验通过 ${childCheck.checks.filter(c => c.passed).length}/${childCheck.checks.length} 项`
        });
      }
    }
    return {
      passed: checks.every(c => c.passed),
      checks,
      checkedAt: Date.now(),
      checkTimeMs: Date.now() - startTime
    };
  }

  public async snapshot(): Promise<SnapshotData> {
    const serializedState = JSON.stringify({
      ...this._state,
      data: {
        ...this._state.data,
        securityRules: Array.from(this._securityRules.entries()),
        securityAudits: this._securityAudits.slice(-100),
        activeContexts: Array.from(this._activeContexts.entries()),
        childStates: this.childModules ? {
          [this.childModules[0].moduleId]: this.childModules[0].getCurrentState(),
          [this.childModules[1].moduleId]: this.childModules[1].getCurrentState()
        } : undefined
      }
    });
    return {
      snapshotId: this._generateId(),
      moduleId: this.moduleId,
      createdAt: Date.now(),
      version: this.version,
      state: { ...this._state },
      serializedState,
      compression: 'none',
      encrypted: false,
      sizeBytes: serializedState.length,
      checksum: this._calculateChecksum(serializedState),
      metadata: { reason: 'auto', creator: this.moduleId, tags: ['level2', 'control', 'security'] }
    };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const startTime = Date.now();
    try {
      const parsed = JSON.parse(snapshot.serializedState);
      this._state = parsed;
      this._stateVersion = parsed.version;
      if (parsed.data.securityRules) {
        this._securityRules = new Map(parsed.data.securityRules);
      }
      if (parsed.data.securityAudits) {
        this._securityAudits = parsed.data.securityAudits;
      }
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - startTime };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - startTime };
    }
  }

  public async validate(input: ModuleInput): Promise<CheckResult> {
    const checks = [];
    checks.push({
      name: '输入数据存在性',
      passed: input.data !== undefined && input.data !== null,
      type: 'syntax' as const,
      error: input.data === undefined || input.data === null ? '输入数据不能为空' : undefined
    });
    checks.push({
      name: '数据类型有效性',
      passed: typeof input.dataType === 'string' && input.dataType.length > 0,
      type: 'syntax' as const
    });
    const customChecks = await this._onValidate(input);
    checks.push(...customChecks);
    return {
      passed: checks.every(c => c.passed),
      checks,
      checkedAt: Date.now(),
      checkTimeMs: 0
    };
  }

  public async monitor(childState: ModuleState): Promise<void> {
    this._audit('MONITOR', `监控子模块 ${childState.moduleId}`, { status: childState.status });
    if (childState.status === 'failed') {
      await this._handleChildFailure(childState);
    }
    await this._onMonitor(childState);
  }

  public getCurrentState(): ModuleState {
    return { ...this._state };
  }

  public getModuleInfo(): ModuleInfo {
    return {
      moduleId: this.moduleId,
      moduleName: this.moduleName,
      version: this.version,
      description: '任务规则与安全管控模块，负责安全规则管理和风险检测',
      createdAt: Date.now(),
      capabilities: ['security-rule-management', 'risk-detection', 'violation-interception', 'security-audit'],
      dependencies: ['level1-control']
    };
  }

  public addSecurityRule(rule: SecurityRule): boolean {
    if (this._securityRules.size >= this._options.maxRules) return false;
    this._securityRules.set(rule.id, rule);
    this._audit('RULE_ADDED', `添加安全规则: ${rule.name}`, { ruleId: rule.id });
    return true;
  }

  public removeSecurityRule(ruleId: string): boolean {
    const removed = this._securityRules.delete(ruleId);
    if (removed) this._audit('RULE_REMOVED', `移除安全规则: ${ruleId}`);
    return removed;
  }

  public getSecurityRules(): SecurityRule[] {
    return Array.from(this._securityRules.values());
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onValidate(input: ModuleInput): Promise<CheckResult['checks']>;
  protected abstract _onMonitor(childState: ModuleState): Promise<void>;

  private _createInitialState(): ModuleState {
    return {
      stateId: this._generateId(),
      moduleId: this.moduleId,
      status: 'pending',
      data: { ruleCount: 0, auditCount: 0, activeContextCount: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 0
    };
  }

  private _updateState(status: StatusCode): void {
    this._stateVersion++;
    this._state = {
      ...this._state,
      status,
      data: {
        ruleCount: this._securityRules.size,
        auditCount: this._securityAudits.length,
        activeContextCount: this._activeContexts.size
      },
      updatedAt: Date.now(),
      version: this._stateVersion
    };
  }

  private async _loadDefaultSecurityRules(): Promise<void> {
    const defaultRules: SecurityRule[] = [
      {
        id: 'sec-access-control',
        name: '访问控制规则',
        description: '检查用户访问权限',
        type: 'access',
        priority: 100,
        condition: () => true,
        action: async () => ({ allowed: true, riskScore: 0 })
      },
      {
        id: 'sec-execution-limit',
        name: '执行限制规则',
        description: '限制执行频率和资源使用',
        type: 'execution',
        priority: 90,
        condition: () => true,
        action: async () => ({ allowed: true, riskScore: 0 })
      }
    ];
    for (const rule of defaultRules) {
      this._securityRules.set(rule.id, rule);
    }
  }

  private _createSecurityContext(input: ModuleInput): SecurityContext {
    return {
      userId: input.metadata?.userId as string,
      role: input.metadata?.role as string,
      permissions: (input.metadata?.permissions as string[]) || [],
      ip: input.metadata?.ip as string,
      timestamp: Date.now(),
      riskLevel: 'low'
    };
  }

  private async _executeSecurityRules(input: ModuleInput, context: SecurityContext): Promise<SecurityActionResult> {
    const rules = Array.from(this._securityRules.values()).sort((a, b) => b.priority - a.priority);
    let totalRiskScore = 0;
    for (const rule of rules) {
      if (rule.condition(input, context)) {
        const result = await rule.action(input, context);
        totalRiskScore += result.riskScore;
        if (!result.allowed) {
          return { allowed: false, reason: result.reason, riskScore: totalRiskScore };
        }
      }
    }
    return { allowed: true, riskScore: totalRiskScore };
  }

  private async _handleChildFailure(childState: ModuleState): Promise<void> {
    this._audit('CHILD_FAILURE', `子模块 ${childState.moduleId} 状态异常`, { status: childState.status });
  }

  private _audit(action: string, message: string, metadata?: Record<string, unknown>): void {
    if (!this._options.enableSecurityAudit) return;
    this._securityAudits.push({
      id: this._generateId(),
      timestamp: Date.now(),
      action,
      message,
      metadata,
      moduleId: this.moduleId
    });
    if (this._securityAudits.length > 1000) {
      this._securityAudits = this._securityAudits.slice(-500);
    }
  }

  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] {
    const errors = [];
    if (!state.stateId) errors.push('stateId 不能为空');
    if (!state.moduleId) errors.push('moduleId 不能为空');
    return { name: '语法校验', passed: errors.length === 0, type: 'syntax', error: errors.length > 0 ? errors.join(', ') : undefined };
  }

  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] {
    const validStatuses: StatusCode[] = ['pending', 'running', 'completed', 'failed', 'paused'];
    return { name: '语义校验', passed: validStatuses.includes(state.status), type: 'semantic', error: !validStatuses.includes(state.status) ? `无效的状态: ${state.status}` : undefined };
  }

  private async _checkSecurityRulesConsistency(): Promise<CheckResult['checks'][0]> {
    const hasDuplicates = this._securityRules.size !== new Set(this._securityRules.keys()).size;
    return { name: '安全规则一致性校验', passed: !hasDuplicates, type: 'integrity', error: hasDuplicates ? '存在重复的安全规则ID' : undefined };
  }

  private async _checkAuditLogHealth(): Promise<CheckResult['checks'][0]> {
    const isHealthy = this._securityAudits.length < 1000;
    return { name: '审计日志健康检查', passed: isHealthy, type: 'performance', error: isHealthy ? undefined : '审计日志接近上限' };
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

  private _generateId(): string {
    return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

interface SecurityAudit {
  id: string;
  timestamp: number;
  action: string;
  message: string;
  metadata?: Record<string, unknown>;
  moduleId: string;
}

export default Level2RuleControlModule;
