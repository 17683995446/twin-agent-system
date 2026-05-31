/**
 * 超长任务Agent树形双生子模块化执行系统
 * 配置管理器 - 第10阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

/**
 * 配置源接口
 */
export interface ConfigSource {
  load(): Promise<Record<string, unknown>>;
  save(config: Record<string, unknown>): Promise<void>;
}

/**
 * 内存配置源
 */
export class MemoryConfigSource implements ConfigSource {
  private _config: Record<string, unknown> = {};

  async load(): Promise<Record<string, unknown>> {
    return { ...this._config };
  }

  async save(config: Record<string, unknown>): Promise<void> {
    this._config = { ...config };
  }
}

/**
 * 配置管理器
 * 
 * 职责：
 * 1. 配置加载与解析
 * 2. 配置热更新
 * 3. 配置验证
 */
export class ConfigManager {
  private _source: ConfigSource;
  private _config: Record<string, unknown> = {};
  private _watchers: Array<(key: string, value: unknown) => void> = [];
  private _isLoaded: boolean = false;

  constructor(source?: ConfigSource) {
    this._source = source || new MemoryConfigSource();
  }

  /**
   * 加载配置
   */
  public async load(): Promise<void> {
    this._config = await this._source.load();
    this._isLoaded = true;
  }

  /**
   * 获取配置值
   */
  public get<T>(key: string, defaultValue?: T): T | undefined {
    const keys = key.split('.');
    let value: unknown = this._config;

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[k];
      } else {
        return defaultValue;
      }
    }

    return value as T | undefined;
  }

  /**
   * 设置配置值
   */
  public async set<T>(key: string, value: T): Promise<void> {
    const keys = key.split('.');
    let current: Record<string, unknown> = this._config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1];
    const oldValue = current[lastKey];
    current[lastKey] = value;

    // 通知监听器
    if (oldValue !== value) {
      this._notifyWatchers(key, value);
    }

    // 保存配置
    await this._source.save(this._config);
  }

  /**
   * 批量设置配置
   */
  public async setMultiple(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.set(key, value);
    }
  }

  /**
   * 检查配置是否存在
   */
  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * 删除配置
   */
  public async delete(key: string): Promise<void> {
    const keys = key.split('.');
    let current: Record<string, unknown> = this._config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object') {
        return;
      }
      current = current[k] as Record<string, unknown>;
    }

    delete current[keys[keys.length - 1]];
    await this._source.save(this._config);
  }

  /**
   * 获取所有配置
   */
  public getAll(): Record<string, unknown> {
    return { ...this._config };
  }

  /**
   * 添加配置变更监听器
   */
  public watch(callback: (key: string, value: unknown) => void): void {
    this._watchers.push(callback);
  }

  /**
   * 移除配置变更监听器
   */
  public unwatch(callback: (key: string, value: unknown) => void): void {
    const index = this._watchers.indexOf(callback);
    if (index > -1) {
      this._watchers.splice(index, 1);
    }
  }

  /**
   * 重新加载配置
   */
  public async reload(): Promise<void> {
    await this.load();
  }

  /**
   * 验证配置
   */
  public validate(schema: Record<string, { type: string; required?: boolean }>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [key, rule] of Object.entries(schema)) {
      const value = this.get(key);

      if (rule.required && value === undefined) {
        errors.push(`${key} 是必填项`);
        continue;
      }

      if (value !== undefined && typeof value !== rule.type) {
        errors.push(`${key} 必须是 ${rule.type} 类型`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private _notifyWatchers(key: string, value: unknown): void {
    for (const watcher of this._watchers) {
      try {
        watcher(key, value);
      } catch (e) {
        // 忽略监听器错误
      }
    }
  }
}

export default ConfigManager;
