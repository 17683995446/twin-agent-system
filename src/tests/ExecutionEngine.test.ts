/**
 * 第50阶段：执行引擎集成测试
 * Execution Engine Integration Tests
 * 
 * 测试执行引擎各组件的协同工作：
 * - ExecutionContext + ExecutionQueue + ExecutionScheduler
 * - StepExecutor + ExecutionMonitor
 * - ConcurrencyController + ExecutionTimeout
 * - ExecutionResultHandler + ExecutionRollback
 */

import { ExecutionContext, ExecutionContextManager, ExecutionStatus, ExecutionPhase } from '../core/ExecutionContext';
import { ExecutionQueue, QueuePriority, QueueItemStatus } from '../core/ExecutionQueue';
import { ExecutionScheduler, SchedulerStatus, ScheduleStrategyType } from '../core/ExecutionScheduler';
import { StepExecutor, StepBuilder, StepType, StepStatus } from '../core/StepExecutor';
import { ExecutionMonitor, AlertSeverity, TimelineEventType } from '../core/ExecutionMonitor';
import { ConcurrencyController, Semaphore, RateLimiter, RateLimiterType } from '../core/ConcurrencyController';
import { ExecutionResultHandler, ResultStatus } from '../core/ExecutionResultHandler';
import { ExecutionRollback, RollbackStrategy, RollbackStatus } from '../core/ExecutionRollback';
import { ExecutionTimeout, TimeoutType, TimeoutStrategy } from '../core/ExecutionTimeout';
import { ModuleInput } from '../core/interfaces';

describe('Execution Engine Integration Tests', () => {
  // ==================== Phase 5 核心组件测试 ====================

  describe('ExecutionContext Integration', () => {
    let contextManager: ExecutionContextManager;

    beforeEach(() => {
      contextManager = new ExecutionContextManager();
    });

    it('should create and manage execution contexts', () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      
      expect(context.id).toBeDefined();
      expect(context.taskId).toBe('task-001');
      expect(context.executionId).toBe('exec-001');
      expect(context.moduleId).toBe('module-001');
      expect(context.status).toBe(ExecutionStatus.PENDING);
    });

    it('should manage parent-child context relationships', () => {
      const parentContext = contextManager.createContext('task-001', 'exec-001', 'parent-module');
      parentContext.setVariable('sharedVar', 'parentValue', { scope: 'parent' });
      
      const childContext = contextManager.createContext(
        'task-001', 
        'exec-002', 
        'child-module',
        parentContext.id
      );

      expect(childContext.parentContextId).toBe(parentContext.id);
      expect(childContext.getVariableValue('sharedVar')).toBe('parentValue');
    });

    it('should create and restore snapshots', () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      context.setVariable('testVar', 42);
      context.setStatus(ExecutionStatus.RUNNING);

      const snapshot = context.createSnapshot('test snapshot');
      expect(snapshot.checksum).toBeDefined();

      context.setVariable('testVar', 100);
      context.setStatus(ExecutionStatus.COMPLETED);

      context.restoreFromSnapshot(snapshot);
      expect(context.getVariableValue('testVar')).toBe(42);
      expect(context.status).toBe(ExecutionStatus.RUNNING);
    });
  });

  describe('ExecutionQueue Integration', () => {
    let queue: ExecutionQueue;

    beforeEach(() => {
      queue = new ExecutionQueue({ maxConcurrent: 5 });
    });

    it('should enqueue and dequeue items by priority', async () => {
      await queue.enqueue('task-001', 'module-001', { taskId: 'task-001', params: {}, timestamp: Date.now() }, { priority: QueuePriority.LOW });
      await queue.enqueue('task-002', 'module-002', { taskId: 'task-002', params: {}, timestamp: Date.now() }, { priority: QueuePriority.HIGH });
      await queue.enqueue('task-003', 'module-003', { taskId: 'task-003', params: {}, timestamp: Date.now() }, { priority: QueuePriority.CRITICAL });

      const item1 = queue.dequeue();
      expect(item1?.priority).toBe(QueuePriority.CRITICAL);
      
      const item2 = queue.dequeue();
      expect(item2?.priority).toBe(QueuePriority.HIGH);
    });

    it('should handle item completion and failure', async () => {
      const item = await queue.enqueue('task-001', 'module-001', { taskId: 'task-001', params: {}, timestamp: Date.now() });
      const dequeued = queue.dequeue();
      
      queue.complete(item.id, { result: 'success' });
      const completedItem = queue.getItem(item.id);
      expect(completedItem?.status).toBe(QueueItemStatus.COMPLETED);
    });

    it('should enforce concurrency limits', async () => {
      const limitedQueue = new ExecutionQueue({ maxConcurrent: 2 });
      
      await limitedQueue.enqueue('task-001', 'module-001', { taskId: 'task-001', params: {}, timestamp: Date.now() });
      await limitedQueue.enqueue('task-002', 'module-002', { taskId: 'task-002', params: {}, timestamp: Date.now() });
      await limitedQueue.enqueue('task-003', 'module-003', { taskId: 'task-003', params: {}, timestamp: Date.now() });

      const item1 = limitedQueue.dequeue();
      const item2 = limitedQueue.dequeue();
      const item3 = limitedQueue.dequeue(); // Should be null due to concurrency limit

      expect(item1).not.toBeNull();
      expect(item2).not.toBeNull();
      expect(item3).toBeNull();
    });
  });

  describe('StepExecutor Integration', () => {
    let executor: StepExecutor;
    let contextManager: ExecutionContextManager;

    beforeEach(() => {
      executor = new StepExecutor();
      contextManager = new ExecutionContextManager();
    });

    it('should execute steps with validation', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      
      const step = new StepBuilder('step-001', 'Test Step')
        .withAction(async (input) => {
          return { result: input.value * 2 };
        })
        .withInputValidation([
          { field: 'value', required: true, type: 'number' }
        ])
        .build();

      const result = await executor.execute(step, { value: 21 }, context);
      
      expect(result.status).toBe(StepStatus.COMPLETED);
      expect(result.output).toEqual({ result: 42 });
    });

    it('should handle step failures and compensation', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      let compensated = false;

      const step = new StepBuilder('step-001', 'Failing Step')
        .withAction(async () => {
          throw new Error('Step failed');
        })
        .withCompensation(async () => {
          compensated = true;
        })
        .build();

      const result = await executor.execute(step, {}, context);
      
      expect(result.status).toBe(StepStatus.FAILED);
      expect(result.compensated).toBe(true);
      expect(compensated).toBe(true);
    });

    it('should execute step sequences', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      
      const steps = [
        new StepBuilder('step-001', 'Step 1')
          .withAction(async (input) => ({ value: (input.value || 0) + 1 }))
          .build(),
        new StepBuilder('step-002', 'Step 2')
          .withAction(async (input) => ({ value: input.value + 1 }))
          .build(),
        new StepBuilder('step-003', 'Step 3')
          .withAction(async (input) => ({ value: input.value + 1 }))
          .build()
      ];

      const results = await executor.executeSequence(steps, { value: 0 }, context);
      
      expect(results.length).toBe(3);
      expect(results[2].output.value).toBe(3);
    });
  });

  describe('ConcurrencyController Integration', () => {
    it('should control concurrency with semaphore', async () => {
      const semaphore = new Semaphore(2);
      const results: number[] = [];

      const task1 = semaphore.withPermit(async () => {
        results.push(1);
        await new Promise(r => setTimeout(r, 100));
        results.push(2);
      });

      const task2 = semaphore.withPermit(async () => {
        results.push(3);
        await new Promise(r => setTimeout(r, 100));
        results.push(4);
      });

      const task3 = semaphore.withPermit(async () => {
        results.push(5);
      });

      await Promise.all([task1, task2, task3]);
      
      expect(results).toContain(1);
      expect(results).toContain(3);
      expect(results).toContain(5);
    });

    it('should rate limit requests', () => {
      const limiter = new RateLimiter({
        type: RateLimiterType.TOKEN_BUCKET,
        rate: 10,
        capacity: 10
      });

      // Should allow first 10 requests
      for (let i = 0; i < 10; i++) {
        expect(limiter.tryAcquire()).toBe(true);
      }

      // Should deny 11th request
      expect(limiter.tryAcquire()).toBe(false);
    });
  });

  describe('ExecutionMonitor Integration', () => {
    let monitor: ExecutionMonitor;

    beforeEach(() => {
      monitor = new ExecutionMonitor();
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should collect and aggregate metrics', () => {
      monitor.incrementCounter('tasks.completed', 5);
      monitor.incrementCounter('tasks.completed', 3);
      monitor.setGauge('queue.size', 100);

      expect(monitor.getCounter('tasks.completed')).toBe(8);
      expect(monitor.getGauge('queue.size')).toBe(100);
    });

    it('should record timeline events', () => {
      monitor.recordTimelineEvent(TimelineEventType.TASK_STARTED, { taskId: 'task-001' });
      monitor.recordTimelineEvent(TimelineEventType.STEP_STARTED, { taskId: 'task-001', stepId: 'step-001' });
      monitor.recordTimelineEvent(TimelineEventType.TASK_COMPLETED, { taskId: 'task-001' });

      const timeline = monitor.getTimeline({ taskId: 'task-001' });
      expect(timeline.length).toBe(3);
    });

    it('should trigger alerts when thresholds exceeded', () => {
      monitor.registerAlertRule({
        id: 'test-alert',
        name: 'Test Alert',
        metricName: 'test.counter',
        condition: 'gt',
        threshold: 5,
        severity: AlertSeverity.WARNING,
        cooldown: 1000,
        enabled: true
      });

      for (let i = 0; i < 10; i++) {
        monitor.incrementCounter('test.counter');
      }

      const alerts = monitor.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
    });

    it('should provide health status', () => {
      monitor.incrementCounter('executor.completed', 100);
      monitor.incrementCounter('executor.failed', 5);

      const health = monitor.getHealthStatus();
      expect(health.status).toBe('healthy');
      expect(health.score).toBeGreaterThan(0);
    });
  });

  describe('ExecutionTimeout Integration', () => {
    let timeout: ExecutionTimeout;
    let contextManager: ExecutionContextManager;

    beforeEach(() => {
      timeout = new ExecutionTimeout({ defaultTimeout: 1000 });
      contextManager = new ExecutionContextManager();
    });

    afterEach(() => {
      timeout.destroy();
    });

    it('should timeout long-running operations', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');

      await expect(
        timeout.executeWithTimeout(
          async () => {
            await new Promise(r => setTimeout(r, 5000));
            return 'done';
          },
          context,
          { timeout: 100 }
        )
      ).rejects.toThrow('timeout');
    });

    it('should complete fast operations', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');

      const result = await timeout.executeWithTimeout(
        async () => {
          await new Promise(r => setTimeout(r, 50));
          return 'done';
        },
        context,
        { timeout: 1000 }
      );

      expect(result).toBe('done');
    });

    it('should track timeout statistics', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');

      try {
        await timeout.executeWithTimeout(
          async () => {
            await new Promise(r => setTimeout(r, 5000));
          },
          context,
          { timeout: 100 }
        );
      } catch {}

      const stats = timeout.getStats();
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('ExecutionRollback Integration', () => {
    let rollback: ExecutionRollback;
    let contextManager: ExecutionContextManager;

    beforeEach(() => {
      rollback = new ExecutionRollback();
      contextManager = new ExecutionContextManager();
    });

    it('should create and use rollback points', () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      context.setVariable('state', 'initial');

      const point = rollback.createRollbackPoint('checkpoint-1', context, []);
      expect(point.id).toBeDefined();

      const retrieved = rollback.getRollbackPoint(point.id);
      expect(retrieved?.name).toBe('checkpoint-1');
    });

    it('should execute compensation actions', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      let compensated = false;

      rollback.registerStepCompensation('step-001', async () => {
        compensated = true;
      });

      const stepResult = {
        stepId: 'step-001',
        status: StepStatus.COMPLETED,
        input: {},
        startTime: Date.now(),
        retryCount: 0,
        skipped: false,
        compensated: false,
        metadata: {}
      };

      const result = await rollback.rollback(context, [stepResult], {
        strategy: RollbackStrategy.COMPENSATE
      });

      expect(result.status).toBe(RollbackStatus.COMPLETED);
      expect(compensated).toBe(true);
    });
  });

  describe('ExecutionResultHandler Integration', () => {
    let handler: ExecutionResultHandler;
    let contextManager: ExecutionContextManager;

    beforeEach(() => {
      handler = new ExecutionResultHandler();
      contextManager = new ExecutionContextManager();
    });

    it('should create and process execution results', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      context.setStatus(ExecutionStatus.COMPLETED);

      const stepResults = [
        {
          stepId: 'step-001',
          status: StepStatus.COMPLETED,
          input: {},
          output: { value: 42 },
          startTime: Date.now() - 100,
          endTime: Date.now(),
          duration: 100,
          retryCount: 0,
          skipped: false,
          compensated: false,
          metadata: {}
        }
      ];

      const result = handler.createResult('task-001', context, stepResults);
      
      expect(result.status).toBe(ResultStatus.SUCCESS);
      expect(result.metrics.completedSteps).toBe(1);
    });

    it('should aggregate multiple results', async () => {
      const context = contextManager.createContext('task-001', 'exec-001', 'module-001');
      context.setStatus(ExecutionStatus.COMPLETED);

      const results = [
        handler.createResult('task-001', context, []),
        handler.createResult('task-001', context, []),
        handler.createResult('task-001', context, [])
      ];

      results[0].status = ResultStatus.SUCCESS;
      results[1].status = ResultStatus.SUCCESS;
      results[2].status = ResultStatus.FAILURE;

      const aggregated = handler.aggregateResults(results);
      
      expect(aggregated.total).toBe(3);
      expect(aggregated.successful).toBe(2);
      expect(aggregated.failed).toBe(1);
      expect(aggregated.successRate).toBeCloseTo(0.67, 1);
    });
  });

  // ==================== 端到端集成测试 ====================

  describe('End-to-End Execution Flow', () => {
    it('should execute a complete task flow', async () => {
      // 初始化所有组件
      const contextManager = new ExecutionContextManager();
      const queue = new ExecutionQueue({ maxConcurrent: 5 });
      const monitor = new ExecutionMonitor();
      const executor = new StepExecutor();
      const resultHandler = new ExecutionResultHandler();
      const timeout = new ExecutionTimeout({ defaultTimeout: 5000 });

      // 创建执行上下文
      const context = contextManager.createContext('task-e2e', 'exec-e2e', 'main-module');
      context.setStatus(ExecutionStatus.RUNNING);

      // 入队任务
      const queueItem = await queue.enqueue('task-e2e', 'main-module', {
        taskId: 'task-e2e',
        params: { input: 10 },
        timestamp: Date.now()
      });

      monitor.recordTimelineEvent(TimelineEventType.TASK_STARTED, { taskId: 'task-e2e' });
      monitor.incrementCounter('tasks.started');

      // 定义并执行步骤
      const step = new StepBuilder('step-main', 'Main Step')
        .withAction(async (input) => ({ result: input.value * 2 }))
        .build();

      const stepResult = await executor.execute(step, { value: 10 }, context);
      
      expect(stepResult.status).toBe(StepStatus.COMPLETED);
      expect(stepResult.output.result).toBe(20);

      monitor.recordTimelineEvent(TimelineEventType.STEP_COMPLETED, { 
        taskId: 'task-e2e', 
        stepId: 'step-main' 
      });
      monitor.incrementCounter('steps.completed');

      // 完成任务
      queue.complete(queueItem.id, stepResult.output);
      context.setStatus(ExecutionStatus.COMPLETED);
      context.setOutput({ data: stepResult.output, success: true });

      monitor.recordTimelineEvent(TimelineEventType.TASK_COMPLETED, { taskId: 'task-e2e' });
      monitor.incrementCounter('tasks.completed');

      // 创建结果
      const executionResult = resultHandler.createResult('task-e2e', context, [stepResult]);
      
      expect(executionResult.status).toBe(ResultStatus.SUCCESS);
      expect(executionResult.output.result).toBe(20);

      // 验证监控数据
      const stats = monitor.getStats();
      expect(stats.total).toBeGreaterThan(0);

      // 清理
      monitor.destroy();
      timeout.destroy();
    });
  });
});
