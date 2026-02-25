import { describe, it, expect } from '@jest/globals';
import { toSandboxAllowed } from '../../../helpers/numbers.js';

describe('numbers helpers', () => {
  describe('toSandboxAllowed', () => {
    it('debe convertir número argentino móvil correctamente', () => {
      expect(toSandboxAllowed('+5491112345678')).toBe('541112345678');
      expect(toSandboxAllowed('5491112345678')).toBe('541112345678');
    });

    it('debe mantener otros formatos', () => {
      expect(toSandboxAllowed('541112345678')).toBe('541112345678');
      expect(toSandboxAllowed('1234567890')).toBe('1234567890');
    });

    it('debe limpiar caracteres no numéricos', () => {
      expect(toSandboxAllowed('+54 9 11 1234-5678')).toBe('541112345678');
    });
  });
});
