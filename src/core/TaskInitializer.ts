/**
 * 超长任务Agent树形双生子模块化执行系统
 * 任务初始化器 - 第34阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { TaskParam } from './interfaces';

/**
 * 初始化配置
 */
export interface InitializationConfig {
  autoGenerateId?: boolean;
  defaultTimeout?: number;
  defaultMaxRetries?: number;
  defaultPriority?: number;
  enforceIdFormat?: boolean;
  idPrefix?: string;
}

/**
 * 初始化结果
 */
export interface InitializationResult {
  success: boolean;
  param?: TaskParam;
  errors: string[];
  warnings: string[];
}

/**
 * 参数转换器
 */
export interface ParamTransformer {
  field: string;
  transform: (value: unknown) => unknown;
}

/**
 * 任务初始化器
 * 
 * 职责：
 * 1. 任务参数的解析
 * 2. 参数转换与格式化
 * 3. 默认值填充
 * 4. 初始化状态设置
 */
export class TaskInitializer {
  private _config: Required<InitializationConfig>;
  private _transformers: ParamTransformer[] = [];
  private _initHistory: Array<{ timestamp: number; taskId: string; success: boolean }> = [];

  constructor(config: InitializationConfig = {}) {
    this._config = {
      autoGenerateId: config.autoGenerateId ?? true,
      defaultTimeout: config.defaultTimeout ?? 30000,
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      defaultPriority: config.defaultPriority ?? 0,
      enforceIdFormat: config.enforceIdFormat ?? true,
      idPrefix: config.idPrefix ?? 'task'
    };
  }

  /**
   * 初始化任务参数
   */
  public initialize(rawParam: Partial<TaskParam>): InitializationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 1. 生成或验证任务ID
      let taskId = rawParam.taskId;
      if (!taskId && this._config.autoGenerateId) {
        taskId = this._generateTaskId();
      } else if (!taskId) {
        errors.push('taskId 不能为空');
      } else if (this._config.enforceIdFormat && !this._validateTaskId(taskId)) {
        errors.push(`taskId 格式无效: ${taskId}`);
      }

      // 2. 设置默认值
      const param: TaskParam = {
        taskId: taskId!,
        taskName: rawParam.taskName || '未命名任务',
        config: rawParam.config || {},
        description: rawParam.description,
        priority: rawParam.priority ?? this._config.defaultPriority,
        timeout: rawParam.timeout ?? this._config.defaultTimeout,
        maxRetries: rawParam.maxRetries ?? this._config.defaultMaxRetries,
        createdAt: rawParam.createdAt || Date.now(),
        metadata: {
          ...rawParam.metadata,
          initializedAt: Date.now(),
          initVersion: '1.0.0'
        }
      };

      // 3. 应用转换器
      for (const transformer of this._transformers) {
        const value = this._getFieldValue(param, transformer.field);
        const transformed = transformer.transform(value);
        this._setFieldValue(param, transformer.field, transformed);
      }

      // 4. 验证初始化结果
      if (!param.taskName || param.taskName.trim().length === 0) {
        errors.push('taskName 不能为空');
      }

      if (param.timeout <= 0) {
        warnings.push('timeout 已调整为默认值');
        param.timeout = this._config.defaultTimeout;
      }

      if (param.maxRetries < 0) {
        warnings.push('maxRetries 已调整为默认值');
        param.maxRetries = this._config.defaultMaxRetries;
      }

      // 记录历史
      this._initHistory.push({
        timestamp: Date.now(),
        taskId: param.taskId,
        success: errors.length === 0
      });

      if (errors.length > 0) {
        return { success: false, errors, warnings };
      }

      return { success: true, param, errors, warnings };
    } catch (error) {
      errors.push(`初始化异常: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, errors, warnings };
    }
  }

  /**
   * 批量初始化
   */
  public initializeBatch(rawParams: Partial<TaskParam>[]): InitializationResult[] {
    return rawParams.map(param => this.initialize(param));
  }

  /**
   * 添加参数转换器
   */
  public addTransformer(transformer: ParamTransformer): void {
    this._transformers.push(transformer);
  }

  /**
   * 获取初始化历史
   */
  public getInitHistory(limit: number = 100): typeof this._initHistory {
    return this._initHistory.slice(-limit);
  }

  /**
   * 克隆任务参数
   */
  public clone(param: TaskParam, overrides?: Partial<TaskParam>): TaskParam {
    const cloned: TaskParam = {
      ...param,
      taskId: overrides?.taskId || this._generateTaskId(),
      taskName: overrides?.taskName || `${param.taskName} (副本)`,
      createdAt: Date.now(),
      metadata: {
        ...param.metadata,
        clonedFrom: param.taskId,
        clonedAt: Date.now()
      }
    };

    if (overrides) {
      Object.assign(cloned, overrides);
    }

    return cloned;
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<InitializationConfig>): void {
    Object.assign(this._config, config);
  }

  private _generateTaskId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 6);
    return `${this._config.idPrefix}_${timestamp}_${random}`;
  }

  private _validateTaskId(taskId: string): boolean {
    // 简单验证：以前缀开头，包含时间戳和随机数
    const pattern = new RegExp(`^${this._config.idPrefix}_[a-z0-9]+_[a-z0-9]+$`);
    return pattern.test(taskId);
  }

  private _getFieldValue(obj: unknown, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = obj;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private _setFieldValue(obj: unknown, field: string, value: unknown): void {
    const parts = field.split('.');
    let current: Record<string, unknown> = obj as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }
}

export default TaskInitializer;
