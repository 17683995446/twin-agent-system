/**
 * 第47阶段：执行结果处理
 * Execution Result Handler
 * 
 * 处理执行结果：
 * - 结果收集与聚合
 * - 结果验证与转换
 * - 结果持久化
 * - 结果分发
 */

import { ModuleOutput } from './interfaces';
import { ExecutionContext, ExecutionStatus } from './ExecutionContext';
import { StepResult } from './StepExecutor';

// 结果状态
export enum ResultStatus {
  SUCCESS = 'success',
  PARTIAL_SUCCESS = 'partial_success',
  FAILURE = 'failure',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
  SKIPPED = 'skipped'
}

// 执行结果
export interface ExecutionResult {
  id: string;
  taskId: string;
  status: ResultStatus;
  startTime: number;
  endTime: number;
  duration: number;
  output?: any;
  error?: ErrorInfo;
  steps: StepResult[];
  metadata: Record<string, any>;
  metrics: ResultMetrics;
}

export interface ErrorInfo {
  code: string;
  message: string;
  stack?: string;
  details?: Record<string, any>;
  recoverable: boolean;
}

export interface ResultMetrics {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  retriedSteps: number;
  totalRetryCount: number;
  avgStepDuration: number;
  maxStepDuration: number;
  minStepDuration: number;
}

// 结果处理器
export interface ResultProcessor {
  name: string;
  priority: number;
  process(result: ExecutionResult): Promise<ExecutionResult>;
}

// 结果存储接口
export interface ResultStorage {
  save(result: ExecutionResult): Promise<void>;
  load(id: string): Promise<ExecutionResult | null>;
  loadByTask(taskId: string): Promise<ExecutionResult[]>;
  query(filter: ResultQueryFilter): Promise<ExecutionResult[]>;
  delete(id: string): Promise<boolean>;
}

export interface ResultQueryFilter {
  taskId?: string;
  status?: ResultStatus[];
  startTime?: number;
  endTime?: number;
  limit?: number;
}

// 内存存储实现
export class MemoryResultStorage implements ResultStorage {
  private _results: Map<string, ExecutionResult> = new Map();

  async save(result: ExecutionResult): Promise<void> {
    this._results.set(result.id, result);
  }

  async load(id: string): Promise<ExecutionResult | null> {
    return this._results.get(id) || null;
  }

  async loadByTask(taskId: string): Promise<ExecutionResult[]> {
    return Array.from(this._results.values()).filter(r => r.taskId === taskId);
  }

  async query(filter: ResultQueryFilter): Promise<ExecutionResult[]> {
    let results = Array.from(this._results.values());
    
    if (filter.taskId) {
      results = results.filter(r => r.taskId === filter.taskId);
    }
    if (filter.status) {
      results = results.filter(r => filter.status!.includes(r.status));
    }
    if (filter.startTime) {
      results = results.filter(r => r.startTime >= filter.startTime!);
    }
    if (filter.endTime) {
      results = results.filter(r => r.endTime <= filter.endTime!);
    }
    if (filter.limit) {
      results = results.slice(-filter.limit);
    }
    
    return results;
  }

  async delete(id: string): Promise<boolean> {
    return this._results.delete(id);
  }
}

// ==================== 执行结果处理器 ====================

export class ExecutionResultHandler {
  private _storage: ResultStorage;
  private _processors: ResultProcessor[] = [];
  private _listeners: Set<(result: ExecutionResult) => void> = new Set();

  constructor(storage?: ResultStorage) {
    this._storage = storage || new MemoryResultStorage();
  }

  /**
   * 创建执行结果
   */
  public createResult(
    taskId: string,
    context: ExecutionContext,
    steps: StepResult[]
  ): ExecutionResult {
    const metrics = this._calculateMetrics(steps);
    const status = this._determineStatus(steps, context);
    
    const result: ExecutionResult = {
      id: this._generateId(),
      taskId,
      status,
      startTime: context.createdAt,
      endTime: Date.now(),
      duration: Date.now() - context.createdAt,
      output: context.getOutput()?.data,
      steps,
      metadata: context.getAllMetadata(),
      metrics
    };

    // 提取错误信息
    const failedStep = steps.find(s => s.status === 'failed');
    if (failedStep && failedStep.error) {
      result.error = {
        code: 'STEP_FAILURE',
        message: failedStep.error.message,
        stack: failedStep.error.stack,
        recoverable: failedStep.retryCount < 3
      };
    }

    return result;
  }

  /**
   * 处理结果
   */
  public async handle(result: ExecutionResult): Promise<ExecutionResult> {
    // 执行处理器链
    let processedResult = result;
    const sortedProcessors = [...this._processors].sort((a, b) => a.priority - b.priority);
    
    for (const processor of sortedProcessors) {
      processedResult = await processor.process(processedResult);
    }

    // 保存结果
    await this._storage.save(processedResult);

    // 通知监听器
    for (const listener of this._listeners) {
      try {
        listener(processedResult);
      } catch (error) {
        console.error('Result listener error:', error);
      }
    }

    return processedResult;
  }

  /**
   * 获取结果
   */
  public async getResult(id: string): Promise<ExecutionResult | null> {
    return this._storage.load(id);
  }

  /**
   * 获取任务的所有结果
   */
  public async getResultsByTask(taskId: string): Promise<ExecutionResult[]> {
    return this._storage.loadByTask(taskId);
  }

  /**
   * 查询结果
   */
  public async queryResults(filter: ResultQueryFilter): Promise<ExecutionResult[]> {
    return this._storage.query(filter);
  }

  /**
   * 添加处理器
   */
  public addProcessor(processor: ResultProcessor): void {
    this._processors.push(processor);
  }

  /**
   * 移除处理器
   */
  public removeProcessor(name: string): boolean {
    const index = this._processors.findIndex(p => p.name === name);
    if (index >= 0) {
      this._processors.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 添加监听器
   */
  public addListener(listener: (result: ExecutionResult) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * 聚合多个结果
   */
  public aggregateResults(results: ExecutionResult[]): AggregatedResult {
    const successful = results.filter(r => r.status === ResultStatus.SUCCESS);
    const failed = results.filter(r => r.status === ResultStatus.FAILURE);
    
    return {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      successRate: results.length > 0 ? successful.length / results.length : 0,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      avgDuration: results.length > 0 
        ? results.reduce((sum, r) => sum + r.duration, 0) / results.length 
        : 0,
      outputs: successful.map(r => r.output).filter(o => o !== undefined),
      errors: failed.map(r => r.error).filter(e => e !== undefined) as ErrorInfo[]
    };
  }

  private _calculateMetrics(steps: StepResult[]): ResultMetrics {
    const completedSteps = steps.filter(s => s.status === 'completed');
    const failedSteps = steps.filter(s => s.status === 'failed');
    const skippedSteps = steps.filter(s => s.status === 'skipped');
    const retriedSteps = steps.filter(s => s.retryCount > 0);
    
    const durations = completedSteps
      .map(s => s.duration || 0)
      .filter(d => d > 0);

    return {
      totalSteps: steps.length,
      completedSteps: completedSteps.length,
      failedSteps: failedSteps.length,
      skippedSteps: skippedSteps.length,
      retriedSteps: retriedSteps.length,
      totalRetryCount: steps.reduce((sum, s) => sum + s.retryCount, 0),
      avgStepDuration: durations.length > 0 
        ? durations.reduce((a, b) => a + b, 0) / durations.length 
        : 0,
      maxStepDuration: durations.length > 0 ? Math.max(...durations) : 0,
      minStepDuration: durations.length > 0 ? Math.min(...durations) : 0
    };
  }

  private _determineStatus(steps: StepResult[], context: ExecutionContext): ResultStatus {
    const contextStatus = context.status;
    
    if (contextStatus === ExecutionStatus.CANCELLED) {
      return ResultStatus.CANCELLED;
    }
    if (contextStatus === ExecutionStatus.TIMEOUT) {
      return ResultStatus.TIMEOUT;
    }

    const allSkipped = steps.every(s => s.status === 'skipped');
    if (allSkipped && steps.length > 0) {
      return ResultStatus.SKIPPED;
    }

    const hasFailure = steps.some(s => s.status === 'failed');
    const allSuccess = steps.every(s => s.status === 'completed' || s.status === 'skipped');

    if (allSuccess) {
      return ResultStatus.SUCCESS;
    }
    if (hasFailure && steps.some(s => s.status === 'completed')) {
      return ResultStatus.PARTIAL_SUCCESS;
    }
    return ResultStatus.FAILURE;
  }

  private _generateId(): string {
    return `result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export interface AggregatedResult {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  totalDuration: number;
  avgDuration: number;
  outputs: any[];
  errors: ErrorInfo[];
}

// ==================== 内置处理器 ====================

/** 结果验证处理器 */
export class ResultValidationProcessor implements ResultProcessor {
  name = 'validation';
  priority = 10;

  async process(result: ExecutionResult): Promise<ExecutionResult> {
    // 验证结果完整性
    if (!result.taskId) {
      throw new Error('Result missing taskId');
    }
    if (result.endTime < result.startTime) {
      result.endTime = result.startTime;
      result.duration = 0;
    }
    return result;
  }
}

/** 结果转换处理器 */
export class ResultTransformProcessor implements ResultProcessor {
  name = 'transform';
  priority = 20;
  private _transformers: Map<string, (output: any) => any> = new Map();

  registerTransformer(taskType: string, transformer: (output: any) => any): void {
    this._transformers.set(taskType, transformer);
  }

  async process(result: ExecutionResult): Promise<ExecutionResult> {
    const taskType = result.metadata?.taskType;
    if (taskType && this._transformers.has(taskType)) {
      const transformer = this._transformers.get(taskType)!;
      result.output = transformer(result.output);
    }
    return result;
  }
}

/** 结果清理处理器 */
export class ResultCleanupProcessor implements ResultProcessor {
  name = 'cleanup';
  priority = 100;
  private _sensitiveFields: string[];

  constructor(sensitiveFields: string[] = ['password', 'token', 'secret', 'apiKey']) {
    this._sensitiveFields = sensitiveFields;
  }

  async process(result: ExecutionResult): Promise<ExecutionResult> {
    result.output = this._cleanSensitiveData(result.output);
    result.metadata = this._cleanSensitiveData(result.metadata);
    return result;
  }

  private _cleanSensitiveData(data: any): any {
    if (!data || typeof data !== 'object') return data;
    
    const cleaned = Array.isArray(data) ? [...data] : { ...data };
    
    for (const key of Object.keys(cleaned)) {
      if (this._sensitiveFields.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
        cleaned[key] = '[REDACTED]';
      } else if (typeof cleaned[key] === 'object') {
        cleaned[key] = this._cleanSensitiveData(cleaned[key]);
      }
    }
    
    return cleaned;
  }
}

// 导出工厂函数
export function createExecutionResultHandler(storage?: ResultStorage): ExecutionResultHandler {
  return new ExecutionResultHandler(storage);
}
