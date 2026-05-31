/**
 * 超长任务Agent树形双生子模块化执行系统
 * 核心模块导出 - 第一阶段汇总
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

// 第1阶段：接口定义
export * from './interfaces';

// 第2阶段：根模块
export * from './RootModule';

// 第5阶段：模块间通信总线
export * from './ModuleBus';

// 第6阶段：状态快照管理器
export * from './SnapshotManager';

// 第7阶段：任务参数验证器
export * from './TaskParamValidator';

// 第8阶段：错误处理器
export * from './ErrorHandler';

// 第9阶段：日志记录器
export * from './Logger';

// 第10阶段：配置管理器
export * from './ConfigManager';

// 第15阶段：三级模块挂载机制
export * from './ModuleLoader';

// 第16阶段：父子模块通信协议
export * from './ParentChildProtocol';

// 第17阶段：模块生命周期管理
export * from './LifecycleManager';

// 第18阶段：双子模块调度器
export * from './TwinScheduler';

// 第19阶段：层级状态聚合器
export * from './StateAggregator';
