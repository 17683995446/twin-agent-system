/**
 * 超长任务Agent树形双生子模块化执行系统
 * 行为修正指令生成器 - 第36阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ViolationRecord, ViolationType, ViolationSeverity } from './ViolationDetector';

/**
 * 修正动作类型
 */
export type CorrectionAction = 
  | 'retry' 
  | 'skip' 
  | 'rollback' 
  | 'throttle' 
  | 'escalate' 
  | 'terminate' 
  | 'notify';

/**
 * 修正指令
 */
export interface CorrectionCommand {
  id: string;
  timestamp: number;
  violationId: string;
  action: CorrectionAction;
  priority: number;
  parameters: Record<string, unknown>;
  reason: string;
  autoExecute: boolean;
}

/**
 * 修正策略
 */
export interface CorrectionStrategy {
  id: string;
  name: string;
  applicableTypes: ViolationType[];
  applicableSeverities: ViolationSeverity[];
  action: CorrectionAction;
  priority: number;
  parameters: Record<string, unknown>;
  generateCommand: (violation: ViolationRecord) => CorrectionCommand;
}

/**
 * 修正结果
 */
export interface CorrectionResult {
  success: boolean;
  commandId: string;
  executedAt: number;
  outcome?: string;
  error?: string;
}

/**
 * 行为修正指令生成器
 * 
 * 职责：
 * 1. 根据违规检测结果生成修正指令
 * 2. 策略匹配与优先级排序
 * 3. 指令执行与结果追踪
 */
export class CorrectionGenerator {
  private _strategies: Map<string, CorrectionStrategy> = new Map();
  private _commands: CorrectionCommand[] = [];
  private _results: CorrectionResult[] = [];

  constructor() {
    this._initDefaultStrategies();
  }

  /**
   * 注册修正策略
   */
  public registerStrategy(strategy: CorrectionStrategy): void {
    this._strategies.set(strategy.id, strategy);
  }

  /**
   * 移除修正策略
   */
  public removeStrategy(strategyId: string): boolean {
    return this._strategies.delete(strategyId);
  }

  /**
   * 生成修正指令
   */
  public generateCommand(violation: ViolationRecord): CorrectionCommand | null {
    // 查找适用的策略
    const applicableStrategies: CorrectionStrategy[] = [];

    for (const strategy of this._strategies.values()) {
      if (
        strategy.applicableTypes.includes(violation.type) &&
        strategy.applicableSeverities.includes(violation.severity)
      ) {
        applicableStrategies.push(strategy);
      }
    }

    if (applicableStrategies.length === 0) {
      return null;
    }

    // 按优先级排序，选择最高优先级的策略
    applicableStrategies.sort((a, b) => b.priority - a.priority);
    const selectedStrategy = applicableStrategies[0];

    // 生成指令
    const command = selectedStrategy.generateCommand(violation);
    this._commands.push(command);

    return command;
  }

  /**
   * 批量生成修正指令
   */
  public generateCommands(violations: ViolationRecord[]): CorrectionCommand[] {
    const commands: CorrectionCommand[] = [];
    for (const violation of violations) {
      const command = this.generateCommand(violation);
      if (command) {
        commands.push(command);
      }
    }
    return commands.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 执行修正指令
   */
  public async executeCommand(command: CorrectionCommand): Promise<CorrectionResult> {
    const startTime = Date.now();

    try {
      // 根据动作类型执行不同的修正逻辑
      let outcome: string;

      switch (command.action) {
        case 'retry':
          outcome = `重试操作，延迟 ${command.parameters.delayMs || 1000}ms`;
          break;
        case 'skip':
          outcome = '跳过当前操作';
          break;
        case 'rollback':
          outcome = `回滚到状态 ${command.parameters.targetState || 'previous'}`;
          break;
        case 'throttle':
          outcome = `降低速率至 ${command.parameters.rate || 50}%`;
          break;
        case 'escalate':
          outcome = `升级处理至 ${command.parameters.target || 'admin'}`;
          break;
        case 'terminate':
          outcome = '终止当前任务';
          break;
        case 'notify':
          outcome = `发送通知给 ${command.parameters.recipients || 'admin'}`;
          break;
        default:
          outcome = '执行默认修正';
      }

      const result: CorrectionResult = {
        success: true,
        commandId: command.id,
        executedAt: Date.now(),
        outcome
      };

      this._results.push(result);
      return result;
    } catch (error) {
      const result: CorrectionResult = {
        success: false,
        commandId: command.id,
        executedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      };
      this._results.push(result);
      return result;
    }
  }

  /**
   * 获取待执行的自动指令
   */
  public getPendingAutoCommands(): CorrectionCommand[] {
    return this._commands.filter(c => c.autoExecute);
  }

  /**
   * 获取指令历史
   */
  public getCommandHistory(limit: number = 100): CorrectionCommand[] {
    return this._commands.slice(-limit);
  }

  /**
   * 获取执行结果
   */
  public getResults(limit: number = 100): CorrectionResult[] {
    return this._results.slice(-limit);
  }

  /**
   * 获取统计信息
   */
  public getStatistics(): { total: number; success: number; failed: number } {
    return {
      total: this._results.length,
      success: this._results.filter(r => r.success).length,
      failed: this._results.filter(r => !r.success).length
    };
  }

  private _initDefaultStrategies(): void {
    // 速率限制策略
    this.registerStrategy({
      id: 'strategy-rate-limit',
      name: '速率限制策略',
      applicableTypes: ['rate_limit'],
      applicableSeverities: ['low', 'medium'],
      action: 'throttle',
      priority: 100,
      parameters: { rate: 50, durationMs: 60000 },
      generateCommand: (violation) => ({
        id: `cmd_${Date.now()}_rate`,
        timestamp: Date.now(),
        violationId: violation.id,
        action: 'throttle',
        priority: 100,
        parameters: { rate: 50, durationMs: 60000 },
        reason: `因 ${violation.message} 触发速率限制`,
        autoExecute: true
      })
    });

    // 资源过度使用策略
    this.registerStrategy({
      id: 'strategy-resource',
      name: '资源优化策略',
      applicableTypes: ['resource_overuse'],
      applicableSeverities: ['medium', 'high'],
      action: 'throttle',
      priority: 90,
      parameters: { scaleFactor: 0.7 },
      generateCommand: (violation) => ({
        id: `cmd_${Date.now()}_resource`,
        timestamp: Date.now(),
        violationId: violation.id,
        action: 'throttle',
        priority: 90,
        parameters: { scaleFactor: 0.7 },
        reason: `因 ${violation.message} 降低资源使用`,
        autoExecute: true
      })
    });

    // 死循环策略
    this.registerStrategy({
      id: 'strategy-dead-loop',
      name: '死循环处理策略',
      applicableTypes: ['dead_loop'],
      applicableSeverities: ['critical'],
      action: 'terminate',
      priority: 1000,
      parameters: { force: true },
      generateCommand: (violation) => ({
        id: `cmd_${Date.now()}_loop`,
        timestamp: Date.now(),
        violationId: violation.id,
        action: 'terminate',
        priority: 1000,
        parameters: { force: true, notify: true },
        reason: `因 ${violation.message} 强制终止任务`,
        autoExecute: true
      })
    });

    // 安全违规策略
    this.registerStrategy({
      id: 'strategy-security',
      name: '安全违规处理策略',
      applicableTypes: ['security_breach'],
      applicableSeverities: ['high', 'critical'],
      action: 'escalate',
      priority: 950,
      parameters: { target: 'security_team' },
      generateCommand: (violation) => ({
        id: `cmd_${Date.now()}_security`,
        timestamp: Date.now(),
        violationId: violation.id,
        action: 'escalate',
        priority: 950,
        parameters: { target: 'security_team', logLevel: 'critical' },
        reason: `因 ${violation.message} 升级至安全团队`,
        autoExecute: false
      })
    });
  }
}

export default CorrectionGenerator;
