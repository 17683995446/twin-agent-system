/**
 * 超长任务Agent树形双生子模块化执行系统
 * 准入日志审计 - 第38阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ModuleInput } from './interfaces';

/**
 * 审计事件类型
 */
export type AuditEventType = 
  | 'access_attempt' 
  | 'access_granted' 
  | 'access_denied' 
  | 'rule_evaluated' 
  | 'permission_checked'
  | 'violation_detected'
  | 'correction_applied';

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  userId?: string;
  moduleId: string;
  inputId?: string;
  details: {
    ruleId?: string;
    permission?: string;
    violationType?: string;
    correctionAction?: string;
    [key: string]: unknown;
  };
  result: 'success' | 'failure' | 'blocked' | 'warning';
  ip?: string;
  userAgent?: string;
}

/**
 * 审计查询条件
 */
export interface AuditQuery {
  startTime?: number;
  endTime?: number;
  eventTypes?: AuditEventType[];
  userId?: string;
  moduleId?: string;
  result?: AuditLogEntry['result'];
}

/**
 * 审计统计
 */
export interface AuditStatistics {
  totalEvents: number;
  grantedCount: number;
  deniedCount: number;
  violationCount: number;
  byType: Record<AuditEventType, number>;
  byResult: Record<AuditLogEntry['result'], number>;
}

/**
 * 审计日志存储接口
 */
export interface AuditStorage {
  save(entry: AuditLogEntry): Promise<void>;
  query(query: AuditQuery): Promise<AuditLogEntry[]>;
  getStatistics(startTime: number, endTime: number): Promise<AuditStatistics>;
}

/**
 * 内存审计存储
 */
export class MemoryAuditStorage implements AuditStorage {
  private _logs: AuditLogEntry[] = [];
  private _maxSize: number;

  constructor(maxSize: number = 10000) {
    this._maxSize = maxSize;
  }

  async save(entry: AuditLogEntry): Promise<void> {
    this._logs.push(entry);
    if (this._logs.length > this._maxSize) {
      this._logs = this._logs.slice(-this._maxSize / 2);
    }
  }

  async query(query: AuditQuery): Promise<AuditLogEntry[]> {
    return this._logs.filter(log => {
      if (query.startTime && log.timestamp < query.startTime) return false;
      if (query.endTime && log.timestamp > query.endTime) return false;
      if (query.eventTypes && !query.eventTypes.includes(log.eventType)) return false;
      if (query.userId && log.userId !== query.userId) return false;
      if (query.moduleId && log.moduleId !== query.moduleId) return false;
      if (query.result && log.result !== query.result) return false;
      return true;
    });
  }

  async getStatistics(startTime: number, endTime: number): Promise<AuditStatistics> {
    const filtered = this._logs.filter(log => log.timestamp >= startTime && log.timestamp <= endTime);
    
    const byType: Record<string, number> = {};
    const byResult: Record<string, number> = {};

    for (const log of filtered) {
      byType[log.eventType] = (byType[log.eventType] || 0) + 1;
      byResult[log.result] = (byResult[log.result] || 0) + 1;
    }

    return {
      totalEvents: filtered.length,
      grantedCount: byResult['success'] || 0,
      deniedCount: byResult['failure'] || 0,
      violationCount: byType['violation_detected'] || 0,
      byType: byType as Record<AuditEventType, number>,
      byResult: byResult as Record<AuditLogEntry['result'], number>
    };
  }
}

/**
 * 准入日志审计器
 * 
 * 职责：
 * 1. 准入与权限操作的完整审计日志
 * 2. 日志查询与分析
 * 3. 审计报告生成
 * 4. 合规性检查
 */
export class AccessAuditLogger {
  private _storage: AuditStorage;
  private _enabled: boolean = true;

  constructor(storage?: AuditStorage) {
    this._storage = storage || new MemoryAuditStorage();
  }

  /**
   * 记录访问尝试
   */
  public async logAccessAttempt(
    input: ModuleInput,
    moduleId: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    if (!this._enabled) return;

    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      eventType: 'access_attempt',
      userId: input.metadata?.userId as string,
      moduleId,
      inputId: input.inputId,
      details: details || {},
      result: 'success',
      ip: input.metadata?.ip as string,
      userAgent: input.metadata?.userAgent as string
    };

    await this._storage.save(entry);
  }

  /**
   * 记录访问授权
   */
  public async logAccessGranted(
    input: ModuleInput,
    moduleId: string,
    ruleId?: string
  ): Promise<void> {
    if (!this._enabled) return;

    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      eventType: 'access_granted',
      userId: input.metadata?.userId as string,
      moduleId,
      inputId: input.inputId,
      details: { ruleId },
      result: 'success',
      ip: input.metadata?.ip as string
    };

    await this._storage.save(entry);
  }

  /**
   * 记录访问拒绝
   */
  public async logAccessDenied(
    input: ModuleInput,
    moduleId: string,
    reason: string,
    ruleId?: string
  ): Promise<void> {
    if (!this._enabled) return;

    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      eventType: 'access_denied',
      userId: input.metadata?.userId as string,
      moduleId,
      inputId: input.inputId,
      details: { reason, ruleId },
      result: 'failure',
      ip: input.metadata?.ip as string
    };

    await this._storage.save(entry);
  }

  /**
   * 记录权限检查
   */
  public async logPermissionCheck(
    userId: string,
    moduleId: string,
    permission: string,
    allowed: boolean
  ): Promise<void> {
    if (!this._enabled) return;

    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      eventType: 'permission_checked',
      userId,
      moduleId,
      details: { permission },
      result: allowed ? 'success' : 'failure'
    };

    await this._storage.save(entry);
  }

  /**
   * 记录违规检测
   */
  public async logViolation(
    moduleId: string,
    violationType: string,
    severity: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    if (!this._enabled) return;

    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      eventType: 'violation_detected',
      moduleId,
      details: { violationType, severity, ...details },
      result: 'blocked'
    };

    await this._storage.save(entry);
  }

  /**
   * 查询日志
   */
  public async query(query: AuditQuery): Promise<AuditLogEntry[]> {
    return this._storage.query(query);
  }

  /**
   * 获取统计信息
   */
  public async getStatistics(startTime: number, endTime: number): Promise<AuditStatistics> {
    return this._storage.getStatistics(startTime, endTime);
  }

  /**
   * 生成审计报告
   */
  public async generateReport(startTime: number, endTime: number): Promise<string> {
    const stats = await this.getStatistics(startTime, endTime);
    
    const report = [
      '=== 准入审计报告 ===',
      `时间范围: ${new Date(startTime).toISOString()} - ${new Date(endTime).toISOString()}`,
      '',
      '统计摘要:',
      `- 总事件数: ${stats.totalEvents}`,
      `- 授权成功: ${stats.grantedCount}`,
      `- 访问拒绝: ${stats.deniedCount}`,
      `- 违规检测: ${stats.violationCount}`,
      '',
      '事件类型分布:',
      ...Object.entries(stats.byType).map(([type, count]) => `  - ${type}: ${count}`),
      '',
      '结果分布:',
      ...Object.entries(stats.byResult).map(([result, count]) => `  - ${result}: ${count}`)
    ].join('\n');

    return report;
  }

  /**
   * 启用/禁用审计
   */
  public setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  /**
   * 导出日志
   */
  public async exportLogs(query: AuditQuery): Promise<string> {
    const logs = await this.query(query);
    return JSON.stringify(logs, null, 2);
  }
}

export default AccessAuditLogger;
