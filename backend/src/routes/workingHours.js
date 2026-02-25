// src/routes/workingHours.js
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";

export const workingHours = Router();

// Seguridad - permitir admin, staff y user para que el staff pueda ver horarios
workingHours.use(requireAuth, requireRole("admin", "staff", "user"));

// Helper: asegura que existan los 7 días
function ensureSevenDays(rows, instructorId) {
  // Si hay múltiples registros para el mismo día (por sucursal), tomar el primero
  const map = new Map();
  for (const r of rows) {
    const key = Number(r.weekday);
    if (!map.has(key)) {
      map.set(key, r);
    }
  }
  return Array.from({ length: 7 }, (_, d) => {
    const r = map.get(d);
    return r || { instructor_id: Number(instructorId), weekday: d, start_time: null, end_time: null, branch_id: null };
  });
}

// GET /api/working-hours?instructorId=1
workingHours.get("/", async (req, res) => {
  try {
    const instructorId = Number(req.query.instructorId);
    if (!instructorId) {
      return res.status(400).json({ ok: false, error: "Falta instructorId" });
    }
    
    // Verificar si la columna branch_id existe
    const [columns] = await pool.query(
      `SELECT COLUMN_NAME 
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'working_hours' 
       AND COLUMN_NAME = 'branch_id'`
    );
    const hasBranchId = columns.length > 0;
    
    const selectFields = hasBranchId 
      ? `instructor_id, weekday, start_time, end_time, branch_id`
      : `instructor_id, weekday, start_time, end_time`;
    
    const orderBy = hasBranchId 
      ? `ORDER BY weekday ASC, branch_id ASC`
      : `ORDER BY weekday ASC`;
    
    const [rows] = await pool.query(
      `SELECT ${selectFields}
       FROM working_hours
       WHERE instructor_id = ? AND tenant_id = ?
       ${orderBy}`,
      [instructorId, req.tenant.id]
    );
    
    console.log(`[GET /api/working-hours] Instructor ${instructorId}: ${rows.length} horarios encontrados`);
    console.log(`[GET /api/working-hours] Horarios:`, JSON.stringify(rows, null, 2));
    
    // NO usar ensureSevenDays aquí porque ahora puede haber múltiples horarios por día (uno por sucursal)
    // El frontend se encarga de agruparlos por día
    const data = rows.map(row => ({
      ...row,
      branch_id: hasBranchId ? (row.branch_id ?? null) : undefined
    }));
    
    console.log(`[GET /api/working-hours] Datos devueltos:`, JSON.stringify(data, null, 2));
    
    return res.json({ ok: true, data });
  } catch (e) {
    console.error("[GET /api/working-hours] error:", e);
    let errorMessage = e.message || "Error al cargar horarios";
    
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      errorMessage = "Error en la estructura de la base de datos. Verificá que la columna branch_id exista ejecutando la migración 053.";
    }
    
    return res.status(500).json({ 
      ok: false, 
      error: errorMessage,
      code: e.code || null
    });
  }
});

// PUT /api/working-hours
// Body: { instructorId: 1, hours: [{weekday, start_time|null|"", end_time|null|"", branch_id|null}, ...] }
// Ahora acepta múltiples horarios por día (uno por sucursal)
workingHours.put("/", async (req, res) => {
  try {
    const instructorId = Number(req.body?.instructorId);
    const hours = Array.isArray(req.body?.hours) ? req.body.hours : null;
    const tenantId = req.tenant.id;
    if (!instructorId) return res.status(400).json({ ok: false, error: "Falta instructorId" });
    if (!hours || hours.length === 0) {
      // Si no se envían horarios, interpretar como "dejar todo en franco"
      // Eliminar todos los registros actuales de working_hours para el instructor
      try {
        const [del] = await pool.query(
          `DELETE FROM working_hours WHERE instructor_id = ? AND tenant_id = ?`,
          [instructorId, tenantId]
        );
        console.log(`[PUT /api/working-hours] ✅ Sin horas enviadas. Eliminados ${del.affectedRows} horarios para instructor ${instructorId}`);
        return res.json({ ok: true, deleted: del.affectedRows });
      } catch (e) {
        console.error("[PUT /api/working-hours] error eliminando horarios:", e);
        return res.status(500).json({ ok: false, error: "Error al limpiar horarios" });
      }
    }

    // Normalizar y validar
    console.log(`[PUT /api/working-hours] Recibidos ${hours.length} horarios sin procesar:`, JSON.stringify(hours, null, 2));
    
    const cleaned = hours.map((h, idx) => {
      const weekday = Number(h.weekday);
      if (!(weekday >= 0 && weekday <= 6)) {
        throw new Error("Falta weekday (0..6)");
      }
      // "" → null
      let start = h.start_time;
      let end = h.end_time;
      start = (start === "" || start === undefined) ? null : start;
      end = (end === "" || end === undefined) ? null : end;

      // Si uno es null, ambos a null (franco)
      if (start == null || end == null) {
        start = null; end = null;
      } else {
        // Asegurar formato HH:MM:SS
        if (/^\d{2}:\d{2}$/.test(start)) start += ":00";
        if (/^\d{2}:\d{2}$/.test(end)) end += ":00";
      }

      const branch_id = h.branch_id != null ? Number(h.branch_id) : null;
      
      const cleanedItem = { weekday, start_time: start, end_time: end, branch_id };
      console.log(`[PUT /api/working-hours] Item ${idx} procesado:`, cleanedItem);
      
      return cleanedItem;
    });
    
    console.log(`[PUT /api/working-hours] Total de items después de limpieza: ${cleaned.length}`);

    // Verificar si la columna branch_id existe
    const [columns] = await pool.query(
      `SELECT COLUMN_NAME 
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'working_hours' 
       AND COLUMN_NAME = 'branch_id'`
    );
    const hasBranchId = columns.length > 0;

    // Upsert por cada día
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Crear un set de los horarios que se están enviando (para identificar cuáles eliminar después)
      const sentKeys = new Set();
      const validItems = cleaned.filter(item => item.start_time && item.end_time); // Solo los que tienen horarios válidos

      console.log(`[PUT /api/working-hours] ==========================================`);
      console.log(`[PUT /api/working-hours] INICIO DE GUARDADO`);
      console.log(`[PUT /api/working-hours] Instructor ID: ${instructorId}`);
      console.log(`[PUT /api/working-hours] Tenant ID: ${tenantId}`);
      console.log(`[PUT /api/working-hours] Total items recibidos: ${cleaned.length}`);
      console.log(`[PUT /api/working-hours] Items válidos (con horarios): ${validItems.length}`);
      console.log(`[PUT /api/working-hours] Branch_id existe en BD: ${hasBranchId}`);
      console.log(`[PUT /api/working-hours] Items a procesar:`, JSON.stringify(validItems, null, 2));
      
      // Validar que no haya horarios solapados
      const validateOverlaps = (items) => {
        const timeToMinutes = (timeStr) => {
          if (!timeStr) return null;
          const parts = timeStr.split(':');
          return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
        };

        const byDay = {};
        items.forEach(item => {
          if (!byDay[item.weekday]) {
            byDay[item.weekday] = [];
          }
          byDay[item.weekday].push(item);
        });

        const overlaps = [];
        Object.entries(byDay).forEach(([weekday, dayItems]) => {
          for (let i = 0; i < dayItems.length; i++) {
            for (let j = i + 1; j < dayItems.length; j++) {
              const h1 = dayItems[i];
              const h2 = dayItems[j];
              
              const start1 = timeToMinutes(h1.start_time);
              const end1 = timeToMinutes(h1.end_time);
              const start2 = timeToMinutes(h2.start_time);
              const end2 = timeToMinutes(h2.end_time);

              if (start1 !== null && end1 !== null && start2 !== null && end2 !== null) {
                // Si existe branch_id, solo considerar solapamiento dentro de la MISMA sucursal
                if (hasBranchId) {
                  const b1 = h1.branch_id == null ? null : Number(h1.branch_id);
                  const b2 = h2.branch_id == null ? null : Number(h2.branch_id);
                  if (b1 !== b2) {
                    continue; // solapamiento entre distintas sucursales es válido
                  }
                }
                // Verificar solapamiento: (start1 < end2 && end1 > start2)
                if (start1 < end2 && end1 > start2) {
                  overlaps.push({
                    weekday: Number(weekday),
                    schedule1: { branch_id: h1.branch_id, time: `${h1.start_time} - ${h1.end_time}` },
                    schedule2: { branch_id: h2.branch_id, time: `${h2.start_time} - ${h2.end_time}` }
                  });
                }
              }
            }
          }
        });

        return overlaps;
      };

      const overlaps = validateOverlaps(validItems);
      if (overlaps.length > 0) {
        console.error(`[PUT /api/working-hours] ❌ Horarios solapados detectados:`, overlaps);
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const overlapMessages = overlaps.map(ov => {
          const dayName = dayNames[ov.weekday];
          const branch1 = ov.schedule1.branch_id ? `Sucursal ${ov.schedule1.branch_id}` : 'Sin sucursal';
          const branch2 = ov.schedule2.branch_id ? `Sucursal ${ov.schedule2.branch_id}` : 'Sin sucursal';
          return `${dayName}: ${branch1} (${ov.schedule1.time}) se solapa con ${branch2} (${ov.schedule2.time})`;
        });
        return res.status(400).json({ 
          ok: false, 
          error: "No se pueden guardar horarios que se solapen",
          details: overlapMessages,
          code: "ERR_OVERLAPPING_SCHEDULES"
        });
      }
      
      console.log(`[PUT /api/working-hours] ==========================================`);

      for (const item of validItems) {
        const { weekday, start_time, end_time, branch_id } = item;
        
        // Validar que los datos sean correctos
        if (weekday === null || weekday === undefined || weekday < 0 || weekday > 6) {
          console.error(`[PUT /api/working-hours] Weekday inválido: ${weekday}`);
          continue;
        }
        
        // Crear una clave única para este horario (manejar null explícitamente)
        const branchKey = branch_id === null || branch_id === undefined ? 'null' : String(branch_id);
        const key = hasBranchId 
          ? `${weekday}-${branchKey}`
          : `${weekday}`;
        
        // Verificar si ya agregamos esta clave (duplicado en el mismo request)
        if (sentKeys.has(key)) {
          console.warn(`[PUT /api/working-hours] ADVERTENCIA: Clave duplicada detectada: ${key}. Esto podría causar que solo se guarde uno.`);
        }
        sentKeys.add(key);
        
        console.log(`[PUT /api/working-hours] Procesando: weekday=${weekday}, branch_id=${branch_id} (tipo: ${typeof branch_id}), key=${key}`);

        if (hasBranchId) {
          // ¿ya existe fila para este día y sucursal?
          // Usar una consulta más precisa que maneje NULL correctamente
          let exists = null;
          let queryUsed = '';
          
          if (branch_id === null || branch_id === undefined) {
            queryUsed = `SELECT id FROM working_hours WHERE instructor_id=${instructorId} AND tenant_id=${tenantId} AND weekday=${weekday} AND branch_id IS NULL`;
            console.log(`[PUT /api/working-hours] 🔍 Buscando horario existente (branch_id IS NULL): ${queryUsed}`);
            const [rows] = await conn.query(
              `SELECT id FROM working_hours 
               WHERE instructor_id=? AND tenant_id=? AND weekday=? AND branch_id IS NULL`,
              [instructorId, tenantId, weekday]);
            exists = rows[0] || null;
            console.log(`[PUT /api/working-hours] 🔍 Resultado búsqueda (NULL): ${rows.length} registros encontrados`, rows);
          } else {
            queryUsed = `SELECT id FROM working_hours WHERE instructor_id=${instructorId} AND tenant_id=${tenantId} AND weekday=${weekday} AND branch_id=${branch_id}`;
            console.log(`[PUT /api/working-hours] 🔍 Buscando horario existente (branch_id=${branch_id}): ${queryUsed}`);
            const [rows] = await conn.query(
              `SELECT id FROM working_hours 
               WHERE instructor_id=? AND tenant_id=? AND weekday=? AND branch_id = ?`,
              [instructorId, tenantId, weekday, branch_id]);
            exists = rows[0] || null;
            console.log(`[PUT /api/working-hours] 🔍 Resultado búsqueda (branch_id=${branch_id}): ${rows.length} registros encontrados`, rows);
          }

          if (exists) {
            console.log(`[PUT /api/working-hours] ✏️ ACTUALIZANDO horario existente id=${exists.id}`);
            console.log(`[PUT /api/working-hours] ✏️ Datos: start_time=${start_time}, end_time=${end_time}, branch_id=${branch_id}`);
            const [updateResult] = await conn.query(
              `UPDATE working_hours
                 SET start_time = ?, end_time = ?, branch_id = ?
               WHERE id = ?`,
              [start_time, end_time, branch_id, exists.id]
            );
            console.log(`[PUT /api/working-hours] ✏️ UPDATE ejecutado: affectedRows=${updateResult.affectedRows}`);
          } else {
            console.log(`[PUT /api/working-hours] ➕ INSERTANDO nuevo horario:`);
            console.log(`[PUT /api/working-hours] ➕   - weekday: ${weekday}`);
            console.log(`[PUT /api/working-hours] ➕   - branch_id: ${branch_id} (tipo: ${typeof branch_id})`);
            console.log(`[PUT /api/working-hours] ➕   - start_time: ${start_time}`);
            console.log(`[PUT /api/working-hours] ➕   - end_time: ${end_time}`);
            console.log(`[PUT /api/working-hours] ➕   - tenant_id: ${tenantId}`);
            console.log(`[PUT /api/working-hours] ➕   - instructor_id: ${instructorId}`);
            
            try {
              const [result] = await conn.query(
                `INSERT INTO working_hours (tenant_id, instructor_id, weekday, start_time, end_time, branch_id)
               VALUES (?,?,?,?,?,?)`,
                [tenantId, instructorId, weekday, start_time, end_time, branch_id]
              );
              console.log(`[PUT /api/working-hours] ✅ ✅ ✅ INSERT EXITOSO: id=${result.insertId}, affectedRows=${result.affectedRows}`);
            } catch (insertError) {
              console.error(`[PUT /api/working-hours] ❌ ❌ ❌ ERROR AL INSERTAR:`);
              console.error(`[PUT /api/working-hours] ❌ Error code: ${insertError.code}`);
              console.error(`[PUT /api/working-hours] ❌ Error message: ${insertError.message}`);
              console.error(`[PUT /api/working-hours] ❌ SQL State: ${insertError.sqlState}`);
              console.error(`[PUT /api/working-hours] ❌ SQL Message: ${insertError.sqlMessage}`);
              console.error(`[PUT /api/working-hours] ❌ Datos que intentaron insertarse:`);
              console.error(`[PUT /api/working-hours] ❌   - tenantId: ${tenantId}`);
              console.error(`[PUT /api/working-hours] ❌   - instructorId: ${instructorId}`);
              console.error(`[PUT /api/working-hours] ❌   - weekday: ${weekday}`);
              console.error(`[PUT /api/working-hours] ❌   - branch_id: ${branch_id} (tipo: ${typeof branch_id})`);
              console.error(`[PUT /api/working-hours] ❌   - start_time: ${start_time}`);
              console.error(`[PUT /api/working-hours] ❌   - end_time: ${end_time}`);
              if (insertError.sql) {
                console.error(`[PUT /api/working-hours] ❌ SQL ejecutado: ${insertError.sql}`);
              }
              throw insertError; // Re-lanzar para que se maneje en el catch principal
            }
          }
        } else {
          // Versión sin branch_id (compatibilidad hacia atrás)
          const [[exists]] = await conn.query(
            `SELECT id FROM working_hours WHERE instructor_id=? AND tenant_id=? AND weekday=?`,
            [instructorId, tenantId, weekday]);

          if (exists) {
            await conn.query(
              `UPDATE working_hours
                 SET start_time = ?, end_time = ?
               WHERE id = ?`,
              [start_time, end_time, exists.id]
            );
          } else {
            await conn.query(
              `INSERT INTO working_hours (tenant_id, instructor_id, weekday, start_time, end_time)
             VALUES (?,?,?,?,?)`,
              [tenantId, instructorId, weekday, start_time, end_time]
            );
          }
        }
      }

      // Eliminar horarios que ya no están en la lista enviada
      // Hacer esto DESPUÉS de insertar/actualizar para evitar eliminar antes de guardar
      if (hasBranchId) {
        // Obtener todos los horarios existentes para este instructor (después de las inserciones/actualizaciones)
        const [existingRows] = await conn.query(
          `SELECT id, weekday, branch_id FROM working_hours WHERE instructor_id=? AND tenant_id=?`,
          [instructorId, tenantId]
        );

        console.log(`[PUT /api/working-hours] Horarios existentes después de guardar: ${existingRows.length}, Claves enviadas:`, Array.from(sentKeys));
        
        const toDelete = [];
        for (const existing of existingRows) {
          // Crear la clave de la misma forma que en el loop anterior
          const existingBranchId = existing.branch_id;
          const branchKey = existingBranchId === null || existingBranchId === undefined ? 'null' : String(existingBranchId);
          const key = `${existing.weekday}-${branchKey}`;
          
          console.log(`[PUT /api/working-hours] Verificando horario existente: weekday=${existing.weekday}, branch_id=${existingBranchId}, key=${key}, existe en sentKeys=${sentKeys.has(key)}`);
          
          if (!sentKeys.has(key)) {
            // Este horario ya no está en la lista, marcarlo para eliminar
            console.log(`[PUT /api/working-hours] Marcando para eliminar horario id=${existing.id} (ya no está en la lista)`);
            toDelete.push(existing.id);
          }
        }
        
        // Eliminar todos los horarios marcados en una sola operación
        if (toDelete.length > 0) {
          console.log(`[PUT /api/working-hours] Eliminando ${toDelete.length} horarios que ya no están en la lista`);
          await conn.query(
            `DELETE FROM working_hours WHERE id IN (${toDelete.map(() => '?').join(',')})`,
            toDelete
          );
        }
      } else {
        // Sin branch_id: eliminar días que no tienen horarios válidos
        const sentWeekdays = new Set(validItems.map(item => item.weekday));
        const [existingRows] = await conn.query(
          `SELECT id, weekday FROM working_hours WHERE instructor_id=? AND tenant_id=?`,
          [instructorId, tenantId]
        );

        for (const existing of existingRows) {
          if (!sentWeekdays.has(existing.weekday)) {
            await conn.query(
              `DELETE FROM working_hours WHERE id = ?`,
              [existing.id]
            );
          }
        }
      }

      console.log(`[PUT /api/working-hours] ==========================================`);
      console.log(`[PUT /api/working-hours] COMMIT de transacción`);
      await conn.commit();
      console.log(`[PUT /api/working-hours] ✅ Transacción completada exitosamente`);
      console.log(`[PUT /api/working-hours] ==========================================`);
    } catch (e) {
      console.error(`[PUT /api/working-hours] ==========================================`);
      console.error(`[PUT /api/working-hours] ❌ ERROR EN TRANSACCIÓN - ROLLBACK`);
      console.error(`[PUT /api/working-hours] ❌ Error code: ${e.code}`);
      console.error(`[PUT /api/working-hours] ❌ Error message: ${e.message}`);
      console.error(`[PUT /api/working-hours] ❌ SQL State: ${e.sqlState}`);
      console.error(`[PUT /api/working-hours] ❌ SQL Message: ${e.sqlMessage}`);
      if (e.sql) {
        console.error(`[PUT /api/working-hours] ❌ SQL que causó el error: ${e.sql}`);
      }
      console.error(`[PUT /api/working-hours] ❌ Stack trace:`, e.stack);
      console.error(`[PUT /api/working-hours] ==========================================`);
      
      await conn.rollback();
      console.log(`[PUT /api/working-hours] 🔄 Rollback ejecutado`);
      
      // Mejorar mensajes de error
      let errorMessage = e.message || "Error al guardar horarios";
      
      if (e.code === 'ER_DUP_ENTRY') {
        console.error(`[PUT /api/working-hours] ❌ ERROR DE DUPLICADO DETECTADO`);
        console.error(`[PUT /api/working-hours] ❌ Mensaje completo: ${e.sqlMessage}`);
        if (e.sqlMessage && e.sqlMessage.includes('uq_wh')) {
          errorMessage = "Ya existe un horario para este día. La restricción única uq_wh todavía está activa. Ejecutá la migración 054d para corregirlo.";
        } else if (e.sqlMessage && e.sqlMessage.includes('uq_wh_instructor_weekday_branch')) {
          errorMessage = "Ya existe un horario para esta combinación de día y sucursal. Verificá que no estés duplicando horarios.";
        } else {
          errorMessage = `Error de duplicado: ${e.sqlMessage}. Verificá que no estés intentando guardar el mismo horario dos veces.`;
        }
      } else if (e.code === 'ER_BAD_FIELD_ERROR') {
        errorMessage = "Error en la estructura de la base de datos. Verificá que la columna branch_id exista ejecutando la migración 053.";
      } else if (e.code === 'ER_NO_REFERENCED_ROW_2') {
        errorMessage = "La sucursal seleccionada no existe o no está disponible.";
      }
      
      throw new Error(errorMessage);
    } finally {
      conn.release();
      console.log(`[PUT /api/working-hours] 🔓 Conexión liberada`);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/working-hours] error:", e);
    const statusCode = e.code === 'ER_DUP_ENTRY' || e.code === 'ER_BAD_FIELD_ERROR' ? 400 : 500;
    return res.status(statusCode).json({ 
      ok: false, 
      error: e.message || "Error al guardar horarios",
      code: e.code || null
    });
  }
});
