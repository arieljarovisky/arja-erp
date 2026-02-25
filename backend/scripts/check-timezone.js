// Script para verificar la zona horaria de la base de datos
import { pool } from '../src/db.js';

async function checkTimezone() {
  const conn = await pool.getConnection();
  try {
    console.log('🔍 Verificando zona horaria de la base de datos...\n');
    
    // Verificar zona horaria de la sesión actual
    const [sessionTz] = await conn.query("SELECT @@session.time_zone AS session_tz, @@global.time_zone AS global_tz, NOW() AS server_now, UTC_TIMESTAMP() AS utc_now");
    console.log('📊 Zona horaria de la sesión:', sessionTz[0].session_tz);
    console.log('📊 Zona horaria global:', sessionTz[0].global_tz);
    console.log('📊 Hora del servidor (NOW()):', sessionTz[0].server_now);
    console.log('📊 Hora UTC (UTC_TIMESTAMP()):', sessionTz[0].utc_now);
    
    // Verificar zona horaria del sistema
    const [systemTz] = await conn.query("SELECT @@system_time_zone AS system_tz");
    console.log('📊 Zona horaria del sistema:', systemTz[0].system_tz);
    
    // Probar inserción de una fecha con timezone
    const testDate = '2024-12-02 08:30:00';
    const [testResult] = await conn.query("SELECT STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s') AS parsed_date, ? AS original_date", [testDate, testDate]);
    console.log('\n🧪 Prueba de fecha:');
    console.log('   Fecha original:', testResult[0].original_date);
    console.log('   Fecha parseada:', testResult[0].parsed_date);
    
    // Probar con CONVERT_TZ
    const [convertTzResult] = await conn.query(
      "SELECT CONVERT_TZ(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), '+00:00', '-03:00') AS arg_time, CONVERT_TZ(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), '-03:00', '+00:00') AS utc_time",
      [testDate, testDate]
    );
    console.log('\n🔄 Conversión de timezone:');
    console.log('   UTC a Argentina (-03:00):', convertTzResult[0].arg_time);
    console.log('   Argentina (-03:00) a UTC:', convertTzResult[0].utc_time);
    
    // Verificar un turno existente
    const [appointment] = await conn.query("SELECT id, starts_at, ends_at FROM appointment ORDER BY id DESC LIMIT 1");
    if (appointment.length > 0) {
      console.log('\n📅 Último turno en la base de datos:');
      console.log('   ID:', appointment[0].id);
      console.log('   starts_at:', appointment[0].starts_at);
      console.log('   ends_at:', appointment[0].ends_at);
      console.log('   Tipo de dato:', typeof appointment[0].starts_at);
    }
    
    console.log('\n✅ Verificación completada');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    conn.release();
    await pool.end();
  }
}

checkTimezone();

