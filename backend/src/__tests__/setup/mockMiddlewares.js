/**
 * Mocks de middlewares para tests de integración
 * Se debe importar ANTES de importar las rutas
 */

// Mock de requireAuth
export const mockRequireAuth = (req, res, next) => {
  req.user = {
    id: 1,
    tenant_id: 1,
    tenantId: 1,
    role: 'admin',
    email: 'test@example.com',
    permissions: {
      appointments: ['appointments.read', 'appointments.write']
    },
    is_super_admin: false
  };
  req.tenant = { id: 1 };
  next();
};

// Mock de requireRole
export const mockRequireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ ok: false, error: 'Usuario no autenticado' });
  }
  if (req.user.is_super_admin || roles.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ ok: false, error: 'Forbidden' });
  }
};

// Mock de requireAdmin
export const mockRequireAdmin = mockRequireRole('admin');

// Mock de requireTenant
export const mockRequireTenant = (req, res, next) => {
  req.tenantId = req.tenant?.id || req.user?.tenant_id || 1;
  next();
};

// Mock de requireActiveSubscription
export const mockRequireActiveSubscription = (req, res, next) => {
  // Simular suscripción activa
  next();
};

