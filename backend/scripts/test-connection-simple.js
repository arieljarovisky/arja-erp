// Test simple de conexión a MySQL
import mysql from 'mysql2/promise';

async function testConnection() {
  const config = {
    host: process.env.TEST_DB_HOST || 'localhost',
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASS || '',
    database: process.env.TEST_DB_NAME || 'pelu_turnos',
  };

  console.log('🔍 Intentando conectar con:');
  console.log(`   Host: ${config.host}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   User: ${config.user}`);
  console.log(`   Password: ${config.password ? '***' : '(vacío)'}`);
  console.log(`   Database: ${config.database}`);
  console.log('');

  try {
    const connection = await mysql.createConnection(config);
    console.log('✅ Conexión exitosa!');
    
    const [rows] = await connection.query('SELECT DATABASE() as db, USER() as user');
    console.log(`📊 Base de datos conectada: ${rows[0].db}`);
    console.log(`👤 Usuario: ${rows[0].user}`);
    
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`📋 Tablas encontradas: ${tables.length}`);
    
    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
    console.error('   Código:', error.code);
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n💡 El password o usuario es incorrecto.');
      console.log('   Verifica que TEST_DB_PASS en .env.test sea correcto.');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 No se puede conectar al servidor MySQL.');
      console.log('   Verifica que MySQL esté corriendo.');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.log(`\n💡 La base de datos "${config.database}" no existe.`);
      console.log(`   Créala con: CREATE DATABASE ${config.database};`);
    }
    
    process.exit(1);
  }
}

// Cargar .env.test primero
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.test') });

testConnection();

