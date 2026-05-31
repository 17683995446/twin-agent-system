/**
 * 超长任务Agent树形双生子模块化执行系统
 * 权限校验器 - 第32阶段交付物
 * 
 * 遵循原则：图难于其易，为大于其细
 * 版本：v1.0
 */

import { ModuleId } from './interfaces';

/**
 * 权限项
 */
export interface Permission {
  resource: string;
  action: string;
}

/**
 * 角色定义
 */
export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  parentRoleId?: string;
}

/**
 * 用户权限上下文
 */
export interface UserPermissionContext {
  userId: string;
  roles: string[];
  directPermissions?: Permission[];
  metadata?: Record<string, unknown>;
}

/**
 * 权限校验结果
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  matchedPermissions: Permission[];
  checkedAt: number;
}

/**
 * 权限校验器
 * 
 * 职责：
 * 1. 基于角色的权限校验（RBAC）
 * 2. 权限继承计算
 * 3. 动态权限评估
 */
export class PermissionValidator {
  private _roles: Map<string, Role> = new Map();
  private _permissionCache: Map<string, Permission[]> = new Map();
  private _checkHistory: Array<{ timestamp: number; userId: string; resource: string; action: string; allowed: boolean }> = [];

  /**
   * 注册角色
   */
  public registerRole(role: Role): void {
    this._roles.set(role.id, role);
    this._clearCache();
  }

  /**
   * 移除角色
   */
  public removeRole(roleId: string): boolean {
    const removed = this._roles.delete(roleId);
    if (removed) this._clearCache();
    return removed;
  }

  /**
   * 获取角色
   */
  public getRole(roleId: string): Role | undefined {
    return this._roles.get(roleId);
  }

  /**
   * 获取所有角色
   */
  public getAllRoles(): Role[] {
    return Array.from(this._roles.values());
  }

  /**
   * 检查用户是否有权限
   */
  public checkPermission(
    context: UserPermissionContext,
    resource: string,
    action: string
  ): PermissionCheckResult {
    const cacheKey = `${context.userId}_${resource}_${action}`;
    
    // 计算用户所有权限
    const userPermissions = this._getUserPermissions(context);
    
    // 检查权限
    const matched = userPermissions.filter(
      p => p.resource === resource && (p.action === action || p.action === '*')
    );

    const result: PermissionCheckResult = {
      allowed: matched.length > 0,
      reason: matched.length > 0 ? undefined : `用户没有 ${resource}:${action} 权限`,
      matchedPermissions: matched,
      checkedAt: Date.now()
    };

    // 记录检查历史
    this._checkHistory.push({
      timestamp: Date.now(),
      userId: context.userId,
      resource,
      action,
      allowed: result.allowed
    });

    return result;
  }

  /**
   * 批量检查权限
   */
  public checkPermissions(
    context: UserPermissionContext,
    permissions: Permission[]
  ): { allAllowed: boolean; results: Array<{ permission: Permission; allowed: boolean }> } {
    const results = permissions.map(permission => ({
      permission,
      allowed: this.checkPermission(context, permission.resource, permission.action).allowed
    }));

    return {
      allAllowed: results.every(r => r.allowed),
      results
    };
  }

  /**
   * 获取用户的所有权限
   */
  public getUserPermissions(context: UserPermissionContext): Permission[] {
    return this._getUserPermissions(context);
  }

  /**
   * 获取检查历史
   */
  public getCheckHistory(userId?: string, limit: number = 100): typeof this._checkHistory {
    let history = this._checkHistory;
    if (userId) {
      history = history.filter(h => h.userId === userId);
    }
    return history.slice(-limit);
  }

  /**
   * 导出角色配置
   */
  public exportRoles(): string {
    return JSON.stringify(Array.from(this._roles.values()), null, 2);
  }

  /**
   * 导入角色配置
   */
  public importRoles(json: string): boolean {
    try {
      const roles: Role[] = JSON.parse(json);
      for (const role of roles) {
        this.registerRole(role);
      }
      return true;
    } catch (error) {
      console.error('角色导入失败:', error);
      return false;
    }
  }

  private _getUserPermissions(context: UserPermissionContext): Permission[] {
    const cacheKey = context.userId;
    
    // 检查缓存
    const cached = this._permissionCache.get(cacheKey);
    if (cached) return cached;

    const permissions: Permission[] = [...(context.directPermissions || [])];
    const processedRoles = new Set<string>();

    // 递归获取角色权限
    for (const roleId of context.roles) {
      this._collectRolePermissions(roleId, permissions, processedRoles);
    }

    // 去重
    const uniquePermissions = this._deduplicatePermissions(permissions);
    
    // 缓存
    this._permissionCache.set(cacheKey, uniquePermissions);
    
    return uniquePermissions;
  }

  private _collectRolePermissions(
    roleId: string,
    permissions: Permission[],
    processedRoles: Set<string>
  ): void {
    if (processedRoles.has(roleId)) return;
    processedRoles.add(roleId);

    const role = this._roles.get(roleId);
    if (!role) return;

    permissions.push(...role.permissions);

    // 递归处理父角色
    if (role.parentRoleId) {
      this._collectRolePermissions(role.parentRoleId, permissions, processedRoles);
    }
  }

  private _deduplicatePermissions(permissions: Permission[]): Permission[] {
    const seen = new Set<string>();
    return permissions.filter(p => {
      const key = `${p.resource}:${p.action}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private _clearCache(): void {
    this._permissionCache.clear();
  }
}

export default PermissionValidator;
