/**
 * 第39阶段：权限系统集成测试
 * Permission System Integration Tests
 * 
 * 测试完整的准入控制流程，包括：
 * - 规则引擎与权限验证的协同
 * - 违规检测与修正指令生成
 * - 规则动态加载与审计日志
 * - 端到端的访问控制场景
 */

import { AccessRuleEngine, AccessRule, RuleAction } from '../core/AccessRuleEngine';
import { PermissionValidator, Role, Permission } from '../core/PermissionValidator';
import { ViolationDetector, DetectionContext, ViolationSeverity } from '../core/ViolationDetector';
import { CorrectionGenerator, CorrectionAction } from '../core/CorrectionGenerator';
import { RuleLoader, RuleSourceType } from '../core/RuleLoader';
import { AccessAuditLogger, MemoryAuditStorage } from '../core/AccessAuditLogger';
import { TaskParamValidator, ValidationRule } from '../core/TaskParamValidator';
import { TaskInitializer } from '../core/TaskInitializer';
import { ModuleInput, ModuleContext } from '../core/interfaces';

// 测试工具类
class TestContextBuilder {
  private _input: ModuleInput = {
    taskId: '',
    params: {},
    timestamp: Date.now()
  };
  private _context: ModuleContext = {
    executionId: '',
    parentModuleId: undefined,
    siblingModuleId: undefined,
    sharedState: new Map()
  };

  withTaskId(taskId: string): TestContextBuilder {
    this._input.taskId = taskId;
    return this;
  }

  withParams(params: Record<string, any>): TestContextBuilder {
    this._input.params = params;
    return this;
  }

  withExecutionId(executionId: string): TestContextBuilder {
    this._context.executionId = executionId;
    return this;
  }

  withUser(userId: string, role: string): TestContextBuilder {
    this._input.params.userId = userId;
    this._input.params.userRole = role;
    return this;
  }

  withResource(resource: string, action: string): TestContextBuilder {
    this._input.params.resource = resource;
    this._input.params.action = action;
    return this;
  }

  build(): { input: ModuleInput; context: ModuleContext } {
    return { input: this._input, context: this._context };
  }
}

// 集成测试套件
describe('Permission System Integration Tests', () => {
  let ruleEngine: AccessRuleEngine;
  let permissionValidator: PermissionValidator;
  let violationDetector: ViolationDetector;
  let correctionGenerator: CorrectionGenerator;
  let ruleLoader: RuleLoader;
  let auditLogger: AccessAuditLogger;
  let paramValidator: TaskParamValidator;
  let taskInitializer: TaskInitializer;

  beforeEach(() => {
    // 初始化所有组件
    ruleEngine = new AccessRuleEngine();
    permissionValidator = new PermissionValidator();
    violationDetector = new ViolationDetector();
    correctionGenerator = new CorrectionGenerator();
    ruleLoader = new RuleLoader();
    auditLogger = new AccessAuditLogger(new MemoryAuditStorage());
    paramValidator = new TaskParamValidator();
    taskInitializer = new TaskInitializer();

    // 设置基础角色和权限
    setupBaseRoles();
    setupBaseRules();
    setupBaseDetectionRules();
  });

  // 设置基础角色
  function setupBaseRoles(): void {
    const adminRole: Role = {
      id: 'admin',
      name: 'Administrator',
      permissions: [
        { resource: '*', actions: ['*'], conditions: [] },
        { resource: 'system', actions: ['config', 'monitor', 'shutdown'], conditions: [] }
      ],
      parentRoles: []
    };

    const managerRole: Role = {
      id: 'manager',
      name: 'Manager',
      permissions: [
        { resource: 'tasks', actions: ['create', 'read', 'update', 'delete'], conditions: [] },
        { resource: 'users', actions: ['read', 'update'], conditions: [] },
        { resource: 'reports', actions: ['read', 'export'], conditions: [] }
      ],
      parentRoles: []
    };

    const userRole: Role = {
      id: 'user',
      name: 'Standard User',
      permissions: [
        { resource: 'tasks', actions: ['create', 'read'], conditions: [{ type: 'ownership', value: 'self' }] },
        { resource: 'profile', actions: ['read', 'update'], conditions: [] }
      ],
      parentRoles: []
    };

    const guestRole: Role = {
      id: 'guest',
      name: 'Guest',
      permissions: [
        { resource: 'public', actions: ['read'], conditions: [] }
      ],
      parentRoles: []
    };

    permissionValidator.registerRole(adminRole);
    permissionValidator.registerRole(managerRole);
    permissionValidator.registerRole(userRole);
    permissionValidator.registerRole(guestRole);
  }

  // 设置基础规则
  function setupBaseRules(): void {
    // 工作时间限制规则
    const businessHoursRule: AccessRule = {
      id: 'business-hours',
      name: 'Business Hours Only',
      priority: 100,
      conditions: [
        {
          field: 'timestamp',
          operator: 'custom',
          value: (timestamp: number) => {
            const hour = new Date(timestamp).getHours();
            return hour >= 9 && hour < 18;
          }
        }
      ],
      action: 'allow',
      enabled: true
    };

    // 管理员绕过规则
    const adminBypassRule: AccessRule = {
      id: 'admin-bypass',
      name: 'Admin Bypass',
      priority: 200,
      conditions: [
        { field: 'userRole', operator: 'equals', value: 'admin' }
      ],
      action: 'allow',
      enabled: true
    };

    // IP白名单规则
    const ipWhitelistRule: AccessRule = {
      id: 'ip-whitelist',
      name: 'IP Whitelist',
      priority: 150,
      conditions: [
        {
          field: 'clientIp',
          operator: 'custom',
          value: (ip: string) => {
            const allowedIps = ['192.168.1.0/24', '10.0.0.0/8', '127.0.0.1'];
            return allowedIps.some(allowed => ip.startsWith(allowed.split('/')[0]));
          }
        }
      ],
      action: 'allow',
      enabled: true
    };

    // 敏感操作需要MFA
    const mfaRequiredRule: AccessRule = {
      id: 'mfa-required',
      name: 'MFA Required for Sensitive Operations',
      priority: 180,
      conditions: [
        {
          field: 'action',
          operator: 'custom',
          value: (action: string) => ['delete', 'shutdown', 'config'].includes(action)
        },
        { field: 'mfaVerified', operator: 'equals', value: false }
      ],
      action: 'deny',
      enabled: true
    };

    ruleEngine.registerRule(businessHoursRule);
    ruleEngine.registerRule(adminBypassRule);
    ruleEngine.registerRule(ipWhitelistRule);
    ruleEngine.registerRule(mfaRequiredRule);
  }

  // 设置基础检测规则
  function setupBaseDetectionRules(): void {
    // 添加自定义检测规则
    violationDetector.registerRule({
      id: 'test-unusual-access-pattern',
      name: 'Unusual Access Pattern',
      description: 'Detects unusual access patterns',
      severity: ViolationSeverity.WARNING,
      enabled: true,
      check: async (context: DetectionContext) => {
        // 模拟检测逻辑
        const accessCount = context.metrics?.get('accessCount') || 0;
        if (accessCount > 100) {
          return {
            detected: true,
            message: `Unusual access pattern detected: ${accessCount} accesses`,
            details: { accessCount },
            suggestedAction: CorrectionAction.THROTTLE
          };
        }
        return { detected: false };
      }
    });
  }

  describe('Scenario 1: Normal User Access Flow', () => {
    it('should allow standard user to create task during business hours', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-001')
        .withExecutionId('exec-001')
        .withUser('user-001', 'user')
        .withResource('tasks', 'create')
        .withParams({
          clientIp: '192.168.1.100',
          timestamp: new Date('2024-01-15T10:00:00').getTime() // 业务时间
        });

      const { input, context } = builder.build();

      // 1. 参数验证
      const paramValidation = await paramValidator.validate(input.params, [
        { field: 'userId', type: 'required' },
        { field: 'resource', type: 'required' },
        { field: 'action', type: 'required' }
      ]);
      expect(paramValidation.valid).toBe(true);

      // 2. 任务初始化
      const initializedInput = await taskInitializer.initialize(input);
      expect(initializedInput.taskId).toBeDefined();

      // 3. 记录访问尝试
      await auditLogger.logAccessAttempt(initializedInput, 'Level3AccessControlModule');

      // 4. 规则引擎检查
      const ruleResult = await ruleEngine.execute(initializedInput);
      expect(ruleResult.action).toBe('allow');

      // 5. 权限验证
      const hasPermission = await permissionValidator.validate(
        initializedInput.params.userRole as string,
        initializedInput.params.resource as string,
        initializedInput.params.action as string,
        initializedInput.params
      );
      expect(hasPermission).toBe(true);

      // 6. 违规检测
      const detectionContext: DetectionContext = {
        input: initializedInput,
        context,
        metrics: new Map([['accessCount', 5]]),
        history: []
      };
      const violations = await violationDetector.detect(detectionContext);
      expect(violations.length).toBe(0);
      expect(violationDetector.shouldBlock()).toBe(false);

      // 7. 记录访问授权
      await auditLogger.logAccessGranted(initializedInput, 'Level3AccessControlModule');

      // 8. 验证审计日志
      const logs = await (auditLogger as any)._storage.query({
        startTime: Date.now() - 60000,
        endTime: Date.now()
      });
      expect(logs.length).toBe(2); // access_attempt + access_granted
    });

    it('should deny access outside business hours for non-admin users', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-002')
        .withExecutionId('exec-002')
        .withUser('user-002', 'user')
        .withResource('tasks', 'create')
        .withParams({
          clientIp: '192.168.1.100',
          timestamp: new Date('2024-01-15T20:00:00').getTime() // 非业务时间
        });

      const { input } = builder.build();

      // 记录访问尝试
      await auditLogger.logAccessAttempt(input, 'Level3AccessControlModule');

      // 规则引擎检查 - 应该被拒绝
      const ruleResult = await ruleEngine.execute(input);
      expect(ruleResult.action).toBe('deny');
      expect(ruleResult.matchedRules).toContain('business-hours');

      // 记录访问拒绝
      await auditLogger.logAccessDenied(input, 'Level3AccessControlModule', ruleResult.reason || 'Outside business hours');

      // 验证日志
      const logs = await (auditLogger as any)._storage.query({});
      const deniedLog = logs.find((log: any) => log.eventType === 'access_denied');
      expect(deniedLog).toBeDefined();
    });
  });

  describe('Scenario 2: Admin Privilege Escalation', () => {
    it('should allow admin to bypass business hours restriction', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-003')
        .withExecutionId('exec-003')
        .withUser('admin-001', 'admin')
        .withResource('system', 'config')
        .withParams({
          clientIp: '192.168.1.10',
          timestamp: new Date('2024-01-15T22:00:00').getTime(), // 非业务时间
          mfaVerified: true
        });

      const { input, context } = builder.build();

      await auditLogger.logAccessAttempt(input, 'Level3AccessControlModule');

      // 规则引擎检查 - 管理员应该被允许
      const ruleResult = await ruleEngine.execute(input);
      expect(ruleResult.action).toBe('allow');
      expect(ruleResult.matchedRules).toContain('admin-bypass');

      // 权限验证
      const hasPermission = await permissionValidator.validate(
        input.params.userRole as string,
        input.params.resource as string,
        input.params.action as string
      );
      expect(hasPermission).toBe(true);

      // 违规检测
      const detectionContext: DetectionContext = {
        input,
        context,
        metrics: new Map(),
        history: []
      };
      const violations = await violationDetector.detect(detectionContext);
      expect(violations.length).toBe(0);

      await auditLogger.logAccessGranted(input, 'Level3AccessControlModule');
    });

    it('should require MFA for admin sensitive operations', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-004')
        .withExecutionId('exec-004')
        .withUser('admin-002', 'admin')
        .withResource('system', 'shutdown')
        .withParams({
          clientIp: '192.168.1.10',
          timestamp: new Date('2024-01-15T10:00:00').getTime(),
          mfaVerified: false // 未验证MFA
        });

      const { input } = builder.build();

      await auditLogger.logAccessAttempt(input, 'Level3AccessControlModule');

      // 规则引擎检查 - 应该被拒绝因为缺少MFA
      const ruleResult = await ruleEngine.execute(input);
      expect(ruleResult.action).toBe('deny');
      expect(ruleResult.matchedRules).toContain('mfa-required');

      await auditLogger.logAccessDenied(input, 'Level3AccessControlModule', 'MFA required for sensitive operations');
    });
  });

  describe('Scenario 3: Violation Detection and Correction', () => {
    it('should detect and correct rate limit violation', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-005')
        .withExecutionId('exec-005')
        .withUser('user-003', 'user')
        .withResource('tasks', 'create')
        .withParams({
          clientIp: '192.168.1.100',
          timestamp: Date.now()
        });

      const { input, context } = builder.build();

      // 模拟高频访问
      const detectionContext: DetectionContext = {
        input,
        context,
        metrics: new Map([
          ['requestCount', 150],
          ['timeWindow', 60000]
        ]),
        history: Array(150).fill(null).map((_, i) => ({
          timestamp: Date.now() - i * 100,
          action: 'request'
        }))
      };

      // 检测违规
      const violations = await violationDetector.detect(detectionContext);
      expect(violations.length).toBeGreaterThan(0);

      const rateLimitViolation = violations.find(v => v.ruleId === 'rate-limit-check');
      expect(rateLimitViolation).toBeDefined();

      // 记录违规
      await auditLogger.logViolationDetected(rateLimitViolation!, context);

      // 生成修正指令
      const correction = correctionGenerator.generateCommand(rateLimitViolation!);
      expect(correction).not.toBeNull();
      expect(correction?.action).toBe(CorrectionAction.THROTTLE);

      // 记录修正应用
      await auditLogger.logCorrectionApplied(rateLimitViolation!, correction!, context);

      // 验证系统应该阻塞
      expect(violationDetector.shouldBlock()).toBe(true);
    });

    it('should detect resource overuse and suggest escalation', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-006')
        .withExecutionId('exec-006')
        .withUser('user-004', 'user')
        .withParams({
          clientIp: '192.168.1.100',
          timestamp: Date.now()
        });

      const { input, context } = builder.build();

      const detectionContext: DetectionContext = {
        input,
        context,
        metrics: new Map([
          ['cpuUsage', 95],
          ['memoryUsage', 90],
          ['duration', 600000] // 10分钟
        ]),
        history: []
      };

      const violations = await violationDetector.detect(detectionContext);
      const resourceViolation = violations.find(v => v.ruleId === 'resource-overuse');

      if (resourceViolation) {
        const correction = correctionGenerator.generateCommand(resourceViolation);
        expect(correction?.action).toBe(CorrectionAction.ESCALATE);
      }
    });
  });

  describe('Scenario 4: Dynamic Rule Loading', () => {
    it('should load and apply rules from memory source', async () => {
      // 注册内存规则源
      ruleLoader.registerSource({
        id: 'memory-rules',
        type: RuleSourceType.MEMORY,
        config: {
          rules: [
            {
              id: 'dynamic-test-rule',
              name: 'Dynamic Test Rule',
              priority: 300,
              conditions: [
                { field: 'testFlag', operator: 'equals', value: true }
              ],
              action: 'allow' as RuleAction,
              enabled: true
            }
          ]
        },
        autoReload: false
      });

      // 加载规则
      const loadResult = await ruleLoader.loadFromSource('memory-rules');
      expect(loadResult.success).toBe(true);
      expect(loadResult.rules.length).toBe(1);

      // 注册到规则引擎
      for (const rule of loadResult.rules) {
        ruleEngine.registerRule(rule);
      }

      // 测试动态规则
      const builder = new TestContextBuilder()
        .withTaskId('task-007')
        .withParams({
          testFlag: true,
          timestamp: Date.now()
        });

      const { input } = builder.build();
      const result = await ruleEngine.execute(input);
      expect(result.action).toBe('allow');
      expect(result.matchedRules).toContain('dynamic-test-rule');
    });

    it('should handle rule loading errors gracefully', async () => {
      ruleLoader.registerSource({
        id: 'invalid-source',
        type: RuleSourceType.FILE,
        config: { path: '/nonexistent/path/rules.json' },
        autoReload: false
      });

      const loadResult = await ruleLoader.loadFromSource('invalid-source');
      expect(loadResult.success).toBe(false);
      expect(loadResult.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 5: Complex Multi-Stage Access Control', () => {
    it('should handle complete access control pipeline', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-008')
        .withExecutionId('exec-008')
        .withUser('manager-001', 'manager')
        .withResource('reports', 'export')
        .withParams({
          clientIp: '192.168.1.50',
          timestamp: new Date('2024-01-15T14:00:00').getTime(),
          reportType: 'financial',
          dateRange: { start: '2024-01-01', end: '2024-01-31' }
        });

      const { input, context } = builder.build();

      // Stage 1: 参数验证
      const validationRules: ValidationRule[] = [
        { field: 'userId', type: 'required' },
        { field: 'userRole', type: 'required' },
        { field: 'clientIp', type: 'pattern', pattern: /^\d+\.\d+\.\d+\.\d+$/ },
        { field: 'reportType', type: 'enum', allowedValues: ['financial', 'operational', 'audit'] },
        {
          field: 'dateRange',
          type: 'custom',
          validator: (value: any) => {
            return value && value.start && value.end && new Date(value.start) <= new Date(value.end);
          }
        }
      ];

      const paramValidation = await paramValidator.validate(input.params, validationRules);
      expect(paramValidation.valid).toBe(true);

      // Stage 2: 记录访问尝试
      await auditLogger.logAccessAttempt(input, 'Level3AccessControlModule');

      // Stage 3: 规则引擎执行
      const ruleResult = await ruleEngine.execute(input);
      expect(ruleResult.action).toBe('allow');

      // Stage 4: 权限验证
      const hasPermission = await permissionValidator.validate(
        input.params.userRole as string,
        input.params.resource as string,
        input.params.action as string
      );
      expect(hasPermission).toBe(true);

      // Stage 5: 违规检测
      const detectionContext: DetectionContext = {
        input,
        context,
        metrics: new Map([
          ['accessCount', 10],
          ['lastAccessTime', Date.now() - 60000]
        ]),
        history: []
      };

      const violations = await violationDetector.detect(detectionContext);
      expect(violations.length).toBe(0);

      // Stage 6: 记录访问授权
      await auditLogger.logAccessGranted(input, 'Level3AccessControlModule');

      // Stage 7: 生成审计报告
      const report = await auditLogger.generateReport(
        Date.now() - 3600000,
        Date.now()
      );
      expect(report).toContain('Access Audit Report');
      expect(report).toContain('task-008');
    });

    it('should detect and handle security breach attempt', async () => {
      const builder = new TestContextBuilder()
        .withTaskId('task-009')
        .withExecutionId('exec-009')
        .withUser('attacker', 'guest')
        .withResource('system', 'config')
        .withParams({
          clientIp: '192.168.1.200',
          timestamp: Date.now(),
          // 尝试注入攻击
          payload: "'; DROP TABLE users; --"
        });

      const { input, context } = builder.build();

      // 尝试参数验证 - 应该检测到注入攻击
      const securityValidation = await paramValidator.validateSecurity(input.params);
      expect(securityValidation.safe).toBe(false);
      expect(securityValidation.issues.length).toBeGreaterThan(0);

      // 记录访问尝试
      await auditLogger.logAccessAttempt(input, 'Level3AccessControlModule');

      // 权限验证 - 应该失败
      const hasPermission = await permissionValidator.validate(
        input.params.userRole as string,
        input.params.resource as string,
        input.params.action as string
      );
      expect(hasPermission).toBe(false);

      // 记录权限检查
      await auditLogger.logPermissionChecked(
        input,
        input.params.resource as string,
        input.params.action as string,
        false
      );

      // 记录访问拒绝
      await auditLogger.logAccessDenied(input, 'Level3AccessControlModule', 'Permission denied');
    });
  });

  describe('Scenario 6: Audit Log Query and Reporting', () => {
    it('should generate comprehensive audit report', async () => {
      // 创建多个审计事件
      const events = [
        { taskId: 'task-010', userRole: 'admin', action: 'access_attempt', resource: 'system' },
        { taskId: 'task-011', userRole: 'user', action: 'access_attempt', resource: 'tasks' },
        { taskId: 'task-011', userRole: 'user', action: 'access_granted', resource: 'tasks' },
        { taskId: 'task-012', userRole: 'guest', action: 'access_attempt', resource: 'reports' },
        { taskId: 'task-012', userRole: 'guest', action: 'access_denied', resource: 'reports' }
      ];

      for (const event of events) {
        const builder = new TestContextBuilder()
          .withTaskId(event.taskId)
          .withUser('test-user', event.userRole)
          .withResource(event.resource, 'read')
          .withParams({ timestamp: Date.now() });

        const { input } = builder.build();

        if (event.action === 'access_attempt') {
          await auditLogger.logAccessAttempt(input, 'TestModule');
        } else if (event.action === 'access_granted') {
          await auditLogger.logAccessGranted(input, 'TestModule');
        } else if (event.action === 'access_denied') {
          await auditLogger.logAccessDenied(input, 'TestModule', 'Test denial');
        }
      }

      // 生成报告
      const startTime = Date.now() - 60000;
      const endTime = Date.now();
      const report = await auditLogger.generateReport(startTime, endTime);

      expect(report).toContain('Access Audit Report');
      expect(report).toContain('Total Events: 5');
      expect(report).toContain('Access Granted: 1');
      expect(report).toContain('Access Denied: 1');
    });

    it('should query logs with filters', async () => {
      // 创建测试日志
      const builder = new TestContextBuilder()
        .withTaskId('task-013')
        .withUser('test-user', 'manager')
        .withParams({ timestamp: Date.now() });

      const { input } = builder.build();
      await auditLogger.logAccessAttempt(input, 'TestModule');

      // 查询日志
      const logs = await (auditLogger as any)._storage.query({
        eventTypes: ['access_attempt'],
        startTime: Date.now() - 60000,
        endTime: Date.now()
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].eventType).toBe('access_attempt');
      expect(logs[0].taskId).toBe('task-013');
    });
  });
});

// 导出测试套件供外部使用
export { TestContextBuilder };
