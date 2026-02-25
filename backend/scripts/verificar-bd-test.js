// Script para verificar conexión a BD de test
import { getTestPool } from '../src/__tests__/setup/db.test.js';

async function verificar() {
  try {
    console.log('🔍 Verificando conexión a BD de test...');
    const pool = getTestPool();
    
    const [result] = await pool.query('SELECT 1 as test, DATABASE() as db_name');
    console.log('✅ Conexión exitosa!');
    console.log(`📊 Base de datos: ${result[0].db_name}`);
    
    // Verificar si hay tablas
    const [tables] = await pool.query('SHOW TABLES');
    console.log(`📋 Tablas encontradas: ${tables.length}`);
    
    if (tables.length === 0) {
      console.log('\n⚠️  La BD está vacía. Necesitas copiar el esquema desde producción.');
      console.log('   Ejecuta: mysqldump -u root -p pelu_turnos --no-data > schema.sql');
      console.log('   Luego: mysql -u root -p pelu_turnos_test < schema.sql');
    } else {
      console.log('✅ La BD tiene tablas. Lista para usar en tests.');
      console.log('\n📝 Próximos pasos:');
      console.log('   1. Activar tests con .skip() en los archivos de test');
      console.log('   2. Ejecutar: npm test');
    }
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error de conexión:', error.message);
    console.log('\n💡 Verifica:');
    console.log('   1. Que el archivo .env.test tenga las credenciales correctas');
    console.log('   2. Que la BD pelu_turnos_test exista');
    console.log('   3. Que el usuario tenga permisos');
    console.log('\n📖 Ver: INSTRUCCIONES_BD_TEST.md para más ayuda');
    process.exit(1);
  }
}

verificar();

