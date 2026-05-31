/**
 * 第41阶段：执行上下文管理
 * Execution Context Management
 * 
 * 管理执行过程中的上下文状态：
 * - 上下文创建和初始化
 * - 父子模块间的上下文传递
 * - 上下文快照和恢复
 * - 执行变量和共享状态
 * - 上下文生命周期管理
 */

import { ModuleInput, ModuleOutput, ModuleContext } from './interfaces';

// 执行状态枚举
export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout'
}

// 执行阶段
export enum ExecutionPhase {
  INIT = 'init',
  VALIDATE = 'validate',
  PREPARE = 'prepare',
  EXECUTE = 'execute',
  VERIFY = 'verify',
  CLEANUP = 'cleanup',
  FINALIZE = 'finalize'
}

// 执行变量
export interface ExecutionVariable {
  name: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function';
  scope: 'local' | 'parent' | 'global';
  readonly?: boolean;
  metadata?: Record<string, any>;
}

// 执行上下文快照
export interface ContextSnapshot {
  id: string;
  timestamp: number;
  contextId: string;
  phase: ExecutionPhase;
  status: ExecutionStatus;
  variables: Map<string, ExecutionVariable>;
  sharedState: Map<string, any>;
  metadata: Record<string, any>;
  checksum: string;
}

// 执行上下文配置
export interface ExecutionContextConfig {
  maxVariables?: number;
  maxSharedStateSize?: number;
  enableSnapshot?: boolean;
  snapshotInterval?: number;
  inheritParentVariables?: boolean;
  propagateChanges?: boolean;
}

// 执行事件
export interface ExecutionEvent {
  type: 'context_created' | 'context_updated' | 'context_snapshot' | 'context_restored' | 'context_destroyed' | 'variable_set' | 'variable_deleted' | 'phase_changed' | 'status_changed';
  contextId: string;
  timestamp: number;
  data?: any;
}

// 执行上下文
export class ExecutionContext {
  private _id: string;
  private _taskId: string;
  private _executionId: string;
  private _moduleId: string;
  private _parentContextId: string | null = null;
  private _childContextIds: Set<string> = new Set();
  private _status: ExecutionStatus = ExecutionStatus.PENDING;
  private _phase: ExecutionPhase = ExecutionPhase.INIT;
  private _variables: Map<string, ExecutionVariable> = new Map();
  private _sharedState: Map<string, any> = new Map();
  private _input: ModuleInput | null = null;
  private _output: ModuleOutput | null = null;
  private _metadata: Record<string, any> = {};
  private _createdAt: number;
  private _updatedAt: number;
  private _config: ExecutionContextConfig;
  private _eventListeners: Set<(event: ExecutionEvent) => void> = new Set();
  private _snapshots: ContextSnapshot[] = [];
  private _executionPath: string[] = [];

  constructor(
    taskId: string,
    executionId: string,
    moduleId: string,
    config: ExecutionContextConfig = {}
  ) {
    this._id = this._generateId();
    this._taskId = taskId;
    this._executionId = executionId;
    this._moduleId = moduleId;
    this._createdAt = Date.now();
    this._updatedAt = this._createdAt;
    this._config = {
      maxVariables: 1000,
      maxSharedStateSize: 10000,
      enableSnapshot: true,
      snapshotInterval: 60000,
      inheritParentVariables: true,
      propagateChanges: false,
      ...config
    };

    this._executionPath.push(moduleId);
    this._notifyEvent('context_created', { taskId, executionId, moduleId });
  }

  // ==================== 基础属性访问 ====================

  public get id(): string {
    return this._id;
  }

  public get taskId(): string {
    return this._taskId;
  }

  public get executionId(): string {
    return this._executionId;
  }

  public get moduleId(): string {
    return this._moduleId;
  }

  public get parentContextId(): string | null {
    return this._parentContextId;
  }

  public get childContextIds(): string[] {
    return Array.from(this._childContextIds);
  }

  public get status(): ExecutionStatus {
    return this._status;
  }

  public get phase(): ExecutionPhase {
    return this._phase;
  }

  public get createdAt(): number {
    return this._createdAt;
  }

  public get updatedAt(): number {
    return this._updatedAt;
  }

  public get executionPath(): string[] {
    return [...this._executionPath];
  }

  // ==================== 状态管理 ====================

  /**
   * 设置执行状态
   */
  public setStatus(status: ExecutionStatus): void {
    const oldStatus = this._status;
    this._status = status;
    this._updatedAt = Date.now();
    this._notifyEvent('status_changed', { oldStatus, newStatus: status });
  }

  /**
   * 设置执行阶段
   */
  public setPhase(phase: ExecutionPhase): void {
    const oldPhase = this._phase;
    this._phase = phase;
    this._updatedAt = Date.now();
    this._notifyEvent('phase_changed', { oldPhase, newPhase: phase });
  }

  /**
   * 检查是否可执行
   */
  public canExecute(): boolean {
    return this._status === ExecutionStatus.PENDING || 
           this._status === ExecutionStatus.RUNNING ||
           this._status === ExecutionStatus.PAUSED;
  }

  /**
   * 检查是否已完成
   */
  public isCompleted(): boolean {
    return this._status === ExecutionStatus.COMPLETED ||
           this._status === ExecutionStatus.FAILED ||
           this._status === ExecutionStatus.CANCELLED ||
           this._status === ExecutionStatus.TIMEOUT;
  }

  // ==================== 输入输出管理 ====================

  /**
   * 设置输入
   */
  public setInput(input: ModuleInput): void {
    this._input = input;
    this._updatedAt = Date.now();
  }

  /**
   * 获取输入
   */
  public getInput(): ModuleInput | null {
    return this._input;
  }

  /**
   * 设置输出
   */
  public setOutput(output: ModuleOutput): void {
    this._output = output;
    this._updatedAt = Date.now();
  }

  /**
   * 获取输出
   */
  public getOutput(): ModuleOutput | null {
    return this._output;
  }

  // ==================== 变量管理 ====================

  /**
   * 设置变量
   */
  public setVariable(
    name: string,
    value: any,
    options: {
      scope?: 'local' | 'parent' | 'global';
      readonly?: boolean;
      metadata?: Record<string, any>;
    } = {}
  ): void {
    if (this._variables.size >= this._config.maxVariables!) {
      throw new Error(`Maximum variables limit (${this._config.maxVariables}) reached`);
    }

    const existing = this._variables.get(name);
    if (existing?.readonly) {
      throw new Error(`Variable '${name}' is readonly`);
    }

    const variable: ExecutionVariable = {
      name,
      value,
      type: this._inferType(value),
      scope: options.scope || 'local',
      readonly: options.readonly || false,
      metadata: options.metadata
    };

    this._variables.set(name, variable);
    this._updatedAt = Date.now();
    this._notifyEvent('variable_set', { name, variable });
  }

  /**
   * 获取变量
   */
  public getVariable(name: string): ExecutionVariable | undefined {
    return this._variables.get(name);
  }

  /**
   * 获取变量值
   */
  public getVariableValue<T = any>(name: string, defaultValue?: T): T {
    const variable = this._variables.get(name);
    return variable ? variable.value : (defaultValue as T);
  }

  /**
   * 删除变量
   */
  public deleteVariable(name: string): boolean {
    const variable = this._variables.get(name);
    if (!variable) {
      return false;
    }

    if (variable.readonly) {
      throw new Error(`Variable '${name}' is readonly`);
    }

    this._variables.delete(name);
    this._updatedAt = Date.now();
    this._notifyEvent('variable_deleted', { name });
    return true;
  }

  /**
   * 检查变量是否存在
   */
  public hasVariable(name: string): boolean {
    return this._variables.has(name);
  }

  /**
   * 获取所有变量
   */
  public getAllVariables(): Map<string, ExecutionVariable> {
    return new Map(this._variables);
  }

  /**
   * 按作用域获取变量
   */
  public getVariablesByScope(scope: 'local' | 'parent' | 'global'): ExecutionVariable[] {
    return Array.from(this._variables.values()).filter(v => v.scope === scope);
  }

  private _inferType(value: any): ExecutionVariable['type'] {
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'function') return 'function';
    return 'object';
  }

  // ==================== 共享状态管理 ====================

  /**
   * 设置共享状态
   */
  public setSharedState(key: string, value: any): void {
    this._sharedState.set(key, value);
    this._updatedAt = Date.now();
  }

  /**
   * 获取共享状态
   */
  public getSharedState<T = any>(key: string, defaultValue?: T): T {
    const value = this._sharedState.get(key);
    return value !== undefined ? value : (defaultValue as T);
  }

  /**
   * 删除共享状态
   */
  public deleteSharedState(key: string): boolean {
    const result = this._sharedState.delete(key);
    if (result) {
      this._updatedAt = Date.now();
    }
    return result;
  }

  /**
   * 获取所有共享状态
   */
  public getAllSharedState(): Map<string, any> {
    return new Map(this._sharedState);
  }

  /**
   * 合并共享状态
   */
  public mergeSharedState(state: Record<string, any>): void {
    for (const [key, value] of Object.entries(state)) {
      this._sharedState.set(key, value);
    }
    this._updatedAt = Date.now();
  }

  // ==================== 父子关系管理 ====================

  /**
   * 设置父上下文
   */
  public setParentContext(parentContextId: string): void {
    this._parentContextId = parentContextId;
    this._updatedAt = Date.now();
  }

  /**
   * 添加子上下文
   */
  public addChildContext(childContextId: string): void {
    this._childContextIds.add(childContextId);
    this._updatedAt = Date.now();
  }

  /**
   * 移除子上下文
   */
  public removeChildContext(childContextId: string): void {
    this._childContextIds.delete(childContextId);
    this._updatedAt = Date.now();
  }

  /**
   * 继承父上下文变量
   */
  public inheritVariables(parentContext: ExecutionContext): void {
    if (!this._config.inheritParentVariables) {
      return;
    }

    const parentVars = parentContext.getVariablesByScope('parent');
    for (const variable of parentVars) {
      if (!this._variables.has(variable.name)) {
        this._variables.set(variable.name, {
          ...variable,
          scope: 'parent'
        });
      }
    }

    // 继承共享状态
    const parentSharedState = parentContext.getAllSharedState();
    for (const [key, value] of parentSharedState) {
      if (!this._sharedState.has(key)) {
        this._sharedState.set(key, value);
      }
    }

    // 继承执行路径
    this._executionPath = [...parentContext.executionPath, this._moduleId];
    this._updatedAt = Date.now();
  }

  // ==================== 快照与恢复 ====================

  /**
   * 创建快照
   */
  public createSnapshot(description?: string): ContextSnapshot {
    const snapshot: ContextSnapshot = {
      id: this._generateId(),
      timestamp: Date.now(),
      contextId: this._id,
      phase: this._phase,
      status: this._status,
      variables: new Map(this._variables),
      sharedState: new Map(this._sharedState),
      metadata: {
        ...this._metadata,
        description,
        executionPath: this._executionPath,
        input: this._input,
        output: this._output
      },
      checksum: this._calculateChecksum()
    };

    this._snapshots.push(snapshot);
    this._updatedAt = Date.now();
    this._notifyEvent('context_snapshot', { snapshotId: snapshot.id });

    return snapshot;
  }

  /**
   * 从快照恢复
   */
  public restoreFromSnapshot(snapshot: ContextSnapshot): void {
    this._phase = snapshot.phase;
    this._status = snapshot.status;
    this._variables = new Map(snapshot.variables);
    this._sharedState = new Map(snapshot.sharedState);
    
    if (snapshot.metadata) {
      this._metadata = { ...snapshot.metadata };
      if (snapshot.metadata.executionPath) {
        this._executionPath = snapshot.metadata.executionPath;
      }
      if (snapshot.metadata.input) {
        this._input = snapshot.metadata.input;
      }
      if (snapshot.metadata.output) {
        this._output = snapshot.metadata.output;
      }
    }

    this._updatedAt = Date.now();
    this._notifyEvent('context_restored', { snapshotId: snapshot.id });
  }

  /**
   * 获取所有快照
   */
  public getSnapshots(): ContextSnapshot[] {
    return [...this._snapshots];
  }

  /**
   * 获取最新快照
   */
  public getLatestSnapshot(): ContextSnapshot | undefined {
    return this._snapshots.length > 0 
      ? this._snapshots[this._snapshots.length - 1] 
      : undefined;
  }

  /**
   * 清除快照
   */
  public clearSnapshots(): void {
    this._snapshots = [];
  }

  private _calculateChecksum(): string {
    const content = JSON.stringify({
      variables: Array.from(this._variables.entries()),
      sharedState: Array.from(this._sharedState.entries()),
      phase: this._phase,
      status: this._status
    });

    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  // ==================== 元数据管理 ====================

  /**
   * 设置元数据
   */
  public setMetadata(key: string, value: any): void {
    this._metadata[key] = value;
    this._updatedAt = Date.now();
  }

  /**
   * 获取元数据
   */
  public getMetadata<T = any>(key: string, defaultValue?: T): T {
    return this._metadata[key] !== undefined 
      ? this._metadata[key] 
      : (defaultValue as T);
  }

  /**
   * 获取所有元数据
   */
  public getAllMetadata(): Record<string, any> {
    return { ...this._metadata };
  }

  // ==================== 事件监听 ====================

  /**
   * 添加事件监听器
   */
  public addEventListener(listener: (event: ExecutionEvent) => void): () => void {
    this._eventListeners.add(listener);
    return () => this._eventListeners.delete(listener);
  }

  private _notifyEvent(type: ExecutionEvent['type'], data?: any): void {
    const event: ExecutionEvent = {
      type,
      contextId: this._id,
      timestamp: Date.now(),
      data
    };

    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Execution context event listener error:', error);
      }
    }
  }

  // ==================== 序列化 ====================

  /**
   * 序列化上下文
   */
  public serialize(): string {
    return JSON.stringify({
      id: this._id,
      taskId: this._taskId,
      executionId: this._executionId,
      moduleId: this._moduleId,
      parentContextId: this._parentContextId,
      childContextIds: Array.from(this._childContextIds),
      status: this._status,
      phase: this._phase,
      variables: Array.from(this._variables.entries()),
      sharedState: Array.from(this._sharedState.entries()),
      metadata: this._metadata,
      input: this._input,
      output: this._output,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      executionPath: this._executionPath
    });
  }

  /**
   * 反序列化上下文
   */
  public static deserialize(data: string): ExecutionContext {
    const parsed = JSON.parse(data);
    const context = new ExecutionContext(
      parsed.taskId,
      parsed.executionId,
      parsed.moduleId
    );

    context._id = parsed.id;
    context._parentContextId = parsed.parentContextId;
    context._childContextIds = new Set(parsed.childContextIds);
    context._status = parsed.status;
    context._phase = parsed.phase;
    context._variables = new Map(parsed.variables);
    context._sharedState = new Map(parsed.sharedState);
    context._metadata = parsed.metadata;
    context._input = parsed.input;
    context._output = parsed.output;
    context._createdAt = parsed.createdAt;
    context._updatedAt = parsed.updatedAt;
    context._executionPath = parsed.executionPath;

    return context;
  }

  // ==================== 销毁 ====================

  /**
   * 销毁上下文
   */
  public destroy(): void {
    this._notifyEvent('context_destroyed', {});
    this._variables.clear();
    this._sharedState.clear();
    this._childContextIds.clear();
    this._eventListeners.clear();
    this._snapshots = [];
  }

  private _generateId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ==================== 执行上下文管理器 ====================

export class ExecutionContextManager {
  private _contexts: Map<string, ExecutionContext> = new Map();
  private _rootContexts: Set<string> = new Set();
  private _config: ExecutionContextConfig;
  private _eventListeners: Set<(event: ExecutionEvent) => void> = new Set();

  constructor(config: ExecutionContextConfig = {}) {
    this._config = config;
  }

  /**
   * 创建执行上下文
   */
  public createContext(
    taskId: string,
    executionId: string,
    moduleId: string,
    parentContextId?: string
  ): ExecutionContext {
    const context = new ExecutionContext(taskId, executionId, moduleId, this._config);
    
    if (parentContextId) {
      const parentContext = this._contexts.get(parentContextId);
      if (parentContext) {
        context.setParentContext(parentContextId);
        context.inheritVariables(parentContext);
        parentContext.addChildContext(context.id);
      }
    } else {
      this._rootContexts.add(context.id);
    }

    this._contexts.set(context.id, context);

    // 转发子上下文事件
    context.addEventListener((event) => {
      this._notifyEvent(event);
    });

    return context;
  }

  /**
   * 获取上下文
   */
  public getContext(contextId: string): ExecutionContext | undefined {
    return this._contexts.get(contextId);
  }

  /**
   * 获取根上下文
   */
  public getRootContexts(): ExecutionContext[] {
    return Array.from(this._rootContexts)
      .map(id => this._contexts.get(id))
      .filter((ctx): ctx is ExecutionContext => ctx !== undefined);
  }

  /**
   * 获取任务的上下文
   */
  public getContextsByTask(taskId: string): ExecutionContext[] {
    return Array.from(this._contexts.values())
      .filter(ctx => ctx.taskId === taskId);
  }

  /**
   * 获取模块的上下文
   */
  public getContextsByModule(moduleId: string): ExecutionContext[] {
    return Array.from(this._contexts.values())
      .filter(ctx => ctx.moduleId === moduleId);
  }

  /**
   * 销毁上下文
   */
  public destroyContext(contextId: string): boolean {
    const context = this._contexts.get(contextId);
    if (!context) {
      return false;
    }

    // 销毁所有子上下文
    for (const childId of context.childContextIds) {
      this.destroyContext(childId);
    }

    // 从父上下文中移除
    if (context.parentContextId) {
      const parent = this._contexts.get(context.parentContextId);
      parent?.removeChildContext(contextId);
    } else {
      this._rootContexts.delete(contextId);
    }

    context.destroy();
    this._contexts.delete(contextId);
    return true;
  }

  /**
   * 销毁任务的所有上下文
   */
  public destroyTaskContexts(taskId: string): number {
    const contexts = this.getContextsByTask(taskId);
    let count = 0;
    for (const context of contexts) {
      if (this.destroyContext(context.id)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 获取所有上下文
   */
  public getAllContexts(): ExecutionContext[] {
    return Array.from(this._contexts.values());
  }

  /**
   * 获取上下文数量
   */
  public getContextCount(): number {
    return this._contexts.size;
  }

  /**
   * 批量创建快照
   */
  public createSnapshots(description?: string): Map<string, ContextSnapshot> {
    const snapshots = new Map<string, ContextSnapshot>();
    for (const [id, context] of this._contexts) {
      snapshots.set(id, context.createSnapshot(description));
    }
    return snapshots;
  }

  /**
   * 添加全局事件监听器
   */
  public addEventListener(listener: (event: ExecutionEvent) => void): () => void {
    this._eventListeners.add(listener);
    return () => this._eventListeners.delete(listener);
  }

  private _notifyEvent(event: ExecutionEvent): void {
    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Execution context manager event listener error:', error);
      }
    }
  }
}

// 导出工厂函数
export function createExecutionContextManager(config?: ExecutionContextConfig): ExecutionContextManager {
  return new ExecutionContextManager(config);
}
