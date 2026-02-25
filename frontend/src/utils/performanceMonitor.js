// Utilidad para monitorear el rendimiento del servidor
// Ayuda a diagnosticar si el problema es de Railway o del frontend
import { logger } from "./logger.js";

let requestStats = {
  total: 0,
  slow: 0, // > 2 segundos
  verySlow: 0, // > 5 segundos
  timeouts: 0,
  errors: 0,
  totalTime: 0,
  slowestRequest: { url: '', duration: 0 }
};

export function recordRequest(url, duration, isError = false, isTimeout = false) {
  requestStats.total++;
  requestStats.totalTime += duration;
  
  if (isTimeout) {
    requestStats.timeouts++;
  }
  
  if (isError) {
    requestStats.errors++;
  }
  
  if (duration > 2000) {
    requestStats.slow++;
  }
  
  if (duration > 5000) {
    requestStats.verySlow++;
  }
  
  if (duration > requestStats.slowestRequest.duration) {
    requestStats.slowestRequest = { url, duration };
  }
}

export function getStats() {
  return {
    ...requestStats,
    averageTime: requestStats.total > 0 
      ? Math.round(requestStats.totalTime / requestStats.total) 
      : 0
  };
}

export function getDiagnosis() {
  const stats = getStats();
  const issues = [];
  
  if (stats.timeouts > 0) {
    issues.push({
      severity: 'high',
      message: `${stats.timeouts} petición(es) con timeout. El servidor Railway no está respondiendo.`,
      solution: 'Verifica el estado del servidor en Railway Dashboard. Puede estar dormido o sobrecargado.'
    });
  }
  
  if (stats.verySlow > 0) {
    issues.push({
      severity: 'high',
      message: `${stats.verySlow} petición(es) muy lentas (>5s). Probable problema del servidor.`,
      solution: 'Revisa los logs de Railway y considera actualizar el plan si estás en el tier gratuito.'
    });
  }
  
  if (stats.slow > stats.total * 0.3) {
    issues.push({
      severity: 'medium',
      message: `Más del 30% de las peticiones son lentas (>2s).`,
      solution: 'El servidor Railway puede estar sobrecargado. Considera optimizar consultas o actualizar el plan.'
    });
  }
  
  if (stats.averageTime > 2000) {
    issues.push({
      severity: 'medium',
      message: `Tiempo promedio de respuesta: ${stats.averageTime}ms (muy alto).`,
      solution: 'Verifica el rendimiento del servidor en Railway Dashboard.'
    });
  }
  
  if (stats.slowestRequest.duration > 0) {
    issues.push({
      severity: 'info',
      message: `Petición más lenta: ${stats.slowestRequest.url} (${stats.slowestRequest.duration}ms)`,
      solution: 'Considera optimizar este endpoint en el backend.'
    });
  }
  
  return {
    stats,
    issues,
    isServerProblem: stats.timeouts > 0 || stats.verySlow > 0 || stats.averageTime > 2000
  };
}

export function logDiagnosis() {
  const diagnosis = getDiagnosis();
  
  logger.log('🔍 Diagnóstico de Rendimiento');
  logger.log('📊 Estadísticas:', diagnosis.stats);
  
  if (diagnosis.issues.length > 0) {
    logger.log('⚠️ Problemas detectados:');
    diagnosis.issues.forEach((issue, i) => {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🔵';
      logger.log(`${icon} ${issue.message}`);
      logger.log(`   💡 Solución: ${issue.solution}`);
    });
  }
  
  if (diagnosis.isServerProblem) {
    logger.warn('🚨 El problema parece ser del SERVIDOR (Railway), no del frontend.');
    logger.log('📊 Revisa el dashboard de Railway: https://railway.app');
    logger.log('💡 Consejos:');
    logger.log('   - Verifica si el servicio está "dormido" (plan gratuito)');
    logger.log('   - Revisa los logs del servidor');
    logger.log('   - Considera actualizar el plan si estás en el tier gratuito');
  } else {
    logger.log('✅ El rendimiento parece normal. Si aún es lento, puede ser la conexión a internet.');
  }
  
  
  return diagnosis;
}

// Función para mostrar diagnóstico en la consola cada cierto tiempo
let diagnosisInterval = null;

export function startMonitoring(intervalMs = 60000) {
  if (diagnosisInterval) {
    clearInterval(diagnosisInterval);
  }
  
  diagnosisInterval = setInterval(() => {
    if (requestStats.total > 0) {
      logDiagnosis();
    }
  }, intervalMs);
}

export function stopMonitoring() {
  if (diagnosisInterval) {
    clearInterval(diagnosisInterval);
    diagnosisInterval = null;
  }
}

