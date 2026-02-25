import { describe, it, expect, beforeEach } from '@jest/globals';
import { toMySQLDateTime, parseDateTime } from '../../../helpers/overlapValidation.js';

describe('overlapValidation helpers', () => {
  describe('toMySQLDateTime', () => {
    it('debe convertir Date a formato MySQL', () => {
      const date = new Date('2024-01-15T14:30:00');
      const result = toMySQLDateTime(date);
      expect(result).toBe('2024-01-15 14:30:00');
    });

    it('debe manejar strings de fecha', () => {
      const dateStr = '2024-01-15T14:30:00';
      const result = toMySQLDateTime(dateStr);
      expect(result).toBe('2024-01-15 14:30:00');
    });

    it('debe retornar null para valores null/undefined', () => {
      expect(toMySQLDateTime(null)).toBe(null);
      expect(toMySQLDateTime(undefined)).toBe(null);
    });

    it('debe retornar null para fechas inválidas', () => {
      expect(toMySQLDateTime('invalid-date')).toBe(null);
    });

    it('debe formatear correctamente con padding de ceros', () => {
      const date = new Date('2024-01-05T09:05:03');
      const result = toMySQLDateTime(date);
      expect(result).toBe('2024-01-05 09:05:03');
    });
  });

  describe('parseDateTime', () => {
    it('debe parsear formato MySQL correctamente', () => {
      const mysqlDate = '2024-01-15 14:30:00';
      const result = parseDateTime(mysqlDate);
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // Enero es 0
      expect(result.getDate()).toBe(15);
    });

    it('debe agregar segundos si faltan', () => {
      const mysqlDate = '2024-01-15 14:30';
      const result = parseDateTime(mysqlDate);
      expect(result).toBeInstanceOf(Date);
    });

    it('debe retornar null para valores null/undefined', () => {
      expect(parseDateTime(null)).toBe(null);
      expect(parseDateTime(undefined)).toBe(null);
    });

    it('debe retornar null para fechas inválidas', () => {
      expect(parseDateTime('invalid-date')).toBe(null);
    });

    it('debe manejar objetos Date', () => {
      const date = new Date('2024-01-15T14:30:00');
      const result = parseDateTime(date);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(date.getTime());
    });
  });
});

