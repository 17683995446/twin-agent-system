/**
 * 第40阶段：规则配置管理界面
 * Rule Configuration Manager
 * 
 * 提供规则配置的完整管理功能：
 * - CRUD操作（创建、读取、更新、删除）
 * - 配置验证
 * - 导入导出（JSON/YAML）
 * - 版本管理
 * - 回滚功能
 * - 配置快照
 */

import { AccessRule, RuleCondition, RuleAction } from './AccessRuleEngine';

// 配置版本记录
export interface ConfigVersion {
  id: string;
  timestamp: number;
  rules: AccessRule[];
  checksum: string;
  description?: string;
  author?: string;
  tags?: string[];
}

// 配置验证结果
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

export interface ConfigValidationError {
  ruleId?: string;
  field: string;
  message: string;
  code: string;
}

export interface ConfigValidationWarning {
  ruleId?: string;
  field: string;
  message: string;
  suggestion?: string;
}

// 导入导出选项
export interface ExportOptions {
  format: 'json' | 'yaml';
  includeDisabled?: boolean;
  includeMetadata?: boolean;
  pretty?: boolean;
}

export interface ImportOptions {
  format: 'json' | 'yaml' | 'auto';
  merge?: boolean;
  overwrite?: boolean;
  validate?: boolean;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  rules: AccessRule[];
}

// 配置差异
export interface ConfigDiff {
  added: AccessRule[];
  removed: AccessRule[];
  modified: {
    rule: AccessRule;
    oldVersion: AccessRule;
    changes: string[];
  }[];
}

// 配置存储接口
export interface ConfigStorage {
  save(rules: AccessRule[]): Promise<void>;
  load(): Promise<AccessRule[]>;
  saveVersion(version: ConfigVersion): Promise<void>;
  loadVersions(): Promise<ConfigVersion[]>;
}

// 内存存储实现
export class MemoryConfigStorage implements ConfigStorage {
  private _rules: AccessRule[] = [];
  private _versions: ConfigVersion[] = [];

  async save(rules: AccessRule[]): Promise<void> {
    this._rules = [...rules];
  }

  async load(): Promise<AccessRule[]> {
    return [...this._rules];
  }

  async saveVersion(version: ConfigVersion): Promise<void> {
    this._versions.push(version);
  }

  async loadVersions(): Promise<ConfigVersion[]> {
    return [...this._versions];
  }
}

// 规则配置管理器
export class RuleConfigManager {
  private _rules: Map<string, AccessRule> = new Map();
  private _versions: ConfigVersion[] = [];
  private _currentVersionId: string | null = null;
  private _storage: ConfigStorage;
  private _maxVersions: number;
  private _changeListeners: Set<(event: ConfigChangeEvent) => void> = new Set();

  constructor(storage?: ConfigStorage, maxVersions: number = 50) {
    this._storage = storage || new MemoryConfigStorage();
    this._maxVersions = maxVersions;
  }

  // ==================== CRUD 操作 ====================

  /**
   * 创建新规则
   */
  public async createRule(rule: AccessRule): Promise<AccessRule> {
    // 验证规则
    const validation = this.validateRule(rule);
    if (!validation.valid) {
      throw new Error(`Invalid rule: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    // 检查ID冲突
    if (this._rules.has(rule.id)) {
      throw new Error(`Rule with ID '${rule.id}' already exists`);
    }

    // 添加规则
    this._rules.set(rule.id, { ...rule });
    
    // 触发变更事件
    this._notifyChange({
      type: 'create',
      ruleId: rule.id,
      rule: rule
    });

    return { ...rule };
  }

  /**
   * 读取规则
   */
  public getRule(ruleId: string): AccessRule | undefined {
    const rule = this._rules.get(ruleId);
    return rule ? { ...rule } : undefined;
  }

  /**
   * 读取所有规则
   */
  public getAllRules(): AccessRule[] {
    return Array.from(this._rules.values()).map(rule => ({ ...rule }));
  }

  /**
   * 获取启用的规则
   */
  public getEnabledRules(): AccessRule[] {
    return this.getAllRules().filter(rule => rule.enabled);
  }

  /**
   * 更新规则
   */
  public async updateRule(ruleId: string, updates: Partial<AccessRule>): Promise<AccessRule> {
    const existingRule = this._rules.get(ruleId);
    if (!existingRule) {
      throw new Error(`Rule '${ruleId}' not found`);
    }

    // 合并更新
    const updatedRule: AccessRule = {
      ...existingRule,
      ...updates,
      id: ruleId // 确保ID不被修改
    };

    // 验证更新后的规则
    const validation = this.validateRule(updatedRule);
    if (!validation.valid) {
      throw new Error(`Invalid rule update: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    // 应用更新
    this._rules.set(ruleId, updatedRule);

    // 触发变更事件
    this._notifyChange({
      type: 'update',
      ruleId: ruleId,
      rule: updatedRule,
      oldRule: existingRule
    });

    return { ...updatedRule };
  }

  /**
   * 删除规则
   */
  public async deleteRule(ruleId: string): Promise<boolean> {
    const rule = this._rules.get(ruleId);
    if (!rule) {
      return false;
    }

    this._rules.delete(ruleId);

    // 触发变更事件
    this._notifyChange({
      type: 'delete',
      ruleId: ruleId,
      rule: rule
    });

    return true;
  }

  /**
   * 批量删除规则
   */
  public async deleteRules(ruleIds: string[]): Promise<{ deleted: string[]; notFound: string[] }> {
    const deleted: string[] = [];
    const notFound: string[] = [];

    for (const ruleId of ruleIds) {
      if (await this.deleteRule(ruleId)) {
        deleted.push(ruleId);
      } else {
        notFound.push(ruleId);
      }
    }

    return { deleted, notFound };
  }

  /**
   * 启用/禁用规则
   */
  public async setRuleEnabled(ruleId: string, enabled: boolean): Promise<AccessRule> {
    return this.updateRule(ruleId, { enabled });
  }

  // ==================== 配置验证 ====================

  /**
   * 验证单个规则
   */
  public validateRule(rule: AccessRule): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];
    const warnings: ConfigValidationWarning[] = [];

    // ID验证
    if (!rule.id || typeof rule.id !== 'string') {
      errors.push({
        ruleId: rule.id,
        field: 'id',
        message: 'Rule ID is required and must be a string',
        code: 'INVALID_ID'
      });
    } else if (!/^[a-zA-Z0-9_-]+$/.test(rule.id)) {
      errors.push({
        ruleId: rule.id,
        field: 'id',
        message: 'Rule ID can only contain letters, numbers, underscores, and hyphens',
        code: 'INVALID_ID_FORMAT'
      });
    }

    // 名称验证
    if (!rule.name || typeof rule.name !== 'string') {
      errors.push({
        ruleId: rule.id,
        field: 'name',
        message: 'Rule name is required',
        code: 'INVALID_NAME'
      });
    }

    // 优先级验证
    if (typeof rule.priority !== 'number' || rule.priority < 0) {
      errors.push({
        ruleId: rule.id,
        field: 'priority',
        message: 'Priority must be a non-negative number',
        code: 'INVALID_PRIORITY'
      });
    }

    // 条件验证
    if (!Array.isArray(rule.conditions)) {
      errors.push({
        ruleId: rule.id,
        field: 'conditions',
        message: 'Conditions must be an array',
        code: 'INVALID_CONDITIONS'
      });
    } else {
      rule.conditions.forEach((condition, index) => {
        const condErrors = this._validateCondition(condition, index);
        errors.push(...condErrors.map(e => ({
          ruleId: rule.id,
          ...e
        })));
      });

      if (rule.conditions.length === 0) {
        warnings.push({
          ruleId: rule.id,
          field: 'conditions',
          message: 'Rule has no conditions - will always match',
          suggestion: 'Consider adding conditions to limit rule scope'
        });
      }
    }

    // 动作验证
    if (!['allow', 'deny'].includes(rule.action)) {
      errors.push({
        ruleId: rule.id,
        field: 'action',
        message: 'Action must be either "allow" or "deny"',
        code: 'INVALID_ACTION'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证所有规则
   */
  public validateAllRules(): ConfigValidationResult {
    const allErrors: ConfigValidationError[] = [];
    const allWarnings: ConfigValidationWarning[] = [];
    const ruleIds = new Set<string>();

    for (const rule of this._rules.values()) {
      // 单个规则验证
      const result = this.validateRule(rule);
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);

      // ID重复检查
      if (ruleIds.has(rule.id)) {
        allErrors.push({
          ruleId: rule.id,
          field: 'id',
          message: `Duplicate rule ID: ${rule.id}`,
          code: 'DUPLICATE_ID'
        });
      }
      ruleIds.add(rule.id);
    }

    // 优先级冲突检查
    const priorities = new Map<number, string[]>();
    for (const rule of this._rules.values()) {
      const existing = priorities.get(rule.priority) || [];
      existing.push(rule.id);
      priorities.set(rule.priority, existing);
    }

    for (const [priority, ruleIds] of priorities) {
      if (ruleIds.length > 1) {
        allWarnings.push({
          field: 'priority',
          message: `Multiple rules have the same priority ${priority}: ${ruleIds.join(', ')}`,
          suggestion: 'Consider adjusting priorities to ensure deterministic execution order'
        });
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings
    };
  }

  private _validateCondition(condition: RuleCondition, index: number): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    if (!condition.field || typeof condition.field !== 'string') {
      errors.push({
        field: `conditions[${index}].field`,
        message: 'Condition field is required',
        code: 'INVALID_CONDITION_FIELD'
      });
    }

    const validOperators = ['equals', 'notEquals', 'contains', 'notContains', 'regex', 'range', 'exists', 'custom'];
    if (!validOperators.includes(condition.operator)) {
      errors.push({
        field: `conditions[${index}].operator`,
        message: `Invalid operator: ${condition.operator}`,
        code: 'INVALID_OPERATOR'
      });
    }

    if (condition.operator === 'regex') {
      try {
        new RegExp(condition.value as string);
      } catch (e) {
        errors.push({
          field: `conditions[${index}].value`,
          message: `Invalid regex pattern: ${condition.value}`,
          code: 'INVALID_REGEX'
        });
      }
    }

    return errors;
  }

  // ==================== 导入导出 ====================

  /**
   * 导出规则配置
   */
  public async exportRules(options: ExportOptions): Promise<string> {
    let rules = this.getAllRules();

    // 过滤禁用规则
    if (!options.includeDisabled) {
      rules = rules.filter(r => r.enabled);
    }

    const exportData: any = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      rules: rules
    };

    if (options.includeMetadata) {
      exportData.metadata = {
        totalRules: rules.length,
        enabledRules: rules.filter(r => r.enabled).length,
        checksum: this._calculateChecksum(rules)
      };
    }

    if (options.format === 'yaml') {
      return this._toYaml(exportData, options.pretty);
    } else {
      return JSON.stringify(exportData, null, options.pretty ? 2 : 0);
    }
  }

  /**
   * 导入规则配置
   */
  public async importRules(data: string, options: ImportOptions): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      imported: 0,
      skipped: 0,
      errors: [],
      rules: []
    };

    try {
      // 解析数据
      let parsed: any;
      const format = options.format === 'auto' ? this._detectFormat(data) : options.format;

      if (format === 'yaml') {
        parsed = this._parseYaml(data);
      } else {
        parsed = JSON.parse(data);
      }

      const importedRules: AccessRule[] = parsed.rules || [];

      // 验证规则
      if (options.validate !== false) {
        for (const rule of importedRules) {
          const validation = this.validateRule(rule);
          if (!validation.valid) {
            result.errors.push(`Rule '${rule.id}': ${validation.errors.map(e => e.message).join(', ')}`);
          }
        }
      }

      if (result.errors.length > 0 && !options.merge) {
        return result;
      }

      // 导入规则
      for (const rule of importedRules) {
        const existing = this._rules.has(rule.id);

        if (existing && !options.overwrite && !options.merge) {
          result.skipped++;
          continue;
        }

        if (existing && options.overwrite) {
          await this.updateRule(rule.id, rule);
        } else if (!existing) {
          await this.createRule(rule);
        } else {
          // merge模式：跳过已存在的规则
          result.skipped++;
          continue;
        }

        result.imported++;
        result.rules.push(rule);
      }

      result.success = true;
    } catch (error) {
      result.errors.push(`Import failed: ${error}`);
    }

    return result;
  }

  private _detectFormat(data: string): 'json' | 'yaml' {
    const trimmed = data.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return 'json';
    }
    return 'yaml';
  }

  private _toYaml(data: any, pretty?: boolean): string {
    // 简化YAML转换（生产环境应使用专业库）
    const lines: string[] = [];
    
    const toYamlValue = (value: any, indent: number = 0): string[] => {
      const result: string[] = [];
      const prefix = '  '.repeat(indent);
      
      if (value === null || value === undefined) {
        result.push(`${prefix}null`);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'object' && v !== null) {
            result.push(`${prefix}${k}:`);
            result.push(...toYamlValue(v, indent + 1));
          } else {
            result.push(`${prefix}${k}: ${JSON.stringify(v)}`);
          }
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object') {
            result.push(`${prefix}-`);
            result.push(...toYamlValue(item, indent + 1).map(l => l.startsWith('  '.repeat(indent + 1)) ? l : `${prefix}  ${l.trim()}`));
          } else {
            result.push(`${prefix}- ${JSON.stringify(item)}`);
          }
        }
      } else {
        result.push(`${prefix}${JSON.stringify(value)}`);
      }
      
      return result;
    };

    lines.push(...toYamlValue(data));
    return lines.join('\n');
  }

  private _parseYaml(data: string): any {
    // 简化YAML解析（生产环境应使用专业库）
    // 这里仅支持简单格式，实际使用应集成js-yaml等库
    throw new Error('YAML parsing requires a YAML library. Please use JSON format or install js-yaml.');
  }

  // ==================== 版本管理 ====================

  /**
   * 创建配置版本快照
   */
  public async createVersion(description?: string, author?: string, tags?: string[]): Promise<ConfigVersion> {
    const rules = this.getAllRules();
    const version: ConfigVersion = {
      id: this._generateVersionId(),
      timestamp: Date.now(),
      rules: rules,
      checksum: this._calculateChecksum(rules),
      description,
      author,
      tags
    };

    this._versions.push(version);
    this._currentVersionId = version.id;

    // 限制版本数量
    if (this._versions.length > this._maxVersions) {
      this._versions = this._versions.slice(-this._maxVersions);
    }

    // 持久化
    await this._storage.saveVersion(version);

    return version;
  }

  /**
   * 获取所有版本
   */
  public getVersions(): ConfigVersion[] {
    return [...this._versions];
  }

  /**
   * 获取特定版本
   */
  public getVersion(versionId: string): ConfigVersion | undefined {
    return this._versions.find(v => v.id === versionId);
  }

  /**
   * 获取当前版本
   */
  public getCurrentVersion(): ConfigVersion | undefined {
    if (!this._currentVersionId) return undefined;
    return this.getVersion(this._currentVersionId);
  }

  /**
   * 回滚到指定版本
   */
  public async rollbackToVersion(versionId: string): Promise<boolean> {
    const version = this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version '${versionId}' not found`);
    }

    // 清空当前规则
    this._rules.clear();

    // 恢复版本规则
    for (const rule of version.rules) {
      this._rules.set(rule.id, { ...rule });
    }

    this._currentVersionId = versionId;

    // 触发变更事件
    this._notifyChange({
      type: 'rollback',
      versionId: versionId
    });

    return true;
  }

  /**
   * 比较两个版本的差异
   */
  public compareVersions(versionId1: string, versionId2: string): ConfigDiff {
    const v1 = this.getVersion(versionId1);
    const v2 = this.getVersion(versionId2);

    if (!v1 || !v2) {
      throw new Error('One or both versions not found');
    }

    const rules1Map = new Map(v1.rules.map(r => [r.id, r]));
    const rules2Map = new Map(v2.rules.map(r => [r.id, r]));

    const diff: ConfigDiff = {
      added: [],
      removed: [],
      modified: []
    };

    // 找出新增和修改的规则
    for (const [id, rule] of rules2Map) {
      if (!rules1Map.has(id)) {
        diff.added.push(rule);
      } else {
        const oldRule = rules1Map.get(id)!;
        const changes = this._findRuleChanges(oldRule, rule);
        if (changes.length > 0) {
          diff.modified.push({ rule, oldVersion: oldRule, changes });
        }
      }
    }

    // 找出删除的规则
    for (const [id, rule] of rules1Map) {
      if (!rules2Map.has(id)) {
        diff.removed.push(rule);
      }
    }

    return diff;
  }

  private _findRuleChanges(oldRule: AccessRule, newRule: AccessRule): string[] {
    const changes: string[] = [];

    if (oldRule.name !== newRule.name) changes.push('name');
    if (oldRule.priority !== newRule.priority) changes.push('priority');
    if (oldRule.action !== newRule.action) changes.push('action');
    if (oldRule.enabled !== newRule.enabled) changes.push('enabled');
    if (JSON.stringify(oldRule.conditions) !== JSON.stringify(newRule.conditions)) {
      changes.push('conditions');
    }

    return changes;
  }

  // ==================== 工具方法 ====================

  /**
   * 搜索规则
   */
  public searchRules(query: {
    name?: string;
    action?: RuleAction;
    enabled?: boolean;
    minPriority?: number;
    maxPriority?: number;
    tags?: string[];
  }): AccessRule[] {
    let rules = this.getAllRules();

    if (query.name) {
      const nameLower = query.name.toLowerCase();
      rules = rules.filter(r => r.name.toLowerCase().includes(nameLower));
    }

    if (query.action) {
      rules = rules.filter(r => r.action === query.action);
    }

    if (query.enabled !== undefined) {
      rules = rules.filter(r => r.enabled === query.enabled);
    }

    if (query.minPriority !== undefined) {
      rules = rules.filter(r => r.priority >= query.minPriority!);
    }

    if (query.maxPriority !== undefined) {
      rules = rules.filter(r => r.priority <= query.maxPriority!);
    }

    return rules;
  }

  /**
   * 克隆规则
   */
  public async cloneRule(ruleId: string, newId: string): Promise<AccessRule> {
    const original = this.getRule(ruleId);
    if (!original) {
      throw new Error(`Rule '${ruleId}' not found`);
    }

    const cloned: AccessRule = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`
    };

    return this.createRule(cloned);
  }

  /**
   * 批量更新优先级
   */
  public async updatePriorities(updates: { ruleId: string; priority: number }[]): Promise<void> {
    for (const update of updates) {
      await this.updateRule(update.ruleId, { priority: update.priority });
    }
  }

  /**
   * 添加变更监听器
   */
  public addChangeListener(listener: (event: ConfigChangeEvent) => void): () => void {
    this._changeListeners.add(listener);
    return () => this._changeListeners.delete(listener);
  }

  // ==================== 持久化 ====================

  /**
   * 保存配置到存储
   */
  public async save(): Promise<void> {
    await this._storage.save(this.getAllRules());
  }

  /**
   * 从存储加载配置
   */
  public async load(): Promise<void> {
    const rules = await this._storage.load();
    this._rules.clear();
    for (const rule of rules) {
      this._rules.set(rule.id, rule);
    }
  }

  // ==================== 私有方法 ====================

  private _generateVersionId(): string {
    return `v${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private _calculateChecksum(rules: AccessRule[]): string {
    const content = JSON.stringify(rules.map(r => ({
      id: r.id,
      name: r.name,
      priority: r.priority,
      conditions: r.conditions,
      action: r.action,
      enabled: r.enabled
    })));
    
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private _notifyChange(event: ConfigChangeEvent): void {
    for (const listener of this._changeListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Config change listener error:', error);
      }
    }
  }
}

// 配置变更事件
export interface ConfigChangeEvent {
  type: 'create' | 'update' | 'delete' | 'rollback';
  ruleId?: string;
  rule?: AccessRule;
  oldRule?: AccessRule;
  versionId?: string;
}

// 导出工厂函数
export function createRuleConfigManager(storage?: ConfigStorage, maxVersions?: number): RuleConfigManager {
  return new RuleConfigManager(storage, maxVersions);
}
