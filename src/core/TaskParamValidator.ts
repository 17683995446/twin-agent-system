/**
 * 超长任务Agent树形双生子模块化执行系统
 * 任务参数验证器 - 第33阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { TaskParam } from './interfaces';

/**
 * 验证规则类型
 */
export type ValidationRuleType = 'required' | 'type' | 'range' | 'length' | 'pattern' | 'enum' | 'custom';

/**
 * 字段验证规则
 */
export interface FieldValidationRule {
  field: string;
  type: ValidationRuleType;
  message?: string;
  // required
  required?: boolean;
  // type
  expectedType?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  // range
  min?: number;
  max?: number;
  // length
  minLength?: number;
  maxLength?: number;
  // pattern
  pattern?: RegExp;
  // enum
  allowedValues?: unknown[];
  // custom
  validator?: (value: unknown) => boolean | Promise<boolean>;
}

/**
 * 验证结果
 */
export interface ParamValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string; value?: unknown }>;
  warnings: Array<{ field: string; message: string; value?: unknown }>;
}

/**
 * 安全检查结果
 */
export interface SecurityCheckResult {
  passed: boolean;
  threats: Array<{ type: string; field: string; message: string }>;
  sanitizedValue?: unknown;
}

/**
 * 任务参数验证器
 * 
 * 职责：
 * 1. 参数完整性验证
 * 2. 参数合法性验证
 * 3. 参数安全性验证
 */
export class TaskParamValidator {
  private _rules: Map<string, FieldValidationRule[]> = new Map();
  private _securityPatterns: Map<string, RegExp> = new Map();

  constructor() {
    this._initSecurityPatterns();
  }

  /**
   * 添加验证规则
   */
  public addRule(field: string, rule: FieldValidationRule): void {
    if (!this._rules.has(field)) {
      this._rules.set(field, []);
    }
    this._rules.get(field)!.push(rule);
  }

  /**
   * 移除验证规则
   */
  public removeRules(field: string): void {
    this._rules.delete(field);
  }

  /**
   * 验证任务参数
   */
  public async validate(param: TaskParam): Promise<ParamValidationResult> {
    const errors: ParamValidationResult['errors'] = [];
    const warnings: ParamValidationResult['warnings'] = [];

    // 1. 必填字段检查
    const requiredFields = ['taskId', 'taskName', 'config'];
    for (const field of requiredFields) {
      const value = this._getFieldValue(param, field);
      if (value === undefined || value === null) {
        errors.push({ field, message: `${field} 是必填字段`, value });
      }
    }

    // 2. 类型检查
    if (typeof param.taskId !== 'string') {
      errors.push({ field: 'taskId', message: 'taskId 必须是字符串', value: param.taskId });
    }
    if (typeof param.taskName !== 'string') {
      errors.push({ field: 'taskName', message: 'taskName 必须是字符串', value: param.taskName });
    }
    if (typeof param.config !== 'object' || param.config === null) {
      errors.push({ field: 'config', message: 'config 必须是对象', value: param.config });
    }

    // 3. 长度检查
    if (param.taskName && param.taskName.length > 200) {
      errors.push({ field: 'taskName', message: 'taskName 长度不能超过200字符', value: param.taskName });
    }
    if (param.description && param.description.length > 1000) {
      warnings.push({ field: 'description', message: 'description 长度超过1000字符', value: param.description });
    }

    // 4. 数值范围检查
    if (param.priority !== undefined && (typeof param.priority !== 'number' || param.priority < 0)) {
      errors.push({ field: 'priority', message: 'priority 必须是非负数', value: param.priority });
    }
    if (param.timeout !== undefined && (typeof param.timeout !== 'number' || param.timeout < 0)) {
      errors.push({ field: 'timeout', message: 'timeout 必须是非负数', value: param.timeout });
    }
    if (param.maxRetries !== undefined && (typeof param.maxRetries !== 'number' || param.maxRetries < 0)) {
      errors.push({ field: 'maxRetries', message: 'maxRetries 必须是非负数', value: param.maxRetries });
    }

    // 5. 自定义规则验证
    for (const [field, rules] of this._rules) {
      const value = this._getFieldValue(param, field);
      for (const rule of rules) {
        const valid = await this._validateRule(value, rule);
        if (!valid) {
          errors.push({ field, message: rule.message || `${field} 验证失败`, value });
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 安全验证
   */
  public securityCheck(param: TaskParam): SecurityCheckResult {
    const threats: SecurityCheckResult['threats'] = [];

    // 检查SQL注入
    const sqlPattern = this._securityPatterns.get('sqlInjection');
    if (sqlPattern && param.taskName && sqlPattern.test(param.taskName)) {
      threats.push({ type: 'SQL_INJECTION', field: 'taskName', message: '检测到潜在的SQL注入风险' });
    }

    // 检查XSS
    const xssPattern = this._securityPatterns.get('xss');
    if (xssPattern && param.description && xssPattern.test(param.description)) {
      threats.push({ type: 'XSS', field: 'description', message: '检测到潜在的XSS风险' });
    }

    // 检查命令注入
    const cmdPattern = this._securityPatterns.get('commandInjection');
    if (cmdPattern && param.taskName && cmdPattern.test(param.taskName)) {
      threats.push({ type: 'COMMAND_INJECTION', field: 'taskName', message: '检测到潜在的命令注入风险' });
    }

    return { passed: threats.length === 0, threats };
  }

  /**
   * 完整验证（包含安全检查）
   */
  public async validateFull(param: TaskParam): Promise<{ validation: ParamValidationResult; security: SecurityCheckResult }> {
    const validation = await this.validate(param);
    const security = this.securityCheck(param);
    return { validation, security };
  }

  /**
   * 清理参数（去除危险字符）
   */
  public sanitize(param: TaskParam): TaskParam {
    const sanitized: TaskParam = { ...param };

    if (typeof sanitized.taskName === 'string') {
      sanitized.taskName = this._sanitizeString(sanitized.taskName);
    }
    if (typeof sanitized.description === 'string') {
      sanitized.description = this._sanitizeString(sanitized.description);
    }

    return sanitized;
  }

  private _initSecurityPatterns(): void {
    this._securityPatterns.set('sqlInjection', /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|SCRIPT)\b)|(--)|(\/\*)|(\*\/)/i);
    this._securityPatterns.set('xss', /<script|<\/script|javascript:|on\w+\s*=/i);
    this._securityPatterns.set('commandInjection', /[;&|`$(){}[\]\\]|(\|\|)|(&&)/);
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

  private async _validateRule(value: unknown, rule: FieldValidationRule): Promise<boolean> {
    switch (rule.type) {
      case 'required':
        return value !== undefined && value !== null && value !== '';
      case 'type':
        if (rule.expectedType === 'array') return Array.isArray(value);
        return typeof value === rule.expectedType;
      case 'range':
        if (typeof value !== 'number') return false;
        const min = rule.min ?? -Infinity;
        const max = rule.max ?? Infinity;
        return value >= min && value <= max;
      case 'length':
        const length = typeof value === 'string' ? value.length : Array.isArray(value) ? value.length : 0;
        const minLen = rule.minLength ?? 0;
        const maxLen = rule.maxLength ?? Infinity;
        return length >= minLen && length <= maxLen;
      case 'pattern':
        if (typeof value !== 'string' || !rule.pattern) return false;
        return rule.pattern.test(value);
      case 'enum':
        return rule.allowedValues?.includes(value) ?? false;
      case 'custom':
        if (rule.validator) {
          return await rule.validator(value);
        }
        return true;
      default:
        return true;
    }
  }

  private _sanitizeString(str: string): string {
    return str
      .replace(/[<>]/g, '')
      .replace(/['"]/g, '')
      .trim();
  }
}

export default TaskParamValidator;
