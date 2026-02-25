import { Router } from "express";
import { sendEmail } from "../services/email.js";

const router = Router();

// Endpoint de prueba para verificar configuración de email
router.post("/test", async (req, res) => {
  try {
    const { to } = req.body;
    
    if (!to) {
      return res.status(400).json({ 
        ok: false, 
        error: "Email de destino requerido" 
      });
    }

    console.log(`[TEST_EMAIL] Intentando enviar email de prueba a: ${to}`);

    await sendEmail({
      to,
      subject: "Email de prueba - ARJA ERP",
      html: `
        <h1>Email de prueba</h1>
        <p>Si recibiste este email, la configuración de correo está funcionando correctamente.</p>
        <p>Fecha: ${new Date().toLocaleString('es-AR')}</p>
      `,
      text: "Si recibiste este email, la configuración de correo está funcionando correctamente.",
    });

    res.json({ 
      ok: true, 
      message: `Email de prueba enviado a ${to}. Revisá tu bandeja de entrada.` 
    });
  } catch (error) {
    console.error("[TEST_EMAIL] Error:", error);
    res.status(500).json({ 
      ok: false, 
      error: "Error al enviar email de prueba",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export default router;

