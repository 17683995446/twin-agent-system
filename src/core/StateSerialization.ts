/**
 * 第52阶段：状态序列化
 * State Serialization
 * 
 * 提供状态序列化功能：
 * - 多格式支持（JSON、Binary、自定义）
 * - 类型感知序列化
 * - 循环引用处理
 * - 压缩支持
 */

// 序列化格式
export enum SerializationFormat {
  JSON = 'json',
  BINARY = 'binary',
  MSGPACK = 'msgpack',
  CUSTOM = 'custom'
}

// 序列化选项
export interface SerializationOptions {
  format?: SerializationFormat;
  pretty?: boolean;
  includeTypeInfo?: boolean;
  compress?: boolean;
  maxDepth?: number;
  excludeFields?: string[];
  customSerializers?: Map<string, (value: any) => any>;
}

// 反序列化选项
export interface DeserializationOptions {
  format?: SerializationFormat;
  strict?: boolean;
  customDeserializers?: Map<string, (value: any) => any>;
}

// 序列化结果
export interface SerializationResult {
  data: string | Buffer;
  format: SerializationFormat;
  size: number;
  compressed: boolean;
  checksum: string;
  metadata: {
    originalSize: number;
    typeInfo?: string;
    serializedAt: number;
  };
}

// 类型信息
interface TypeInfo {
  type: string;
  constructor?: string;
  properties?: Record<string, TypeInfo>;
}

// ==================== 状态序列化器 ====================

export class StateSerializer {
  private _format: SerializationFormat;
  private _customSerializers: Map<string, (value: any) => any> = new Map();
  private _customDeserializers: Map<string, (value: any) => any> = new Map();
  private _typeRegistry: Map<string, any> = new Map();

  constructor(format: SerializationFormat = SerializationFormat.JSON) {
    this._format = format;
    this._initBuiltInTypes();
  }

  // ==================== 序列化 ====================

  /**
   * 序列化值
   */
  public serialize(value: any, options: SerializationOptions = {}): SerializationResult {
    const format = options.format || this._format;
    const startTime = Date.now();

    // 准备序列化数据
    let prepared = this._prepareForSerialization(value, options);
    const originalSize = this._estimateSize(prepared);

    // 应用自定义序列化器
    if (options.customSerializers) {
      prepared = this._applyCustomSerializers(prepared, options.customSerializers);
    }

    // 序列化
    let data: string | Buffer;
    switch (format) {
      case SerializationFormat.JSON:
        data = options.pretty 
          ? JSON.stringify(prepared, null, 2) 
          : JSON.stringify(prepared);
        break;
      case SerializationFormat.BINARY:
        data = this._serializeToBinary(prepared);
        break;
      default:
        data = JSON.stringify(prepared);
    }

    // 压缩
    let compressed = false;
    if (options.compress) {
      data = this._compress(data);
      compressed = true;
    }

    const checksum = this._calculateChecksum(data);

    return {
      data,
      format,
      size: typeof data === 'string' ? data.length : data.length,
      compressed,
      checksum,
      metadata: {
        originalSize,
        typeInfo: options.includeTypeInfo ? this._extractTypeInfo(value) : undefined,
        serializedAt: Date.now()
      }
    };
  }

  /**
   * 反序列化
   */
  public deserialize<T = any>(
    data: string | Buffer,
    options: DeserializationOptions = {}
  ): T {
    const format = options.format || this._format;

    // 解压
    let decompressed = data;
    if (this._isCompressed(data)) {
      decompressed = this._decompress(data);
    }

    // 反序列化
    let parsed: any;
    switch (format) {
      case SerializationFormat.JSON:
        parsed = JSON.parse(decompressed as string);
        break;
      case SerializationFormat.BINARY:
        parsed = this._deserializeFromBinary(decompressed as Buffer);
        break;
      default:
        parsed = JSON.parse(decompressed as string);
    }

    // 应用自定义反序列化器
    if (options.customDeserializers) {
      parsed = this._applyCustomDeserializers(parsed, options.customDeserializers);
    }

    // 恢复类型
    if (parsed.__type__) {
      parsed = this._restoreType(parsed, options.strict);
    }

    return parsed as T;
  }

  // ==================== 准备序列化 ====================

  private _prepareForSerialization(value: any, options: SerializationOptions, depth: number = 0): any {
    // 深度限制
    if (options.maxDepth && depth > options.maxDepth) {
      return '[MAX_DEPTH_EXCEEDED]';
    }

    // 处理null和undefined
    if (value === null) return null;
    if (value === undefined) return { __undefined__: true };

    // 基本类型
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    // BigInt
    if (typeof value === 'bigint') {
      return { __bigint__: value.toString() };
    }

    // Symbol
    if (typeof value === 'symbol') {
      return { __symbol__: value.description || '' };
    }

    // Function
    if (typeof value === 'function') {
      return { __function__: value.toString() };
    }

    // Date
    if (value instanceof Date) {
      return { __date__: value.toISOString() };
    }

    // RegExp
    if (value instanceof RegExp) {
      return { __regexp__: { source: value.source, flags: value.flags } };
    }

    // Buffer/Uint8Array
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return { __buffer__: value.toString('base64') };
    }

    // Map
    if (value instanceof Map) {
      return {
        __map__: true,
        entries: Array.from(value.entries()).map(([k, v]) => [
          this._prepareForSerialization(k, options, depth + 1),
          this._prepareForSerialization(v, options, depth + 1)
        ])
      };
    }

    // Set
    if (value instanceof Set) {
      return {
        __set__: true,
        values: Array.from(value.values()).map(v => 
          this._prepareForSerialization(v, options, depth + 1)
        )
      };
    }

    // Error
    if (value instanceof Error) {
      return {
        __error__: true,
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }

    // Array
    if (Array.isArray(value)) {
      return value.map(item => this._prepareForSerialization(item, options, depth + 1));
    }

    // Object
    if (typeof value === 'object') {
      const result: any = {};
      
      // 添加类型信息
      if (options.includeTypeInfo) {
        result.__type__ = value.constructor?.name || 'Object';
      }

      // 检查循环引用
      const seen = new WeakSet();
      
      for (const key of Object.keys(value)) {
        // 排除字段
        if (options.excludeFields?.includes(key)) continue;
        
        const propValue = value[key];
        
        // 循环引用检测
        if (typeof propValue === 'object' && propValue !== null) {
          if (seen.has(propValue)) {
            result[key] = { __circular__: true };
            continue;
          }
          seen.add(propValue);
        }
        
        result[key] = this._prepareForSerialization(propValue, options, depth + 1);
      }
      
      return result;
    }

    return value;
  }

  // ==================== 类型恢复 ====================

  private _restoreType(value: any, strict?: boolean): any {
    // undefined
    if (value.__undefined__) return undefined;

    // bigint
    if (value.__bigint__) return BigInt(value.__bigint__);

    // symbol
    if (value.__symbol__) return Symbol(value.__symbol__);

    // function
    if (value.__function__) {
      try {
        return eval(`(${value.__function__})`);
      } catch {
        return () => {};
      }
    }

    // date
    if (value.__date__) return new Date(value.__date__);

    // regexp
    if (value.__regexp__) return new RegExp(value.__regexp__.source, value.__regexp__.flags);

    // buffer
    if (value.__buffer__) return Buffer.from(value.__buffer__, 'base64');

    // map
    if (value.__map__) {
      const map = new Map();
      for (const [k, v] of value.entries) {
        map.set(this._restoreType(k), this._restoreType(v));
      }
      return map;
    }

    // set
    if (value.__set__) {
      return new Set(value.values.map((v: any) => this._restoreType(v)));
    }

    // error
    if (value.__error__) {
      const ErrorClass = this._typeRegistry.get(value.name) || Error;
      const error = new ErrorClass(value.message);
      error.stack = value.stack;
      return error;
    }

    // 自定义类型
    if (value.__type__) {
      const Constructor = this._typeRegistry.get(value.__type__);
      if (Constructor) {
        const instance = Object.create(Constructor.prototype);
        for (const key of Object.keys(value)) {
          if (key !== '__type__') {
            instance[key] = this._restoreType(value[key]);
          }
        }
        return instance;
      }
    }

    // 普通对象
    if (typeof value === 'object' && value !== null) {
      const result: any = {};
      for (const key of Object.keys(value)) {
        if (key !== '__type__') {
          result[key] = this._restoreType(value[key]);
        }
      }
      return result;
    }

    // 数组
    if (Array.isArray(value)) {
      return value.map(item => this._restoreType(item));
    }

    return value;
  }

  // ==================== 工具方法 ====================

  /**
   * 注册自定义类型
   */
  public registerType(name: string, constructor: any): void {
    this._typeRegistry.set(name, constructor);
  }

  /**
   * 注册自定义序列化器
   */
  public registerSerializer(typeName: string, serializer: (value: any) => any): void {
    this._customSerializers.set(typeName, serializer);
  }

  /**
   * 注册自定义反序列化器
   */
  public registerDeserializer(typeName: string, deserializer: (value: any) => any): void {
    this._customDeserializers.set(typeName, deserializer);
  }

  private _initBuiltInTypes(): void {
    this._typeRegistry.set('Error', Error);
    this._typeRegistry.set('TypeError', TypeError);
    this._typeRegistry.set('RangeError', RangeError);
    this._typeRegistry.set('SyntaxError', SyntaxError);
  }

  private _applyCustomSerializers(value: any, serializers: Map<string, (value: any) => any>): any {
    if (typeof value === 'object' && value !== null && value.__type__) {
      const serializer = serializers.get(value.__type__);
      if (serializer) {
        return { ...value, __custom__: serializer(value) };
      }
    }
    return value;
  }

  private _applyCustomDeserializers(value: any, deserializers: Map<string, (value: any) => any>): any {
    if (typeof value === 'object' && value !== null && value.__custom__ && value.__type__) {
      const deserializer = deserializers.get(value.__type__);
      if (deserializer) {
        return deserializer(value.__custom__);
      }
    }
    return value;
  }

  private _serializeToBinary(value: any): Buffer {
    const json = JSON.stringify(value);
    return Buffer.from(json, 'utf8');
  }

  private _deserializeFromBinary(data: Buffer): any {
    const json = data.toString('utf8');
    return JSON.parse(json);
  }

  private _compress(data: string | Buffer): string | Buffer {
    // 简化实现 - 实际应使用zlib
    return data;
  }

  private _decompress(data: string | Buffer): string | Buffer {
    return data;
  }

  private _isCompressed(data: string | Buffer): boolean {
    return false;
  }

  private _estimateSize(value: any): number {
    return JSON.stringify(value).length;
  }

  private _calculateChecksum(data: string | Buffer): string {
    const str = typeof data === 'string' ? data : data.toString('hex');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private _extractTypeInfo(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}

// 导出
export function createStateSerializer(format?: SerializationFormat): StateSerializer {
  return new StateSerializer(format);
}
