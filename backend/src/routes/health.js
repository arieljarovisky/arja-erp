import { Router } from "express";
import { pool } from "../db.js";

export const health = Router();

// Verificar si el pool está listo
let dbReady = false;
let dbCheckAttempts = 0;
const MAX_DB_CHECK_ATTEMPTS = 5;

// Verificar conexión a BD al iniciar
async function checkDatabaseConnection() {
  try {
    await pool.query("SELECT 1");
    dbReady = true;
    console.log("✅ [Health] Conexión a base de datos verificada");
  } catch (error) {
    dbCheckAttempts++;
    console.warn(`⚠️ [Health] Intento ${dbCheckAttempts}/${MAX_DB_CHECK_ATTEMPTS} - Error conectando a BD:`, error.message);
    
    if (dbCheckAttempts < MAX_DB_CHECK_ATTEMPTS) {
      // Reintentar después de 2 segundos
      setTimeout(checkDatabaseConnection, 2000);
    } else {
      console.error("❌ [Health] No se pudo conectar a la base de datos después de varios intentos");
      dbReady = false;
    }
  }
}

// Iniciar verificación al cargar el módulo
checkDatabaseConnection();

health.get("/", async (_req, res) => {
  try {
    // Verificar conexión a BD
    if (!dbReady) {
      // Intentar verificar nuevamente
      try {
        await pool.query("SELECT 1");
        dbReady = true;
      } catch (error) {
        return res.status(503).json({ 
          ok: false, 
          service: "pelu-api", 
          db: "unavailable",
          error: "Base de datos no disponible",
          time: new Date().toISOString() 
        });
      }
    }
    
    res.json({ 
      ok: true, 
      service: "pelu-api", 
      db: "connected",
      time: new Date().toISOString() 
    });
  } catch (error) {
    res.status(503).json({ 
      ok: false, 
      service: "pelu-api", 
      db: "error",
      error: error.message,
      time: new Date().toISOString() 
    });
  }
});
