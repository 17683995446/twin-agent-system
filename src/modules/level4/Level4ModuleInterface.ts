/**
 * 超长任务Agent树形双生子模块化执行系统
 * 四级模块扩展接口规范 - 第29阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 * 
 * 本文件定义四级及以下模块的扩展接口规范。
 * 架构扩展规则：任意层级任意模块，向下扩展永远只生成2个子模块。
 */

import {
  ModuleId, ModuleInitParam, InitResult, ModuleInput, ModuleOutput,
  ModuleState, CheckResult, SnapshotData, IBaseModule,
  StatusCode, ModuleInfo, TaskParam
} from '../../core/interfaces';

/**
 * 四级模块类型标识
 */
export type Level4ModuleType = 'control' | 'execute';

/**
 * 四级模块通用接口
 * 所有四级模块必须实现此接口
 */
export interface ILevel4Module extends IBaseModule {
  /** 模块层级（固定为4） */
  readonly level: 4;
  /** 模块类型 */
  readonly moduleType: Level4ModuleType;
}

/**
 * 四级管控模块接口
 */
export interface ILevel4ControlModule extends ILevel4Module {
  readonly moduleType: 'control';
  /** 精细化校验 */
  fineGrainedValidate(input: ModuleInput): Promise<CheckResult>;
}

/**
 * 四级执行模块接口
 */
export interface ILevel4ExecuteModule extends ILevel4Module {
  readonly moduleType: 'execute';
  /** 精细化执行 */
  fineGrainedExecute(input: ModuleInput): Promise<ModuleOutput>;
}

/**
 * 四级模块抽象基类
 * 提供四级模块的通用实现模板
 */
export abstract class BaseLevel4Module implements ILevel4Module {
  public readonly level: 4 = 4;
  public abstract readonly moduleType: Level4ModuleType;
  public abstract readonly moduleId: ModuleId;
  public abstract readonly moduleName: string;
  public readonly version: string = '1.0.0';
  public abstract readonly parentModuleId: ModuleId;
  public childModules?: [IBaseModule, IBaseModule];

  private _state: ModuleState;
  private _initialized: boolean = false;
  private _stateVersion: number = 0;

  constructor(moduleId: ModuleId, moduleName: string, parentModuleId: ModuleId, moduleType: Level4ModuleType) {
    this._state = this._createInitialState(moduleId);
    Object.defineProperty(this, 'moduleId', { value: moduleId, writable: false });
    Object.defineProperty(this, 'moduleName', { value: moduleName, writable: false });
    Object.defineProperty(this, 'parentModuleId', { value: parentModuleId, writable: false });
    Object.defineProperty(this, 'moduleType', { value: moduleType, writable: false });
  }

  public async init(params: ModuleInitParam): Promise<InitResult> {
    const startTime = Date.now();
    try {
      if (params.parentModuleId !== this.parentModuleId) {
        throw new Error(`父模块ID不匹配: 期望 ${this.parentModuleId}`);
      }
      await this._onInit(params);
      if (this.childModules) {
        for (const child of this.childModules) {
          const r = await child.init({ moduleId: child.moduleId, moduleName: child.moduleName, version: child.version, parentModuleId: this.moduleId, globalTaskParam: params.globalTaskParam });
          if (!r.success) throw new Error(`子模块 ${child.moduleId} 初始化失败`);
        }
      }
      this._updateState('pending');
      this._initialized = true;
      return { success: true, instanceId: `instance_${this.moduleId}_${Date.now()}`, initialState: this._state, initTimeMs: Date.now() - startTime };
    } catch (error) {
      this._updateState('failed');
      return { success: false, error: error instanceof Error ? error.message : String(error), errorCode: 'INIT_ERROR', initTimeMs: Date.now() - startTime };
    }
  }

  public async run(input: ModuleInput): Promise<ModuleOutput> {
    const startTime = Date.now();
    try {
      if (!this._initialized) throw new Error('模块未初始化');
      this._updateState('running');
      const result = await this._onRun(input);
      this._updateState('completed');
      return { ...result, executionTimeMs: Date.now() - startTime };
    } catch (error) {
      this._updateState('failed');
      return { outputId: `out_${Date.now()}`, data: { error: error instanceof Error ? error.message : String(error) }, dataType: 'error', timestamp: Date.now(), status: 'failed', executionTimeMs: Date.now() - startTime };
    }
  }

  public async check(state: ModuleState): Promise<CheckResult> {
    const checks = [this._checkSyntax(state), this._checkSemantic(state)];
    const custom = await this._onCheck(state);
    checks.push(...custom);
    return { passed: checks.every(c => c.passed), checks, checkedAt: Date.now(), checkTimeMs: 0 };
  }

  public async snapshot(): Promise<SnapshotData> {
    const s = JSON.stringify(this._state);
    return { snapshotId: `snap_${Date.now()}`, moduleId: this.moduleId, createdAt: Date.now(), version: this.version, state: { ...this._state }, serializedState: s, compression: 'none', encrypted: false, sizeBytes: s.length, checksum: this._checksum(s), metadata: { reason: 'auto', creator: this.moduleId, tags: ['level4', this.moduleType] } };
  }

  public getCurrentState(): ModuleState { return { ...this._state }; }

  public getModuleInfo(): ModuleInfo {
    return { moduleId: this.moduleId, moduleName: this.moduleName, version: this.version, description: `四级${this.moduleType === 'control' ? '管控' : '执行'}模块`, createdAt: Date.now(), capabilities: [this.moduleType === 'control' ? 'fine-grained-control' : 'fine-grained-execution'], dependencies: [this.parentModuleId] };
  }

  protected abstract _onInit(params: ModuleInitParam): Promise<void>;
  protected abstract _onRun(input: ModuleInput): Promise<ModuleOutput>;
  protected abstract _onCheck(state: ModuleState): Promise<CheckResult['checks']>;

  private _createInitialState(moduleId: ModuleId): ModuleState {
    return { stateId: `state_${moduleId}_${Date.now()}`, moduleId, status: 'pending', data: {}, createdAt: Date.now(), updatedAt: Date.now(), version: 0 };
  }

  private _updateState(status: StatusCode): void {
    this._stateVersion++;
    this._state = { ...this._state, status, updatedAt: Date.now(), version: this._stateVersion };
  }

  private _checkSyntax(state: ModuleState): CheckResult['checks'][0] { return { name: '语法校验', passed: !!state.stateId, type: 'syntax' }; }
  private _checkSemantic(state: ModuleState): CheckResult['checks'][0] { return { name: '语义校验', passed: ['pending', 'running', 'completed', 'failed', 'paused'].includes(state.status), type: 'semantic' }; }
  private _checksum(data: string): string { let h = 0; for (let i = 0; i < data.length; i++) h = ((h << 5) - h) + data.charCodeAt(i), h = h & h; return h.toString(16); }
}

/**
 * 四级模块注册表
 * 用于动态注册和管理四级模块
 */
export class Level4ModuleRegistry {
  private _modules: Map<ModuleId, ILevel4Module> = new Map();
  private _factories: Map<string, new (parentId: ModuleId) => ILevel4Module> = new Map();

  /** 注册模块工厂 */
  public registerFactory(type: string, factory: new (parentId: ModuleId) => ILevel4Module): void {
    this._factories.set(type, factory);
  }

  /** 创建模块实例 */
  public createModule(type: string, parentId: ModuleId): ILevel4Module | undefined {
    const factory = this._factories.get(type);
    if (!factory) return undefined;
    const module = new factory(parentId);
    this._modules.set(module.moduleId, module);
    return module;
  }

  /** 获取已注册的模块 */
  public getModule(moduleId: ModuleId): ILevel4Module | undefined {
    return this._modules.get(moduleId);
  }

  /** 获取所有模块 */
  public getAllModules(): ILevel4Module[] {
    return Array.from(this._modules.values());
  }
}

/**
 * 扩展规范声明
 * 
 * 后续新增任意层级模块必须遵守：
 * 1. 新增父模块必须拆分恰好2个直接子模块
 * 2. 所有新增模块严格封装，仅暴露4类标准接口
 * 3. 保持「管控模块 + 执行模块」的双子配对范式
 * 4. 使用BaseLevel4Module作为四级模块的基类
 */
export const LEVEL4_EXTENSION_SPEC = {
  version: '1.0.0',
  rules: [
    '每个父模块恰好包含2个子模块',
    '仅暴露ModuleInit/ModuleRun/ModuleCheck/ModuleSnapshot四个标准接口',
    '保持管控+执行的双子配对范式',
    '模块内部状态完全封装'
  ]
};
