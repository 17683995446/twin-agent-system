/**
 * 第44阶段：步骤执行器
 * Step Executor
 * 
 * 实现单个步骤的执行逻辑：
 * - 步骤定义与执行
 * - 前置/后置处理钩子
 * - 输入输出验证
 * - 步骤重试与补偿
 * - 执行结果收集
 */

import { ModuleInput, ModuleOutput, ModuleContext } from './interfaces';
import { ExecutionContext, ExecutionStatus, ExecutionPhase } from './ExecutionContext';

// 步骤状态
export enum StepStatus {
  PENDING = 'pending',
  PREPARING = 'preparing',
  RUNNING = 'running',
  VERIFYING = 'verifying',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  COMPENSATING = 'compensating'
}

// 步骤类型
export enum StepType {
  TASK = 'task',
  CONDITION = 'condition',
  LOOP = 'loop',
  PARALLEL = 'parallel',
  SEQUENCE = 'sequence',
  COMPENSATION = 'compensation'
}

// 验证规则
export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  pattern?: RegExp;
  min?: number;
  max?: number;
  enum?: any[];
  custom?: (value: any, context: ExecutionContext) => boolean | Promise<boolean>;
  message?: string;
}

// 验证结果
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

// 前置/后置处理器
export interface StepProcessor {
  name: string;
  priority: number;
  execute(context: ExecutionContext, step: Step): Promise<void>;
}

// 步骤定义
export interface Step {
  id: string;
  name: string;
  type: StepType;
  description?: string;
  
  // 执行配置
  action: (input: any, context: ExecutionContext) => Promise<any>;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  
  // 验证配置
  inputValidation?: ValidationRule[];
  outputValidation?: ValidationRule[];
  
  // 处理器
  preProcessors?: StepProcessor[];
  postProcessors?: StepProcessor[];
  
  // 补偿/回滚
  compensation?: (input: any, context: ExecutionContext, result: any) => Promise<void>;
  
  // 条件执行
  condition?: (context: ExecutionContext) => boolean | Promise<boolean>;
  skipOnCondition?: boolean;
  
  // 元数据
  metadata?: Record<string, any>;
  tags?: string[];
}

// 步骤执行结果
export interface StepResult {
  stepId: string;
  status: StepStatus;
  input: any;
  output?: any;
  error?: Error;
  startTime: number;
  endTime?: number;
  duration?: number;
  retryCount: number;
  skipped: boolean;
  compensated: boolean;
  metadata: Record<string, any>;
}

// 步骤执行配置
export interface StepExecutorConfig {
  defaultTimeout?: number;
  defaultMaxRetries?: number;
  defaultRetryDelay?: number;
  enableValidation?: boolean;
  enableCompensation?: boolean;
  collectMetrics?: boolean;
}

// 步骤事件
export interface StepEvent {
  type: 'step_started' | 'step_completed' | 'step_failed' | 'step_skipped' | 'step_retry' | 'step_compensated';
  stepId: string;
  timestamp: number;
  data?: any;
}

// ==================== 步骤执行器 ====================

export class StepExecutor {
  private _config: Required<StepExecutorConfig>;
  private _eventListeners: Set<(event: StepEvent) => void> = new Set();
  private _globalPreProcessors: StepProcessor[] = [];
  private _globalPostProcessors: StepProcessor[] = [];

  constructor(config: StepExecutorConfig = {}) {
    this._config = {
      defaultTimeout: config.defaultTimeout ?? 300000,
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      defaultRetryDelay: config.defaultRetryDelay ?? 1000,
      enableValidation: config.enableValidation ?? true,
      enableCompensation: config.enableCompensation ?? true,
      collectMetrics: config.collectMetrics ?? true
    };
  }

  // ==================== 核心执行 ====================

  /**
   * 执行步骤
   */
  public async execute(
    step: Step,
    input: any,
    context: ExecutionContext
  ): Promise<StepResult> {
    const result: StepResult = {
      stepId: step.id,
      status: StepStatus.PENDING,
      input,
      startTime: Date.now(),
      retryCount: 0,
      skipped: false,
      compensated: false,
      metadata: {}
    };

    try {
      // 1. 检查执行条件
      if (step.condition) {
        const shouldExecute = await step.condition(context);
        if (!shouldExecute) {
          result.status = StepStatus.SKIPPED;
          result.skipped = true;
          result.endTime = Date.now();
          result.duration = result.endTime - result.startTime;
          this._notifyEvent('step_skipped', step.id, { reason: 'condition_not_met' });
          return result;
        }
      }

      // 2. 输入验证
      if (this._config.enableValidation && step.inputValidation) {
        result.status = StepStatus.PREPARING;
        const validation = await this._validate(input, step.inputValidation, context);
        if (!validation.valid) {
          throw new Error(`Input validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
        }
      }

      // 3. 执行前置处理器
      await this._executePreProcessors(step, context);

      // 4. 执行步骤动作（带重试）
      result.status = StepStatus.RUNNING;
      this._notifyEvent('step_started', step.id, { input });

      const output = await this._executeWithRetry(step, input, context, result);
      result.output = output;

      // 5. 输出验证
      if (this._config.enableValidation && step.outputValidation) {
        result.status = StepStatus.VERIFYING;
        const validation = await this._validate(output, step.outputValidation, context);
        if (!validation.valid) {
          throw new Error(`Output validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
        }
      }

      // 6. 执行后置处理器
      await this._executePostProcessors(step, context, output);

      // 7. 标记完成
      result.status = StepStatus.COMPLETED;
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      this._notifyEvent('step_completed', step.id, { output, duration: result.duration });

    } catch (error) {
      const err = error as Error;
      result.status = StepStatus.FAILED;
      result.error = err;
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;

      this._notifyEvent('step_failed', step.id, { error: err.message });

      // 8. 执行补偿（如果启用且定义了补偿函数）
      if (this._config.enableCompensation && step.compensation) {
        try {
          result.status = StepStatus.COMPENSATING;
          await step.compensation(input, context, result.output);
          result.compensated = true;
          this._notifyEvent('step_compensated', step.id);
        } catch (compensationError) {
          console.error(`Compensation failed for step ${step.id}:`, compensationError);
        }
      }
    }

    return result;
  }

  /**
   * 执行步骤序列
   */
  public async executeSequence(
    steps: Step[],
    initialInput: any,
    context: ExecutionContext,
    options: {
      stopOnFailure?: boolean;
      passOutputToNext?: boolean;
    } = {}
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];
    let currentInput = initialInput;

    for (const step of steps) {
      const result = await this.execute(step, currentInput, context);
      results.push(result);

      if (result.status === StepStatus.FAILED && options.stopOnFailure !== false) {
        break;
      }

      if (options.passOutputToNext !== false && result.output !== undefined) {
        currentInput = result.output;
      }
    }

    return results;
  }

  /**
   * 并行执行步骤
   */
  public async executeParallel(
    steps: Step[],
    input: any,
    context: ExecutionContext,
    options: {
      maxConcurrency?: number;
      stopOnError?: boolean;
    } = {}
  ): Promise<StepResult[]> {
    const maxConcurrency = options.maxConcurrency ?? steps.length;
    const results: StepResult[] = [];
    const errors: Error[] = [];

    // 分批执行
    for (let i = 0; i < steps.length; i += maxConcurrency) {
      const batch = steps.slice(i, i + maxConcurrency);
      
      const batchResults = await Promise.all(
        batch.map(step => this.execute(step, input, context))
      );

      for (const result of batchResults) {
        results.push(result);
        if (result.status === StepStatus.FAILED && options.stopOnError) {
          return results;
        }
      }
    }

    return results;
  }

  // ==================== 验证 ====================

  private async _validate(
    data: any,
    rules: ValidationRule[],
    context: ExecutionContext
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const value = this._getNestedValue(data, rule.field);

      // 必填检查
      if (rule.required && (value === undefined || value === null)) {
        errors.push({
          field: rule.field,
          message: rule.message || `Field '${rule.field}' is required`,
          value
        });
        continue;
      }

      if (value === undefined || value === null) continue;

      // 类型检查
      if (rule.type) {
        const typeValid = this._checkType(value, rule.type);
        if (!typeValid) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' must be of type ${rule.type}`,
            value
          });
          continue;
        }
      }

      // 模式检查
      if (rule.pattern && typeof value === 'string') {
        if (!rule.pattern.test(value)) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' does not match pattern ${rule.pattern}`,
            value
          });
        }
      }

      // 最小值检查
      if (rule.min !== undefined) {
        if (typeof value === 'number' && value < rule.min) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' must be at least ${rule.min}`,
            value
          });
        } else if (typeof value === 'string' && value.length < rule.min) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' must have at least ${rule.min} characters`,
            value
          });
        } else if (Array.isArray(value) && value.length < rule.min) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' must have at least ${rule.min} items`,
            value
          });
        }
      }

      // 最大值检查
      if (rule.max !== undefined) {
        if (typeof value === 'number' && value > rule.max) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' must be at most ${rule.max}`,
            value
          });
        } else if (typeof value === 'string' && value.length > rule.max) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' must have at most ${rule.max} characters`,
            value
          });
        } else if (Array.isArray(value) && value.length > rule.max) {
          errors.push({
            field: rule.field,
            message: rule.message || `Field '${rule.field}' must have at most ${rule.max} items`,
            value
          });
        }
      }

      // 枚举检查
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push({
          field: rule.field,
          message: rule.message || `Field '${rule.field}' must be one of: ${rule.enum.join(', ')}`,
          value
        });
      }

      // 自定义验证
      if (rule.custom) {
        try {
          const customValid = await rule.custom(value, context);
          if (!customValid) {
            errors.push({
              field: rule.field,
              message: rule.message || `Field '${rule.field}' failed custom validation`,
              value
            });
          }
        } catch (error) {
          errors.push({
            field: rule.field,
            message: rule.message || `Custom validation error: ${(error as Error).message}`,
            value
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private _getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;
    for (const key of keys) {
      if (value === undefined || value === null) return undefined;
      value = value[key];
    }
    return value;
  }

  private _checkType(value: any, type: string): boolean {
    switch (type) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number' && !isNaN(value);
      case 'boolean': return typeof value === 'boolean';
      case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array': return Array.isArray(value);
      default: return true;
    }
  }

  // ==================== 处理器 ====================

  /**
   * 添加全局前置处理器
   */
  public addGlobalPreProcessor(processor: StepProcessor): void {
    this._globalPreProcessors.push(processor);
    this._globalPreProcessors.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 添加全局后置处理器
   */
  public addGlobalPostProcessor(processor: StepProcessor): void {
    this._globalPostProcessors.push(processor);
    this._globalPostProcessors.sort((a, b) => a.priority - b.priority);
  }

  private async _executePreProcessors(step: Step, context: ExecutionContext): Promise<void> {
    // 全局前置处理器
    for (const processor of this._globalPreProcessors) {
      await processor.execute(context, step);
    }

    // 步骤特定前置处理器
    if (step.preProcessors) {
      const sorted = [...step.preProcessors].sort((a, b) => a.priority - b.priority);
      for (const processor of sorted) {
        await processor.execute(context, step);
      }
    }
  }

  private async _executePostProcessors(step: Step, context: ExecutionContext, output: any): Promise<void> {
    // 步骤特定后置处理器
    if (step.postProcessors) {
      const sorted = [...step.postProcessors].sort((a, b) => b.priority - a.priority);
      for (const processor of sorted) {
        await processor.execute(context, step);
      }
    }

    // 全局后置处理器
    for (const processor of this._globalPostProcessors) {
      await processor.execute(context, step);
    }
  }

  // ==================== 重试逻辑 ====================

  private async _executeWithRetry(
    step: Step,
    input: any,
    context: ExecutionContext,
    result: StepResult
  ): Promise<any> {
    const maxRetries = step.maxRetries ?? this._config.defaultMaxRetries;
    const retryDelay = step.retryDelay ?? this._config.defaultRetryDelay;
    const timeout = step.timeout ?? this._config.defaultTimeout;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        result.retryCount = attempt;

        // 超时控制
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Step execution timeout (${timeout}ms)`)), timeout);
        });

        const output = await Promise.race([
          step.action(input, context),
          timeoutPromise
        ]);

        return output;

      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          this._notifyEvent('step_retry', step.id, {
            attempt: attempt + 1,
            maxRetries,
            error: lastError.message
          });

          // 等待重试延迟
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  // ==================== 事件监听 ====================

  public addEventListener(listener: (event: StepEvent) => void): () => void {
    this._eventListeners.add(listener);
    return () => this._eventListeners.delete(listener);
  }

  private _notifyEvent(type: StepEvent['type'], stepId: string, data?: any): void {
    const event: StepEvent = {
      type,
      stepId,
      timestamp: Date.now(),
      data
    };

    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Step event listener error:', error);
      }
    }
  }
}

// ==================== 内置处理器 ====================

/** 日志处理器 */
export class LoggingProcessor implements StepProcessor {
  name = 'logging';
  priority = 100;
  private _logger: (message: string) => void;

  constructor(logger?: (message: string) => void) {
    this._logger = logger || console.log;
  }

  async execute(context: ExecutionContext, step: Step): Promise<void> {
    this._logger(`[Step ${step.id}] Context: ${context.id}, Phase: ${context.phase}`);
  }
}

/** 计时处理器 */
export class TimingProcessor implements StepProcessor {
  name = 'timing';
  priority = 50;
  private _timings: Map<string, number> = new Map();

  async execute(context: ExecutionContext, step: Step): Promise<void> {
    const key = `${context.id}:${step.id}`;
    if (this._timings.has(key)) {
      const startTime = this._timings.get(key)!;
      const duration = Date.now() - startTime;
      context.setMetadata(`timing_${step.id}`, duration);
      this._timings.delete(key);
    } else {
      this._timings.set(key, Date.now());
    }
  }

  getTiming(contextId: string, stepId: string): number | undefined {
    return this._timings.get(`${contextId}:${stepId}`);
  }
}

/** 快照处理器 */
export class SnapshotProcessor implements StepProcessor {
  name = 'snapshot';
  priority = 200;

  async execute(context: ExecutionContext, step: Step): Promise<void> {
    context.createSnapshot(`Step ${step.id} checkpoint`);
  }
}

// 导出工厂函数
export function createStepExecutor(config?: StepExecutorConfig): StepExecutor {
  return new StepExecutor(config);
}

// 步骤构建器
export class StepBuilder {
  private _step: Partial<Step> = {};

  constructor(id: string, name: string) {
    this._step.id = id;
    this._step.name = name;
    this._step.type = StepType.TASK;
    this._step.metadata = {};
    this._step.tags = [];
  }

  withType(type: StepType): StepBuilder {
    this._step.type = type;
    return this;
  }

  withDescription(description: string): StepBuilder {
    this._step.description = description;
    return this;
  }

  withAction(action: Step['action']): StepBuilder {
    this._step.action = action;
    return this;
  }

  withTimeout(timeout: number): StepBuilder {
    this._step.timeout = timeout;
    return this;
  }

  withRetries(maxRetries: number, retryDelay?: number): StepBuilder {
    this._step.maxRetries = maxRetries;
    this._step.retryDelay = retryDelay;
    return this;
  }

  withInputValidation(rules: ValidationRule[]): StepBuilder {
    this._step.inputValidation = rules;
    return this;
  }

  withOutputValidation(rules: ValidationRule[]): StepBuilder {
    this._step.outputValidation = rules;
    return this;
  }

  withCompensation(compensation: Step['compensation']): StepBuilder {
    this._step.compensation = compensation;
    return this;
  }

  withCondition(condition: Step['condition']): StepBuilder {
    this._step.condition = condition;
    return this;
  }

  withPreProcessor(processor: StepProcessor): StepBuilder {
    this._step.preProcessors = this._step.preProcessors || [];
    this._step.preProcessors.push(processor);
    return this;
  }

  withPostProcessor(processor: StepProcessor): StepBuilder {
    this._step.postProcessors = this._step.postProcessors || [];
    this._step.postProcessors.push(processor);
    return this;
  }

  withMetadata(key: string, value: any): StepBuilder {
    this._step.metadata![key] = value;
    return this;
  }

  withTag(tag: string): StepBuilder {
    this._step.tags!.push(tag);
    return this;
  }

  build(): Step {
    if (!this._step.action) {
      throw new Error('Step action is required');
    }
    return this._step as Step;
  }
}

export function createStepBuilder(id: string, name: string): StepBuilder {
  return new StepBuilder(id, name);
}
