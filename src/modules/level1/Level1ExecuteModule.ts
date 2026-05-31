/**
 * 超长任务Agent树形双生子模块化执行系统
 * 一级执行模块 - 第4阶段交付物
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
  IExecuteModule,
  IBaseModule,
  StatusCode,
  ModuleInfo,
  TaskParam,
  InitError,
  ExecutionError
} from '../../core/interfaces';

/**
 * 一级执行模块配置选项
 */
export interface Level1ExecuteModuleOptions {
  /** 最大并发任务数 */
  maxConcurrency?: number;
  /** 任务队列大小 */
  queueSize?: number;
  /** 执行超时时间（毫秒） */
  executionTimeoutMs?: number;
  /** 是否启用重试 */
  enableRetry?: boolean;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 任务执行上下文
 */
export interface ExecutionContext {
  taskId: string;
  startTime: number;
  retryCount: number;
  metadata: Record<string, unknown>;
}

/**
 * 一级执行模块：超长任务迭代执行模块
 * 
 * 职责：
 * 1. 超长任务总链路驱动
 * 2. 全生命周期流转
 * 3. 总迭代调度
 * 
 * 结构（双子结构）：
 * - 二级管控：长任务分层规划校验模块
 * - 二级执行：超长任务分步落地执行模块
 */
export abstract class Level1ExecuteModule implements IExecuteModule {
  public readonly type: 'execute' = 'execute';
  public readonly moduleId: ModuleId = 'level1-execute';
  public readonly moduleName: string = '超长任务迭代执行模块';
  public readonly version: string = '1.0.0';
  public readonly parentModuleId: ModuleId = 'root';

  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _globalTaskParam?: TaskParam;
  private _options: Required<Level1ExecuteModuleOptions>;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;
  private _executionQueue: ModuleInput[] = [];
  private _activeExecutions: Map<string, ExecutionContext> = new Map();
  private _executionHistory: ExecutionRecord[] = [];

  constructor(options: Level1ExecuteModuleOptions = {}) {
    this._options = {
      maxConcurrency: options.maxConcurrency ?? 5,
      queueSize: options.queueSize ?? 100,
      executionTimeoutMs: options.executionTimeoutMs ?? 30000,
      enableRetry: options.enableRetry ?? true,
      maxRetries: options.maxRetries ?? 3
    };
    this._state = this._createInitialState();
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) {
        throw new InitError(`父模块ID不匹配`, this.moduleId);
      }
      this._globalTaskParam = params.globalTaskParam;
      if (params.config) {
        this._options = { ...this._options, ...params.config as Level1ExecuteModuleOptions };
      }
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
      
      // 检查队列容量
      if (this._executionQueue.length >= this._options.queueSize) {
        throw new ExecutionError('执行队列已满', this.moduleId);
      }
      
      // 检查并发数
      if (this._activeExecutions.size >= this._options.maxConcurrency) {
        this._executionQueue.push(input);
        return {
          outputId: this._generateId(),
          data: { queued: true, position: this._executionQueue.length },
          dataType: 'queue-status',
          timestamp: Date.now(),
          status: 'pending',
          executionTimeMs: Date.now() - startTime
        };
      }
      
      const result = await this._executeWithRetry(input);
      this._updateState('completed');
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

  private async _executeWithRetry(input: ModuleInput, retryCount: number = 0): Promise<ModuleOutput> {
    const context: ExecutionContext = {
      taskId: input.inputId,
      startTime: Date.now(),
      retryCount,
      metadata: {}
    };
    this._activeExecutions.set(input.inputId, context);
    
    try {
      const result = await this._onRun(input);
      this._recordExecution(input, result, 'success');
      this._activeExecutions.delete(input.inputId);
      return result;
    } catch (error) {
      if (this._options.enableRetry && retryCount < this._options.maxRetries) {
        this._activeExecutions.delete(input.inputId);
        return this._executeWithRetry(input, retryCount + 1);
      }
      this._recordExecution(input, null, 'failed', error instanceof Error ? error.message : String(error));
      this._activeExecutions.delete(input.inputId);
      throw error;
    }
  }

  public async check(state: ModuleState): Promise<CheckResult> {
    const startTime = Date.now();
    const checks = [];
    checks.push(this._checkSyntax(state));
    checks.push(this._checkSemantic(state));
    checks.push(await this._checkQueueHealth());
    checks.push(await this._checkExecutionHealth());
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
        queueLength: this._executionQueue.length,
        activeExecutions: Array.from(this._activeExecutions.entries()),
        executionHistory: this._executionHistory.slice(-50),
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
      metadata: { reason: 'auto', creator: this.moduleId, tags: ['level1', 'execute'] }
    };
  }

  public async restore(snapshot: SnapshotData): Promise<{ success: boolean; restoredState?: ModuleState; error?: string; restoreTimeMs: number }> {
    const startTime = Date.now();
    try {
      const parsed = JSON.parse(snapshot.serializedState);
      this._state = parsed;
      this._stateVersion = parsed.version;
      if (parsed.data.activeExecutions) {
        this._activeExecutions = new Map(parsed.data.activeExecutions);
      }
      await this._onRestore(snapshot);
      return { success: true, restoredState: this._state, restoreTimeMs: Date.now() - startTime };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error), restoreTimeMs: Date.now() - startTime };
    }
  }

  public async execute(input: ModuleInput): Promise<ModuleOutput> {
    return this.run(input);
  }

  public async processResult(output: ModuleOutput): Promise<void> {
    this._executionHistory.push({
      outputId: output.outputId,
      timestamp: output.timestamp,
      status: output.status,
      executionTimeMs: output.executionTimeMs
    });
    if (this._executionHistory.length > 1000) {
      this._executionHistory = this._executionHistory.slice(-500);
    }
    await this._onProcessResult(output);
  }

  public getCurrentState(): ModuleState {
    return { ...this._state };
  }

  public getModuleInfo(): ModuleInfo {
    return {
      moduleId: this.moduleId,
      moduleName: this.moduleName,
      version: this.version,
      description: '超长任务迭代执行模块，负责任务执行与调度',
      createdAt: Date.now(),
      capabilities: ['task-execution', 'iteration-scheduling', 'retry-management', 'queue-management'],
      dependencies: ['root']
    };
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  protected abstract _onProcessResult(output: ModuleOutput): Promise<void>;

  private _createInitialState(): ModuleState {
    return {
      stateId: this._generateId(),
      moduleId: this.moduleId,
      status: 'pending',
      data: { queueLength: 0, activeCount: 0, completedCount: 0, failedCount: 0 },
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
        queueLength: this._executionQueue.length,
        activeCount: this._activeExecutions.size,
        completedCount: this._executionHistory.filter(r => r.status === 'completed').length,
        failedCount: this._executionHistory.filter(r => r.status === 'failed').length
      },
      updatedAt: Date.now(),
      version: this._stateVersion
    };
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

  private async _checkQueueHealth(): Promise<CheckResult['checks'][0]> {
    const isHealthy = this._executionQueue.length < this._options.queueSize * 0.9;
    return { name: '队列健康检查', passed: isHealthy, type: 'performance', error: isHealthy ? undefined : '队列接近满载' };
  }

  private async _checkExecutionHealth(): Promise<CheckResult['checks'][0]> {
    const isHealthy = this._activeExecutions.size < this._options.maxConcurrency;
    return { name: '执行健康检查', passed: isHealthy, type: 'performance', error: isHealthy ? undefined : '并发执行数已达上限' };
  }

  private _recordExecution(input: ModuleInput, result: ModuleOutput | null, status: 'success' | 'failed', error?: string): void {
    this._executionHistory.push({
      outputId: result?.outputId || input.inputId,
      timestamp: Date.now(),
      status,
      executionTimeMs: result?.executionTimeMs || 0,
      error
    });
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

interface ExecutionRecord {
  outputId: string;
  timestamp: number;
  status: string;
  executionTimeMs: number;
  error?: string;
}

export default Level1ExecuteModule;
