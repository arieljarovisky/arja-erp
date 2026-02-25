import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { toast } from "sonner";
import { Megaphone, Target, Send, Eye, Wrench, Trash2, Filter, Sparkles } from "lucide-react";

export default function CRMPage() {
  const { tenantSlug } = useParams();
  const [segments, setSegments] = useState([]);
  const [customSegments, setCustomSegments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [loadingSegs, setLoadingSegs] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [message, setMessage] = useState("Hola {nombre}, te esperamos esta semana. ¿Querés reservar un turno?");
  const [preview, setPreview] = useState([]);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [segmentForm, setSegmentForm] = useState({
    code: "",
    label: "",
    description: "",
    type: "inactive_x_days",
    days: 60,
  });
  const [scheduleAt, setScheduleAt] = useState("");
  const [schedules, setSchedules] = useState([]);
  const [history, setHistory] = useState([]);
  const [segmentQuery, setSegmentQuery] = useState("");
  const [activeTab, setActiveTab] = useState("segments");
  const [recipientsCount, setRecipientsCount] = useState(0);
  const [segmentLoadError, setSegmentLoadError] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoadingSegs(true);
      try {
        const [presets, customs] = await Promise.all([
          apiClient.crmListSegments(),
          apiClient.crmListCustomSegments(),
        ]);
        setSegments(presets || []);
        setCustomSegments(Array.isArray(customs) ? customs : []);
        const [sched, hist] = await Promise.all([
          apiClient.crmListSchedules(),
          apiClient.crmListHistory(),
        ]);
        setSchedules(Array.isArray(sched) ? sched : []);
        setHistory(Array.isArray(hist) ? hist : []);
      } catch (e) {
        toast.error("Error cargando segmentos");
      } finally {
        setLoadingSegs(false);
      }
    };
    load();
  }, []);

  async function loadRecipients(code) {
    setLoadingList(true);
    setSegmentLoadError(null);
    try {
      const result = await apiClient.crmGetSegment(code);
      setRecipients(result?.data || []);
      setRecipientsCount(Number(result?.count || (result?.data?.length ?? 0)));
      setActiveTab("send");
    } catch (e) {
      const status = e?.response?.status;
      const isCanceled = e?.code === "ERR_CANCELED" || e?.message === "canceled";
      if (!isCanceled && status !== 403) {
        setSegmentLoadError("Error cargando clientes del segmento");
      }
    } finally {
      setLoadingList(false);
    }
  }

  async function doPreview() {
    if (!selected) {
      toast.error("Seleccioná un segmento");
      return;
    }
    if (!String(message || "").trim()) {
      toast.error("Escribí un mensaje para la campaña");
      return;
    }
    try {
      const resp = await apiClient.crmSendCampaign({
        segmentCode: selected.code,
        message,
        preview: true,
        max: 5,
      });
      setPreview(resp?.preview || []);
      toast.success(`Vista previa generada (${resp?.totalCandidates || 0} candidatos)`);
      setActiveTab("send");
    } catch (e) {
      const msg = e?.response?.data?.error || "Error generando vista previa";
      toast.error(msg);
      if (e?.response?.status === 401 || String(msg).toLowerCase().includes("token")) {
        toast.error("Iniciá sesión para enviar campañas");
        setTimeout(() => { window.location.href = "/login"; }, 800);
      }
    }
  }

  async function doSend() {
    if (!selected) return;
    setSending(true);
    try {
      const resp = await apiClient.crmSendCampaign({
        segmentCode: selected.code,
        message,
        preview: false,
        max: 50,
      });
      toast.success(`Campaña enviada: ${resp?.sent || 0} de ${resp?.total || 0}`);
    } catch (e) {
      const msg = e?.response?.data?.error || "Error enviando campaña";
      toast.error(msg);
      if (e?.response?.status === 401 || String(msg).toLowerCase().includes("token")) {
        toast.error("Iniciá sesión para enviar campañas");
        setTimeout(() => { window.location.href = "/login"; }, 800);
      }
    } finally {
      setSending(false);
    }
  }

  async function createCustomSegment() {
    if (!segmentForm.code || !segmentForm.label || !segmentForm.type) {
      toast.error("Completá código, nombre y tipo");
      return;
    }
    setCreating(true);
    try {
      const payload = {
        code: segmentForm.code.trim(),
        label: segmentForm.label.trim(),
        description: segmentForm.description.trim(),
        type: segmentForm.type,
        params: { days: Number(segmentForm.days || 0) || 14 },
      };
      const resp = await apiClient.crmCreateCustomSegment(payload);
      const list = resp?.data ?? resp ?? [];
      setCustomSegments(Array.isArray(list) ? list : []);
      toast.success("Segmento creado");
      setSegmentForm({
        code: "",
        label: "",
        description: "",
        type: "inactive_x_days",
        days: 60,
      });
    } catch (e) {
      toast.error(e?.response?.data?.error || "Error creando segmento");
    } finally {
      setCreating(false);
    }
  }

  async function deleteCustomSegment(code) {
    try {
      const resp = await apiClient.crmDeleteCustomSegment(code);
      const list = resp?.data ?? resp ?? [];
      setCustomSegments(Array.isArray(list) ? list : []);
      // Si estaba seleccionado, limpiar
      if (selected?.code === code) {
        setSelected(null);
        setRecipients([]);
        setPreview([]);
      }
      toast.success("Segmento eliminado");
    } catch (e) {
      toast.error(e?.response?.data?.error || "Error eliminando segmento");
    }
  }

  async function createSchedule() {
    if (!selected) {
      toast.error("Seleccioná un segmento");
      return;
    }
    if (!scheduleAt) {
      toast.error("Elegí fecha y hora");
      return;
    }
    try {
      const payload = {
        segmentCode: selected.code,
        message,
        sendAt: scheduleAt,
        max: 50,
      };
      const resp = await apiClient.crmCreateSchedule(payload);
      const list = resp?.data ?? resp ?? [];
      setSchedules(Array.isArray(list) ? list : []);
      toast.success("Campaña programada");
    } catch (e) {
      toast.error(e?.response?.data?.error || "Error programando campaña");
    }
  }

  async function deleteSchedule(id) {
    try {
      const resp = await apiClient.crmDeleteSchedule(id);
      const list = resp?.data ?? resp ?? [];
      setSchedules(Array.isArray(list) ? list : []);
      toast.success("Programación eliminada");
    } catch (e) {
      toast.error(e?.response?.data?.error || "Error eliminando programación");
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Megaphone className="w-6 h-6" />
          CRM
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4 md:pr-4 md:border-r md:border-border">
          <div className="card card--space-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-header flex items-center gap-2">
                <Target className="w-5 h-5" />
                Segmentos
              </h2>
          </div>
            <div className="flex items-center gap-2 mb-3">
              <div className="input w-full flex items-center gap-2">
                <Filter className="w-4 h-4" />
                <input
                  className="w-full bg-transparent outline-none"
                  value={segmentQuery}
                  onChange={(e) => setSegmentQuery(e.target.value)}
                  placeholder="Buscar segmentos"
                />
              </div>
              <div className="badge">{segments.length + customSegments.length}</div>
            </div>
            {loadingSegs ? (
              <div className="text-foreground-muted">Cargando segmentos…</div>
            ) : (
              <div className="space-y-2">
                {[...segments, ...customSegments]
                  .filter((seg) => {
                    const q = segmentQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      String(seg.label || "").toLowerCase().includes(q) ||
                      String(seg.description || "").toLowerCase().includes(q) ||
                      String(seg.code || "").toLowerCase().includes(q)
                    );
                  })
                  .map((seg) => (
                  <button
                    key={seg.code}
                    onClick={() => {
                      setSelected(seg);
                      loadRecipients(seg.code);
                      setPreview([]);
                    }}
                    className={`w-full text-left p-3 rounded-lg border ${selected?.code === seg.code ? "border-primary-500 bg-primary-500/5" : "border-border hover:bg-background-secondary"}`}
                  >
                    <div className="font-semibold">{seg.label}</div>
                    <div className="text-sm text-foreground-muted">{seg.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card card--space-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-header flex items-center gap-2">
                <Wrench className="w-5 h-5" />
                Segmentos personalizados
              </h2>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-foreground-secondary">Código</label>
                  <input
                    className="input"
                    value={segmentForm.code}
                    onChange={(e) => setSegmentForm((s) => ({ ...s, code: e.target.value }))}
                    placeholder="p.ej. inactive_90_days"
                  />
                </div>
                <div>
                  <label className="text-xs text-foreground-secondary">Nombre</label>
                  <input
                    className="input"
                    value={segmentForm.label}
                    onChange={(e) => setSegmentForm((s) => ({ ...s, label: e.target.value }))}
                    placeholder="p.ej. Inactivos 90 días"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-foreground-secondary">Tipo</label>
                  <select
                    className="input"
                    value={segmentForm.type}
                    onChange={(e) => setSegmentForm((s) => ({ ...s, type: e.target.value }))}
                  >
                     <option value="inactive_x_days">Inactivos en X días</option>
                     <option value="renewal_in_days">Renovación en X días</option>
                     <option value="deposit_pending_recent_days">Seña pendiente últimos X días</option>
                     <option value="deposit_expired_recent_days">Seña vencida últimos X días</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-foreground-secondary">Días (X)</label>
                  <input
                    type="number"
                    className="input"
                    value={segmentForm.days}
                    onChange={(e) => setSegmentForm((s) => ({ ...s, days: Number(e.target.value || 0) }))}
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="text-xs text-foreground-secondary">Descripción</label>
                  <input
                    className="input"
                    value={segmentForm.description}
                    onChange={(e) => setSegmentForm((s) => ({ ...s, description: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>
              <div>
                <button onClick={createCustomSegment} disabled={creating} className="btn-primary">
                  Crear segmento
                </button>
              </div>
              {customSegments.length > 0 && (
                <div className="space-y-2">
                  {customSegments.map((seg) => (
                    <div
                      key={seg.code}
                      className="p-3 rounded-lg border border-border flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold">{seg.label}</div>
                        <div className="text-xs text-foreground-muted">{seg.description}</div>
                        <div className="text-xs text-foreground-muted">
                          {seg.type} · días={seg?.params?.days ?? seg?.days ?? 0}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteCustomSegment(seg.code)}
                        className="btn-ghost text-danger flex items-center gap-1"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </div>

          <div className="card card--space-lg">
            <h2 className="section-header">Destinatarios</h2>
            {segmentLoadError && (
              <div className="mb-2 p-2 rounded-lg border border-danger text-danger text-xs">
                {segmentLoadError}
              </div>
            )}
            {loadingList ? (
              <div className="text-foreground-muted">Cargando clientes…</div>
            ) : recipients.length === 0 ? (
              <div className="text-foreground-muted">Seleccione un segmento para ver los clientes.</div>
            ) : (
              <div className="divide-y divide-border">
                <div className="p-2 text-xs text-foreground-muted">
                  Mostrando {Math.min(50, recipients.length)} de {recipientsCount || recipients.length} destinatarios
                </div>
                {recipients.slice(0, 50).map((r) => (
                  <div key={r.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{r.name || "Sin nombre"}</div>
                      <div className="text-xs text-foreground-muted">{r.phone}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          
        </div>

        <div className="space-y-4 md:pl-4">
          <div className="card card--space-lg">
            <h2 className="section-header">Campaña</h2>
            <div className="space-y-3">
              {selected && (
                <div className="p-3 rounded-lg border border-border flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{selected.label}</div>
                    <div className="text-xs text-foreground-muted">{selected.description}</div>
                  </div>
                  <div className="badge">{recipients.length} destinatarios</div>
                </div>
              )}
              <label className="text-sm text-foreground-secondary">Mensaje</label>
              <textarea
                className="input"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Usa {nombre} para personalizar el mensaje"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn-ghost"
                  onClick={() => setMessage((m) => `${m}\n\nHola {nombre}, ${selected ? `te escribimos desde ${selected.label}` : "tenemos novedades"}.`)}
                >
                  <Sparkles className="w-4 h-4" /> Insertar saludo
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setMessage((m) => `${m}\n\nPara reservar: respondé este mensaje o usá el link del negocio.`)}
                >
                  <Sparkles className="w-4 h-4" /> Insertar CTA
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={doPreview} className="btn-ghost">
                  <Eye className="w-4 h-4" />
                  Vista previa
                </button>
                <button onClick={doSend} disabled={!selected || sending} className="btn-primary">
                  <Send className="w-4 h-4" />
                  Enviar campaña
                </button>
              </div>
            </div>
          </div>

          {preview.length > 0 && (
            <div className="card card--space-lg">
              <h2 className="section-header">Vista previa</h2>
              <div className="space-y-2">
                {preview.map((p, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-border">
                    <div className="text-xs text-foreground-muted">{p.to}</div>
                    <div className="font-medium">{p.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card card--space-lg">
            <h2 className="section-header">Programar campaña</h2>
            <div className="space-y-3">
              <label className="text-sm text-foreground-secondary">Fecha y hora</label>
              <input
                type="datetime-local"
                className="input"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <button onClick={createSchedule} disabled={!selected} className="btn-primary">
                  Programar
                </button>
              </div>
            </div>
          </div>

          <div className="card card--space-lg">
            <h2 className="section-header">Programadas</h2>
            {schedules.length === 0 ? (
              <div className="text-foreground-muted">No hay campañas programadas</div>
            ) : (
              <div className="space-y-2">
                {schedules.map((s) => (
                  <div key={s.id} className="p-3 rounded-lg border border-border flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{s.segmentCode}</div>
                      <div className="text-xs text-foreground-muted">{s.sendAt}</div>
                    </div>
                    <button onClick={() => deleteSchedule(s.id)} className="btn-ghost text-danger flex items-center gap-1">
                      <Trash2 className="w-4 h-4" />
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card card--space-lg">
            <h2 className="section-header">Historial</h2>
            {history.length === 0 ? (
              <div className="text-foreground-muted">Sin envíos recientes</div>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 50).map((h) => (
                  <div key={h.id} className="p-3 rounded-lg border border-border">
                    <div className="font-semibold">{h.segmentCode}</div>
                    <div className="text-xs text-foreground-muted">Enviados {h.sent} de {h.total}</div>
                    <div className="text-xs text-foreground-muted">{h.finishedAt}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
