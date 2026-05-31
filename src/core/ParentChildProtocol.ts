/**
 * 超长任务Agent树形双生子模块化执行系统
 * 父子模块通信协议 - 第16阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { IBaseModule, ModuleId, ModuleState, ModuleInput, ModuleOutput } from './interfaces';

/**
 * 父子通信消息类型
 */
export type ParentChildMessageType = 'command' | 'query' | 'event' | 'response';

/**
 * 父子通信消息
 */
export interface ParentChildMessage {
  messageId: string;
  type: ParentChildMessageType;
  from: ModuleId;
  to: ModuleId;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

/**
 * 父子模块通信协议
 * 
 * 职责：
 * 1. 定义父子模块间的标准化通信协议
 * 2. 消息路由与分发
 * 3. 请求-响应模式支持
 */
export class ParentChildProtocol {
  private _pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = new Map();
  private _messageHandlers: Map<string, (message: ParentChildMessage) => Promise<unknown>> = new Map();

  /**
   * 父模块向子模块发送命令
   */
  public async sendCommand(parent: IBaseModule, child: IBaseModule, command: string, payload: unknown): Promise<unknown> {
    const message: ParentChildMessage = {
      messageId: this._generateMessageId(),
      type: 'command',
      from: parent.moduleId,
      to: child.moduleId,
      payload: { command, data: payload },
      timestamp: Date.now()
    };
    return this._sendAndWait(message);
  }

  /**
   * 子模块向父模块发送事件
   */
  public sendEvent(child: IBaseModule, parent: IBaseModule, event: string, payload: unknown): void {
    const message: ParentChildMessage = {
      messageId: this._generateMessageId(),
      type: 'event',
      from: child.moduleId,
      to: parent.moduleId,
      payload: { event, data: payload },
      timestamp: Date.now()
    };
    this._dispatch(message);
  }

  /**
   * 父模块查询子模块状态
   */
  public async queryState(parent: IBaseModule, child: IBaseModule): Promise<ModuleState> {
    const message: ParentChildMessage = {
      messageId: this._generateMessageId(),
      type: 'query',
      from: parent.moduleId,
      to: child.moduleId,
      payload: { query: 'state' },
      timestamp: Date.now()
    };
    return this._sendAndWait(message) as Promise<ModuleState>;
  }

  /**
   * 注册消息处理器
   */
  public onMessage(moduleId: ModuleId, handler: (message: ParentChildMessage) => Promise<unknown>): void {
    this._messageHandlers.set(moduleId, handler);
  }

  /**
   * 处理接收到的消息
   */
  public async handleMessage(message: ParentChildMessage): Promise<void> {
    if (message.type === 'response' && message.correlationId) {
      const pending = this._pendingRequests.get(message.correlationId);
      if (pending) {
        pending.resolve(message.payload);
        this._pendingRequests.delete(message.correlationId);
      }
      return;
    }

    const handler = this._messageHandlers.get(message.to);
    if (handler) {
      const result = await handler(message);
      // 发送响应
      if (message.type === 'command' || message.type === 'query') {
        const response: ParentChildMessage = {
          messageId: this._generateMessageId(),
          type: 'response',
          from: message.to,
          to: message.from,
          payload: result,
          timestamp: Date.now(),
          correlationId: message.messageId
        };
        this._dispatch(response);
      }
    }
  }

  private async _sendAndWait(message: ParentChildMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this._pendingRequests.set(message.messageId, { resolve, reject });
      this._dispatch(message);
      
      // 超时处理
      setTimeout(() => {
        if (this._pendingRequests.has(message.messageId)) {
          this._pendingRequests.delete(message.messageId);
          reject(new Error('请求超时'));
        }
      }, 30000);
    });
  }

  private _dispatch(message: ParentChildMessage): void {
    // 实际实现中，这里会将消息路由到目标模块
    console.log(`[ParentChildProtocol] ${message.type}: ${message.from} -> ${message.to}`);
  }

  private _generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default ParentChildProtocol;
