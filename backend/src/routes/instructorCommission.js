import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/middlewares.js";

export const instructorCommission = Router();

instructorCommission.get("/", requireAuth, requireAdmin, async (req, res) => {
  const tenantId = req.tenant.id;
  const [rows] = await pool.query(`
 SELECT i.id, i.name, COALESCE(c.percentage, 0) AS percentage
   FROM instructor i
   LEFT JOIN instructor_commission c ON i.id = c.instructor_id
  WHERE i.is_active = 1 AND i.tenant_id = ?
   ORDER BY i.name
  `, [tenantId]);
  res.json(rows);
});

instructorCommission.put("/:instructorId", requireAuth, requireAdmin, async (req, res) => {
  const { instructorId } = req.params;
  const { percentage } = req.body;
  const [[st]] = await pool.query(`SELECT id FROM instructor WHERE id=? AND tenant_id=?`, [instructorId, req.tenant.id]);
  if (!st) return res.status(404).json({ ok: false, error: "Instructor no encontrado en tu cuenta" });
  await pool.query(`
  INSERT INTO instructor_commission (tenant_id, instructor_id, percentage)
  VALUES (?, ?, ?)
   ON DUPLICATE KEY UPDATE percentage = VALUES(percentage)
`, [req.tenant.id, instructorId, Number(percentage ?? 0)]);
  res.json({ ok: true });
});
