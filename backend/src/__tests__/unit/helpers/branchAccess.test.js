import { describe, it, expect } from '@jest/globals';
import {
  isAdminUser,
  getUserBranchId,
  getUserBranchAccess,
  ensureUserCanAccessBranch
} from '../../../helpers/branchAccess.js';

describe('branchAccess helpers', () => {
  describe('isAdminUser', () => {
    it('debe retornar true para super admin', () => {
      const user = { is_super_admin: true, role: 'user' };
      expect(isAdminUser(user)).toBe(true);
    });

    it('debe retornar true para role admin', () => {
      const user = { role: 'admin' };
      expect(isAdminUser(user)).toBe(true);
    });

    it('debe retornar false para role user', () => {
      const user = { role: 'user' };
      expect(isAdminUser(user)).toBe(false);
    });

    it('debe retornar false para usuario null', () => {
      expect(isAdminUser(null)).toBe(false);
    });
  });

  describe('getUserBranchId', () => {
    it('debe retornar branch ID válido', () => {
      const user = { current_branch_id: 5 };
      expect(getUserBranchId(user)).toBe(5);
    });

    it('debe retornar null para ID inválido', () => {
      const user = { current_branch_id: 0 };
      expect(getUserBranchId(user)).toBe(null);
    });

    it('debe retornar null para usuario sin branch', () => {
      const user = {};
      expect(getUserBranchId(user)).toBe(null);
    });
  });

  describe('getUserBranchAccess', () => {
    it('debe retornar "all" por defecto', () => {
      const user = {};
      const access = getUserBranchAccess(user);
      expect(access.mode).toBe('all');
      expect(access.branchIds).toEqual([]);
    });

    it('debe retornar "custom" con branch IDs', () => {
      const user = {
        branch_access_mode: 'custom',
        branch_ids: [1, 2, 3]
      };
      const access = getUserBranchAccess(user);
      expect(access.mode).toBe('custom');
      expect(access.branchIds).toEqual([1, 2, 3]);
    });

    it('debe filtrar IDs inválidos', () => {
      const user = {
        branch_access_mode: 'custom',
        branch_ids: [1, -1, 0, 'invalid', 2]
      };
      const access = getUserBranchAccess(user);
      expect(access.branchIds).toEqual([1, 2]);
    });
  });

  describe('ensureUserCanAccessBranch', () => {
    it('debe permitir acceso con mode "all"', () => {
      const user = { branch_access_mode: 'all' };
      expect(() => ensureUserCanAccessBranch(user, 1)).not.toThrow();
    });

    it('debe permitir acceso si branch está en lista custom', () => {
      const user = {
        branch_access_mode: 'custom',
        branch_ids: [1, 2, 3]
      };
      expect(() => ensureUserCanAccessBranch(user, 2)).not.toThrow();
    });

    it('debe rechazar acceso si branch no está en lista custom', () => {
      const user = {
        branch_access_mode: 'custom',
        branch_ids: [1, 2, 3]
      };
      expect(() => ensureUserCanAccessBranch(user, 99)).toThrow();
    });
  });
});

