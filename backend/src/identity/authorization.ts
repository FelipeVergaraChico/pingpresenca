import { AppError } from '../platform/errors.js';

export type Role = 'OWNER' | 'ADMIN' | 'PROFESSOR' | 'STUDENT';
export interface Principal { id: string; name: string; email: string; roles: Role[] }
export type Permission = 'installation:read';
// Future permissions must explicitly define their resource scope, not just role.
export function requirePermission(principal: Principal | null, permission: Permission): Principal {
  if (!principal) throw new AppError(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.');
  if (permission === 'installation:read' && !principal.roles.some(r => r === 'OWNER' || r === 'ADMIN')) {
    throw new AppError(403, 'FORBIDDEN', 'Esta conta não possui permissão para esta operação.');
  }
  return principal;
}
