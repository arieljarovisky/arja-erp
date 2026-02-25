#!/usr/bin/env node

/**
 * Script de limpieza de base de datos de producción
 * 
 * ⚠️ ADVERTENCIA: Este script puede eliminar datos permanentemente
 * 
 * Uso:
 *   node cleanup-production-db.js --dry-run  # Solo muestra qué se eliminaría
 *   node cleanup-production-db.js --confirm # Ejecuta la limpieza
 *   node cleanup-production-db.js --tenants-only # Solo elimina tenants (no datos relacionados)
 *   node cleanup-production-db.js --all-data # Elimina todos los datos excepto el tenant system
 */

import mysql from 'mysql2/promise';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuración de la base de datos desde variables de entorno
// ⚠️ IMPORTANTE: En producción, usa variables de entorno en lugar de hardcodear credenciales
const dbConfig = {
  host: process.env.DB_HOST || 'yamabiko.proxy.rlwy.net',
  port: parseInt(process.env.DB_PORT) || 47587, // Puerto correcto para Railway
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'VapRZGxFAfuaJxvfYvprkcIxAHQxmPhq',
  database: process.env.DB_NAME || 'arjaerp',
  multipleStatements: true,
  connectTimeout: 10000, // 10 segundos timeout
};

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const needsConfirmation = args.includes('--confirm');
const tenantsOnly = args.includes('--tenants-only');
const allData = args.includes('--all-data');

// Tablas en orden de dependencias (las que dependen de otras van primero)
const TABLES_TO_CLEAN = [
  // Tablas de transacciones y operaciones
  'ecommerce_sale_item',
  'ecommerce_sale',
  'invoice_item',
  'invoice',
  'payment',
  'appointment',
  'appointment_series',
  'class_session',
  'class_enrollment',
  'stock_movement',
  'stock_transfer',
  'stock_reservation',
  'stock_alert',
  'product_stock',
  'product_cost_history',
  'cash_register_closure',
  'user_commission',
  
  // Tablas de relaciones y configuraciones
  'instructor_service',
  'customer_subscription',
  'membership_plan',
  'tenant_integration_logs',
  'tenant_integrations',
  'tenant_whatsapp_config',
  'tenant_settings',
  'user_branch_access',
  'password_reset_tokens',
  'refresh_tokens',
  
  // Tablas principales de datos
  'product',
  'service',
  'instructor',
  'customer',
  'tenant_branch',
  'users',
  'onboarding_session',
  'platform_subscription',
  'tenant',
];

// Tablas que NO se deben limpiar (sistema)
const SYSTEM_TABLES = [
  'tenant', // Se preserva el tenant system
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function getConnection() {
  try {
    console.log(`🔌 Intentando conectar a ${dbConfig.host}:${dbConfig.port}...`);
    const connection = await mysql.createConnection(dbConfig);
    console.log('✅ Conectado a la base de datos');
    return connection;
  } catch (error) {
    console.error('❌ Error conectando a la base de datos:', error.message);
    console.error('\n💡 Verifica:');
    console.error('   - Que el host y puerto sean correctos');
    console.error('   - Que las credenciales sean válidas');
    console.error('   - Que la base de datos esté accesible');
    console.error('\n📝 Configuración actual:');
    console.error(`   Host: ${dbConfig.host}`);
    console.error(`   Puerto: ${dbConfig.port}`);
    console.error(`   Usuario: ${dbConfig.user}`);
    console.error(`   Base de datos: ${dbConfig.database}`);
    process.exit(1);
  }
}

async function getSystemTenantId(connection) {
  const [rows] = await connection.query(
    `SELECT id FROM tenant WHERE is_system = 1 OR subdomain = 'system' LIMIT 1`
  );
  return rows[0]?.id || null;
}

async function getTenantsToDelete(connection, systemTenantId) {
  if (tenantsOnly) {
    const [rows] = await connection.query(
      `SELECT id, name, subdomain, status, created_at 
       FROM tenant 
       WHERE id != ? AND is_system != 1`,
      [systemTenantId]
    );
    return rows;
  }
  return [];
}

async function getTableStats(connection, systemTenantId) {
  const stats = {};
  
  for (const table of TABLES_TO_CLEAN) {
    try {
      // Verificar si la tabla existe
      const [tableExists] = await connection.query(
        `SELECT COUNT(*) as count 
         FROM information_schema.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ?`,
        [table]
      );
      
      if (tableExists[0].count === 0) {
        stats[table] = { exists: false, count: 0 };
        continue;
      }
      
      // Contar registros
      let query = `SELECT COUNT(*) as count FROM \`${table}\``;
      const params = [];
      
      // Si la tabla tiene tenant_id, excluir el tenant system
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME 
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME = 'tenant_id'`,
        [table]
      );
      
      if (columns.length > 0 && systemTenantId) {
        query += ` WHERE tenant_id != ?`;
        params.push(systemTenantId);
      } else if (table === 'tenant' && systemTenantId) {
        // Para la tabla tenant, excluir el tenant system por id o is_system
        query += ` WHERE id != ? AND (is_system != 1 OR is_system IS NULL)`;
        params.push(systemTenantId);
      }
      
      const [rows] = await connection.query(query, params);
      stats[table] = { exists: true, count: rows[0].count };
    } catch (error) {
      stats[table] = { exists: false, error: error.message };
    }
  }
  
  return stats;
}

async function deleteTenantData(connection, tenantId, isDryRun) {
  const deleted = {};
  
  for (const table of TABLES_TO_CLEAN) {
    try {
      // Verificar si la tabla existe y tiene tenant_id
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME 
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME = 'tenant_id'`,
        [table]
      );
      
      if (columns.length === 0) continue; // Tabla sin tenant_id, saltar
      
      if (isDryRun) {
        const [rows] = await connection.query(
          `SELECT COUNT(*) as count FROM \`${table}\` WHERE tenant_id = ?`,
          [tenantId]
        );
        deleted[table] = rows[0].count;
      } else {
        const [result] = await connection.query(
          `DELETE FROM \`${table}\` WHERE tenant_id = ?`,
          [tenantId]
        );
        deleted[table] = result.affectedRows;
      }
    } catch (error) {
      console.error(`  ⚠️  Error en tabla ${table}:`, error.message);
      deleted[table] = { error: error.message };
    }
  }
  
  return deleted;
}

async function deleteAllData(connection, systemTenantId, isDryRun) {
  const deleted = {};
  
  for (const table of TABLES_TO_CLEAN) {
    try {
      // Saltar la tabla tenant - se maneja por separado
      if (table === 'tenant') {
        continue;
      }
      
      // Verificar si la tabla existe
      const [tableExists] = await connection.query(
        `SELECT COUNT(*) as count 
         FROM information_schema.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ?`,
        [table]
      );
      
      if (tableExists[0].count === 0) {
        deleted[table] = { skipped: 'Table does not exist' };
        continue;
      }
      
      // Verificar si tiene tenant_id
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME 
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME = 'tenant_id'`,
        [table]
      );
      
      if (isDryRun) {
        let query = `SELECT COUNT(*) as count FROM \`${table}\``;
        const params = [];
        
        if (columns.length > 0 && systemTenantId) {
          query += ` WHERE tenant_id != ?`;
          params.push(systemTenantId);
        }
        
        const [rows] = await connection.query(query, params);
        deleted[table] = rows[0].count;
      } else {
        if (columns.length > 0 && systemTenantId) {
          // Tabla con tenant_id: excluir system tenant
          const [result] = await connection.query(
            `DELETE FROM \`${table}\` WHERE tenant_id != ?`,
            [systemTenantId]
          );
          deleted[table] = result.affectedRows;
        } else {
          // Tabla sin tenant_id: eliminar todo
          const [result] = await connection.query(`DELETE FROM \`${table}\``);
          deleted[table] = result.affectedRows;
        }
      }
    } catch (error) {
      console.error(`  ⚠️  Error en tabla ${table}:`, error.message);
      deleted[table] = { error: error.message };
    }
  }
  
  return deleted;
}

async function main() {
  console.log('\n🧹 Script de Limpieza de Base de Datos de Producción\n');
  console.log('⚠️  ADVERTENCIA: Este script puede eliminar datos permanentemente\n');
  
  if (isDryRun) {
    console.log('🔍 MODO DRY-RUN: Solo se mostrará qué se eliminaría (no se eliminará nada)\n');
  }
  
  const connection = await getConnection();
  
  try {
    // Obtener tenant system
    const systemTenantId = await getSystemTenantId(connection);
    if (systemTenantId) {
      console.log(`✅ Tenant system encontrado (ID: ${systemTenantId}) - será preservado\n`);
    } else {
      console.log('⚠️  No se encontró tenant system\n');
    }
    
    // Obtener estadísticas
    console.log('📊 Obteniendo estadísticas de la base de datos...\n');
    const stats = await getTableStats(connection, systemTenantId);
    
    let totalRecords = 0;
    console.log('Tablas y registros a limpiar:');
    console.log('─'.repeat(60));
    for (const [table, data] of Object.entries(stats)) {
      if (data.exists && data.count > 0) {
        console.log(`  ${table.padEnd(35)} ${String(data.count).padStart(10)} registros`);
        totalRecords += data.count;
      }
    }
    console.log('─'.repeat(60));
    console.log(`  ${'TOTAL'.padEnd(35)} ${String(totalRecords).padStart(10)} registros\n`);
    
    if (isDryRun) {
      console.log('✅ DRY-RUN completado. Usa --confirm para ejecutar la limpieza.\n');
      await connection.end();
      rl.close();
      return;
    }
    
    if (!needsConfirmation) {
      console.log('❌ Para ejecutar la limpieza, debes usar el flag --confirm\n');
      console.log('Ejemplo: node cleanup-production-db.js --confirm --all-data\n');
      await connection.end();
      rl.close();
      return;
    }
    
    // Confirmación final
    console.log('⚠️  CONFIRMACIÓN REQUERIDA ⚠️\n');
    console.log(`Se eliminarán aproximadamente ${totalRecords} registros`);
    if (systemTenantId) {
      console.log(`El tenant system (ID: ${systemTenantId}) será preservado`);
    }
    console.log('');
    
    const answer = await question('¿Estás seguro de que quieres continuar? (escribe "SI, ELIMINAR" para confirmar): ');
    
    if (answer !== 'SI, ELIMINAR') {
      console.log('\n❌ Operación cancelada\n');
      await connection.end();
      rl.close();
      return;
    }
    
    console.log('\n🗑️  Iniciando limpieza...\n');
    
    await connection.beginTransaction();
    
    let deleted;
    if (tenantsOnly) {
      const tenants = await getTenantsToDelete(connection, systemTenantId);
      console.log(`Eliminando datos de ${tenants.length} tenants...\n`);
      
      for (const tenant of tenants) {
        console.log(`  Eliminando datos del tenant: ${tenant.name} (${tenant.subdomain})`);
        const tenantDeleted = await deleteTenantData(connection, tenant.id, false);
        for (const [table, count] of Object.entries(tenantDeleted)) {
          if (typeof count === 'number' && count > 0) {
            console.log(`    ${table}: ${count} registros eliminados`);
          }
        }
      }
      
      // Eliminar los tenants
      const [result] = await connection.query(
        `DELETE FROM tenant WHERE id != ? AND is_system != 1`,
        [systemTenantId]
      );
      console.log(`\n  ${result.affectedRows} tenants eliminados`);
    } else if (allData) {
      deleted = await deleteAllData(connection, systemTenantId, false);
      
      // Eliminar los tenants (excepto el system)
      if (systemTenantId) {
        const [tenantResult] = await connection.query(
          `DELETE FROM tenant WHERE id != ? AND is_system != 1`,
          [systemTenantId]
        );
        deleted['tenant'] = tenantResult.affectedRows;
        console.log(`\n  ${tenantResult.affectedRows} tenants eliminados de la tabla tenant`);
      } else {
        // Si no hay tenant system, eliminar todos los tenants
        const [tenantResult] = await connection.query(`DELETE FROM tenant`);
        deleted['tenant'] = tenantResult.affectedRows;
        console.log(`\n  ${tenantResult.affectedRows} tenants eliminados de la tabla tenant`);
      }
      
      console.log('\nRegistros eliminados por tabla:');
      console.log('─'.repeat(60));
      for (const [table, count] of Object.entries(deleted)) {
        if (typeof count === 'number' && count > 0) {
          console.log(`  ${table.padEnd(35)} ${String(count).padStart(10)} registros`);
        }
      }
      console.log('─'.repeat(60));
    }
    
    await connection.commit();
    console.log('\n✅ Limpieza completada exitosamente\n');
    
  } catch (error) {
    await connection.rollback();
    console.error('\n❌ Error durante la limpieza:', error.message);
    console.error(error);
  } finally {
    await connection.end();
    rl.close();
  }
}

main().catch(console.error);

