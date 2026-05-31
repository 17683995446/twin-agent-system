/**
 * 超长任务Agent树形双生子模块化执行系统
 * 三级管控模块：任务准入与权限校验 - 第21阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IControlModule, IBaseModule,
  StatusCode, ModuleInfo, TaskParam, InitError, ExecutionError
} from '../../core/interfaces';

/** 准入校验结果 */
export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
}

/** 准入规则 */
export interface AccessRule {
  id: string;
  name: string;
  evaluate: (input: ModuleInput) => boolean | Promise<boolean>;
  failReason: string;
}

/** 权限项 */
export interface PermissionItem {
  resource: string;
  actions: string[];
  roles: string[];
}

export interface Level3AccessControlModuleOptions {
  strictMode?: boolean;
  maxRules?: number;
  defaultDeny?: boolean;
}

/**
 * 三级管控模块：任务准入与权限校验模块
 * 
 * 职责：
 * 1. 任务准入规则校验
 * 2. 基于角色和资源的权限校验
 * 3. 风险等级评估
 * 
 * 结构（双子结构）：
 * - 四级管控：准入规则校验模块
 * - 四级执行：任务参数初始化模块
 */
export abstract class Level3AccessControlModule implements IControlModule {
  public readonly type: 'control' = 'control';
  public readonly moduleId: ModuleId = 'level3-access-control';
  public readonly moduleName: string = '任务准入与权限校验模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'level2-rule-control';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level3AccessControlModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _accessRules: Map<string, AccessRule> = new Map();
  private _permissions: Map<string, PermissionItem> = new Map();
  private _accessLog: Array<{ timestamp: number; inputId: string; allowed: boolean; reason?: string }> = [];

  constructor(options: Level3AccessControlModuleOptions = {}) {
    this._options = { strictMode: options.strictMode ?? true, maxRules: options.maxRules ?? 30, defaultDeny: options.defaultDeny ?? false };
    this._state = this._createInitialState();
    this._loadDefaultRules();
    this._loadDefaultPermissions();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) throw new InitError(`父模块ID不匹配`, this.moduleId);
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) this._options = { ...this._options, ...params.config as Level3AccessControlModuleOptions };
      await this._onInit(params);
      if (this.childModules) {
        for (const child of this.childModules) {
          const r = await child.init({ moduleId: child.moduleId, moduleName: child.moduleName, version: child.version, parentModuleId: this.moduleId, globalTaskParam: this._globalTaskParam });
          if (!r.success) throw new InitError(`子模块 ${child.moduleId} 初始化失败`, child.moduleId);
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
      const accessResult = await this.checkAccess(input);
      this._logAccess(input.inputId, accessResult);
      if (!accessResult.allowed) {
        throw new ExecutionError(`准入校验失败: ${accessResult.reason}`, this.moduleId);
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
    const s = JSON.stringify({ ...this._state, data: { ...this._state.data, rules: Array.from(this._accessRules.entries()), permissions: Array.from(this._permissions.entries()), accessLog: this._accessLog.slice(-50) } });
    return { snapshotId: this._genId(), moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level3', 'control', 'access'] } };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const t = Date.now();
    try {
      const p = JSON.parse(snapshot.serializedState); this._state = p; this._stateVersion = p.version;
      if (p.data.rules) this._accessRules = new Map(p.data.rules);
      if (p.data.permissions) this._permissions = new Map(p.data.permissions);
      if (p.data.accessLog) this._accessLog = p.data.accessLog;
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - t };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - t }; }
  }

  public async validate(input: ModuleInput): Promise<CheckResult> {
    const r = await this.checkAccess(input);
    return { passed: r.allowed, checks: r.checks.map(c => ({ name: c.name, passed: c.passed, type: 'security' as const, error: c.detail })), checkedAt: Date.now(), checkTimeMs: 0 };
  }

  public async monitor(childState: ModuleState): Promise<void> { await this._onMonitor(childState); }
  public getCurrentState(): ModuleState { return { ...this._state }; }
  public getModuleInfo(): ModuleInfo { return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: '任务准入与权限校验模块', createdAt: Date.now(), capabilities: ['access-control', 'permission-check', 'risk-evaluation'], dependencies: ['level2-rule-control'] }; }

  /** 准入校验主方法 */
  public async checkAccess(input: ModuleInput): Promise<AccessCheckResult> {
    const checks: AccessCheckResult['checks'] = [];
    let riskLevel: AccessCheckResult['riskLevel'] = 'low';
    for (const rule of this._accessRules.values()) {
      const passed = await rule.evaluate(input);
      checks.push({ name: rule.name, passed, detail: passed ? undefined : rule.failReason });
      if (!passed && this._options.strictMode) riskLevel = 'high';
    }
    const allowed = this._options.defaultDeny ? checks.every(c => c.passed) : !checks.some(c => !c.passed);
    return { allowed, reason: allowed ? undefined : checks.filter(c => !c.passed).map(c => c.detail).join('; '), riskLevel, checks };
  }

  public addAccessRule(rule: AccessRule): boolean { if (this._accessRules.size >= this._options.maxRules) return false; this._accessRules.set(rule.id, rule); return true; }
  public removeAccessRule(id: string): boolean { return this._accessRules.delete(id); }
  public addPermission(perm: PermissionItem): void { this._permissions.set(perm.resource, perm); }
  public getAccessLog(limit: number = 50): typeof this._accessLog { return this._accessLog.slice(-limit); }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onValidate(input: ModuleInput): Promise<CheckResult['checks']>;
  protected abstract _onMonitor(childState: ModuleState): Promise<void>;

  private _createInitialState(): ModuleState { return { stateId: this._genId(), moduleId: this.moduleId, status: 'pending', data: { ruleCount: 0, permissionCount: 0, logCount: 0 }, createdAt: Date.now(), updatedAt: Date.now(), version: 0 }; }
  private _updateState(status: StatusCode): void { this._stateVersion++; this._state = { ...this._state, status, data: { ruleCount: this._accessRules.size, permissionCount: this._permissions.size, logCount: this._accessLog.length }, updatedAt: Date.now(), version: this._stateVersion }; }
  private _logAccess(inputId: string, result: AccessCheckResult): void { this._accessLog.push({ timestamp: Date.now(), inputId, allowed: result.allowed, reason: result.reason }); if (this._accessLog.length > 500) this._accessLog = this._accessLog.slice(-250); }
  private _loadDefaultRules(): void {
    this._accessRules.set('access-data-exists', { id: 'access-data-exists', name: '数据存在性检查', evaluate: (i) => i.data !== undefined && i.data !== null, failReason: '输入数据不能为空' });
    this._accessRules.set('access-type-valid', { id: 'access-type-valid', name: '数据类型检查', evaluate: (i) => typeof i.dataType === 'string' && i.dataType.length > 0, failReason: '数据类型无效' });
  }
  private _loadDefaultPermissions(): void {
    this._permissions.set('task', { resource: 'task', actions: ['create', 'read', 'execute'], roles: ['admin', 'operator'] });
    this._permissions.set('module', { resource: 'module', actions: ['read', 'configure'], roles: ['admin'] });
  }
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId && !!state.moduleId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
  private _genId(): string { return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
}

export default Level3AccessControlModule;
