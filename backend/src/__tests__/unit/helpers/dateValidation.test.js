import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  isPastDateTime,
  isWithinAllowedRange,
  isBusinessDay,
  validateAppointmentDate,
} from '../../../helpers/dateValidation.js';

describe('dateValidation', () => {
  let originalDateNow;

  beforeEach(() => {
    // Guardar la función original de Date.now
    originalDateNow = Date.now;
  });

  afterEach(() => {
    // Restaurar Date.now después de cada test
    Date.now = originalDateNow;
  });

  describe('isPastDateTime', () => {
    it('debe retornar true para fechas pasadas', () => {
      const pastDate = new Date('2020-01-01T10:00:00');
      expect(isPastDateTime(pastDate)).toBe(true);
    });

    it('debe retornar false para fechas futuras', () => {
      const futureDate = new Date('2030-01-01T10:00:00');
      expect(isPastDateTime(futureDate)).toBe(false);
    });

    it('debe manejar strings en formato MySQL', () => {
      const pastString = '2020-01-01 10:00:00';
      expect(isPastDateTime(pastString)).toBe(true);
    });

    it('debe retornar true para fechas inválidas', () => {
      expect(isPastDateTime('invalid-date')).toBe(true);
    });
  });

  describe('isWithinAllowedRange', () => {
    it('debe retornar true para fechas dentro del rango permitido', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(isWithinAllowedRange(tomorrow)).toBe(true);
    });

    it('debe retornar false para fechas fuera del rango (más de 90 días)', () => {
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 100);
      expect(isWithinAllowedRange(farFuture)).toBe(false);
    });

    it('debe respetar el parámetro maxDays personalizado', () => {
      // Fecha dentro del rango (29 días después, debe estar dentro)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const date29Days = new Date(today);
      date29Days.setDate(date29Days.getDate() + 29);
      date29Days.setHours(12, 0, 0, 0);
      expect(isWithinAllowedRange(date29Days, 30)).toBe(true);

      // Fecha exactamente en el límite (30 días después a las 00:00, debe estar dentro)
      const date30Days = new Date(today);
      date30Days.setDate(date30Days.getDate() + 30);
      date30Days.setHours(0, 0, 0, 0);
      expect(isWithinAllowedRange(date30Days, 30)).toBe(true);

      // Fecha fuera del rango (31 días después, debe estar fuera)
      const date31Days = new Date(today);
      date31Days.setDate(date31Days.getDate() + 31);
      date31Days.setHours(0, 0, 0, 0);
      expect(isWithinAllowedRange(date31Days, 30)).toBe(false);
    });

    it('debe retornar false para fechas pasadas', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isWithinAllowedRange(yesterday)).toBe(false);
    });
  });

  describe('isBusinessDay', () => {
    it('debe retornar true para lunes a sábado', () => {
      // Lunes
      const monday = new Date('2024-01-01T10:00:00'); // 1 de enero 2024 es lunes
      expect(isBusinessDay(monday)).toBe(true);

      // Sábado
      const saturday = new Date('2024-01-06T10:00:00'); // 6 de enero 2024 es sábado
      expect(isBusinessDay(saturday)).toBe(true);
    });

    it('debe retornar false para domingos', () => {
      const sunday = new Date('2024-01-07T10:00:00'); // 7 de enero 2024 es domingo
      expect(isBusinessDay(sunday)).toBe(false);
    });
  });

  describe('validateAppointmentDate', () => {
    let originalDateNow;
    
    beforeEach(() => {
      // Guardar la función original
      originalDateNow = Date.now;
      // Mock de Date.now para tener control sobre "ahora"
      const fixedDate = new Date('2024-01-15T12:00:00');
      Date.now = () => fixedDate.getTime();
    });

    afterEach(() => {
      // Restaurar Date.now
      Date.now = originalDateNow;
    });

    it('debe lanzar error para fechas inválidas', () => {
      expect(() => validateAppointmentDate('invalid-date')).toThrow('Fecha/hora inválida');
    });

    it('debe lanzar error para fechas en el pasado', () => {
      const pastDate = '2024-01-14 10:00:00';
      expect(() => validateAppointmentDate(pastDate)).toThrow('La fecha/hora debe ser futura');
    });

    it('debe aceptar fechas futuras válidas', () => {
      const futureDate = '2024-01-16 14:00:00';
      expect(() => validateAppointmentDate(futureDate)).not.toThrow();
    });

    it('debe lanzar error si los minutos no son múltiplos de 5', () => {
      const invalidTime = '2024-01-16 14:07:00';
      expect(() => validateAppointmentDate(invalidTime)).toThrow('La hora debe ser en bloques de 5 minutos');
    });

    it('debe aceptar horas con minutos múltiplos de 5', () => {
      const validTime1 = '2024-01-16 14:00:00';
      const validTime2 = '2024-01-16 14:15:00';
      const validTime3 = '2024-01-16 14:30:00';

      expect(() => validateAppointmentDate(validTime1)).not.toThrow();
      expect(() => validateAppointmentDate(validTime2)).not.toThrow();
      expect(() => validateAppointmentDate(validTime3)).not.toThrow();
    });
  });
});

