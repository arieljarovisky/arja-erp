#!/usr/bin/env node
/**
 * Script de backup de base de datos MySQL
 * 
 * Uso:
 *   node scripts/backup-db.js
 * 
 * Variables de entorno requeridas:
 *   - DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
 * 
 * Variables opcionales:
 *   - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, AWS_REGION (para subir a S3)
 *   - BACKUP_RETENTION_DAYS (días a mantener, default: 30)
 *   - BACKUP_LOCAL_PATH (ruta local para guardar, default: ./backups)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuración
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;

const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const BACKUP_LOCAL_PATH = process.env.BACKUP_LOCAL_PATH || join(__dirname, '../backups');

// AWS S3 (opcional)
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const USE_S3 = !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && AWS_S3_BUCKET);

// Validar variables requeridas
if (!DB_HOST || !DB_USER || !DB_PASS || !DB_NAME) {
  console.error('❌ Error: Faltan variables de entorno requeridas');
  console.error('   Requeridas: DB_HOST, DB_USER, DB_PASS, DB_NAME');
  process.exit(1);
}

/**
 * Crear backup de la base de datos
 */
async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const filename = `backup_${DB_NAME}_${timestamp}.sql`;
  const filepath = join(BACKUP_LOCAL_PATH, filename);

  // Crear directorio de backups si no existe
  if (!existsSync(BACKUP_LOCAL_PATH)) {
    mkdirSync(BACKUP_LOCAL_PATH, { recursive: true });
    console.log(`📁 Directorio de backups creado: ${BACKUP_LOCAL_PATH}`);
  }

  console.log(`🔄 Creando backup de ${DB_NAME}...`);

  try {
    // Comando mysqldump
    // Nota: En Railway, mysqldump puede no estar disponible directamente
    // Alternativa: usar mysql2 para exportar o instalar mysqldump en el contenedor
    const dumpCommand = `mysqldump -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} -p${DB_PASS} ${DB_NAME} > "${filepath}" 2>&1`;

    try {
      await execAsync(dumpCommand);
    } catch (error) {
      // Si mysqldump no está disponible, intentar método alternativo con Node.js
      if (error.message.includes('mysqldump: command not found') || error.message.includes('ENOENT')) {
        console.log('⚠️  mysqldump no encontrado, usando método alternativo con Node.js...');
        await createBackupWithNode(filepath);
      } else {
        throw error;
      }
    }

    // Verificar que el archivo se creó y tiene contenido
    if (!existsSync(filepath)) {
      throw new Error('El archivo de backup no se creó');
    }

    const stats = statSync(filepath);
    if (stats.size === 0) {
      throw new Error('El archivo de backup está vacío');
    }

    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Backup creado: ${filename} (${sizeMB} MB)`);

    return { filepath, filename, size: stats.size };
  } catch (error) {
    console.error('❌ Error creando backup:', error.message);
    throw error;
  }
}

/**
 * Crear backup usando Node.js (sin mysqldump)
 */
async function createBackupWithNode(filepath) {
  const { createPool } = await import('../src/db.js');
  const pool = createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
  });

  try {
    // Obtener todas las tablas
    const [tables] = await pool.query('SHOW TABLES');
    const tableNames = tables.map(row => Object.values(row)[0]);

    let sqlContent = `-- Backup de ${DB_NAME}\n`;
    sqlContent += `-- Fecha: ${new Date().toISOString()}\n\n`;
    sqlContent += `SET FOREIGN_KEY_CHECKS=0;\n\n`;

    // Exportar cada tabla
    for (const tableName of tableNames) {
      console.log(`  📋 Exportando tabla: ${tableName}`);
      
      // Obtener estructura de la tabla
      const [createTable] = await pool.query(`SHOW CREATE TABLE \`${tableName}\``);
      sqlContent += `\n-- Estructura de tabla: ${tableName}\n`;
      sqlContent += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
      sqlContent += createTable[0]['Create Table'] + ';\n\n';

      // Obtener datos
      const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
      
      if (rows.length > 0) {
        sqlContent += `-- Datos de tabla: ${tableName}\n`;
        sqlContent += `INSERT INTO \`${tableName}\` VALUES\n`;
        
        const values = rows.map(row => {
          const rowValues = Object.values(row).map(val => {
            if (val === null) return 'NULL';
            if (typeof val === 'string') {
              return `'${val.replace(/'/g, "''")}'`;
            }
            return val;
          });
          return `(${rowValues.join(', ')})`;
        });
        
        sqlContent += values.join(',\n') + ';\n\n';
      }
    }

    sqlContent += `SET FOREIGN_KEY_CHECKS=1;\n`;

    writeFileSync(filepath, sqlContent, 'utf8');
    await pool.end();
  } catch (error) {
    await pool.end();
    throw error;
  }
}

/**
 * Subir backup a S3
 */
async function uploadToS3(filepath, filename) {
  if (!USE_S3) {
    console.log('ℹ️  S3 no configurado, saltando subida');
    return;
  }

  try {
    // Importar dinámicamente AWS SDK
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    
    const s3 = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });

    const fileContent = readFileSync(filepath);
    const s3Key = `backups/${filename}`;

    await s3.send(new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'application/sql',
    }));

    console.log(`✅ Backup subido a S3: s3://${AWS_S3_BUCKET}/${s3Key}`);
  } catch (error) {
    console.error('⚠️  Error subiendo a S3:', error.message);
    // No fallar el proceso completo si S3 falla
  }
}

/**
 * Limpiar backups antiguos
 */
function cleanupOldBackups() {
  try {
    if (!existsSync(BACKUP_LOCAL_PATH)) {
      return;
    }

    const files = readdirSync(BACKUP_LOCAL_PATH)
      .filter(file => file.startsWith('backup_') && file.endsWith('.sql'))
      .map(file => ({
        name: file,
        path: join(BACKUP_LOCAL_PATH, file),
        mtime: statSync(join(BACKUP_LOCAL_PATH, file)).mtime,
      }));

    const now = Date.now();
    const retentionMs = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const oldFiles = files.filter(file => (now - file.mtime.getTime()) > retentionMs);

    if (oldFiles.length > 0) {
      console.log(`🧹 Eliminando ${oldFiles.length} backup(s) antiguo(s)...`);
      oldFiles.forEach(file => {
        unlinkSync(file.path);
        console.log(`  🗑️  Eliminado: ${file.name}`);
      });
    } else {
      console.log(`✅ No hay backups antiguos para eliminar (retención: ${BACKUP_RETENTION_DAYS} días)`);
    }

    // Mostrar backups restantes
    const remainingFiles = readdirSync(BACKUP_LOCAL_PATH)
      .filter(file => file.startsWith('backup_') && file.endsWith('.sql'));
    console.log(`📦 Backups almacenados: ${remainingFiles.length}`);
  } catch (error) {
    console.error('⚠️  Error limpiando backups antiguos:', error.message);
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('🚀 Iniciando backup de base de datos...');
  console.log(`📊 Base de datos: ${DB_NAME}`);
  console.log(`📁 Ruta local: ${BACKUP_LOCAL_PATH}`);
  console.log(`☁️  S3: ${USE_S3 ? `s3://${AWS_S3_BUCKET}/backups/` : 'No configurado'}`);
  console.log(`🗓️  Retención: ${BACKUP_RETENTION_DAYS} días\n`);

  try {
    // 1. Crear backup
    const { filepath, filename } = await createBackup();

    // 2. Subir a S3 (si está configurado)
    await uploadToS3(filepath, filename);

    // 3. Limpiar backups antiguos
    cleanupOldBackups();

    console.log('\n✅ Proceso de backup completado exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error en el proceso de backup:', error.message);
    process.exit(1);
  }
}

// Ejecutar
main();

