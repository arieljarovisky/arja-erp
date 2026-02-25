import { describe, it, expect } from '@jest/globals';
import { parseDay } from '../../../helpers/parseDay.js';

describe('parseDay helper', () => {
  it('debe parsear "hoy" correctamente', () => {
    const result = parseDay('hoy');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Formato YYYY-MM-DD
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expected = today.toISOString().slice(0, 10);
    expect(result).toBe(expected);
  });

  it('debe parsear "mañana" correctamente', () => {
    const result = parseDay('mañana');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const expected = tomorrow.toISOString().slice(0, 10);
    expect(result).toBe(expected);
  });

  it('debe parsear formato DD/MM', () => {
    const result = parseDay('15/01');
    expect(result).toMatch(/^\d{4}-01-15$/);
  });

  it('debe retornar null para valores inválidos', () => {
    expect(parseDay('invalid')).toBe(null);
    expect(parseDay('')).toBe(null);
    expect(parseDay('abc/def')).toBe(null);
  });
});

