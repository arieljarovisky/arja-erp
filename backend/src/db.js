import { createPool } from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

// Detectar si estamos en Railway (comúnmente tienen variables como RAILWAY_ENVIRONMENT)
const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_SERVICE_NAME;

// Configuración optimizada para Railway
// En Railway, las conexiones pueden ser más lentas debido a la latencia de red
const poolConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  decimalNumbers: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || (isRailway ? 10 : 20)), // Reducido en Railway
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: "-03:00",
  dateStrings: true,
  
  // Timeouts optimizados para Railway
  // connectTimeout: tiempo máximo para establecer una conexión (10 segundos)
  connectTimeout: isRailway ? 10000 : 60000,
  
  // Nota: acquireTimeout, timeout, reconnect, reconnectDelay, maxReconnects
  // no son opciones válidas para mysql2 pool. Se mantienen comentadas para referencia.
  // acquireTimeout: tiempo máximo para obtener una conexión del pool (30 segundos)
  // acquireTimeout: isRailway ? 30000 : 60000,
  
  // timeout: timeout general para las queries (60 segundos)
  // timeout: isRailway ? 60000 : 60000,
  
  // Configuración adicional para Railway
  // reconnect: true,
  // Reducir el tiempo entre intentos de reconexión
  // reconnectDelay: isRailway ? 1000 : 2000,
  // maxReconnects: 10,
};

const originalPool = createPool(poolConfig);

// Wrapper para medir tiempos de consultas (solo si está explícitamente habilitado)
// OPTIMIZADO: Deshabilitado por defecto en producción para reducir CPU
const ENABLE_QUERY_LOGGING = process.env.ENABLE_DB_QUERY_LOGGING === 'true';
const SLOW_QUERY_THRESHOLD = Number(process.env.SLOW_QUERY_THRESHOLD || 2000); // 2 segundos por defecto (solo queries muy lentas)

const originalQuery = originalPool.query.bind(originalPool);

originalPool.query = function(sql, params) {
  if (!ENABLE_QUERY_LOGGING) {
    return originalQuery(sql, params);
  }
  
  const startTime = Date.now();
  const queryStr = typeof sql === 'string' ? sql.substring(0, 100) : '[Prepared Statement]';
  
  return originalQuery(sql, params)
    .then((result) => {
      const duration = Date.now() - startTime;
      if (duration > SLOW_QUERY_THRESHOLD) {
        console.warn(
          `⚠️ [DB SLOW] Query tardó ${duration}ms: ${queryStr}${queryStr.length >= 100 ? '...' : ''}`
        );
      }
      return result;
    })
    .catch((error) => {
      const duration = Date.now() - startTime;
      console.error(
        `❌ [DB ERROR] Query falló después de ${duration}ms: ${queryStr}${queryStr.length >= 100 ? '...' : ''}`,
        error.message
      );
      throw error;
    });
};

export const pool = originalPool;

// Log de configuración en Railway
if (isRailway) {
  console.log(`[DB] Configuración optimizada para Railway:`);
  console.log(`[DB] - connectTimeout: ${poolConfig.connectTimeout}ms`);
  console.log(`[DB] - acquireTimeout: ${poolConfig.acquireTimeout}ms`);
  console.log(`[DB] - timeout: ${poolConfig.timeout}ms`);
  console.log(`[DB] - connectionLimit: ${poolConfig.connectionLimit}`);
  console.log(`[DB] - Query logging: ${ENABLE_QUERY_LOGGING ? 'HABILITADO' : 'DESHABILITADO'}`);
  console.log(`[DB] - Slow query threshold: ${SLOW_QUERY_THRESHOLD}ms`);
}

// Manejo de errores del pool
pool.on('connection', (connection) => {
  if (isRailway) {
    console.log(`[DB] Nueva conexión establecida (ID: ${connection.threadId})`);
  }
  // Asegurar zona horaria de sesión en -03:00 (Argentina)
  try {
    connection.promise().query(`SET time_zone = '-03:00'`).catch(() => {});
  } catch {}
});

pool.on('error', (err) => {
  console.error(`[DB] Error en el pool de conexiones:`, {
    code: err.code,
    errno: err.errno,
    message: err.message,
    host: poolConfig.host,
    port: poolConfig.port,
  });
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
    console.log(`[DB] ⚠️ Conexión perdida o rechazada. El pool intentará reconectar automáticamente en la próxima query.`);
  }
});
