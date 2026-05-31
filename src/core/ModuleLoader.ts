/**
 * 超长任务Agent树形双生子模块化执行系统
 * 模块加载器（三级模块挂载机制） - 第15阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { IBaseModule, ModuleId, ModuleInitParam } from './interfaces';

/**
 * 模块加载配置
 */
export interface ModuleLoadConfig {
  moduleId: ModuleId;
  moduleClass: new () => IBaseModule;
  parentModuleId?: ModuleId;
}

/**
 * 模块加载器
 * 
 * 职责：
 * 1. 三级子模块的动态挂载
 * 2. 模块初始化管理
 * 3. 模块依赖解析
 */
export class ModuleLoader {
  private _modules: Map<ModuleId, IBaseModule> = new Map();
  private _configs: Map<ModuleId, ModuleLoadConfig> = new Map();

  /**
   * 注册模块配置
   */
  public register(config: ModuleLoadConfig): void {
    this._configs.set(config.moduleId, config);
  }

  /**
   * 加载模块
   */
  public async load(moduleId: ModuleId, parentParam?: ModuleInitParam): Promise<IBaseModule> {
    const config = this._configs.get(moduleId);
    if (!config) {
      throw new Error(`模块配置未找到: ${moduleId}`);
    }

    // 创建模块实例
    const module = new config.moduleClass();
    this._modules.set(moduleId, module);

    // 初始化模块
    if (parentParam) {
      await module.init({
        moduleId: module.moduleId,
        moduleName: module.moduleName,
        version: module.version,
        parentModuleId: config.parentModuleId,
        globalTaskParam: parentParam.globalTaskParam
      });
    }

    return module;
  }

  /**
   * 挂载子模块
   */
  public async mountChildModules(parentModule: IBaseModule, childConfigs: ModuleLoadConfig[]): Promise<void> {
    if (childConfigs.length !== 2) {
      throw new Error(`双子结构要求恰好2个子模块，实际: ${childConfigs.length}`);
    }

    const children: IBaseModule[] = [];
    for (const config of childConfigs) {
      const child = await this.load(config.moduleId);
      children.push(child);
    }

    // 挂载到父模块
    (parentModule as unknown as { childModules: [IBaseModule, IBaseModule] }).childModules = children as [IBaseModule, IBaseModule];
  }

  /**
   * 获取已加载的模块
   */
  public getModule(moduleId: ModuleId): IBaseModule | undefined {
    return this._modules.get(moduleId);
  }

  /**
   * 获取所有已加载的模块
   */
  public getAllModules(): IBaseModule[] {
    return Array.from(this._modules.values());
  }

  /**
   * 卸载模块
   */
  public unload(moduleId: ModuleId): boolean {
    return this._modules.delete(moduleId);
  }
}

export default ModuleLoader;
