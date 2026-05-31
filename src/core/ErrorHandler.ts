/**
 * 超长任务Agent树形双生子模块化执行系统
 * 错误处理器 - 第8阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ModuleError, InitError, ExecutionError, ValidationError, SnapshotError, ErrorCode, ModuleId } from './interfaces';

/**
 * 错误处理策略
 */
export type ErrorStrategy = 'retry' | 'fallback' | 'abort' | 'ignore';

/**
 * 错误处理上下文
 */
export interface ErrorContext {
  moduleId?: ModuleId;
  operation: string;
  input?: unknown;
  strategy?: ErrorStrategy;
}

/**
 * 错误处理器
 * 
 * 职责：
 * 1. 统一的错误码体系
 * 2. 异常处理机制
 * 3. 错误恢复策略
 */
export class ErrorHandler {
  private _errorLog: Array<{ error: Error; context: ErrorContext; timestamp: number }> = [];
  private _maxLogSize: number = 1000;
  private _strategies: Map<ErrorCode, ErrorStrategy> = new Map();

  constructor() {
    this._setupDefaultStrategies();
  }

  /**
   * 处理错误
   */
  public handle(error: Error, context: ErrorContext): { handled: boolean; action: ErrorStrategy; result?: unknown } {
    // 记录错误
    this._logError(error, context);

    // 确定处理策略
    const strategy = context.strategy || this._determineStrategy(error);

    // 执行策略
    switch (strategy) {
      case 'retry':
        return { handled: true, action: 'retry' };
      case 'fallback':
        return { handled: true, action: 'fallback', result: this._getFallbackResult(context) };
      case 'ignore':
        return { handled: true, action: 'ignore' };
      case 'abort':
      default:
        return { handled: false, action: 'abort' };
    }
  }

  /**
   * 创建初始化错误
   */
  public createInitError(message: string, moduleId?: ModuleId, cause?: Error): InitError {
    return new InitError(message, moduleId, cause);
  }

  /**
   * 创建执行错误
   */
  public createExecutionError(message: string, moduleId?: ModuleId, cause?: Error): ExecutionError {
    return new ExecutionError(message, moduleId, cause);
  }

  /**
   * 创建校验错误
   */
  public createValidationError(message: string, moduleId?: ModuleId, cause?: Error): ValidationError {
    return new ValidationError(message, moduleId, cause);
  }

  /**
   * 创建快照错误
   */
  public createSnapshotError(message: string, moduleId?: ModuleId, cause?: Error): SnapshotError {
    return new SnapshotError(message, moduleId, cause);
  }

  /**
   * 获取错误日志
   */
  public getErrorLog(limit: number = 100): Array<{ error: Error; context: ErrorContext; timestamp: number }> {
    return this._errorLog.slice(-limit);
  }

  /**
   * 设置错误处理策略
   */
  public setStrategy(errorCode: ErrorCode, strategy: ErrorStrategy): void {
    this._strategies.set(errorCode, strategy);
  }

  private _setupDefaultStrategies(): void {
    this._strategies.set('INIT_ERROR', 'abort');
    this._strategies.set('EXECUTION_ERROR', 'retry');
    this._strategies.set('VALIDATION_ERROR', 'abort');
    this._strategies.set('SNAPSHOT_ERROR', 'ignore');
  }

  private _determineStrategy(error: Error): ErrorStrategy {
    if (error instanceof ModuleError) {
      return this._strategies.get(error.code) || 'abort';
    }
    return 'abort';
  }

  private _logError(error: Error, context: ErrorContext): void {
    this._errorLog.push({ error, context, timestamp: Date.now() });
    if (this._errorLog.length > this._maxLogSize) {
      this._errorLog = this._errorLog.slice(-this._maxLogSize / 2);
    }
  }

  private _getFallbackResult(context: ErrorContext): unknown {
    // 根据上下文返回默认结果
    return { fallback: true, operation: context.operation };
  }
}

export default ErrorHandler;
