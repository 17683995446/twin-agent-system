/**
 * 第45阶段：执行监控
 * Execution Monitor
 * 
 * 实时监控执行过程并收集指标：
 * - 指标收集与聚合
 * - 阈值告警
 * - 执行时间线
 * - 健康仪表盘
 * - 历史数据查询
 */

import { ExecutionStatus, ExecutionPhase } from './ExecutionContext';
import { QueueItemStatus } from './ExecutionQueue';
import { StepStatus } from './StepExecutor';

// ==================== 指标定义 ====================

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  TIMER = 'timer'
}

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  tags: Record<string, string>;
  unit?: string;
}

export interface MetricAggregation {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

// ==================== 告警定义 ====================

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export interface AlertRule {
  id: string;
  name: string;
  metricName: string;
  condition: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq';
  threshold: number;
  severity: AlertSeverity;
  cooldown: number;       // 告警冷却时间（毫秒）
  enabled: boolean;
  message?: string;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  metricName: string;
  currentValue: number;
  threshold: number;
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

// ==================== 时间线定义 ====================

export enum TimelineEventType {
  TASK_CREATED = 'task_created',
  TASK_STARTED = 'task_started',
  TASK_COMPLETED = 'task_completed',
  TASK_FAILED = 'task_failed',
  TASK_CANCELLED = 'task_cancelled',
  STEP_STARTED = 'step_started',
  STEP_COMPLETED = 'step_completed',
  STEP_FAILED = 'step_failed',
  STEP_SKIPPED = 'step_skipped',
  STEP_RETRY = 'step_retry',
  PHASE_CHANGED = 'phase_changed',
  STATUS_CHANGED = 'status_changed',
  QUEUE_ENQUEUED = 'queue_enqueued',
  QUEUE_DEQUEUED = 'queue_dequeued',
  SCHEDULER_PAUSED = 'scheduler_paused',
  SCHEDULER_RESUMED = 'scheduler_resumed',
  ALERT_TRIGGERED = 'alert_triggered',
  SNAPSHOT_CREATED = 'snapshot_created',
  CHECKPOINT_REACHED = 'checkpoint_reached'
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: number;
  taskId?: string;
  stepId?: string;
  moduleId?: string;
  contextId?: string;
  data: Record<string, any>;
  level: 'info' | 'warn' | 'error' | 'debug';
}

// ==================== 健康检查 ====================

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  score: number;           // 0-100
  components: {
    queue: ComponentHealth;
    scheduler: ComponentHealth;
    executor: ComponentHealth;
    memory: ComponentHealth;
  };
  activeAlerts: number;
  lastCheckTime: number;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  score: number;
  details: Record<string, any>;
}

// ==================== 监控配置 ====================

export interface MonitorConfig {
  metricsRetention?: number;       // 指标保留时间（毫秒）
  timelineRetention?: number;      // 时间线保留时间（毫秒）
  maxAlerts?: number;              // 最大告警数
  healthCheckInterval?: number;    // 健康检查间隔
  aggregationWindow?: number;      // 聚合窗口
  enableTimeline?: boolean;         // 是否启用时间线
  enableAlerts?: boolean;          // 是否启用告警
}

// ==================== 执行监控器 ====================

export class ExecutionMonitor {
  private _config: Required<MonitorConfig>;
  private _metrics: Map<string, Metric[]> = new Map();
  private _counters: Map<string, number> = new Map();
  private _gauges: Map<string, number> = new Map();
  private _timers: Map<string, number[]> = new Map();
  private _timelines: TimelineEvent[] = [];
  private _alerts: Alert[] = [];
  private _alertRules: Map<string, AlertRule> = new Map();
  private _alertCooldowns: Map<string, number> = new Map();
  private _activeTimers: Map<string, number> = new Map();
  private _eventListeners: Set<(event: any) => void> = new Set();
  private _healthCheckTimer: NodeJS.Timeout | null = null;
  private _cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: MonitorConfig = {}) {
    this._config = {
      metricsRetention: config.metricsRetention ?? 3600000,     // 1小时
      timelineRetention: config.timelineRetention ?? 7200000,    // 2小时
      maxAlerts: config.maxAlerts ?? 1000,
      healthCheckInterval: config.healthCheckInterval ?? 30000,  // 30秒
      aggregationWindow: config.aggregationWindow ?? 60000,     // 1分钟
      enableTimeline: config.enableTimeline ?? true,
      enableAlerts: config.enableAlerts ?? true
    };

    this._initDefaultAlertRules();
    this._startHealthCheck();
    this._startCleanup();
  }

  // ==================== 指标收集 ====================

  /**
   * 记录计数器（只增不减）
   */
  public incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    const current = this._counters.get(name) || 0;
    this._counters.set(name, current + value);
    this._recordMetric(name, MetricType.COUNTER, current + value, tags);
  }

  /**
   * 减少计数器
   */
  public decrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    this.incrementCounter(name, -value, tags);
  }

  /**
   * 设置仪表值（可增可减）
   */
  public setGauge(name: string, value: number, tags?: Record<string, string>): void {
    this._gauges.set(name, value);
    this._recordMetric(name, MetricType.GAUGE, value, tags);
  }

  /**
   * 获取仪表值
   */
  public getGauge(name: string): number | undefined {
    return this._gauges.get(name);
  }

  /**
   * 开始计时
   */
  public startTimer(name: string): void {
    this._activeTimers.set(name, Date.now());
  }

  /**
   * 结束计时并记录
   */
  public endTimer(name: string, tags?: Record<string, string>): number | undefined {
    const startTime = this._activeTimers.get(name);
    if (startTime === undefined) return undefined;

    const duration = Date.now() - startTime;
    this._activeTimers.delete(name);

    const values = this._timers.get(name) || [];
    values.push(duration);
    this._timers.set(name, values);

    this._recordMetric(name, MetricType.TIMER, duration, tags, 'ms');
    return duration;
  }

  /**
   * 记录直方图值
   */
  public recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    const values = this._timers.get(name) || [];
    values.push(value);
    this._timers.set(name, values);
    this._recordMetric(name, MetricType.HISTOGRAM, value, tags);
  }

  /**
   * 获取计数器值
   */
  public getCounter(name: string): number {
    return this._counters.get(name) || 0;
  }

  /**
   * 获取计时器统计
   */
  public getTimerStats(name: string): MetricAggregation | null {
    const values = this._timers.get(name);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    return {
      name,
      count: sorted.length,
      sum: sorted.reduce((a, b) => a + b, 0),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  private _recordMetric(name: string, type: MetricType, value: number, tags?: Record<string, string>, unit?: string): void {
    const metric: Metric = {
      name,
      type,
      value,
      timestamp: Date.now(),
      tags: tags || {},
      unit
    };

    const metrics = this._metrics.get(name) || [];
    metrics.push(metric);
    this._metrics.set(name, metrics);

    // 检查告警
    if (this._config.enableAlerts) {
      this._checkAlerts(name, value);
    }
  }

  // ==================== 时间线 ====================

  /**
   * 记录时间线事件
   */
  public recordTimelineEvent(
    type: TimelineEventType,
    data: Record<string, any>,
    options: {
      taskId?: string;
      stepId?: string;
      moduleId?: string;
      contextId?: string;
      level?: 'info' | 'warn' | 'error' | 'debug';
    } = {}
  ): TimelineEvent {
    if (!this._config.enableTimeline) {
      return {} as TimelineEvent;
    }

    const event: TimelineEvent = {
      id: this._generateId(),
      type,
      timestamp: Date.now(),
      taskId: options.taskId,
      stepId: options.stepId,
      moduleId: options.moduleId,
      contextId: options.contextId,
      data,
      level: options.level || 'info'
    };

    this._timelines.push(event);
    return event;
  }

  /**
   * 获取时间线
   */
  public getTimeline(options: {
    taskId?: string;
    stepId?: string;
    startTime?: number;
    endTime?: number;
    types?: TimelineEventType[];
    limit?: number;
  } = {}): TimelineEvent[] {
    let events = [...this._timelines];

    if (options.taskId) {
      events = events.filter(e => e.taskId === options.taskId);
    }
    if (options.stepId) {
      events = events.filter(e => e.stepId === options.stepId);
    }
    if (options.startTime) {
      events = events.filter(e => e.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      events = events.filter(e => e.timestamp <= options.endTime!);
    }
    if (options.types) {
      events = events.filter(e => options.types!.includes(e.type));
    }
    if (options.limit) {
      events = events.slice(-options.limit);
    }

    return events;
  }

  /**
   * 获取任务的完整执行时间线
   */
  public getTaskTimeline(taskId: string): TimelineEvent[] {
    return this.getTimeline({ taskId });
  }

  // ==================== 告警 ====================

  /**
   * 注册告警规则
   */
  public registerAlertRule(rule: AlertRule): void {
    this._alertRules.set(rule.id, rule);
  }

  /**
   * 移除告警规则
   */
  public removeAlertRule(ruleId: string): boolean {
    return this._alertRules.delete(ruleId);
  }

  /**
   * 获取所有告警
   */
  public getAlerts(options: {
    severity?: AlertSeverity;
    acknowledged?: boolean;
    since?: number;
  } = {}): Alert[] {
    let alerts = [...this._alerts];

    if (options.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }
    if (options.acknowledged !== undefined) {
      alerts = alerts.filter(a => a.acknowledged === options.acknowledged);
    }
    if (options.since) {
      alerts = alerts.filter(a => a.timestamp >= options.since!);
    }

    return alerts;
  }

  /**
   * 获取未确认的告警
   */
  public getUnacknowledgedAlerts(): Alert[] {
    return this.getAlerts({ acknowledged: false });
  }

  /**
   * 确认告警
   */
  public acknowledgeAlert(alertId: string): boolean {
    const alert = this._alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * 清除已确认的告警
   */
  public clearAcknowledgedAlerts(): number {
    const before = this._alerts.length;
    this._alerts = this._alerts.filter(a => !a.acknowledged);
    return before - this._alerts.length;
  }

  private _checkAlerts(metricName: string, value: number): void {
    for (const rule of this._alertRules.values()) {
      if (!rule.enabled) continue;
      if (rule.metricName !== metricName) continue;

      // 冷却检查
      const lastAlert = this._alertCooldowns.get(rule.id);
      if (lastAlert && Date.now() - lastAlert < rule.cooldown) continue;

      // 条件检查
      let triggered = false;
      switch (rule.condition) {
        case 'gt': triggered = value > rule.threshold; break;
        case 'lt': triggered = value < rule.threshold; break;
        case 'gte': triggered = value >= rule.threshold; break;
        case 'lte': triggered = value <= rule.threshold; break;
        case 'eq': triggered = value === rule.threshold; break;
        case 'neq': triggered = value !== rule.threshold; break;
      }

      if (triggered) {
        this._triggerAlert(rule, value);
      }
    }
  }

  private _triggerAlert(rule: AlertRule, currentValue: number): void {
    const alert: Alert = {
      id: this._generateId(),
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      metricName: rule.metricName,
      currentValue,
      threshold: rule.threshold,
      message: rule.message || `Alert: ${rule.name} - ${rule.metricName} is ${currentValue} (${rule.condition} ${rule.threshold})`,
      timestamp: Date.now(),
      acknowledged: false
    };

    this._alerts.push(alert);
    this._alertCooldowns.set(rule.id, Date.now());

    // 限制告警数量
    if (this._alerts.length > this._config.maxAlerts) {
      this._alerts = this._alerts.slice(-this._config.maxAlerts);
    }

    this._notifyEvent('alert_triggered', alert);
  }

  private _initDefaultAlertRules(): void {
    const defaults: AlertRule[] = [
      {
        id: 'high-failure-rate',
        name: 'High Failure Rate',
        metricName: 'execution.failures',
        condition: 'gt',
        threshold: 10,
        severity: AlertSeverity.WARNING,
        cooldown: 60000,
        enabled: true,
        message: 'Execution failure rate is too high'
      },
      {
        id: 'queue-backlog',
        name: 'Queue Backlog',
        metricName: 'queue.pending',
        condition: 'gt',
        threshold: 1000,
        severity: AlertSeverity.WARNING,
        cooldown: 30000,
        enabled: true,
        message: 'Queue backlog is too large'
      },
      {
        id: 'long-running-task',
        name: 'Long Running Task',
        metricName: 'execution.duration',
        condition: 'gt',
        threshold: 300000,
        severity: AlertSeverity.WARNING,
        cooldown: 60000,
        enabled: true,
        message: 'Task execution duration exceeds 5 minutes'
      },
      {
        id: 'high-error-count',
        name: 'High Error Count',
        metricName: 'execution.errors',
        condition: 'gt',
        threshold: 50,
        severity: AlertSeverity.CRITICAL,
        cooldown: 30000,
        enabled: true,
        message: 'Error count exceeds critical threshold'
      },
      {
        id: 'low-throughput',
        name: 'Low Throughput',
        metricName: 'execution.throughput',
        condition: 'lt',
        threshold: 1,
        severity: AlertSeverity.INFO,
        cooldown: 120000,
        enabled: true,
        message: 'Execution throughput is below 1 per second'
      }
    ];

    for (const rule of defaults) {
      this._alertRules.set(rule.id, rule);
    }
  }

  // ==================== 健康检查 ====================

  /**
   * 获取健康状态
   */
  public getHealthStatus(): HealthStatus {
    const queueHealth = this._evaluateQueueHealth();
    const schedulerHealth = this._evaluateSchedulerHealth();
    const executorHealth = this._evaluateExecutorHealth();
    const memoryHealth = this._evaluateMemoryHealth();

    const scores = [queueHealth, schedulerHealth, executorHealth, memoryHealth];
    const avgScore = scores.reduce((sum, c) => sum + c.score, 0) / scores.length;

    const allHealthy = scores.every(c => c.status === 'healthy');
    const anyUnhealthy = scores.some(c => c.status === 'unhealthy');

    return {
      status: allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
      score: Math.round(avgScore),
      components: {
        queue: queueHealth,
        scheduler: schedulerHealth,
        executor: executorHealth,
        memory: memoryHealth
      },
      activeAlerts: this.getUnacknowledgedAlerts().length,
      lastCheckTime: Date.now()
    };
  }

  private _evaluateQueueHealth(): ComponentHealth {
    const pending = this.getCounter('queue.pending') || 0;
    const failed = this.getCounter('queue.failed') || 0;
    const total = this.getCounter('queue.total') || 1;

    const failureRate = failed / total;
    let score = 100;

    if (pending > 500) score -= 20;
    if (pending > 1000) score -= 30;
    if (failureRate > 0.1) score -= 30;
    if (failureRate > 0.3) score -= 40;

    return {
      status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy',
      score: Math.max(0, score),
      details: { pending, failed, total, failureRate: Math.round(failureRate * 100) + '%' }
    };
  }

  private _evaluateSchedulerHealth(): ComponentHealth {
    const running = this.getCounter('scheduler.running') || 0;
    const errors = this.getCounter('scheduler.errors') || 0;
    let score = 100;

    if (errors > 10) score -= 20;
    if (errors > 50) score -= 40;
    if (running === 0) score -= 10;

    return {
      status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy',
      score: Math.max(0, score),
      details: { running, errors }
    };
  }

  private _evaluateExecutorHealth(): ComponentHealth {
    const completed = this.getCounter('executor.completed') || 0;
    const failed = this.getCounter('executor.failed') || 0;
    const total = completed + failed || 1;
    const successRate = completed / total;
    let score = 100;

    if (successRate < 0.95) score -= 20;
    if (successRate < 0.8) score -= 40;
    if (successRate < 0.5) score -= 50;

    const avgDuration = this.getTimerStats('executor.duration');
    if (avgDuration && avgDuration.avg > 60000) score -= 10;
    if (avgDuration && avgDuration.avg > 300000) score -= 20;

    return {
      status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy',
      score: Math.max(0, score),
      details: { completed, failed, successRate: Math.round(successRate * 100) + '%', avgDuration: avgDuration?.avg }
    };
  }

  private _evaluateMemoryHealth(): ComponentHealth {
    const metricsCount = this._metrics.size;
    const timelineCount = this._timelines.length;
    const alertsCount = this._alerts.length;
    let score = 100;

    if (metricsCount > 10000) score -= 20;
    if (timelineCount > 50000) score -= 20;
    if (alertsCount > this._config.maxAlerts * 0.8) score -= 10;

    return {
      status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy',
      score: Math.max(0, score),
      details: { metricsCount, timelineCount, alertsCount }
    };
  }

  // ==================== 仪表盘 ====================

  /**
   * 获取仪表盘数据
   */
  public getDashboard(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    timers: Record<string, MetricAggregation | null>;
    recentAlerts: Alert[];
    healthStatus: HealthStatus;
    recentTimeline: TimelineEvent[];
  } {
    const counters: Record<string, number> = {};
    for (const [key, value] of this._counters) {
      counters[key] = value;
    }

    const gauges: Record<string, number> = {};
    for (const [key, value] of this._gauges) {
      gauges[key] = value;
    }

    const timers: Record<string, MetricAggregation | null> = {};
    for (const key of this._timers.keys()) {
      timers[key] = this.getTimerStats(key);
    }

    return {
      counters,
      gauges,
      timers,
      recentAlerts: this.getAlerts({ acknowledged: false }).slice(-10),
      healthStatus: this.getHealthStatus(),
      recentTimeline: this.getTimeline({ limit: 20 })
    };
  }

  // ==================== 事件监听 ====================

  public addEventListener(listener: (event: any) => void): () => void {
    this._eventListeners.add(listener);
    return () => this._eventListeners.delete(listener);
  }

  private _notifyEvent(type: string, data?: any): void {
    for (const listener of this._eventListeners) {
      try {
        listener({ type, timestamp: Date.now(), data });
      } catch (error) {
        console.error('Monitor event listener error:', error);
      }
    }
  }

  // ==================== 定时任务 ====================

  private _startHealthCheck(): void {
    this._healthCheckTimer = setInterval(() => {
      const health = this.getHealthStatus();
      this._notifyEvent('health_check', health);
    }, this._config.healthCheckInterval);
  }

  private _startCleanup(): void {
    this._cleanupTimer = setInterval(() => {
      this._cleanup();
    }, 60000); // 每分钟清理一次
  }

  private _cleanup(): void {
    const now = Date.now();

    // 清理过期指标
    for (const [name, metrics] of this._metrics) {
      const filtered = metrics.filter(m => now - m.timestamp < this._config.metricsRetention);
      this._metrics.set(name, filtered);
    }

    // 清理过期时间线
    this._timelines = this._timelines.filter(
      e => now - e.timestamp < this._config.timelineRetention
    );

    // 清理过期告警冷却
    for (const [ruleId, lastAlert] of this._alertCooldowns) {
      if (now - lastAlert > 300000) { // 5分钟
        this._alertCooldowns.delete(ruleId);
      }
    }
  }

  // ==================== 销毁 ====================

  public destroy(): void {
    if (this._healthCheckTimer) clearInterval(this._healthCheckTimer);
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    this._metrics.clear();
    this._counters.clear();
    this._gauges.clear();
    this._timers.clear();
    this._timelines = [];
    this._alerts = [];
    this._eventListeners.clear();
  }

  private _generateId(): string {
    return `mon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出工厂函数
export function createExecutionMonitor(config?: MonitorConfig): ExecutionMonitor {
  return new ExecutionMonitor(config);
}
