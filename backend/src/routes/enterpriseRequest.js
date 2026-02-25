import { Router } from "express";
import { sendEmail } from "../services/email.js";
import { getEmailLogo } from "../utils/emailLogo.js";

const router = Router();

// Función para escapar HTML y prevenir XSS
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

router.post("/enterprise/request", async (req, res) => {
  try {
    const {
      name = "",
      email = "",
      phone = "",
      company = "",
      teamSize = "",
      message = "",
    } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({
        ok: false,
        error: "Nombre y email son requeridos",
      });
    }

    // Enviar a ventas
    const salesEmail = "ventas@arjaerp.com.ar";
    const subject = "Nueva solicitud Pro a medida";
    const logoSvg = getEmailLogo('light', 'header');
    const footerLogoSvg = getEmailLogo('light', 'footer');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa;">
          <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f7fa;">
            <tr>
              <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <!-- Header con Logo -->
                  <tr>
                    <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #13b5cf 0%, #0d7fd4 100%); border-radius: 12px 12px 0 0;">
                      <div style="display: inline-block; max-width: 200px; width: 100%;">
                        ${logoSvg}
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Contenido principal -->
                  <tr>
                    <td style="padding: 40px;">
                      <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: #1a202c; line-height: 1.3;">
                        Nueva Solicitud Pro a Medida
                      </h1>
                      
                      <p style="margin: 0 0 30px; font-size: 16px; color: #4a5568; line-height: 1.6;">
                        Hay una nueva solicitud para el plan Pro a medida:
                      </p>
                      
                      <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Nombre:</strong>
                            <span style="color: #4a5568; font-size: 14px; margin-left: 8px;">${escapeHtml(name)}</span>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Email:</strong>
                            <a href="mailto:${escapeHtml(email)}" style="color: #0d7fd4; font-size: 14px; margin-left: 8px; text-decoration: none;">${escapeHtml(email)}</a>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Teléfono:</strong>
                            <span style="color: #4a5568; font-size: 14px; margin-left: 8px;">${escapeHtml(phone) || "-"}</span>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Empresa/Negocio:</strong>
                            <span style="color: #4a5568; font-size: 14px; margin-left: 8px;">${escapeHtml(company) || "-"}</span>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Tamaño del equipo:</strong>
                            <span style="color: #4a5568; font-size: 14px; margin-left: 8px;">${escapeHtml(teamSize) || "-"}</span>
                          </td>
                        </tr>
                      </table>
                      
                      ${message ? `
                        <div style="background-color: #f7fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #0d7fd4;">
                          <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #2d3748;">
                            Descripción del proyecto:
                          </h2>
                          <p style="margin: 0; font-size: 14px; color: #4a5568; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</p>
                        </div>
                      ` : ''}
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #f7fafc; border-radius: 0 0 12px 12px; border-top: 1px solid #e2e8f0;">
                      <table role="presentation" style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td align="center" style="padding: 0;">
                            <div style="display: inline-block; max-width: 120px; width: 100%; margin: 0 auto 16px; opacity: 0.8;">
                              ${footerLogoSvg}
                            </div>
                            <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #1a202c;">
                              ARJA ERP
                            </p>
                            <p style="margin: 0 0 12px; font-size: 13px; color: #718096;">
                              Sistema de Gestión Empresarial
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #a0aec0;">
                              © ${new Date().getFullYear()} ARJA ERP. Todos los derechos reservados.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const text = [
      "Hay una nueva solicitud para el plan Pro a medida:",
      "",
      `Nombre: ${name}`,
      `Email: ${email}`,
      `Teléfono: ${phone || "-"}`,
      `Empresa/Negocio: ${company || "-"}`,
      `Tamaño del equipo: ${teamSize || "-"}`,
      "",
      "Descripción del proyecto:",
      message || "(sin descripción)",
    ].join("\n");

    sendEmail({
      to: salesEmail,
      subject,
      text,
      html,
      retries: 3,
    }).catch((emailError) => {
      console.error(`[ENTERPRISE-REQUEST] Error al enviar email a ${salesEmail}:`, emailError.message);
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[POST /public/enterprise/request] error:", error);
    res.status(500).json({
      ok: false,
      error: "No se pudo enviar la solicitud. Intentalo más tarde.",
    });
  }
});

router.post("/contact", async (req, res) => {
  try {
    const {
      name = "",
      email = "",
      subject = "",
      message = "",
      type = "soporte", // 'ventas' o 'soporte'
    } = req.body || {};

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        ok: false,
        error: "Todos los campos son requeridos",
      });
    }

    // Determinar el email destino según el tipo
    const destinationEmail = type === "ventas" 
      ? "ventas@arjaerp.com.ar" 
      : "soporte@arjaerp.com.ar";
    
    const categoryLabel = type === "ventas" ? "Ventas" : "Soporte";
    const emailSubject = `[${categoryLabel}] Contacto ARJA ERP: ${subject}`;
    const logoSvg = getEmailLogo('light', 'header');
    const footerLogoSvg = getEmailLogo('light', 'footer');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa;">
          <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f7fa;">
            <tr>
              <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <!-- Header con Logo -->
                  <tr>
                    <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #13b5cf 0%, #0d7fd4 100%); border-radius: 12px 12px 0 0;">
                      <div style="display: inline-block; max-width: 200px; width: 100%;">
                        ${logoSvg}
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Contenido principal -->
                  <tr>
                    <td style="padding: 40px;">
                      <div style="display: inline-block; padding: 6px 12px; background-color: ${type === "ventas" ? "#10b981" : "#0d7fd4"}; color: #ffffff; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 20px; text-transform: uppercase;">
                        ${categoryLabel}
                      </div>
                      
                      <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: #1a202c; line-height: 1.3;">
                        Nuevo Mensaje de Contacto
                      </h1>
                      
                      <p style="margin: 0 0 30px; font-size: 16px; color: #4a5568; line-height: 1.6;">
                        Has recibido un nuevo mensaje desde el sitio web:
                      </p>
                      
                      <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Nombre:</strong>
                            <span style="color: #4a5568; font-size: 14px; margin-left: 8px;">${escapeHtml(name)}</span>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Email:</strong>
                            <a href="mailto:${escapeHtml(email)}" style="color: #0d7fd4; font-size: 14px; margin-left: 8px; text-decoration: none;">${escapeHtml(email)}</a>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                            <strong style="color: #2d3748; font-size: 14px;">Asunto:</strong>
                            <span style="color: #4a5568; font-size: 14px; margin-left: 8px;">${escapeHtml(subject)}</span>
                          </td>
                        </tr>
                      </table>
                      
                      <div style="background-color: #f7fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #0d7fd4;">
                        <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #2d3748;">
                          Mensaje:
                        </h2>
                        <p style="margin: 0; font-size: 14px; color: #4a5568; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</p>
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #f7fafc; border-radius: 0 0 12px 12px; border-top: 1px solid #e2e8f0;">
                      <table role="presentation" style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td align="center" style="padding: 0;">
                            <div style="display: inline-block; max-width: 120px; width: 100%; margin: 0 auto 16px; opacity: 0.8;">
                              ${footerLogoSvg}
                            </div>
                            <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #1a202c;">
                              ARJA ERP
                            </p>
                            <p style="margin: 0 0 12px; font-size: 13px; color: #718096;">
                              Sistema de Gestión Empresarial
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #a0aec0;">
                              © ${new Date().getFullYear()} ARJA ERP. Todos los derechos reservados.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const text = [
      "Nuevo mensaje de contacto desde el sitio web:",
      "",
      `Nombre: ${name}`,
      `Email: ${email}`,
      `Asunto: ${subject}`,
      `Categoría: ${categoryLabel}`,
      "",
      "Mensaje:",
      message,
    ].join("\n");

    sendEmail({
      to: destinationEmail,
      subject: emailSubject,
      text,
      html,
      retries: 3,
    }).catch((emailError) => {
      console.error(`[CONTACT] Error al enviar email a ${destinationEmail}:`, emailError.message);
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[POST /public/contact] error:", error);
    res.status(500).json({
      ok: false,
      error: "No se pudo enviar el mensaje. Intentalo más tarde.",
    });
  }
});

export default router;


