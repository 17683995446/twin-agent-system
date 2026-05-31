/**
 * 超长任务Agent树形双生子模块化执行系统
 * 规则动态加载器 - 第37阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { AccessRule } from './AccessRuleEngine';

/**
 * 规则源类型
 */
export type RuleSourceType = 'file' | 'database' | 'api' | 'memory';

/**
 * 规则源配置
 */
export interface RuleSourceConfig {
  type: RuleSourceType;
  location: string;
  refreshIntervalMs?: number;
  autoReload?: boolean;
}

/**
 * 加载的模块
 */
export interface LoadedRuleModule {
  id: string;
  name: string;
  rules: AccessRule[];
  loadedAt: number;
  version: string;
}

/**
 * 加载结果
 */
export interface RuleLoadResult {
  success: boolean;
  moduleId?: string;
  rulesLoaded: number;
  errors: string[];
  loadTimeMs: number;
}

/**
 * 规则动态加载器
 * 
 * 职责：
 * 1. 规则的动态加载
 * 2. 规则的热更新
 * 3. 规则版本管理
 * 4. 规则卸载
 */
export class RuleLoader {
  private _sources: Map<string, RuleSourceConfig> = new Map();
  private _loadedModules: Map<string, LoadedRuleModule> = new Map();
  private _loadHistory: Array<{ timestamp: number; moduleId: string; success: boolean }> = [];
  private _reloadTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * 注册规则源
   */
  public registerSource(sourceId: string, config: RuleSourceConfig): void {
    this._sources.set(sourceId, config);

    // 设置自动刷新
    if (config.autoReload && config.refreshIntervalMs && config.refreshIntervalMs > 0) {
      this._setupAutoReload(sourceId, config);
    }
  }

  /**
   * 移除规则源
   */
  public unregisterSource(sourceId: string): boolean {
    // 清除定时器
    const timer = this._reloadTimers.get(sourceId);
    if (timer) {
      clearInterval(timer);
      this._reloadTimers.delete(sourceId);
    }

    return this._sources.delete(sourceId);
  }

  /**
   * 从源加载规则
   */
  public async loadFromSource(sourceId: string): Promise<RuleLoadResult> {
    const startTime = Date.now();
    const source = this._sources.get(sourceId);

    if (!source) {
      return {
        success: false,
        rulesLoaded: 0,
        errors: [`规则源不存在: ${sourceId}`],
        loadTimeMs: Date.now() - startTime
      };
    }

    try {
      let rules: AccessRule[] = [];

      switch (source.type) {
        case 'file':
          rules = await this._loadFromFile(source.location);
          break;
        case 'database':
          rules = await this._loadFromDatabase(source.location);
          break;
        case 'api':
          rules = await this._loadFromApi(source.location);
          break;
        case 'memory':
          rules = this._loadFromMemory(source.location);
          break;
        default:
          throw new Error(`不支持的规则源类型: ${source.type}`);
      }

      // 创建模块
      const module: LoadedRuleModule = {
        id: sourceId,
        name: `module_${sourceId}`,
        rules,
        loadedAt: Date.now(),
        version: this._generateVersion()
      };

      this._loadedModules.set(sourceId, module);
      this._loadHistory.push({ timestamp: Date.now(), moduleId: sourceId, success: true });

      return {
        success: true,
        moduleId: sourceId,
        rulesLoaded: rules.length,
        errors: [],
        loadTimeMs: Date.now() - startTime
      };
    } catch (error) {
      this._loadHistory.push({ timestamp: Date.now(), moduleId: sourceId, success: false });
      return {
        success: false,
        rulesLoaded: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        loadTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * 重新加载规则
   */
  public async reload(sourceId: string): Promise<RuleLoadResult> {
    // 先卸载
    this.unload(sourceId);
    // 再加载
    return this.loadFromSource(sourceId);
  }

  /**
   * 卸载规则模块
   */
  public unload(sourceId: string): boolean {
    return this._loadedModules.delete(sourceId);
  }

  /**
   * 获取已加载的模块
   */
  public getLoadedModule(sourceId: string): LoadedRuleModule | undefined {
    return this._loadedModules.get(sourceId);
  }

  /**
   * 获取所有已加载的模块
   */
  public getAllLoadedModules(): LoadedRuleModule[] {
    return Array.from(this._loadedModules.values());
  }

  /**
   * 获取所有规则
   */
  public getAllRules(): AccessRule[] {
    const allRules: AccessRule[] = [];
    for (const module of this._loadedModules.values()) {
      allRules.push(...module.rules);
    }
    return allRules;
  }

  /**
   * 获取加载历史
   */
  public getLoadHistory(limit: number = 100): typeof this._loadHistory {
    return this._loadHistory.slice(-limit);
  }

  /**
   * 检查是否有更新
   */
  public async checkForUpdates(sourceId: string): Promise<boolean> {
    // 简化实现：实际应该比较版本或哈希
    const module = this._loadedModules.get(sourceId);
    if (!module) return false;

    // 模拟检查（实际实现应该检查源的实际版本）
    return false;
  }

  private _setupAutoReload(sourceId: string, config: RuleSourceConfig): void {
    const timer = setInterval(async () => {
      const hasUpdate = await this.checkForUpdates(sourceId);
      if (hasUpdate) {
        console.log(`[RuleLoader] 检测到规则源 ${sourceId} 有更新，自动重新加载`);
        await this.reload(sourceId);
      }
    }, config.refreshIntervalMs);

    this._reloadTimers.set(sourceId, timer);
  }

  private async _loadFromFile(location: string): Promise<AccessRule[]> {
    // 模拟文件加载
    // 实际实现应该使用 fs 模块读取文件
    console.log(`[RuleLoader] 从文件加载规则: ${location}`);
    return [];
  }

  private async _loadFromDatabase(location: string): Promise<AccessRule[]> {
    // 模拟数据库加载
    console.log(`[RuleLoader] 从数据库加载规则: ${location}`);
    return [];
  }

  private async _loadFromApi(location: string): Promise<AccessRule[]> {
    // 模拟API加载
    console.log(`[RuleLoader] 从API加载规则: ${location}`);
    return [];
  }

  private _loadFromMemory(location: string): AccessRule[] {
    // 从内存加载（用于测试）
    console.log(`[RuleLoader] 从内存加载规则: ${location}`);
    return [];
  }

  private _generateVersion(): string {
    return `v${Date.now()}`;
  }
}

export default RuleLoader;
