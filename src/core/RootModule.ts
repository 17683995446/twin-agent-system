/**
 * 超长任务Agent树形双生子模块化执行系统
 * 根模块基础框架 - 第2阶段交付物
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
  SnapshotRestoreResult,
  IBaseModule,
  TwinModules,
  TaskParam,
  StatusCode,
  ModuleInfo,
  InitError,
  ExecutionError,
  ValidationError,
  SnapshotError,
  INTERFACE_VERSION
} from './interfaces';

/**
 * 根模块配置选项
 */
export interface RootModuleOptions {
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 最大子模块深度 */
  maxDepth?: number;
  /** 是否自动创建快照 */
  autoSnapshot?: boolean;
}

/**
 * 根模块（系统最顶层模块）
 * 
 * 职责：
 * 1. 全局任务初始化
 * 2. 规则约束加载
 * 3. 权限管控
 * 4. 顶层状态锁定
 * 5. 全局异常拦截
 * 
 * 结构：
 * - 包含恰好2个一级子模块（双子结构）
 *   - 一级管控模块：全局任务治理
 *   - 一级执行模块：超长任务迭代执行
 */
export abstract class RootModule implements IBaseModule {
  // ==========================================================================
  // 只读属性（模块标识）
  // ==========================================================================
  
  /** 根模块固定ID */
  public readonly moduleId: ModuleId = 'root';
  
  /** 根模块名称 */
  public readonly moduleName: string = '超长任务总调度核心模块';
  
  /** 模块版本 */
  public readonly version: string = INTERFACE_VERSION;
  
  /** 根模块无父模块 */
  public readonly parentModuleId: ModuleId | undefined = undefined;
  
  // ==========================================================================
  // 子模块（严格双子结构）
  // ==========================================================================
  
  /**
   * 双子子模块
   * [0] = 一级管控模块（左节点）
   * [1] = 一级执行模块（右节点）
   */
  public childModules?: [IBaseModule, IBaseModule];
  
  // ==========================================================================
  // 内部状态（完全封装，禁止外部直接访问）
  // ==========================================================================
  
  /** 当前模块状态 */
  private _state: ModuleState;
  
  /** 全局任务参数 */
  private _globalTaskParam?: TaskParam;
  
  /** 配置选项 */
  private _options: Required<RootModuleOptions>;
  
  /** 初始化完成标志 */
  private _initialized: boolean = false;
  
  /** 状态版本计数器（用于乐观锁） */
  private _stateVersion: number = 0;
  
  // ==========================================================================
  // 构造函数
  // ==========================================================================
  
  constructor(options: RootModuleOptions = {}) {
    // 设置默认配置
    this._options = {
      debug: options.debug ?? false,
      defaultTimeout: options.defaultTimeout ?? 30000,
      maxDepth: options.maxDepth ?? 10,
      autoSnapshot: options.autoSnapshot ?? true
    };
    
    // 初始化空状态（等待init填充）
    this._state = this._createInitialState();
  }
  
  // ==========================================================================
  // 第1个标准接口：ModuleInit - 模块初始化
  // ==========================================================================
  
  /**
   * 模块初始化
   * @param params 初始化参数
   * @returns 初始化结果
   */
  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    
    try {
      // 1. 验证初始化参数
      this._validateInitParam(params);
      
      // 2. 保存全局任务参数
      this._globalTaskParam = params.globalTaskParam;
      
      // 3. 更新模块配置
      if (params.config) {
        this._options = { ...this._options, ...params.config as RootModuleOptions };
      }
      
      // 4. 执行子类特定的初始化逻辑
      await this._onInit(params);
      
      // 5. 初始化双子子模块
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
      
      // 6. 更新状态为就绪
      this._updateState('pending');
      this._initialized = true;
      
      // 7. 创建初始快照
      if (this._options.autoSnapshot) {
        await this.snapshot();
      }
      
      return {
        success: true,
        instanceId: this._generateInstanceId(),
        initialState: this._state,
        initTimeMs: Date.now() - startTime
      };
      
    } catch (error) {
      this._updateState('failed');
      
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
   * @param input 模块输入
   * @returns 模块输出
   */
  public async run(input: ModuleInput): Promise<ModuleOutput> {
    const startTime = Date.now();
    
    try {
      // 1. 检查初始化状态
      if (!this._initialized) {
        throw new ExecutionError('模块未初始化，请先调用init()');
      }
      
      // 2. 更新状态为运行中
      this._updateState('running');
      
      // 3. 执行前置校验
      const checkResult = await this.check(this._state);
      if (!checkResult.passed) {
        const criticalErrors = checkResult.checks.filter(
          c => !c.passed && (c.severity === 'error' || c.severity === 'critical')
        );
        if (criticalErrors.length > 0) {
          throw new ValidationError(`状态校验失败: ${criticalErrors.map(e => e.error).join(', ')}`);
        }
      }
      
      // 4. 执行子类特定的业务逻辑
      const result = await this._onRun(input);
      
      // 5. 更新状态为完成
      this._updateState('completed');
      
      // 6. 自动创建快照
      if (this._options.autoSnapshot) {
        await this.snapshot();
      }
      
      return {
        ...result,
        executionTimeMs: Date.now() - startTime
      };
      
    } catch (error) {
      this._updateState('failed');
      
      return {
        outputId: this._generateId(),
        data: null,
        dataType: 'error',
        timestamp: Date.now(),
        status: 'failed',
        executionTimeMs: Date.now() - startTime,
        logs: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
  
  // ==========================================================================
  // 第3个标准接口：ModuleCheck - 状态校验
  // ==========================================================================
  
  /**
   * 状态校验
   * @param state 要校验的状态
   * @returns 校验结果
   */
  public async check(state: ModuleState): Promise<CheckResult> {
    const startTime = Date.now();
    const checks = [];
    
    // 1. 语法校验
    checks.push(this._checkSyntax(state));
    
    // 2. 语义校验
    checks.push(this._checkSemantic(state));
    
    // 3. 完整性校验
    checks.push(this._checkIntegrity(state));
    
    // 4. 子类特定的校验
    const customChecks = await this._onCheck(state);
    checks.push(...customChecks);
    
    // 5. 校验子模块状态
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
    
    const allPassed = checks.every(c => c.passed);
    
    return {
      passed: allPassed,
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
   * @returns 快照数据
   */
  public async snapshot(): Promise<SnapshotData> {
    try {
      // 1. 序列化当前状态
      const serializedState = this._serializeState(this._state);
      
      // 2. 计算校验和
      const checksum = this._calculateChecksum(serializedState);
      
      // 3. 创建快照
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
        checksum,
        metadata: {
          reason: 'auto',
          creator: this.moduleId,
          tags: ['root', 'auto-snapshot']
        }
      };
      
      // 4. 执行子类特定的快照逻辑
      await this._onSnapshot(snapshot);
      
      return snapshot;
      
    } catch (error) {
      throw new SnapshotError(
        `创建快照失败: ${error instanceof Error ? error.message : String(error)}`,
        this.moduleId
      );
    }
  }
  
  /**
   * 从快照恢复
   * @param snapshot 快照数据
   * @returns 恢复结果
   */
  public async restore(snapshot: SnapshotData): Promise<SnapshotRestoreResult> {
    const startTime = Date.now();
    
    try {
      // 1. 验证快照完整性
      const checksum = this._calculateChecksum(snapshot.serializedState);
      if (checksum !== snapshot.checksum) {
        throw new SnapshotError('快照校验和不匹配，数据可能已损坏');
      }
      
      // 2. 验证模块ID匹配
      if (snapshot.moduleId !== this.moduleId) {
        throw new SnapshotError(`模块ID不匹配: 期望 ${this.moduleId}, 实际 ${snapshot.moduleId}`);
      }
      
      // 3. 恢复状态
      this._state = this._deserializeState(snapshot.serializedState);
      this._stateVersion = this._state.version;
      
      // 4. 执行子类特定的恢复逻辑
      await this._onRestore(snapshot);
      
      // 5. 恢复子模块状态
      if (this.childModules && snapshot.state.data.childStates) {
        const childStates = snapshot.state.data.childStates as Record<ModuleId, ModuleState>;
        for (const child of this.childModules) {
          if (child.restore && childStates[child.moduleId]) {
            await child.restore({
              ...snapshot,
              moduleId: child.moduleId,
              state: childStates[child.moduleId]
            });
          }
        }
      }
      
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
  // 公共方法
  // ==========================================================================
  
  /**
   * 获取当前状态
   */
  public getCurrentState(): ModuleState {
    return { ...this._state };
  }
  
  /**
   * 获取模块信息
   */
  public getModuleInfo(): ModuleInfo {
    return {
      moduleId: this.moduleId,
      moduleName: this.moduleName,
      version: this.version,
      description: '超长任务Agent树形双生子系统根模块',
      createdAt: Date.now(),
      capabilities: [
        'global-task-scheduling',
        'rule-enforcement',
        'permission-control',
        'state-management',
        'exception-handling'
      ],
      dependencies: []
    };
  }
  
  /**
   * 获取全局任务参数
   */
  protected getGlobalTaskParam(): TaskParam | undefined {
    return this._globalTaskParam;
  }
  
  /**
   * 获取配置选项
   */
  protected getOptions(): Required<RootModuleOptions> {
    return { ...this._options };
  }
  
  /**
   * 检查是否已初始化
   */
  protected isInitialized(): boolean {
    return this._initialized;
  }
  
  // ==========================================================================
  // 抽象方法（子类必须实现）
  // ==========================================================================
  
  /**
   * 初始化钩子（子类实现）
   */
  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  
  /**
   * 执行钩子（子类实现）
   */
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  
  /**
   * 校验钩子（子类实现）
   */
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;
  
  /**
   * 快照钩子（子类实现）
   */
  protected abstract _onSnapshot(snapshot: SnapshotData): Promise<void>;
  
  /**
   * 恢复钩子（子类实现）
   */
  protected abstract _onRestore(snapshot: SnapshotData): Promise<void>;
  
  // ==========================================================================
  // 私有方法
  // ==========================================================================
  
  /**
   * 创建初始状态
   */
  private _createInitialState(): ModuleState {
    return {
      stateId: this._generateId(),
      moduleId: this.moduleId,
      status: 'pending',
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 0
    };
  }
  
  /**
   * 更新状态
   */
  private _updateState(status: StatusCode): void {
    this._stateVersion++;
    this._state = {
      ...this._state,
      status,
      updatedAt: Date.now(),
      version: this._stateVersion
    };
  }
  
  /**
   * 验证初始化参数
   */
  private _validateInitParam(params: ModuleInitParam): void {
    if (!params.moduleId) {
      throw new InitError('模块ID不能为空');
    }
    if (!params.globalTaskParam) {
      throw new InitError('全局任务参数不能为空');
    }
    if (!params.globalTaskParam.taskId) {
      throw new InitError('任务ID不能为空');
    }
  }
  
  /**
   * 语法校验
   */
  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] {
    const errors: string[] = [];
    
    if (!state.stateId) errors.push('stateId 不能为空');
    if (!state.moduleId) errors.push('moduleId 不能为空');
    if (!state.status) errors.push('status 不能为空');
    if (!state.data) errors.push('data 不能为空');
    if (!state.createdAt) errors.push('createdAt 不能为空');
    if (!state.updatedAt) errors.push('updatedAt 不能为空');
    if (typeof state.version !== 'number') errors.push('version 必须是数字');
    
    return {
      name: '语法校验',
      passed: errors.length === 0,
      type: 'syntax',
      error: errors.length > 0 ? errors.join(', ') : undefined
    };
  }
  
  /**
   * 语义校验
   */
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] {
    const validStatuses: StatusCode[] = ['pending', 'running', 'completed', 'failed', 'paused'];
    
    if (!validStatuses.includes(state.status)) {
      return {
        name: '语义校验',
        passed: false,
        type: 'semantic',
        error: `无效的状态值: ${state.status}`
      };
    }
    
    return {
      name: '语义校验',
      passed: true,
      type: 'semantic'
    };
  }
  
  /**
   * 完整性校验
   */
  private _checkIntegrity(state: ModuleState): CheckResult['checks'][0] {
    if (state.checksum) {
      const serialized = this._serializeState({ ...state, checksum: undefined });
      const calculated = this._calculateChecksum(serialized);
      
      if (calculated !== state.checksum) {
        return {
          name: '完整性校验',
          passed: false,
          type: 'integrity',
          error: '校验和不匹配，状态数据可能已损坏'
        };
      }
    }
    
    return {
      name: '完整性校验',
      passed: true,
      type: 'integrity'
    };
  }
  
  /**
   * 序列化状态
   */
  private _serializeState(state: ModuleState): string {
    return JSON.stringify(state);
  }
  
  /**
   * 反序列化状态
   */
  private _deserializeState(serialized: string): ModuleState {
    return JSON.parse(serialized);
  }
  
  /**
   * 计算校验和（简单实现，生产环境应使用更安全的算法）
   */
  private _calculateChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
  
  /**
   * 生成唯一ID
   */
  private _generateId(): string {
    return `${this.moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * 生成实例ID
   */
  private _generateInstanceId(): string {
    return `instance_${this.moduleId}_${Date.now()}`;
  }
}

export default RootModule;
