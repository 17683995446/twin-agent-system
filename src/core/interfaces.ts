/**
 * 超长任务Agent树形双生子模块化执行系统
 * 核心接口定义 - 第1阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

// ============================================================================
// 基础类型定义
// ============================================================================

/** 任务唯一标识符 */
export type TaskId = string;

/** 模块唯一标识符 */
export type ModuleId = string;

/** 时间戳 */
export type Timestamp = number;

/** 版本号 */
export type Version = string;

/** 错误码 */
export type ErrorCode = string;

/** 状态码 */
export type StatusCode = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

// ============================================================================
// 第1个标准接口：ModuleInit - 模块初始化接口
// ============================================================================

/**
 * 任务参数 - 任务启动时传入的全局参数
 */
export interface TaskParam {
  /** 任务唯一标识 */
  taskId: TaskId;
  /** 任务名称 */
  taskName: string;
  /** 任务描述 */
  description?: string;
  /** 任务配置 */
  config: Record<string, unknown>;
  /** 任务优先级 */
  priority?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 创建时间 */
  createdAt: Timestamp;
  /** 父任务ID（子任务时填写） */
  parentTaskId?: TaskId;
}

/**
 * 模块初始化参数
 */
export interface ModuleInitParam {
  /** 模块ID */
  moduleId: ModuleId;
  /** 模块名称 */
  moduleName: string;
  /** 模块版本 */
  version: Version;
  /** 父模块ID（根模块为空） */
  parentModuleId?: ModuleId;
  /** 模块配置 */
  config?: Record<string, unknown>;
  /** 全局任务参数 */
  globalTaskParam: TaskParam;
}

/**
 * 初始化结果
 */
export interface InitResult {
  /** 是否初始化成功 */
  success: boolean;
  /** 模块实例ID */
  instanceId?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 错误码（失败时） */
  errorCode?: ErrorCode;
  /** 初始化后的模块状态 */
  initialState?: ModuleState;
  /** 初始化耗时（毫秒） */
  initTimeMs: number;
}

/**
 * 模块初始化接口函数类型
 */
export type ModuleInit = (params: ModuleInitParam) => Promise<InitResult> | InitResult;

// ============================================================================
// 第2个标准接口：ModuleRun - 核心执行接口
// ============================================================================

/**
 * 模块输入数据
 */
export interface ModuleInput {
  /** 输入数据ID */
  inputId: string;
  /** 输入数据内容 */
  data: unknown;
  /** 数据类型标识 */
  dataType: string;
  /** 输入来源模块ID */
  sourceModuleId?: ModuleId;
  /** 输入时间戳 */
  timestamp: Timestamp;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 模块输出数据
 */
export interface ModuleOutput {
  /** 输出数据ID */
  outputId: string;
  /** 输出数据内容 */
  data: unknown;
  /** 数据类型标识 */
  dataType: string;
  /** 目标模块ID（指定接收者） */
  targetModuleId?: ModuleId;
  /** 输出时间戳 */
  timestamp: Timestamp;
  /** 执行状态 */
  status: StatusCode;
  /** 执行耗时（毫秒） */
  executionTimeMs: number;
  /** 执行日志 */
  logs?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 核心执行接口函数类型
 */
export type ModuleRun = (input: ModuleInput) => Promise<ModuleOutput> | ModuleOutput;

// ============================================================================
// 第3个标准接口：ModuleCheck - 状态校验接口
// ============================================================================

/**
 * 模块状态
 */
export interface ModuleState {
  /** 状态ID */
  stateId: string;
  /** 所属模块ID */
  moduleId: ModuleId;
  /** 当前状态码 */
  status: StatusCode;
  /** 状态数据 */
  data: Record<string, unknown>;
  /** 状态创建时间 */
  createdAt: Timestamp;
  /** 状态更新时间 */
  updatedAt: Timestamp;
  /** 状态版本（用于乐观锁） */
  version: number;
  /** 校验和（完整性验证） */
  checksum?: string;
}

/**
 * 校验结果
 */
export interface CheckResult {
  /** 是否通过校验 */
  passed: boolean;
  /** 校验项列表 */
  checks: CheckItem[];
  /** 校验时间戳 */
  checkedAt: Timestamp;
  /** 校验耗时（毫秒） */
  checkTimeMs: number;
}

/**
 * 单个校验项
 */
export interface CheckItem {
  /** 校验项名称 */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 校验类型 */
  type: 'syntax' | 'semantic' | 'integrity' | 'security' | 'performance';
  /** 校验详情 */
  details?: string;
  /** 错误信息（未通过时） */
  error?: string;
  /** 严重程度 */
  severity?: 'info' | 'warning' | 'error' | 'critical';
}

/**
 * 状态校验接口函数类型
 */
export type ModuleCheck = (state: ModuleState) => Promise<CheckResult> | CheckResult;

// ============================================================================
// 第4个标准接口：ModuleSnapshot - 状态快照接口
// ============================================================================

/**
 * 快照数据
 */
export interface SnapshotData {
  /** 快照ID */
  snapshotId: string;
  /** 所属模块ID */
  moduleId: ModuleId;
  /** 快照创建时间 */
  createdAt: Timestamp;
  /** 快照版本 */
  version: Version;
  /** 模块状态数据 */
  state: ModuleState;
  /** 序列化后的状态数据 */
  serializedState: string;
  /** 压缩算法 */
  compression?: 'none' | 'gzip' | 'lz4';
  /** 加密标识 */
  encrypted?: boolean;
  /** 快照大小（字节） */
  sizeBytes: number;
  /** 校验和 */
  checksum: string;
  /** 父快照ID（增量快照） */
  parentSnapshotId?: string;
  /** 元数据 */
  metadata?: {
    /** 创建原因 */
    reason?: string;
    /** 创建者 */
    creator?: string;
    /** 标签 */
    tags?: string[];
    /** 自定义数据 */
    custom?: Record<string, unknown>;
  };
}

/**
 * 快照恢复结果
 */
export interface SnapshotRestoreResult {
  /** 是否恢复成功 */
  success: boolean;
  /** 恢复后的状态 */
  restoredState?: ModuleState;
  /** 错误信息（失败时） */
  error?: string;
  /** 恢复耗时（毫秒） */
  restoreTimeMs: number;
}

/**
 * 状态快照接口函数类型
 */
export type ModuleSnapshot = () => Promise<SnapshotData> | SnapshotData;

/**
 * 从快照恢复接口函数类型
 */
export type ModuleRestore = (snapshot: SnapshotData) => Promise<SnapshotRestoreResult> | SnapshotRestoreResult;

// ============================================================================
// 模块基类接口（所有模块必须实现）
// ============================================================================

/**
 * 模块基类接口
 * 所有模块（管控模块和执行模块）必须实现此接口
 */
export interface IBaseModule {
  /** 模块ID */
  readonly moduleId: ModuleId;
  /** 模块名称 */
  readonly moduleName: string;
  /** 模块版本 */
  readonly version: Version;
  /** 父模块ID */
  readonly parentModuleId?: ModuleId;
  /** 子模块列表（严格为2个，双子结构） */
  readonly childModules?: [IBaseModule, IBaseModule];
  
  /** 模块初始化 */
  init: ModuleInit;
  /** 核心执行 */
  run: ModuleRun;
  /** 状态校验 */
  check: ModuleCheck;
  /** 生成快照 */
  snapshot: ModuleSnapshot;
  /** 从快照恢复 */
  restore?: ModuleRestore;
  
  /** 获取当前状态 */
  getCurrentState(): ModuleState;
  /** 获取模块信息 */
  getModuleInfo(): ModuleInfo;
}

/**
 * 模块信息
 */
export interface ModuleInfo {
  moduleId: ModuleId;
  moduleName: string;
  version: Version;
  description?: string;
  author?: string;
  createdAt: Timestamp;
  capabilities: string[];
  dependencies: ModuleId[];
}

// ============================================================================
// 双子模块类型定义
// ============================================================================

/**
 * 管控模块（左节点）
 * 负责：规划、校验、监控、记忆、安全
 */
export interface IControlModule extends IBaseModule {
  readonly type: 'control';
  /** 管控特有的校验逻辑 */
  validate(input: ModuleInput): Promise<CheckResult>;
  /** 监控子模块状态 */
  monitor(childState: ModuleState): Promise<void>;
}

/**
 * 执行模块（右节点）
 * 负责：拆解、调用、落地、迭代、输出
 */
export interface IExecuteModule extends IBaseModule {
  readonly type: 'execute';
  /** 执行特有的处理逻辑 */
  execute(input: ModuleInput): Promise<ModuleOutput>;
  /** 处理执行结果 */
  processResult(output: ModuleOutput): Promise<void>;
}

/**
 * 双子模块对
 * 每个父模块必须包含恰好2个子模块：1个管控 + 1个执行
 */
export interface TwinModules {
  /** 管控模块（左） */
  control: IControlModule;
  /** 执行模块（右） */
  execute: IExecuteModule;
}

// ============================================================================
// 系统级接口
// ============================================================================

/**
 * 系统配置
 */
export interface SystemConfig {
  /** 系统名称 */
  systemName: string;
  /** 系统版本 */
  version: Version;
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** 快照间隔（毫秒） */
  snapshotIntervalMs: number;
  /** 最大任务深度 */
  maxTaskDepth: number;
  /** 状态存储配置 */
  storage: {
    type: 'memory' | 'file' | 'database';
    connectionString?: string;
    options?: Record<string, unknown>;
  };
  /** 安全策略 */
  security?: {
    enableEncryption: boolean;
    enableAudit: boolean;
    allowedOperations: string[];
  };
}

/**
 * 系统状态
 */
export interface SystemState {
  /** 系统ID */
  systemId: string;
  /** 启动时间 */
  startedAt: Timestamp;
  /** 当前任务数 */
  activeTasks: number;
  /** 完成任务数 */
  completedTasks: number;
  /** 失败任务数 */
  failedTasks: number;
  /** 系统健康状态 */
  health: 'healthy' | 'degraded' | 'unhealthy';
  /** 模块状态映射 */
  moduleStates: Map<ModuleId, ModuleState>;
}

// ============================================================================
// 错误定义
// ============================================================================

/**
 * 模块错误基类
 */
export class ModuleError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly moduleId?: ModuleId,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ModuleError';
  }
}

/**
 * 初始化错误
 */
export class InitError extends ModuleError {
  constructor(message: string, moduleId?: ModuleId, cause?: Error) {
    super(message, 'INIT_ERROR', moduleId, cause);
    this.name = 'InitError';
  }
}

/**
 * 执行错误
 */
export class ExecutionError extends ModuleError {
  constructor(message: string, moduleId?: ModuleId, cause?: Error) {
    super(message, 'EXECUTION_ERROR', moduleId, cause);
    this.name = 'ExecutionError';
  }
}

/**
 * 校验错误
 */
export class ValidationError extends ModuleError {
  constructor(message: string, moduleId?: ModuleId, cause?: Error) {
    super(message, 'VALIDATION_ERROR', moduleId, cause);
    this.name = 'ValidationError';
  }
}

/**
 * 快照错误
 */
export class SnapshotError extends ModuleError {
  constructor(message: string, moduleId?: ModuleId, cause?: Error) {
    super(message, 'SNAPSHOT_ERROR', moduleId, cause);
    this.name = 'SnapshotError';
  }
}

// ============================================================================
// 导出声明
// ============================================================================

/**
 * 接口版本
 */
export const INTERFACE_VERSION: Version = '1.0.0';

/**
 * 接口规范文档说明
 */
export const INTERFACE_SPEC = {
  version: INTERFACE_VERSION,
  description: '超长任务Agent树形双生子模块化执行系统 - 核心接口规范',
  interfaces: [
    { name: 'ModuleInit', description: '模块初始化接口', required: true },
    { name: 'ModuleRun', description: '核心执行接口', required: true },
    { name: 'ModuleCheck', description: '状态校验接口', required: true },
    { name: 'ModuleSnapshot', description: '状态快照接口', required: true }
  ],
  constraints: [
    '所有模块必须实现四个标准接口',
    '每个父模块必须恰好包含2个子模块（双子结构）',
    '模块间仅通过标准化接口通信',
    '禁止跨层、跨模块直接访问内部变量'
  ]
};
