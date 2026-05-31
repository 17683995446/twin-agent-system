/**
 * 超长任务Agent树形双生子模块化执行系统
 * 实时违规检测器 - 第35阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ModuleInput, ModuleOutput, ModuleState } from './interfaces';

/**
 * 违规类型
 */
export type ViolationType = 
  | 'rate_limit' 
  | 'resource_overuse' 
  | 'invalid_operation' 
  | 'security_breach' 
  | 'policy_violation'
  | 'dead_loop';

/**
 * 违规严重程度
 */
export type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * 违规记录
 */
export interface ViolationRecord {
  id: string;
  timestamp: number;
  type: ViolationType;
  severity: ViolationSeverity;
  moduleId: string;
  inputId?: string;
  message: string;
  details?: Record<string, unknown>;
  suggestedAction?: string;
}

/**
 * 检测规则
 */
export interface DetectionRule {
  id: string;
  name: string;
  type: ViolationType;
  severity: ViolationSeverity;
  enabled: boolean;
  evaluate: (context: DetectionContext) => boolean | Promise<boolean>;
  message: string;
  suggestedAction?: string;
}

/**
 * 检测上下文
 */
export interface DetectionContext {
  input: ModuleInput;
  output?: ModuleOutput;
  state: ModuleState;
  executionHistory: Array<{ timestamp: number; inputId: string; status: string }>;
  resourceUsage: { cpu: number; memory: number; duration: number };
}

/**
 * 检测器配置
 */
export interface ViolationDetectorOptions {
  maxViolations?: number;
  autoBlock?: boolean;
  blockThreshold?: ViolationSeverity;
  alertOnViolation?: boolean;
}

/**
 * 实时违规检测器
 * 
 * 职责：
 * 1. 执行过程中的实时违规行为检测
 * 2. 多维度违规识别（速率、资源、安全、策略）
 * 3. 自动阻断与告警
 */
export class ViolationDetector {
  private _rules: Map<string, DetectionRule> = new Map();
  private _violations: ViolationRecord[] = [];
  private _options: Required<ViolationDetectorOptions>;
  private _executionHistory: DetectionContext['executionHistory'] = [];

  constructor(options: ViolationDetectorOptions = {}) {
    this._options = {
      maxViolations: options.maxViolations ?? 1000,
      autoBlock: options.autoBlock ?? true,
      blockThreshold: options.blockThreshold ?? 'high',
      alertOnViolation: options.alertOnViolation ?? true
    };
    this._initDefaultRules();
  }

  /**
   * 注册检测规则
   */
  public registerRule(rule: DetectionRule): void {
    this._rules.set(rule.id, rule);
  }

  /**
   * 移除检测规则
   */
  public removeRule(ruleId: string): boolean {
    return this._rules.delete(ruleId);
  }

  /**
   * 启用/禁用规则
   */
  public setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this._rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    return true;
  }

  /**
   * 执行检测
   */
  public async detect(context: DetectionContext): Promise<ViolationRecord[]> {
    const detected: ViolationRecord[] = [];

    for (const rule of this._rules.values()) {
      if (!rule.enabled) continue;

      try {
        const violated = await rule.evaluate(context);
        if (violated) {
          const record: ViolationRecord = {
            id: `vio_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            timestamp: Date.now(),
            type: rule.type,
            severity: rule.severity,
            moduleId: context.state.moduleId,
            inputId: context.input.inputId,
            message: rule.message,
            details: { ruleId: rule.id },
            suggestedAction: rule.suggestedAction
          };
          detected.push(record);
          this._violations.push(record);

          // 触发告警
          if (this._options.alertOnViolation) {
            this._alert(record);
          }
        }
      } catch (error) {
        console.error(`规则 ${rule.id} 执行失败:`, error);
      }
    }

    // 更新执行历史
    this._executionHistory.push({
      timestamp: Date.now(),
      inputId: context.input.inputId,
      status: detected.length > 0 ? 'violation' : 'normal'
    });

    // 清理旧数据
    this._cleanup();

    return detected;
  }

  /**
   * 检查是否应该阻断
   */
  public shouldBlock(): boolean {
    if (!this._options.autoBlock) return false;

    const severityOrder: ViolationSeverity[] = ['low', 'medium', 'high', 'critical'];
    const thresholdIndex = severityOrder.indexOf(this._options.blockThreshold);

    // 检查最近是否有达到阈值的违规
    const recentViolations = this._violations.slice(-10);
    return recentViolations.some(v => 
      severityOrder.indexOf(v.severity) >= thresholdIndex
    );
  }

  /**
   * 获取违规记录
   */
  public getViolations(
    filters?: { type?: ViolationType; severity?: ViolationSeverity; moduleId?: string },
    limit: number = 100
  ): ViolationRecord[] {
    let result = [...this._violations];

    if (filters?.type) {
      result = result.filter(v => v.type === filters.type);
    }
    if (filters?.severity) {
      result = result.filter(v => v.severity === filters.severity);
    }
    if (filters?.moduleId) {
      result = result.filter(v => v.moduleId === filters.moduleId);
    }

    return result.slice(-limit);
  }

  /**
   * 获取违规统计
   */
  public getStatistics(): Record<ViolationType, number> {
    const stats: Record<string, number> = {};
    for (const v of this._violations) {
      stats[v.type] = (stats[v.type] || 0) + 1;
    }
    return stats as Record<ViolationType, number>;
  }

  /**
   * 清空违规记录
   */
  public clearViolations(): void {
    this._violations = [];
  }

  /**
   * 获取执行历史
   */
  public getExecutionHistory(limit: number = 100): typeof this._executionHistory {
    return this._executionHistory.slice(-limit);
  }

  private _initDefaultRules(): void {
    // 速率限制规则
    this.registerRule({
      id: 'rate-limit-check',
      name: '执行频率检查',
      type: 'rate_limit',
      severity: 'medium',
      enabled: true,
      evaluate: (ctx) => {
        const recentCount = this._executionHistory.filter(
          h => Date.now() - h.timestamp < 60000
        ).length;
        return recentCount > 100;
      },
      message: '执行频率过高，可能触发速率限制',
      suggestedAction: 'throttle'
    });

    // 资源使用规则
    this.registerRule({
      id: 'resource-overuse',
      name: '资源过度使用检查',
      type: 'resource_overuse',
      severity: 'high',
      enabled: true,
      evaluate: (ctx) => ctx.resourceUsage.memory > 80 || ctx.resourceUsage.cpu > 90,
      message: '资源使用率过高',
      suggestedAction: 'scale_down'
    });

    // 死循环检测
    this.registerRule({
      id: 'dead-loop-check',
      name: '死循环检测',
      type: 'dead_loop',
      severity: 'critical',
      enabled: true,
      evaluate: (ctx) => {
        const sameInputCount = this._executionHistory.filter(
          h => h.inputId === ctx.input.inputId && Date.now() - h.timestamp < 30000
        ).length;
        return sameInputCount > 5;
      },
      message: '检测到可能的死循环',
      suggestedAction: 'terminate'
    });
  }

  private _alert(record: ViolationRecord): void {
    console.warn(`[违规告警] ${record.severity.toUpperCase()}: ${record.message} (模块: ${record.moduleId})`);
  }

  private _cleanup(): void {
    if (this._violations.length > this._options.maxViolations) {
      this._violations = this._violations.slice(-this._options.maxViolations / 2);
    }
    if (this._executionHistory.length > 1000) {
      this._executionHistory = this._executionHistory.slice(-500);
    }
  }
}

export default ViolationDetector;
