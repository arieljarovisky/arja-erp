
import os

file_path = r"c:\Users\usuario\Desktop\pelu-turnos\backend\src\routes\appointments.js"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

start_marker = "// Notificar al estilista si existe mapping user_id"
end_marker = "// Notificar al cliente por push (si tiene token registrado en customer_app_settings)"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print(f"Markers not found! start={start_idx}, end={end_idx}")
    exit(1)

new_block = """      // Notificar al estilista (Internal Notification, WhatsApp, Email)
      try { await pool.query(`ALTER TABLE instructor ADD COLUMN phone_e164 VARCHAR(32) NULL`); } catch {}

      const [[inst]] = await pool.query(
        "SELECT id, user_id, phone_e164, name FROM instructor WHERE id=? AND tenant_id=? LIMIT 1",
        [instructorId, tenantId]
      );

      if (inst) {
        // 1. Notificación interna (si tiene usuario)
        if (inst.user_id) {
          await createNotification({
            tenantId,
            userId: inst.user_id,
            type: "appointment",
            title: "Te asignaron un nuevo turno",
            message: `${customerLabel} — ${serviceLabel} — Inicio: ${startsAt}`,
            data: { tenantId, appointmentId, instructorId, serviceId, customerId: effectiveCustomerId, startsAt, endsAt: endMySQL }
          });
        }

        // 2. WhatsApp (si tiene teléfono)
        if (inst.phone_e164 && sendWhatsAppText) {
          try {
            const whenLabel = fmtLocal(startMySQL.replace(" ", "T"));
            const cName = c?.name || "Cliente";
            const cPhone = c?.phone || "";
            const cText = cPhone ? `${cName} (${cPhone})` : cName;

            const msg = `Hola ${inst.name || "👤"}!\\n\\nNuevo turno asignado:\\n` +
                        `• Cliente: ${cText}\\n` +
                        `• Servicio: ${serviceLabel}\\n` +
                        `• Horario: ${whenLabel}`;
            
            try {
              await sendWhatsAppText(inst.phone_e164, msg, tenantId);
            } catch (waErr) {
              if (waErr.code === 131047 && sendWhatsAppTemplate) {
                const langs = ["es", "es_AR", "es_419"];
                for (const lang of langs) {
                  try {
                    await sendWhatsAppTemplate(
                      inst.phone_e164,
                      "nuevo_turno_profesional",
                      lang,
                      [
                        { type: "body", parameters: [
                          { type: "text", text: inst.name || "Profesional" },
                          { type: "text", text: cText },
                          { type: "text", text: serviceLabel },
                          { type: "text", text: whenLabel }
                        ] }
                      ],
                      tenantId
                    );
                    break;
                  } catch {}
                }
              }
            }
          } catch (waSendErr) {
            console.error("⚠️ [appointments] Error enviando WhatsApp al peluquero:", waSendErr?.message || waSendErr);
          }
        }

        // 3. Email (si tiene usuario y email)
        if (inst.user_id) {
          try {
            const [[u]] = await pool.query(
              "SELECT email FROM users WHERE id = ? AND tenant_id = ? LIMIT 1",
              [inst.user_id, tenantId]
            );
            if (u?.email) {
              const { sendEmail } = await import("../email.js").catch(() => ({ sendEmail: null }));
              if (sendEmail) {
                const whenLabel = fmtLocal(startMySQL.replace(" ", "T"));
                const cName = c?.name || "Cliente";
                const cPhone = c?.phone || "";
                const cText = cPhone ? `${cName} (${cPhone})` : cName;
                
                const subject = "Nuevo turno asignado";
                const html = [
                  `<p>Se te asignó un nuevo turno.</p>`,
                  `<p><strong>Cliente:</strong> ${cText}</p>`,
                  `<p><strong>Servicio:</strong> ${serviceLabel}</p>`,
                  `<p><strong>Horario:</strong> ${whenLabel}</p>`
                ].join("");
                await sendEmail({ to: u.email, subject, html, tenantId });
                console.log(`✅ [appointments] Email enviado al peluquero ${u.email}`);
              }
            }
          } catch (emailErr) {
            console.error("⚠️ [appointments] Error enviando email al peluquero:", emailErr?.message || emailErr);
          }
        }
      }

"""

new_content = content[:start_idx] + new_block + content[end_idx:]

with open(file_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("Successfully patched appointments.js")
