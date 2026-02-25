// src/routes/CustomersPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "../shared/useQuery.js";
import { apiClient } from "../api";
import { SearchInput, initials, formatPhone, formatDateTime } from "../shared/ui.jsx";
import { useDebouncedValue } from "../shared/useDebouncedValue.js";
import { useApp } from "../context/UseApp.js";
import { useTranslation } from "../i18n/useTranslation.js";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import VirtualList from "../shared/VirtualList.jsx";

const formatCurrency = (value, currency = "ARS") => {
    if (value == null) return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    try {
        return new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: currency || "ARS",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(numeric);
    } catch {
        return `$${numeric.toFixed(2)} ${currency || ""}`.trim();
    }
};

export default function CustomersPage() {
    const { t } = useTranslation();
    // 1) Estado local de búsqueda y paginación
    const [params, setParams] = useSearchParams();
    const { tenantSlug } = useParams();
    const initialQ = params.get("q") || "";
    const [q, setQ] = useState(initialQ);
    const page = Number(params.get("page")) || 1;
    const limit = 20; // Items por página

    // 2) Si cambia la URL (ej: atrás/adelante), actualizo el input
    useEffect(() => {
        const urlQ = params.get("q") || "";
        setQ(urlQ);
    }, [params]);

    // 3) Debounce
    const qDebounced = useDebouncedValue(q, 300);

    // 4) Resetear a página 1 cuando cambia la búsqueda
    useEffect(() => {
        if (qDebounced !== initialQ && page !== 1) {
            const next = new URLSearchParams(params);
            next.set("page", "1");
            setParams(next, { replace: true });
        }
    }, [qDebounced]);

    // 5) Fetch dinámico con paginación
    const { data: response, loading, error } = useQuery(
        (signal) => apiClient.listCustomers(qDebounced, signal, { page, limit }),
        [qDebounced, page]
    );

    // Extraer datos y paginación
    const rows = Array.isArray(response) ? response : (response?.data || []);
    const pagination = response?.pagination || null;

    const { classesEnabled } = useApp();

    const showMembershipColumn = useMemo(
        () =>
            Array.isArray(rows) &&
            rows.some((row) => row?.has_subscription || row?.subscription_status || row?.has_active_subscription),
        [rows]
    );

    const columnLayout = useMemo(() => {
        const base = {
            customer: 4,
            phone: 3,
            appointments: 2,
            classes: 0,
            membership: 0,
        };

        if (classesEnabled && showMembershipColumn) {
            return {
                customer: 3,
                phone: 2,
                appointments: 2,
                classes: 2,
                membership: 3,
            };
        }

        if (classesEnabled) {
            return {
                customer: 4,
                phone: 3,
                appointments: 2,
                classes: 3,
                membership: 0,
            };
        }

        if (showMembershipColumn) {
            return {
                customer: 4,
                phone: 2,
                appointments: 2,
                classes: 0,
                membership: 4,
            };
        }

        return base;
    }, [classesEnabled, showMembershipColumn]);

    const membershipStyles = {
        authorized: { label: t("customers.active"), className: "bg-emerald-500/10 text-emerald-400 border border-emerald-400/20" },
        pending: { label: t("customers.pending"), className: "bg-amber-500/10 text-amber-400 border border-amber-400/20" },
        paused: { label: t("customers.paused"), className: "bg-slate-500/10 text-slate-300 border border-slate-400/20" },
        cancelled: { label: t("customers.cancelled"), className: "bg-rose-500/10 text-rose-400 border border-rose-400/20" },
        default: { label: t("customers.noSubscription"), className: "bg-foreground/5 text-foreground-secondary border border-border" },
    };

    const renderMembershipInfo = (row) => {
        if (!showMembershipColumn) return null;
        const statusKey = row?.has_subscription
            ? row?.has_active_subscription
                ? "authorized"
                : row?.subscription_status || "default"
            : "default";
        const style = membershipStyles[statusKey] || membershipStyles.default;

        const planLabel = row?.primary_plan_name;
        const amountLabel =
            row?.primary_plan_amount_decimal != null
                ? formatCurrency(row.primary_plan_amount_decimal, row.primary_plan_currency)
                : null;

        return (
            <div className="flex flex-col items-end gap-1.5 text-right w-full">
                <span className={`inline-flex items-center justify-end rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${style.className}`}>
                    {style.label}
                </span>
                {planLabel ? (
                    <div className="text-xs font-medium text-foreground truncate w-full text-right">{planLabel}</div>
                ) : null}
                {amountLabel ? (
                    <div className="text-xs text-foreground-muted truncate w-full text-right">
                        {amountLabel}
                    </div>
                ) : null}
            </div>
        );
    };

    // 6) Actualizo la URL cuando se envía el form (Enter o botón Buscar)
    function submitSearch(v) {
        const next = new URLSearchParams(params);
        if (v) next.set("q", v);
        else next.delete("q");
        next.set("page", "1"); // Resetear a página 1 al buscar
        setParams(next, { replace: true });
    }

    // 7) Navegación de páginas
    function goToPage(newPage) {
        const next = new URLSearchParams(params);
        if (newPage > 1) {
            next.set("page", String(newPage));
        } else {
            next.delete("page");
        }
        setParams(next, { replace: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // Calcular información de paginación
    const startItem = pagination ? (pagination.page - 1) * pagination.limit + 1 : 0;
    const endItem = pagination ? Math.min(pagination.page * pagination.limit, pagination.total) : 0;

    return (
        <div className="flex flex-col gap-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground mb-1">{t("customers.title")}</h1>
                    {pagination && (
                        <p className="text-sm text-foreground-secondary">
                            {pagination.total === 0 ? t("customers.noCustomers") : t("customers.totalCustomers", { count: pagination.total, plural: pagination.total !== 1 ? "s" : "" })}
                        </p>
                    )}
                </div>
            </div>

            {/* Búsqueda */}
            <div className="flex items-center justify-between gap-3">
                <div className="w-full flex flex-col gap-0">
                    <SearchInput
                        value={q}
                        onChange={setQ}
                        onSubmit={submitSearch}
                        placeholder={t("customers.searchPlaceholder")}
                        width="100%"
                    />
                    {loading && qDebounced ? (
                        <div className="text-xs text-foreground-muted mt-1">Buscando…</div>
                    ) : null}
                </div>
            </div>

            {/* Tabla */}
            <div className="card overflow-hidden">
                {/* Header de la tabla */}
                <div 
                    className="grid px-4 md:px-6 py-4 text-xs font-semibold text-foreground-secondary border-b border-border bg-background-secondary/50 gap-x-3"
                    style={{
                        gridTemplateColumns: classesEnabled && showMembershipColumn
                            ? `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr ${columnLayout.classes}fr ${columnLayout.membership}fr`
                            : classesEnabled
                            ? `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr ${columnLayout.classes}fr`
                            : showMembershipColumn
                            ? `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr ${columnLayout.membership}fr`
                            : `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr`
                    }}
                >
                    <div className="min-w-0">Cliente</div>
                    <div className="min-w-0">{t("customers.phone")}</div>
                    <div className="text-right min-w-0">Turnos</div>
                    {classesEnabled ? (
                        <div className="text-right min-w-0">
                            <div># Clases</div>
                            <div className="text-[10px] text-foreground-muted uppercase tracking-wide font-normal mt-0.5">
                                Anotadas / Realizadas
                            </div>
                        </div>
                    ) : null}
                    {showMembershipColumn ? (
                        <div className="text-right min-w-0">{t("customers.membership")}</div>
                    ) : null}
                </div>

                {/* Contenido */}
                {loading ? (
                    <div className="px-6 py-12 flex flex-col items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mb-3" />
                        <div className="text-sm text-foreground-muted">{t("customers.loadingCustomers")}</div>
                    </div>
                ) : error ? (
                    <div className="px-6 py-12 text-center">
                        <div className="text-sm text-red-400 mb-2">{t("customers.errorLoadingCustomers")}</div>
                        <div className="text-xs text-foreground-muted">{error}</div>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
                        <Users className="w-12 h-12 text-foreground-muted mb-3 opacity-50" />
                        <div className="text-sm text-foreground-secondary mb-1">
                            {qDebounced ? t("customers.noCustomersFound") : t("customers.noCustomersYet")}
                        </div>
                        <div className="text-xs text-foreground-muted">
                            {qDebounced
                                ? "Intenta con otro término de búsqueda"
                                : t("customers.customersWillAppear")}
                        </div>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        <VirtualList
                            items={rows}
                            height={560}
                            itemHeight={88}
                            overscan={8}
                            keyExtractor={(r) => r.id}
                            renderItem={(r) => (
                                <Link
                                    to={`/${tenantSlug}/customers/${r.id}`}
                                    className="w-full text-left px-4 md:px-6 py-4 hover:bg-background-secondary/50 grid items-start gap-x-3 transition-colors group"
                                    style={{
                                        gridTemplateColumns: classesEnabled && showMembershipColumn
                                            ? `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr ${columnLayout.classes}fr ${columnLayout.membership}fr`
                                            : classesEnabled
                                            ? `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr ${columnLayout.classes}fr`
                                            : showMembershipColumn
                                            ? `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr ${columnLayout.membership}fr`
                                            : `${columnLayout.customer}fr ${columnLayout.phone}fr ${columnLayout.appointments}fr`
                                    }}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="relative size-10 flex-shrink-0">
                                            {r.picture ? (
                                            <img 
                                                src={r.picture} 
                                                alt={r.name || "Cliente"} 
                                                loading="lazy"
                                                className="size-10 rounded-full object-cover border border-border"
                                                style={{ display: 'block' }}
                                                onError={(e) => {
                                                    e.target.style.display = 'none';
                                                    const fallback = e.target.nextElementSibling;
                                                        if (fallback) {
                                                            fallback.style.display = 'flex';
                                                        }
                                                    }}
                                                />
                                            ) : null}
                                            <div 
                                                className="size-10 rounded-full bg-primary-500/10 flex items-center justify-center text-primary-400 text-sm font-semibold group-hover:bg-primary-500/20 transition-colors"
                                                style={{ 
                                                    display: r.picture ? 'none' : 'flex',
                                                    position: r.picture ? 'absolute' : 'static',
                                                    top: r.picture ? 0 : 'auto',
                                                    left: r.picture ? 0 : 'auto',
                                                    right: r.picture ? 0 : 'auto',
                                                    bottom: r.picture ? 0 : 'auto'
                                                }}
                                            >
                                                {initials(r.name || "?")}
                                            </div>
                                        </div>
                                        <div className="min-w-0 flex-1 overflow-hidden">
                                            <div className="text-sm font-semibold text-foreground truncate group-hover:text-primary-400 transition-colors">
                                                {r.name || t("customers.noName")}
                                            </div>
                                            <div className="text-xs text-foreground-muted truncate">ID #{r.id}</div>
                                        </div>
                                    </div>
                                    <div className="text-sm text-foreground-secondary min-w-0 truncate">
                                        {formatPhone(r.phone_e164 ?? r.phone) || "—"}
                                    </div>
                                    <div className="text-right min-w-0">
                                        <div className="text-sm font-semibold text-foreground">
                                            {r.total_appointments ?? r.appointments_count ?? 0}
                                        </div>
                                    </div>
                                    {classesEnabled ? (
                                        <div className="text-right min-w-0">
                                            <div className="text-sm font-semibold text-foreground whitespace-nowrap">
                                                {r.upcoming_classes ?? 0}{" "}
                                                <span className="text-xs text-foreground-muted font-normal uppercase tracking-wide">
                                                    anotadas
                                                </span>
                                            </div>
                                            <div className="text-xs text-foreground-secondary whitespace-nowrap">
                                                {r.completed_classes ?? 0} realizadas
                                            </div>
                                        </div>
                                    ) : null}
                                    {showMembershipColumn ? (
                                        <div className="text-right min-w-0 overflow-hidden">
                                            {renderMembershipInfo(r)}
                                        </div>
                                    ) : null}
                                </Link>
                            )}
                        />
                    </div>
                )}

                {/* Paginación */}
                {pagination && pagination.totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-border bg-background-secondary/30 flex items-center justify-between">
                        <div className="text-sm text-foreground-secondary">
                            Mostrando <span className="font-semibold text-foreground">{startItem}</span> a{" "}
                            <span className="font-semibold text-foreground">{endItem}</span> de{" "}
                            <span className="font-semibold text-foreground">{pagination.total}</span> {t("customers.title").toLowerCase()}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => goToPage(page - 1)}
                                disabled={!pagination.hasPrev || loading}
                                className="px-3 py-1.5 text-sm font-medium text-foreground-secondary bg-background border border-border rounded-lg hover:bg-background-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                            >
                                <ChevronLeft className="w-4 h-4" />
                                Anterior
                            </button>
                            <div className="flex items-center gap-1">
                                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                                    let pageNum;
                                    if (pagination.totalPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (page <= 3) {
                                        pageNum = i + 1;
                                    } else if (page >= pagination.totalPages - 2) {
                                        pageNum = pagination.totalPages - 4 + i;
                                    } else {
                                        pageNum = page - 2 + i;
                                    }
                                    return (
                                        <button
                                            key={pageNum}
                                            onClick={() => goToPage(pageNum)}
                                            disabled={loading}
                                            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                                                pageNum === page
                                                    ? "bg-primary-500 text-white"
                                                    : "text-foreground-secondary bg-background border border-border hover:bg-background-secondary hover:text-foreground"
                                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                onClick={() => goToPage(page + 1)}
                                disabled={!pagination.hasNext || loading}
                                className="px-3 py-1.5 text-sm font-medium text-foreground-secondary bg-background border border-border rounded-lg hover:bg-background-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                            >
                                Siguiente
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
