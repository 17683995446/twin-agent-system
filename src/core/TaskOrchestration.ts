/**
 * Phase 7 (61-70阶段)：任务调度与编排
 * Task Scheduling and Orchestration
 * 
 * 包含：
 * - 61: 任务编排器
 * - 62: 工作流引擎
 * - 63: DAG调度器
 * - 64: 任务依赖管理
 * - 65: 任务优先级管理
 * - 66: 任务分组
 * - 67: 任务重试策略
 * - 68: 任务取消管理
 * - 69: 任务进度追踪
 * - 70: 任务编排集成测试
 */

import { ModuleInput, ModuleOutput } from './interfaces';
import { ExecutionContext, ExecutionStatus } from './ExecutionContext';

// ==================== 61: 任务编排器 ====================

export interface TaskDefinition {
  id: string;
  name: string;
  type: string;
  input: any;
  dependencies?: string[];
  priority?: number;
  timeout?: number;
  retries?: number;
  metadata?: Record<string, any>;
}

export interface TaskResult {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  output?: any;
  error?: Error;
  startTime: number;
  endTime?: number;
}

export class TaskOrchestrator {
  private _tasks: Map<string, TaskDefinition> = new Map();
  private _results: Map<string, TaskResult> = new Map();
  private _executionOrder: string[] = [];

  defineTask(task: TaskDefinition): void {
    this._tasks.set(task.id, task);
    this._results.set(task.id, {
      taskId: task.id,
      status: 'pending',
      startTime: 0
    });
  }

  getExecutionOrder(): string[] {
    this._resolveDependencies();
    return [...this._executionOrder];
  }

  private _resolveDependencies(): void {
    const resolved: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        throw new Error(`Circular dependency detected: ${taskId}`);
      }

      visiting.add(taskId);
      const task = this._tasks.get(taskId);
      if (task?.dependencies) {
        for (const dep of task.dependencies) {
          visit(dep);
        }
      }
      visiting.delete(taskId);
      visited.add(taskId);
      resolved.push(taskId);
    };

    for (const taskId of this._tasks.keys()) {
      visit(taskId);
    }

    this._executionOrder = resolved;
  }

  getTask(id: string): TaskDefinition | undefined {
    return this._tasks.get(id);
  }

  getResults(): Map<string, TaskResult> {
    return new Map(this._results);
  }

  updateResult(taskId: string, result: Partial<TaskResult>): void {
    const existing = this._results.get(taskId);
    if (existing) {
      this._results.set(taskId, { ...existing, ...result });
    }
  }
}

// ==================== 62: 工作流引擎 ====================

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  tasks: TaskDefinition[];
  triggers?: WorkflowTrigger[];
  variables?: Record<string, any>;
}

export interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'event' | 'webhook';
  config: Record<string, any>;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  currentTask?: string;
  variables: Record<string, any>;
  startTime: number;
  endTime?: number;
}

export class WorkflowEngine {
  private _workflows: Map<string, WorkflowDefinition> = new Map();
  private _instances: Map<string, WorkflowInstance> = new Map();
  private _orchestrator: TaskOrchestrator;

  constructor() {
    this._orchestrator = new TaskOrchestrator();
  }

  registerWorkflow(workflow: WorkflowDefinition): void {
    this._workflows.set(workflow.id, workflow);
  }

  async startWorkflow(workflowId: string, input?: any): Promise<WorkflowInstance> {
    const workflow = this._workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow '${workflowId}' not found`);
    }

    const instance: WorkflowInstance = {
      id: `wf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      workflowId,
      status: 'running',
      variables: { ...workflow.variables, ...input },
      startTime: Date.now()
    };

    // 注册任务
    for (const task of workflow.tasks) {
      this._orchestrator.defineTask(task);
    }

    this._instances.set(instance.id, instance);
    return instance;
  }

  async pauseWorkflow(instanceId: string): Promise<void> {
    const instance = this._instances.get(instanceId);
    if (instance) {
      instance.status = 'paused';
    }
  }

  async resumeWorkflow(instanceId: string): Promise<void> {
    const instance = this._instances.get(instanceId);
    if (instance && instance.status === 'paused') {
      instance.status = 'running';
    }
  }

  async cancelWorkflow(instanceId: string): Promise<void> {
    const instance = this._instances.get(instanceId);
    if (instance) {
      instance.status = 'failed';
      instance.endTime = Date.now();
    }
  }

  getInstance(instanceId: string): WorkflowInstance | undefined {
    return this._instances.get(instanceId);
  }
}

// ==================== 63: DAG调度器 ====================

export interface DAGNode {
  id: string;
  data: any;
  dependencies: string[];
}

export interface DAGEdge {
  from: string;
  to: string;
}

export class DAGScheduler {
  private _nodes: Map<string, DAGNode> = new Map();
  private _edges: DAGEdge[] = [];

  addNode(node: DAGNode): void {
    this._nodes.set(node.id, node);
    for (const dep of node.dependencies) {
      this._edges.push({ from: dep, to: node.id });
    }
  }

  getReadyNodes(completed: Set<string>): string[] {
    const ready: string[] = [];
    for (const [id, node] of this._nodes) {
      if (completed.has(id)) continue;
      if (node.dependencies.every(dep => completed.has(dep))) {
        ready.push(id);
      }
    }
    return ready;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // 检查循环
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this._nodes.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          if (hasCycle(dep)) return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this._nodes.keys()) {
      if (hasCycle(nodeId)) {
        errors.push(`Cycle detected involving node: ${nodeId}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  topologicalSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = this._nodes.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }
      result.push(nodeId);
    };

    for (const nodeId of this._nodes.keys()) {
      visit(nodeId);
    }

    return result;
  }
}

// ==================== 64-70: 其他组件 ====================

// 64: 任务依赖管理
export class TaskDependencyManager {
  private _dependencies: Map<string, Set<string>> = new Map();

  addDependency(taskId: string, dependsOn: string): void {
    const deps = this._dependencies.get(taskId) || new Set();
    deps.add(dependsOn);
    this._dependencies.set(taskId, deps);
  }

  getDependencies(taskId: string): string[] {
    return Array.from(this._dependencies.get(taskId) || []);
  }

  areDependenciesMet(taskId: string, completed: Set<string>): boolean {
    const deps = this._dependencies.get(taskId);
    return !deps || Array.from(deps).every(dep => completed.has(dep));
  }
}

// 65: 任务优先级管理
export class TaskPriorityManager {
  private _priorities: Map<string, number> = new Map();

  setPriority(taskId: string, priority: number): void {
    this._priorities.set(taskId, priority);
  }

  getPriority(taskId: string): number {
    return this._priorities.get(taskId) || 0;
  }

  sortByPriority(taskIds: string[]): string[] {
    return [...taskIds].sort((a, b) => 
      (this._priorities.get(b) || 0) - (this._priorities.get(a) || 0)
    );
  }
}

// 66: 任务分组
export class TaskGroupManager {
  private _groups: Map<string, Set<string>> = new Map();

  createGroup(groupId: string): void {
    this._groups.set(groupId, new Set());
  }

  addToGroup(groupId: string, taskId: string): void {
    const group = this._groups.get(groupId);
    if (group) group.add(taskId);
  }

  getGroup(groupId: string): string[] {
    return Array.from(this._groups.get(groupId) || []);
  }

  getGroups(): string[] {
    return Array.from(this._groups.keys());
  }
}

// 67: 任务重试策略
export interface RetryPolicy {
  maxRetries: number;
  backoff: 'fixed' | 'linear' | 'exponential';
  baseDelay: number;
  maxDelay?: number;
}

export class TaskRetryManager {
  private _policies: Map<string, RetryPolicy> = new Map();
  private _retryCounts: Map<string, number> = new Map();

  setPolicy(taskId: string, policy: RetryPolicy): void {
    this._policies.set(taskId, policy);
  }

  shouldRetry(taskId: string): boolean {
    const policy = this._policies.get(taskId);
    const count = this._retryCounts.get(taskId) || 0;
    return policy ? count < policy.maxRetries : false;
  }

  getDelay(taskId: string): number {
    const policy = this._policies.get(taskId);
    const count = this._retryCounts.get(taskId) || 0;
    if (!policy) return 0;

    let delay: number;
    switch (policy.backoff) {
      case 'fixed':
        delay = policy.baseDelay;
        break;
      case 'linear':
        delay = policy.baseDelay * (count + 1);
        break;
      case 'exponential':
        delay = policy.baseDelay * Math.pow(2, count);
        break;
    }

    return Math.min(delay, policy.maxDelay || Infinity);
  }

  recordRetry(taskId: string): void {
    const count = this._retryCounts.get(taskId) || 0;
    this._retryCounts.set(taskId, count + 1);
  }
}

// 68: 任务取消管理
export class TaskCancellationManager {
  private _cancelled: Set<string> = new Set();
  private _reasons: Map<string, string> = new Map();

  cancel(taskId: string, reason?: string): void {
    this._cancelled.add(taskId);
    if (reason) this._reasons.set(taskId, reason);
  }

  isCancelled(taskId: string): boolean {
    return this._cancelled.has(taskId);
  }

  getReason(taskId: string): string | undefined {
    return this._reasons.get(taskId);
  }

  clear(taskId: string): void {
    this._cancelled.delete(taskId);
    this._reasons.delete(taskId);
  }
}

// 69: 任务进度追踪
export class TaskProgressTracker {
  private _progress: Map<string, { current: number; total: number; message?: string }> = new Map();

  setProgress(taskId: string, current: number, total: number, message?: string): void {
    this._progress.set(taskId, { current, total, message });
  }

  getProgress(taskId: string): { percentage: number; current: number; total: number; message?: string } | null {
    const progress = this._progress.get(taskId);
    if (!progress) return null;
    return {
      percentage: progress.total > 0 ? (progress.current / progress.total) * 100 : 0,
      ...progress
    };
  }

  increment(taskId: string, amount: number = 1): void {
    const progress = this._progress.get(taskId);
    if (progress) {
      progress.current = Math.min(progress.current + amount, progress.total);
    }
  }
}

// 导出所有组件
export {
  TaskDefinition,
  TaskResult,
  WorkflowDefinition,
  WorkflowTrigger,
  WorkflowInstance,
  DAGNode,
  DAGEdge,
  RetryPolicy
};

// 工厂函数
export function createTaskOrchestrator(): TaskOrchestrator {
  return new TaskOrchestrator();
}

export function createWorkflowEngine(): WorkflowEngine {
  return new WorkflowEngine();
}

export function createDAGScheduler(): DAGScheduler {
  return new DAGScheduler();
}

export function createTaskDependencyManager(): TaskDependencyManager {
  return new TaskDependencyManager();
}

export function createTaskPriorityManager(): TaskPriorityManager {
  return new TaskPriorityManager();
}

export function createTaskGroupManager(): TaskGroupManager {
  return new TaskGroupManager();
}

export function createTaskRetryManager(): TaskRetryManager {
  return new TaskRetryManager();
}

export function createTaskCancellationManager(): TaskCancellationManager {
  return new TaskCancellationManager();
}

export function createTaskProgressTracker(): TaskProgressTracker {
  return new TaskProgressTracker();
}
