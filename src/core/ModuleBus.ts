/**
 * 超长任务Agent树形双生子模块化执行系统
 * 模块间通信总线 - 第5阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ModuleId, ModuleInput, ModuleOutput } from './interfaces';

/**
 * 消息类型
 */
export type MessageType = 'request' | 'response' | 'event' | 'broadcast';

/**
 * 消息优先级
 */
export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * 通信消息
 */
export interface ModuleMessage {
  /** 消息ID */
  messageId: string;
  /** 消息类型 */
  type: MessageType;
  /** 发送者模块ID */
  senderId: ModuleId;
  /** 接收者模块ID（广播时为空） */
  receiverId?: ModuleId;
  /** 消息主题 */
  topic: string;
  /** 消息载荷 */
  payload: unknown;
  /** 时间戳 */
  timestamp: number;
  /** 优先级 */
  priority: MessagePriority;
  /** 关联的请求ID（响应消息） */
  correlationId?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 消息处理器
 */
export type MessageHandler = (message: ModuleMessage) => Promise<ModuleOutput> | ModuleOutput;

/**
 * 模块间通信总线
 * 
 * 职责：
 * 1. 实现模块间标准化通信接口
 * 2. 支持接口调用与消息传递
 * 3. 消息路由与分发
 * 4. 异步通信支持
 */
export class ModuleBus {
  private _handlers: Map<string, MessageHandler[]> = new Map();
  private _middlewares: Array<(message: ModuleMessage) => Promise<ModuleMessage>> = [];
  private _messageHistory: ModuleMessage[] = [];
  private _maxHistorySize: number = 1000;

  /**
   * 注册消息处理器
   */
  public on(topic: string, handler: MessageHandler): void {
    if (!this._handlers.has(topic)) {
      this._handlers.set(topic, []);
    }
    this._handlers.get(topic)!.push(handler);
  }

  /**
   * 取消注册消息处理器
   */
  public off(topic: string, handler: MessageHandler): void {
    const handlers = this._handlers.get(topic);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 发送消息
   */
  public async send(message: Omit<ModuleMessage, 'messageId' | 'timestamp'>): Promise<ModuleOutput> {
    const fullMessage: ModuleMessage = {
      ...message,
      messageId: this._generateMessageId(),
      timestamp: Date.now()
    };

    // 应用中间件
    let processedMessage = fullMessage;
    for (const middleware of this._middlewares) {
      processedMessage = await middleware(processedMessage);
    }

    // 记录消息
    this._recordMessage(processedMessage);

    // 路由消息
    const handlers = this._handlers.get(processedMessage.topic) || [];
    if (handlers.length === 0) {
      return {
        outputId: this._generateMessageId(),
        data: { error: `No handler for topic: ${processedMessage.topic}` },
        dataType: 'error',
        timestamp: Date.now(),
        status: 'failed',
        executionTimeMs: 0
      };
    }

    // 执行处理器
    const results = await Promise.all(handlers.map(h => h(processedMessage)));
    return results[0]; // 返回第一个结果
  }

  /**
   * 广播消息
   */
  public async broadcast(message: Omit<ModuleMessage, 'messageId' | 'timestamp' | 'receiverId'>): Promise<ModuleOutput[]> {
    const fullMessage: ModuleMessage = {
      ...message,
      messageId: this._generateMessageId(),
      timestamp: Date.now(),
      type: 'broadcast'
    };

    this._recordMessage(fullMessage);

    const handlers = this._handlers.get(fullMessage.topic) || [];
    return Promise.all(handlers.map(h => h(fullMessage)));
  }

  /**
   * 添加中间件
   */
  public use(middleware: (message: ModuleMessage) => Promise<ModuleMessage>): void {
    this._middlewares.push(middleware);
  }

  /**
   * 获取消息历史
   */
  public getMessageHistory(limit: number = 100): ModuleMessage[] {
    return this._messageHistory.slice(-limit);
  }

  private _recordMessage(message: ModuleMessage): void {
    this._messageHistory.push(message);
    if (this._messageHistory.length > this._maxHistorySize) {
      this._messageHistory = this._messageHistory.slice(-this._maxHistorySize / 2);
    }
  }

  private _generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default ModuleBus;
