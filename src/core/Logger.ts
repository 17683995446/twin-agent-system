/**
 * 超长任务Agent树形双生子模块化执行系统
 * 日志记录器 - 第9阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ModuleId } from './interfaces';

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志条目
 */
export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  moduleId?: ModuleId;
  message: string;
  metadata?: Record<string, unknown>;
  stack?: string;
}

/**
 * 日志输出目标
 */
export interface LogTarget {
  write(entry: LogEntry): void;
}

/**
 * 控制台日志目标
 */
export class ConsoleLogTarget implements LogTarget {
  write(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}]`;
    const moduleInfo = entry.moduleId ? ` [${entry.moduleId}]` : '';
    
    switch (entry.level) {
      case 'debug':
        console.debug(`${prefix}${moduleInfo} ${entry.message}`, entry.metadata || '');
        break;
      case 'info':
        console.info(`${prefix}${moduleInfo} ${entry.message}`, entry.metadata || '');
        break;
      case 'warn':
        console.warn(`${prefix}${moduleInfo} ${entry.message}`, entry.metadata || '');
        break;
      case 'error':
        console.error(`${prefix}${moduleInfo} ${entry.message}`, entry.metadata || '', entry.stack || '');
        break;
    }
  }
}

/**
 * 日志记录器
 * 
 * 职责：
 * 1. 分级日志记录（debug、info、warn、error）
 * 2. 支持多个输出目标
 * 3. 日志过滤与格式化
 */
export class Logger {
  private _level: LogLevel;
  private _targets: LogTarget[];
  private _logs: LogEntry[] = [];
  private _maxLogs: number = 10000;

  private static _levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  constructor(level: LogLevel = 'info', targets?: LogTarget[]) {
    this._level = level;
    this._targets = targets || [new ConsoleLogTarget()];
  }

  /**
   * 记录调试日志
   */
  public debug(message: string, metadata?: Record<string, unknown>, moduleId?: ModuleId): void {
    this._log('debug', message, metadata, moduleId);
  }

  /**
   * 记录信息日志
   */
  public info(message: string, metadata?: Record<string, unknown>, moduleId?: ModuleId): void {
    this._log('info', message, metadata, moduleId);
  }

  /**
   * 记录警告日志
   */
  public warn(message: string, metadata?: Record<string, unknown>, moduleId?: ModuleId): void {
    this._log('warn', message, metadata, moduleId);
  }

  /**
   * 记录错误日志
   */
  public error(message: string, error?: Error, metadata?: Record<string, unknown>, moduleId?: ModuleId): void {
    this._log('error', message, metadata, moduleId, error?.stack);
  }

  /**
   * 获取日志
   */
  public getLogs(level?: LogLevel, limit: number = 100): LogEntry[] {
    let logs = this._logs;
    if (level) {
      const minPriority = Logger._levelPriority[level];
      logs = logs.filter(l => Logger._levelPriority[l.level] >= minPriority);
    }
    return logs.slice(-limit);
  }

  /**
   * 设置日志级别
   */
  public setLevel(level: LogLevel): void {
    this._level = level;
  }

  /**
   * 添加输出目标
   */
  public addTarget(target: LogTarget): void {
    this._targets.push(target);
  }

  /**
   * 清除日志
   */
  public clear(): void {
    this._logs = [];
  }

  private _log(level: LogLevel, message: string, metadata?: Record<string, unknown>, moduleId?: ModuleId, stack?: string): void {
    // 检查日志级别
    if (Logger._levelPriority[level] < Logger._levelPriority[this._level]) {
      return;
    }

    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      level,
      moduleId,
      message,
      metadata,
      stack
    };

    // 存储日志
    this._logs.push(entry);
    if (this._logs.length > this._maxLogs) {
      this._logs = this._logs.slice(-this._maxLogs / 2);
    }

    // 输出到目标
    for (const target of this._targets) {
      try {
        target.write(entry);
      } catch (e) {
        // 忽略输出错误
      }
    }
  }
}

export default Logger;
