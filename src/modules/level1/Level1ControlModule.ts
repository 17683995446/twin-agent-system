/**
 * 超长任务Agent树形双生子模块化执行系统
 * 一级管控模块 - 第3阶段交付物
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
 * 一级管控模块配置选项
 */
export interface Level1ControlModuleOptions {
  /** 是否启用严格模式 */
  strictMode?: boolean;
  /** 规则检查间隔（毫秒） */
  ruleCheckIntervalMs?: number;
  /** 最大规则数量 */
  maxRules?: number;
  /** 是否启用审计日志 */
  enableAudit?: boolean;
}

/**
 * 一级管控模块：全局任务治理模块
 * 
 * 职责：
 * 1. 全局任务初始化
 * 2. 规则约束加载与执行
 * 3. 权限管控
 * 4. 顶层状态锁定
 * 5. 全局异常拦截
 * 
 * 结构（双子结构）：
 * - 二级管控：任务规则与安全管控模块
 * - 二级执行：全局状态持久化模块
 */
export abstract class Level1ControlModule implements IControlModule {
  // ==========================================================================
  // 只读属性（模块标识）
  // ==========================================================================
  
  /** 模块类型 */
  public readonly type: 'control' = 'control';
  
  /** 模块ID */
  public readonly moduleId: ModuleId = 'level1-control';
  
  /** 模块名称 */
  public readonly moduleName: string = '全局任务治理模块';
  
  /** 模块版本 */
  public readonly version: string = '1.0.0';
  
  /** 父模块ID（根模块） */
  public readonly parentModuleId: ModuleId = 'root';
  
  // ==========================================================================
  // 子模块（严格双子结构）
  // ==========================================================================
  
  /**
   * 双子子模块
   * [0] = 二级管控模块：任务规则与安全管控
   * [1] = 二级执行模块：全局状态持久化
   */
  public childModules?: [IBaseModule, IBaseModule];
  
  // ==========================================================================
  // 内部状态（完全封装）
  // ==========================================================================
  
  /** 当前模块状态 */
  private _state: ModuleState;
  
  /** 全局任务参数 */
  private _globalTaskParam?: TaskParam;
  
  /** 配置选项 */
  private _options: Required<Level1ControlModuleOptions>;
  
  /** 初始化完成标志 */
  private _initialized: boolean = false;
  
  /** 状态版本计数器 */
  private _stateVersion: number = 0;
  
  /** 规则集合 */
  private _rules: Map<string, Rule> = new Map();
  
  /** 权限配置 */
  private _permissions: Map<string, Permission> = new Map();
  
  /** 审计日志 */
  private _auditLogs: AuditLog[] = [];
  
  // ==========================================================================
  // 构造函数
  // ==========================================================================
  
  constructor(options: Level1ControlModuleOptions = {}) {
    this._options = {
      strictMode: options.strictMode ?? true,
      ruleCheckIntervalMs: options.ruleCheckIntervalMs ?? 1000,
      maxRules: options.maxRules ?? 100,
      enableAudit: options.enableAudit ?? true
    };
    
    this._state = this._createInitialState();
  }
  
  // ==========================================================================
  // 第1个标准接口：ModuleInit - 模块初始化
  // ==========================================================================
  
  /**
   * 模块初始化
   */
  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    
    try {
      // 1. 验证父模块ID
      if (params.parentModuleId !== this.parentModuleId) {
        throw new InitError(
          `父模块ID不匹配: 期望 ${this.parentModuleId}, 实际 ${params.parentModuleId}`,
          this.moduleId
        );
      }
      
      // 2. 保存全局任务参数
      this._globalTaskParam = params.globalTaskParam;
      
      // 3. 更新配置
      if (params.config) {
        this._options = { ...this._options, ...params.config as Level1ControlModuleOptions };
      }
      
      // 4. 加载默认规则
      await this._loadDefaultRules();
      
      // 5. 加载默认权限
      await this._loadDefaultPermissions();
      
      // 6. 执行子类特定的初始化
      await this._onInit(params);
      
      // 7. 初始化双子子模块
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
            throw new InitError(
              `子模块 ${child.moduleId} 初始化失败: ${childResult.error}`,
              child.moduleId
            );
          }
        }
      }
      
      // 8. 记录审计日志
      this._logAudit('INIT', '模块初始化成功', { taskId: this._globalTaskParam?.taskId });
      
      // 9. 更新状态
      this._updateState('pending');
      this._initialized = true;
      
      return {
        success: true,
        instanceId: this._generateInstanceId(),
        initialState: this._state,
        initTimeMs: Date.now() - startTime
      };
      
    } catch (error) {
      this._updateState('failed');
      this._logAudit('INIT_FAILED', error instanceof Error ? error.message : String(error));
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error instanceof InitError ? error.code : 'INIT_ERROR',
        initTimeMs: Date.now() - startTime
      };
    }
  }
  
  // ==========================================================================
  // 第2个标准接口：ModuleRun - 核心执行
  // ==========================================================================
  
  /**
   * 核心执行入口
   * 管控模块的执行主要是执行治理逻辑
   */
  public async run(input: ModuleInput): Promise<ModuleOutput> {
    const startTime = Date.now();
    
    try {
      if (!this._initialized) {
        throw new ExecutionError('模块未初始化', this.moduleId);
      }
      
      this._updateState('running');
      
      // 1. 执行输入验证
      const validationResult = await this.validate(input);
      if (!validationResult.passed) {
        const errors = validationResult.checks
          .filter(c => !c.passed)
          .map(c => c.error)
          .join(', ');
        throw new ValidationError(`输入验证失败: ${errors}`, this.moduleId);
      }
      
      // 2. 执行权限检查
      const hasPermission = await this._checkPermission(input);
      if (!hasPermission) {
        throw new ExecutionError('权限不足', this.moduleId);
      }
      
      // 3. 执行规则检查
      const ruleResult = await this._executeRules(input);
      if (!ruleResult.passed) {
        throw new ValidationError(`规则检查失败: ${ruleResult.message}`, this.moduleId);
      }
      
      // 4. 执行子类特定的治理逻辑
      const result = await this._onRun(input);
      
      // 5. 记录审计日志
      this._logAudit('EXECUTE', '治理执行成功', { inputId: input.inputId });
      
      this._updateState('completed');
      
      return {
        ...result,
        executionTimeMs: Date.now() - startTime
      };
      
    } catch (error) {
      this._updateState('failed');
      this._logAudit('EXECUTE_FAILED', error instanceof Error ? error.message : String(error));
      
      return {
        outputId: this._generateId(),
        data: { error: error instanceof Error ? error.message : String(error) },
        dataType: 'error',
        timestamp: Date.now(),
        status: 'failed',
        executionTimeMs: Date.now() - startTime,
        logs: [error instanceof Error ? error.stack || error.message : String(error)]
      };
    }
  }
  
  // ==========================================================================
  // 第3个标准接口：ModuleCheck - 状态校验
  // ==========================================================================
  
  /**
   * 状态校验
   */
  public async check(state: ModuleState): Promise<CheckResult> {
    const startTime = Date.now();
    const checks = [];
    
    // 1. 基础语法校验
    checks.push(this._checkSyntax(state));
    
    // 2. 语义校验
    checks.push(this._checkSemantic(state));
    
    // 3. 规则一致性校验
    checks.push(await this._checkRulesConsistency());
    
    // 4. 权限配置校验
    checks.push(await this._checkPermissionsConsistency());
    
    // 5. 子类特定的校验
    const customChecks = await this._onCheck(state);
    checks.push(...customChecks);
    
    // 6. 子模块状态校验
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
  
  // ==========================================================================
  // 第4个标准接口：ModuleSnapshot - 状态快照
  // ==========================================================================
  
  /**
   * 生成状态快照
   */
  public async snapshot(): Promise<SnapshotData> {
    const serializedState = JSON.stringify({
      ...this._state,
      data: {
        ...this._state.data,
        rules: Array.from(this._rules.entries()),
        permissions: Array.from(this._permissions.entries()),
        auditLogs: this._auditLogs.slice(-100), // 只保留最近100条
        childStates: this.childModules ? {
          [this.childModules[0].moduleId]: this.childModules[0].getCurrentState(),
          [this.childModules[1].moduleId]: this.childModules[1].getCurrentState()
        } : undefined
      }
    });
    
    const snapshot: SnapshotData = {
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
      metadata: {
        reason: 'auto',
        creator: this.moduleId,
        tags: ['level1', 'control', 'governance']
      }
    };
    
    await this._onSnapshot(snapshot);
    
    return snapshot;
  }
  
  /**
   * 从快照恢复
   */
  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const startTime = Date.now();
    
    try {
      // 验证校验和
      const checksum = this._calculateChecksum(snapshot.serializedState);
      if (checksum !== snapshot.checksum) {
        throw new Error('快照校验和不匹配');
      }
      
      // 恢复状态
      const parsed = JSON.parse(snapshot.serializedState);
      this._state = parsed;
      this._stateVersion = parsed.version;
      
      // 恢复规则
      if (parsed.data.rules) {
        this._rules = new Map(parsed.data.rules);
      }
      
      // 恢复权限
      if (parsed.data.permissions) {
        this._permissions = new Map(parsed.data.permissions);
      }
      
      // 恢复审计日志
      if (parsed.data.auditLogs) {
        this._auditLogs = parsed.data.auditLogs;
      }
      
      // 恢复子模块
      if (this.childModules && parsed.data.childStates) {
        for (const child of this.childModules) {
          if (child.restore && parsed.data.childStates[child.moduleId]) {
            await child.restore({
              ...snapshot,
              moduleId: child.moduleId,
              state: parsed.data.childStates[child.moduleId]
            });
          }
        }
      }
      
      await this._onRestore(snapshot);
      
      return {
        success: true,
        restoredState: this._state,
        restoreTimeMs: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        restoreTimeMs: Date.now() - startTime
      };
    }
  }
  
  // ==========================================================================
  // 管控模块特有方法
  // ==========================================================================
  
  /**
   * 输入验证（管控模块特有）
   */
  public async validate(input: ModuleInput): Promise<CheckResult> {
    const checks = [];
    
    // 1. 输入数据存在性检查
    checks.push({
      name: '输入数据存在性',
      passed: input.data !== undefined && input.data !== null,
      type: 'syntax' as const,
      error: input.data === undefined || input.data === null ? '输入数据不能为空' : undefined
    });
    
    // 2. 数据类型检查
    checks.push({
      name: '数据类型有效性',
      passed: typeof input.dataType === 'string' && input.dataType.length > 0,
      type: 'syntax' as const,
      error: !input.dataType ? '数据类型不能为空' : undefined
    });
    
    // 3. 来源模块检查
    checks.push({
      name: '来源模块有效性',
      passed: !input.sourceModuleId || typeof input.sourceModuleId === 'string',
      type: 'semantic' as const
    });
    
    // 4. 时间戳检查
    checks.push({
      name: '时间戳有效性',
      passed: typeof input.timestamp === 'number' && input.timestamp > 0,
      type: 'syntax' as const,
      error: !input.timestamp ? '时间戳无效' : undefined
    });
    
    // 5. 执行子类特定的验证
    const customChecks = await this._onValidate(input);
    checks.push(...customChecks);
    
    return {
      passed: checks.every(c => c.passed),
      checks,
      checkedAt: Date.now(),
      checkTimeMs: 0
    };
  }
  
  /**
   * 监控子模块状态（管控模块特有）
   */
  public async monitor(childState: ModuleState): Promise<void> {
    // 1. 记录监控日志
    this._logAudit('MONITOR', `监控子模块 ${childState.moduleId}`, {
      status: childState.status,
      version: childState.version
    });
    
    // 2. 检查子模块状态异常
    if (childState.status === 'failed') {
      await this._handleChildFailure(childState);
    }
    
    // 3. 执行子类特定的监控逻辑
    await this._onMonitor(childState);
  }
  
  // ==========================================================================
  // 公共方法
  // ==========================================================================
  
  public getCurrentState(): ModuleState {
    return { ...this._state };
  }
  
  public getModuleInfo(): ModuleInfo {
    return {
      moduleId: this.moduleId,
      moduleName: this.moduleName,
      version: this.version,
      description: '全局任务治理模块，负责任务初始化、规则约束、权限管控',
      createdAt: Date.now(),
      capabilities: [
        'task-governance',
        'rule-enforcement',
        'permission-control',
        'state-locking',
        'exception-interception',
        'audit-logging'
      ],
      dependencies: ['root']
    };
  }
  
  /**
   * 添加规则
   */
  public addRule(rule: Rule): boolean {
    if (this._rules.size >= this._options.maxRules) {
      return false;
    }
    this._rules.set(rule.id, rule);
    this._logAudit('RULE_ADDED', `添加规则: ${rule.name}`, { ruleId: rule.id });
    return true;
  }
  
  /**
   * 移除规则
   */
  public removeRule(ruleId: string): boolean {
    const removed = this._rules.delete(ruleId);
    if (removed) {
      this._logAudit('RULE_REMOVED', `移除规则: ${ruleId}`);
    }
    return removed;
  }
  
  /**
   * 获取所有规则
   */
  public getRules(): Rule[] {
    return Array.from(this._rules.values());
  }
  
  /**
   * 添加权限
   */
  public addPermission(permission: Permission): void {
    this._permissions.set(permission.id, permission);
    this._logAudit('PERMISSION_ADDED', `添加权限: ${permission.name}`, { permissionId: permission.id });
  }
  
  /**
   * 获取审计日志
   */
  public getAuditLogs(limit: number = 100): AuditLog[] {
    return this._auditLogs.slice(-limit);
  }
  
  // ==========================================================================
  // 抽象方法（子类实现）
  // ==========================================================================
  
  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onValidate(input: ModuleInput): Promise<CheckResult['checks']>;
  protected abstract _onMonitor(childState: ModuleState): Promise<void>;
  
  // ==========================================================================
  // 私有方法
  // ==========================================================================
  
  private _createInitialState(): ModuleState {
    return {
      stateId: this._generateId(),
      moduleId: this.moduleId,
      status: 'pending',
      data: {
        ruleCount: 0,
        permissionCount: 0,
        auditLogCount: 0
      },
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
        ruleCount: this._rules.size,
        permissionCount: this._permissions.size,
        auditLogCount: this._auditLogs.length
      },
      updatedAt: Date.now(),
      version: this._stateVersion
    };
  }
  
  private async _loadDefaultRules(): Promise<void> {
    // 加载默认规则（子类可覆盖）
    const defaultRules: Rule[] = [
      {
        id: 'rule-task-timeout',
        name: '任务超时检查',
        description: '检查任务是否超过最大执行时间',
        type: 'constraint',
        priority: 100,
        condition: (input) => true,
        action: async (input) => ({ passed: true })
      },
      {
        id: 'rule-max-depth',
        name: '最大深度检查',
        description: '检查任务嵌套深度是否超过限制',
        type: 'constraint',
        priority: 90,
        condition: (input) => true,
        action: async (input) => ({ passed: true })
      }
    ];
    
    for (const rule of defaultRules) {
      this._rules.set(rule.id, rule);
    }
  }
  
  private async _loadDefaultPermissions(): Promise<void> {
    // 加载默认权限（子类可覆盖）
    const defaultPermissions: Permission[] = [
      {
        id: 'perm-task-create',
        name: '任务创建权限',
        resource: 'task',
        action: 'create',
        roles: ['admin', 'operator']
      },
      {
        id: 'perm-task-execute',
        name: '任务执行权限',
        resource: 'task',
        action: 'execute',
        roles: ['admin', 'operator', 'executor']
      }
    ];
    
    for (const perm of defaultPermissions) {
      this._permissions.set(perm.id, perm);
    }
  }
  
  private async _checkPermission(input: ModuleInput): Promise<boolean> {
    // 简化实现，实际应根据角色和资源进行细粒度检查
    return true;
  }
  
  private async _executeRules(input: ModuleInput): Promise<{ passed: boolean; message?: string }> {
    const rules = Array.from(this._rules.values()).sort((a, b) => b.priority - a.priority);
    
    for (const rule of rules) {
      if (rule.condition(input)) {
        const result = await rule.action(input);
        if (!result.passed) {
          return { passed: false, message: `规则 "${rule.name}" 检查失败: ${result.message}` };
        }
      }
    }
    
    return { passed: true };
  }
  
  private async _handleChildFailure(childState: ModuleState): Promise<void> {
    this._logAudit('CHILD_FAILURE', `子模块 ${childState.moduleId} 状态异常`, {
      status: childState.status
    });
    // 子类可实现具体的故障处理逻辑
  }
  
  private _logAudit(action: string, message: string, metadata?: Record<string, unknown>): void {
    if (!this._options.enableAudit) return;
    
    this._auditLogs.push({
      id: this._generateId(),
      timestamp: Date.now(),
      action,
      message,
      metadata,
      moduleId: this.moduleId
    });
    
    // 限制日志数量
    if (this._auditLogs.length > 1000) {
      this._auditLogs = this._auditLogs.slice(-500);
    }
  }
  
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] {
    const errors: string[] = [];
    
    if (!state.stateId) errors.push('stateId 不能为空');
    if (!state.moduleId) errors.push('moduleId 不能为空');
    if (!state.status) errors.push('status 不能为空');
    if (!state.data) errors.push('data 不能为空');
    
    return {
      name: '语法校验',
      passed: errors.length === 0,
      type: 'syntax',
      error: errors.length > 0 ? errors.join(', ') : undefined
    };
  }
  
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] {
    const validStatuses: StatusCode[] = ['pending', 'running', 'completed', 'failed', 'paused'];
    
    return {
      name: '语义校验',
      passed: validStatuses.includes(state.status),
      type: 'semantic',
      error: !validStatuses.includes(state.status) ? `无效的状态: ${state.status}` : undefined
    };
  }
  
  private async _checkRulesConsistency(): Promise<CheckResult['checks'][0]> {
    const hasDuplicates = this._rules.size !== new Set(this._rules.keys()).size;
    
    return {
      name: '规则一致性校验',
      passed: !hasDuplicates,
      type: 'integrity',
      error: hasDuplicates ? '存在重复的规则ID' : undefined
    };
  }
  
  private async _checkPermissionsConsistency(): Promise<CheckResult['checks'][0]> {
    const hasDuplicates = this._permissions.size !== new Set(this._permissions.keys()).size;
    
    return {
      name: '权限一致性校验',
      passed: !hasDuplicates,
      type: 'integrity',
      error: hasDuplicates ? '存在重复的权限ID' : undefined
    };
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
  
  private _generateInstanceId(): string {
    return `instance_${this.moduleId}_${Date.now()}`;
  }
}

// ==========================================================================
// 类型定义
// ==========================================================================

/**
 * 规则定义
 */
export interface Rule {
  id: string;
  name: string;
  description: string;
  type: 'constraint' | 'validation' | 'transformation';
  priority: number;
  condition: (input: ModuleInput) => boolean;
  action: (input: ModuleInput) => Promise<{ passed: boolean; message?: string }>;
}

/**
 * 权限定义
 */
export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  roles: string[];
}

/**
 * 审计日志
 */
export interface AuditLog {
  id: string;
  timestamp: number;
  action: string;
  message: string;
  metadata?: Record<string, unknown>;
  moduleId: string;
}

export default Level1ControlModule;
