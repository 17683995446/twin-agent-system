/**
 * 第48阶段：执行回滚
 * Execution Rollback
 * 
 * 实现执行回滚机制：
 * - 回滚点管理
 * - 补偿操作执行
 * - 回滚策略
 * - 回滚状态追踪
 */

import { ExecutionContext, ExecutionStatus } from './ExecutionContext';
import { StepResult } from './StepExecutor';

// 回滚状态
export enum RollbackStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIAL = 'partial'
}

// 回滚点
export interface RollbackPoint {
  id: string;
  name: string;
  timestamp: number;
  contextSnapshot: string;
  stepResults: StepResult[];
  metadata: Record<string, any>;
}

// 补偿操作
export interface CompensationAction {
  id: string;
  name: string;
  stepId: string;
  execute: (context: ExecutionContext, stepResult: StepResult) => Promise<void>;
  priority: number;
  timeout: number;
  retryable: boolean;
}

// 回滚策略
export enum RollbackStrategy {
  FULL = 'full',               // 完全回滚到初始状态
  PARTIAL = 'partial',         // 部分回滚到指定点
  COMPENSATE = 'compensate',   // 执行补偿操作
  RESTART = 'restart'          // 重新执行
}

// 回滚结果
export interface RollbackResult {
  id: string;
  status: RollbackStatus;
  strategy: RollbackStrategy;
  targetPoint?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  compensatedSteps: string[];
  failedCompensations: string[];
  error?: Error;
}

// 回滚配置
export interface RollbackConfig {
  defaultStrategy?: RollbackStrategy;
  maxRetries?: number;
  timeout?: number;
  enableAutoCheckpoint?: boolean;
  checkpointInterval?: number;
}

// ==================== 执行回滚管理器 ====================

export class ExecutionRollback {
  private _config: Required<RollbackConfig>;
  private _rollbackPoints: Map<string, RollbackPoint> = new Map();
  private _compensationActions: Map<string, CompensationAction> = new Map();
  private _rollbackHistory: RollbackResult[] = [];
  private _listeners: Set<(result: RollbackResult) => void> = new Set();

  constructor(config: RollbackConfig = {}) {
    this._config = {
      defaultStrategy: config.defaultStrategy ?? RollbackStrategy.COMPENSATE,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeout ?? 60000,
      enableAutoCheckpoint: config.enableAutoCheckpoint ?? true,
      checkpointInterval: config.checkpointInterval ?? 300000
    };
  }

  // ==================== 回滚点管理 ====================

  /**
   * 创建回滚点
   */
  public createRollbackPoint(
    name: string,
    context: ExecutionContext,
    stepResults: StepResult[],
    metadata: Record<string, any> = {}
  ): RollbackPoint {
    const point: RollbackPoint = {
      id: this._generateId(),
      name,
      timestamp: Date.now(),
      contextSnapshot: context.serialize(),
      stepResults: [...stepResults],
      metadata
    };

    this._rollbackPoints.set(point.id, point);
    return point;
  }

  /**
   * 获取回滚点
   */
  public getRollbackPoint(pointId: string): RollbackPoint | undefined {
    return this._rollbackPoints.get(pointId);
  }

  /**
   * 获取所有回滚点
   */
  public getAllRollbackPoints(): RollbackPoint[] {
    return Array.from(this._rollbackPoints.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取最近的回滚点
   */
  public getLatestRollbackPoint(): RollbackPoint | undefined {
    const points = this.getAllRollbackPoints();
    return points[0];
  }

  /**
   * 删除回滚点
   */
  public deleteRollbackPoint(pointId: string): boolean {
    return this._rollbackPoints.delete(pointId);
  }

  // ==================== 补偿操作管理 ====================

  /**
   * 注册补偿操作
   */
  public registerCompensation(action: CompensationAction): void {
    this._compensationActions.set(action.id, action);
  }

  /**
   * 为步骤注册补偿操作
   */
  public registerStepCompensation(
    stepId: string,
    compensation: (context: ExecutionContext, stepResult: StepResult) => Promise<void>,
    options: { name?: string; priority?: number; timeout?: number } = {}
  ): CompensationAction {
    const action: CompensationAction = {
      id: `comp_${stepId}`,
      name: options.name || `Compensation for ${stepId}`,
      stepId,
      execute: compensation,
      priority: options.priority ?? 0,
      timeout: options.timeout ?? this._config.timeout,
      retryable: true
    };

    this._compensationActions.set(action.id, action);
    return action;
  }

  /**
   * 获取步骤的补偿操作
   */
  public getCompensationForStep(stepId: string): CompensationAction | undefined {
    return Array.from(this._compensationActions.values())
      .find(a => a.stepId === stepId);
  }

  /**
   * 移除补偿操作
   */
  public removeCompensation(actionId: string): boolean {
    return this._compensationActions.delete(actionId);
  }

  // ==================== 回滚执行 ====================

  /**
   * 执行回滚
   */
  public async rollback(
    context: ExecutionContext,
    stepResults: StepResult[],
    options: {
      strategy?: RollbackStrategy;
      targetPoint?: string;
      skipSteps?: string[];
    } = {}
  ): Promise<RollbackResult> {
    const strategy = options.strategy ?? this._config.defaultStrategy;
    
    const result: RollbackResult = {
      id: this._generateId(),
      status: RollbackStatus.IN_PROGRESS,
      strategy,
      targetPoint: options.targetPoint,
      startTime: Date.now(),
      compensatedSteps: [],
      failedCompensations: []
    };

    try {
      switch (strategy) {
        case RollbackStrategy.FULL:
          await this._executeFullRollback(context, stepResults, result, options.skipSteps);
          break;
        case RollbackStrategy.PARTIAL:
          await this._executePartialRollback(context, stepResults, result, options);
          break;
        case RollbackStrategy.COMPENSATE:
          await this._executeCompensationRollback(context, stepResults, result, options.skipSteps);
          break;
        case RollbackStrategy.RESTART:
          await this._executeRestartRollback(context, result);
          break;
      }

      result.status = result.failedCompensations.length > 0
        ? RollbackStatus.PARTIAL
        : RollbackStatus.COMPLETED;

    } catch (error) {
      result.status = RollbackStatus.FAILED;
      result.error = error as Error;
    }

    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;

    this._rollbackHistory.push(result);
    this._notifyListeners(result);

    return result;
  }

  /**
   * 完全回滚
   */
  private async _executeFullRollback(
    context: ExecutionContext,
    stepResults: StepResult[],
    result: RollbackResult,
    skipSteps?: string[]
  ): Promise<void> {
    // 从最后一个完成的步骤开始反向补偿
    const completedSteps = stepResults
      .filter(s => s.status === 'completed' && !skipSteps?.includes(s.stepId))
      .reverse();

    for (const step of completedSteps) {
      await this._compensateStep(context, step, result);
    }

    // 恢复到初始状态
    context.setStatus(ExecutionStatus.PENDING);
    context.setMetadata('rolled_back', true);
    context.setMetadata('rollback_type', 'full');
  }

  /**
   * 部分回滚
   */
  private async _executePartialRollback(
    context: ExecutionContext,
    stepResults: StepResult[],
    result: RollbackResult,
    options: { targetPoint?: string; skipSteps?: string[] }
  ): Promise<void> {
    const targetPoint = options.targetPoint 
      ? this._rollbackPoints.get(options.targetPoint)
      : this.getLatestRollbackPoint();

    if (!targetPoint) {
      throw new Error('No target rollback point found');
    }

    result.targetPoint = targetPoint.id;

    // 找出需要补偿的步骤
    const stepsAfterPoint = stepResults.filter(
      s => s.startTime > targetPoint.timestamp && !options.skipSteps?.includes(s.stepId)
    ).reverse();

    for (const step of stepsAfterPoint) {
      await this._compensateStep(context, step, result);
    }

    // 恢复上下文到回滚点
    const restoredContext = ExecutionContext.deserialize(targetPoint.contextSnapshot);
    context.setMetadata('rolled_back', true);
    context.setMetadata('rollback_type', 'partial');
    context.setMetadata('rollback_point', targetPoint.id);
  }

  /**
   * 补偿回滚
   */
  private async _executeCompensationRollback(
    context: ExecutionContext,
    stepResults: StepResult[],
    result: RollbackResult,
    skipSteps?: string[]
  ): Promise<void> {
    // 只执行已注册补偿操作的步骤
    const compensatableSteps = stepResults
      .filter(s => s.status === 'completed' && !skipSteps?.includes(s.stepId))
      .filter(s => this._compensationActions.has(`comp_${s.stepId}`))
      .reverse();

    for (const step of compensatableSteps) {
      await this._compensateStep(context, step, result);
    }

    context.setMetadata('rolled_back', true);
    context.setMetadata('rollback_type', 'compensate');
  }

  /**
   * 重启回滚
   */
  private async _executeRestartRollback(
    context: ExecutionContext,
    result: RollbackResult
  ): Promise<void> {
    // 重置上下文状态
    context.setStatus(ExecutionStatus.PENDING);
    context.setMetadata('rolled_back', true);
    context.setMetadata('rollback_type', 'restart');
    context.setMetadata('restart_required', true);
  }

  /**
   * 补偿单个步骤
   */
  private async _compensateStep(
    context: ExecutionContext,
    step: StepResult,
    result: RollbackResult
  ): Promise<void> {
    const compensation = this.getCompensationForStep(step.stepId);
    
    if (!compensation) {
      // 没有补偿操作，跳过
      return;
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Compensation timeout')), compensation.timeout);
      });

      await Promise.race([
        compensation.execute(context, step),
        timeoutPromise
      ]);

      result.compensatedSteps.push(step.stepId);

    } catch (error) {
      result.failedCompensations.push(step.stepId);
      
      if (!compensation.retryable) {
        throw error;
      }
      
      // 重试
      for (let i = 0; i < this._config.maxRetries; i++) {
        try {
          await compensation.execute(context, step);
          result.failedCompensations.pop();
          result.compensatedSteps.push(step.stepId);
          return;
        } catch {
          // 继续重试
        }
      }
    }
  }

  // ==================== 历史查询 ====================

  /**
   * 获取回滚历史
   */
  public getRollbackHistory(limit?: number): RollbackResult[] {
    const history = [...this._rollbackHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * 获取最近的回滚结果
   */
  public getLatestRollback(): RollbackResult | undefined {
    return this._rollbackHistory[this._rollbackHistory.length - 1];
  }

  // ==================== 事件监听 ====================

  /**
   * 添加监听器
   */
  public addListener(listener: (result: RollbackResult) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(result: RollbackResult): void {
    for (const listener of this._listeners) {
      try {
        listener(result);
      } catch (error) {
        console.error('Rollback listener error:', error);
      }
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 清理所有回滚点
   */
  public clearRollbackPoints(): void {
    this._rollbackPoints.clear();
  }

  /**
   * 清理补偿操作
   */
  public clearCompensations(): void {
    this._compensationActions.clear();
  }

  /**
   * 清理历史
   */
  public clearHistory(): void {
    this._rollbackHistory = [];
  }

  private _generateId(): string {
    return `rb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出工厂函数
export function createExecutionRollback(config?: RollbackConfig): ExecutionRollback {
  return new ExecutionRollback(config);
}
