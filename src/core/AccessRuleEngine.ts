/**
 * 超长任务Agent树形双生子模块化执行系统
 * 准入规则引擎 - 第31阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ModuleInput } from './interfaces';

/**
 * 规则条件类型
 */
export type RuleConditionType = 'equals' | 'contains' | 'regex' | 'range' | 'exists' | 'custom';

/**
 * 规则条件
 */
export interface RuleCondition {
  field: string;
  type: RuleConditionType;
  value?: unknown;
  min?: number;
  max?: number;
  pattern?: string;
  customEvaluator?: (input: ModuleInput) => boolean | Promise<boolean>;
}

/**
 * 规则动作
 */
export type RuleAction = 'allow' | 'deny' | 'warn' | 'log' | 'transform';

/**
 * 准入规则定义
 */
export interface AccessRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  conditionLogic: 'and' | 'or';
  action: RuleAction;
  transformConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * 规则执行结果
 */
export interface RuleExecutionResult {
  ruleId: string;
  matched: boolean;
  action: RuleAction;
  transformedInput?: ModuleInput;
  executionTimeMs: number;
  timestamp: number;
}

/**
 * 规则引擎配置
 */
export interface AccessRuleEngineOptions {
  maxRules?: number;
  executionTimeoutMs?: number;
  enableRuleCache?: boolean;
  defaultAction?: RuleAction;
}

/**
 * 准入规则引擎
 * 
 * 职责：
 * 1. 规则的解析与验证
 * 2. 规则的执行与匹配
 * 3. 规则优先级管理
 * 4. 规则缓存优化
 */
export class AccessRuleEngine {
  private _rules: Map<string, AccessRule> = new Map();
  private _sortedRules: AccessRule[] = [];
  private _options: Required<AccessRuleEngineOptions>;
  private _executionCache: Map<string, RuleExecutionResult> = new Map();
  private _executionHistory: Array<{ timestamp: number; ruleId: string; matched: boolean }> = [];

  constructor(options: AccessRuleEngineOptions = {}) {
    this._options = {
      maxRules: options.maxRules ?? 100,
      executionTimeoutMs: options.executionTimeoutMs ?? 5000,
      enableRuleCache: options.enableRuleCache ?? true,
      defaultAction: options.defaultAction ?? 'allow'
    };
  }

  /**
   * 注册规则
   */
  public registerRule(rule: AccessRule): boolean {
    if (this._rules.size >= this._options.maxRules) {
      console.warn(`规则数量已达上限: ${this._options.maxRules}`);
      return false;
    }

    // 验证规则
    if (!this._validateRule(rule)) {
      console.error(`规则验证失败: ${rule.id}`);
      return false;
    }

    this._rules.set(rule.id, rule);
    this._sortRules();
    this._clearCache();
    return true;
  }

  /**
   * 批量注册规则
   */
  public registerRules(rules: AccessRule[]): { success: string[]; failed: string[] } {
    const success: string[] = [];
    const failed: string[] = [];

    for (const rule of rules) {
      if (this.registerRule(rule)) {
        success.push(rule.id);
      } else {
        failed.push(rule.id);
      }
    }

    return { success, failed };
  }

  /**
   * 移除规则
   */
  public removeRule(ruleId: string): boolean {
    const removed = this._rules.delete(ruleId);
    if (removed) {
      this._sortRules();
      this._clearCache();
    }
    return removed;
  }

  /**
   * 获取规则
   */
  public getRule(ruleId: string): AccessRule | undefined {
    return this._rules.get(ruleId);
  }

  /**
   * 获取所有规则
   */
  public getAllRules(): AccessRule[] {
    return [...this._sortedRules];
  }

  /**
   * 启用/禁用规则
   */
  public setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this._rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    this._sortRules();
    this._clearCache();
    return true;
  }

  /**
   * 执行规则引擎
   */
  public async execute(input: ModuleInput): Promise<RuleExecutionResult> {
    const startTime = Date.now();
    const cacheKey = this._generateCacheKey(input);

    // 检查缓存
    if (this._options.enableRuleCache) {
      const cached = this._executionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 60000) {
        return cached;
      }
    }

    // 按优先级执行规则
    for (const rule of this._sortedRules) {
      if (!rule.enabled) continue;

      const matched = await this._evaluateConditions(input, rule);
      this._executionHistory.push({ timestamp: Date.now(), ruleId: rule.id, matched });

      if (matched) {
        const result: RuleExecutionResult = {
          ruleId: rule.id,
          matched: true,
          action: rule.action,
          transformedInput: rule.action === 'transform' ? this._transformInput(input, rule) : undefined,
          executionTimeMs: Date.now() - startTime,
          timestamp: Date.now()
        };

        // 缓存结果
        if (this._options.enableRuleCache) {
          this._executionCache.set(cacheKey, result);
        }

        return result;
      }
    }

    // 默认动作
    const defaultResult: RuleExecutionResult = {
      ruleId: 'default',
      matched: false,
      action: this._options.defaultAction,
      executionTimeMs: Date.now() - startTime,
      timestamp: Date.now()
    };

    return defaultResult;
  }

  /**
   * 验证输入是否满足所有规则
   */
  public async validate(input: ModuleInput): Promise<{ valid: boolean; violations: string[] }> {
    const violations: string[] = [];

    for (const rule of this._sortedRules) {
      if (!rule.enabled) continue;

      const matched = await this._evaluateConditions(input, rule);
      if (matched && rule.action === 'deny') {
        violations.push(`规则 ${rule.name} (${rule.id}) 拒绝访问`);
      }
    }

    return { valid: violations.length === 0, violations };
  }

  /**
   * 获取执行历史
   */
  public getExecutionHistory(limit: number = 100): typeof this._executionHistory {
    return this._executionHistory.slice(-limit);
  }

  /**
   * 清空缓存
   */
  public clearCache(): void {
    this._executionCache.clear();
  }

  /**
   * 导出规则配置
   */
  public exportRules(): string {
    return JSON.stringify(Array.from(this._rules.values()), null, 2);
  }

  /**
   * 导入规则配置
   */
  public importRules(json: string): { success: number; failed: number } {
    try {
      const rules: AccessRule[] = JSON.parse(json);
      const result = this.registerRules(rules);
      return { success: result.success.length, failed: result.failed.length };
    } catch (error) {
      console.error('规则导入失败:', error);
      return { success: 0, failed: 0 };
    }
  }

  private _validateRule(rule: AccessRule): boolean {
    if (!rule.id || !rule.name) return false;
    if (!rule.conditions || rule.conditions.length === 0) return false;
    if (!['allow', 'deny', 'warn', 'log', 'transform'].includes(rule.action)) return false;
    if (!['and', 'or'].includes(rule.conditionLogic)) return false;
    return true;
  }

  private _sortRules(): void {
    this._sortedRules = Array.from(this._rules.values())
      .filter(r => r.enabled)
      .sort((a, b) => b.priority - a.priority);
  }

  private async _evaluateConditions(input: ModuleInput, rule: AccessRule): Promise<boolean> {
    const results: boolean[] = [];

    for (const condition of rule.conditions) {
      const result = await this._evaluateCondition(input, condition);
      results.push(result);
    }

    if (rule.conditionLogic === 'and') {
      return results.every(r => r);
    } else {
      return results.some(r => r);
    }
  }

  private async _evaluateCondition(input: ModuleInput, condition: RuleCondition): Promise<boolean> {
    const value = this._getFieldValue(input, condition.field);

    switch (condition.type) {
      case 'equals':
        return value === condition.value;
      case 'contains':
        if (typeof value === 'string') {
          return value.includes(String(condition.value));
        }
        if (Array.isArray(value)) {
          return value.includes(condition.value);
        }
        return false;
      case 'regex':
        if (typeof value === 'string' && condition.pattern) {
          return new RegExp(condition.pattern).test(value);
        }
        return false;
      case 'range':
        if (typeof value === 'number') {
          const min = condition.min ?? -Infinity;
          const max = condition.max ?? Infinity;
          return value >= min && value <= max;
        }
        return false;
      case 'exists':
        return value !== undefined && value !== null;
      case 'custom':
        if (condition.customEvaluator) {
          return await condition.customEvaluator(input);
        }
        return false;
      default:
        return false;
    }
  }

  private _getFieldValue(input: ModuleInput, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = input;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private _transformInput(input: ModuleInput, rule: AccessRule): ModuleInput {
    if (!rule.transformConfig) return input;

    // 简化的转换逻辑
    const transformed = { ...input };
    for (const [key, value] of Object.entries(rule.transformConfig)) {
      (transformed.metadata as Record<string, unknown>)[key] = value;
    }

    return transformed;
  }

  private _generateCacheKey(input: ModuleInput): string {
    return `cache_${input.inputId}_${input.dataType}`;
  }

  private _clearCache(): void {
    this._executionCache.clear();
  }
}

export default AccessRuleEngine;
