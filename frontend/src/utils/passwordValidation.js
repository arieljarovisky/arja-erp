/**
 * Validación de contraseñas en el frontend
 * Debe coincidir con las reglas del backend
 */

/**
 * Valida una contraseña según las políticas de seguridad
 * @param {string} password - La contraseña a validar
 * @returns {{ valid: boolean, error?: string, requirements?: object, missingRequirements?: object }}
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return {
      valid: false,
      error: 'La contraseña es requerida',
      requirements: getPasswordRequirements()
    };
  }

  const requirements = {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  const errors = [];

  if (!requirements.minLength) {
    errors.push('al menos 8 caracteres');
  }
  if (!requirements.hasUpperCase) {
    errors.push('al menos una letra mayúscula');
  }
  if (!requirements.hasLowerCase) {
    errors.push('al menos una letra minúscula');
  }
  if (!requirements.hasNumber) {
    errors.push('al menos un número');
  }
  if (!requirements.hasSpecialChar) {
    errors.push('al menos un carácter especial');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: `La contraseña debe tener: ${errors.join(', ')}`,
      requirements: getPasswordRequirements(),
      missingRequirements: requirements
    };
  }

  // Verificar que no sea una contraseña común
  const commonPasswords = [
    'password', '12345678', '123456789', 'qwerty', 'abc123',
    'password123', 'admin123', 'welcome123', 'letmein', 'monkey'
  ];
  
  const passwordLower = password.toLowerCase();
  if (commonPasswords.some(common => passwordLower.includes(common))) {
    return {
      valid: false,
      error: 'La contraseña es demasiado común. Elegí una más segura',
      requirements: getPasswordRequirements()
    };
  }

  return {
    valid: true,
    requirements: getPasswordRequirements()
  };
}

/**
 * Obtiene los requisitos de contraseña en formato legible
 * @returns {object}
 */
export function getPasswordRequirements() {
  return {
    minLength: 8,
    mustHave: [
      'Al menos 8 caracteres',
      'Al menos una letra mayúscula (A-Z)',
      'Al menos una letra minúscula (a-z)',
      'Al menos un número (0-9)',
      'Al menos un carácter especial (!@#$%^&*()_+-=[]{}|;:,.<>?)'
    ]
  };
}

