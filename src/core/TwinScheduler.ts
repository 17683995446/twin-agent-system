/**
 * 超长任务Agent树形双生子模块化执行系统
 * 双子模块调度器 - 第18阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { IBaseModule, IControlModule, IExecuteModule, ModuleInput, ModuleOutput } from './interfaces';

/**
 * 调度策略
 */
export type SchedulingStrategy = 'sequential' | 'parallel' | 'priority';

/**
 * 调度任务
 */
export interface SchedulingTask {
  id: string;
  input: ModuleInput;
  priority: number;
  timestamp: number;
}

/**
 * 双子模块调度器
 * 
 * 职责：
 * 1. 左管控+右执行的双子模块统一调度
 * 2. 调度策略管理
 * 3. 任务队列管理
 */
export class TwinScheduler {
  private _controlModule?: IControlModule;
  private _executeModule?: IExecuteModule;
  private _strategy: SchedulingStrategy = 'sequential';
  private _taskQueue: SchedulingTask[] = [];
  private _isRunning: boolean = false;

  /**
   * 注册双子模块
   */
  public registerTwin(control: IControlModule, execute: IExecuteModule): void {
    this._controlModule = control;
    this._executeModule = execute;
  }

  /**
   * 设置调度策略
   */
  public setStrategy(strategy: SchedulingStrategy): void {
    this._strategy = strategy;
  }

  /**
   * 提交任务
   */
  public async submit(input: ModuleInput, priority: number = 0): Promise<string> {
    const task: SchedulingTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      input,
      priority,
      timestamp: Date.now()
    };
    this._taskQueue.push(task);
    this._sortQueue();
    return task.id;
  }

  /**
   * 开始调度
   */
  public async start(): Promise<void> {
    if (this._isRunning) return;
    if (!this._controlModule || !this._executeModule) {
      throw new Error('双子模块未注册');
    }

    this._isRunning = true;
    
    while (this._isRunning && this._taskQueue.length > 0) {
      const task = this._taskQueue.shift();
      if (task) {
        await this._executeTask(task);
      }
    }
  }

  /**
   * 停止调度
   */
  public stop(): void {
    this._isRunning = false;
  }

  /**
   * 获取队列长度
   */
  public getQueueLength(): number {
    return this._taskQueue.length;
  }

  private async _executeTask(task: SchedulingTask): Promise<void> {
    if (!this._controlModule || !this._executeModule) return;

    // 1. 管控模块先执行校验
    const validationResult = await this._controlModule.validate(task.input);
    if (!validationResult.passed) {
      console.warn(`任务 ${task.id} 校验失败`);
      return;
    }

    // 2. 执行模块执行实际任务
    const result = await this._executeModule.execute(task.input);
    
    // 3. 处理结果
    await this._executeModule.processResult(result);
  }

  private _sortQueue(): void {
    switch (this._strategy) {
      case 'priority':
        this._taskQueue.sort((a, b) => b.priority - a.priority);
        break;
      case 'sequential':
      default:
        // 保持FIFO顺序
        break;
    }
  }
}

export default TwinScheduler;
