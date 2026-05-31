/**
 * 超长任务Agent树形双生子模块化执行系统
 * 二级模块导出 - 第20阶段交付物（汇总）
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

// 第11阶段：二级管控-任务规则框架
export * from './Level2RuleControlModule';

// 第12阶段：二级执行-状态持久化框架
export * from './Level2StatePersistModule';

// 第13阶段：二级管控-规划校验框架
export * from './Level2PlanVerifyModule';

// 第14阶段：二级执行-分步落地框架
export * from './Level2StepExecuteModule';

// 第15阶段：三级模块挂载机制 -> core/ModuleLoader
// 第16阶段：父子模块通信协议 -> core/ParentChildProtocol
// 第17阶段：模块生命周期管理 -> core/LifecycleManager
// 第18阶段：双子模块调度器 -> core/TwinScheduler
// 第19阶段：层级状态聚合器 -> core/StateAggregator
