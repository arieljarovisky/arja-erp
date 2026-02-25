// src/shared/useQuery.js
import { useEffect, useState, useCallback, useRef } from "react";

// Caché global simple para evitar peticiones duplicadas
const queryCache = new Map();
const DEFAULT_CACHE_TTL = 5000; // 5 segundos de caché

function getCacheKey(fn, deps) {
    // Crear una clave única basada en la función y dependencias
    const fnStr = fn.toString();
    const depsStr = JSON.stringify(deps);
    return `${fnStr}:${depsStr}`;
}

function getCachedData(key) {
    const cached = queryCache.get(key);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > (cached.ttl ?? DEFAULT_CACHE_TTL)) {
        queryCache.delete(key);
        return null;
    }
    
    return cached.data;
}

function setCachedData(key, data, ttl) {
    queryCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl: typeof ttl === "number" ? ttl : DEFAULT_CACHE_TTL
    });
}

/**
 * useQuery(fn, deps?)
 * - fn: (signal) => Promise<any>
 * - deps: dependencias para re-ejecutar
 */
export function useQuery(fn, deps = [], options = {}) {
    const [data, setData] = useState(undefined);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const fnRef = useRef(fn);
    const mountedRef = useRef(true);
    const abortControllerRef = useRef(null);
    const isExecutingRef = useRef(false);
    const cacheKeyRef = useRef(getCacheKey(fn, deps));
    const ttlRef = useRef(typeof options.staleTime === "number" ? options.staleTime : DEFAULT_CACHE_TTL);

    // Actualizar ref cuando cambia la función
    useEffect(() => {
        fnRef.current = fn;
        cacheKeyRef.current = getCacheKey(fn, deps);
        ttlRef.current = typeof options.staleTime === "number" ? options.staleTime : DEFAULT_CACHE_TTL;
    }, [fn, deps, options]);

    const executeQuery = useCallback(async (signal, skipLoading = false, forceRefresh = false) => {
        // Evitar ejecuciones duplicadas
        if (isExecutingRef.current && !skipLoading) {
            return;
        }
        
        const cacheKey = cacheKeyRef.current;
        
        // Intentar obtener datos del caché si no es un refresh forzado
        if (!forceRefresh && !skipLoading) {
            const cached = getCachedData(cacheKey);
            if (cached !== null) {
                setData(cached);
                setLoading(false);
                return;
            }
        }
        
        isExecutingRef.current = true;
        
        if (!skipLoading) {
            setLoading(true);
        }
        setError("");

        try {
            const result = await fnRef.current(signal);
            if (mountedRef.current && !signal.aborted) {
                setData(result);
                // Guardar en caché
                setCachedData(cacheKey, result, ttlRef.current);
            }
        } catch (e) {
            if (signal.aborted || !mountedRef.current) {
                isExecutingRef.current = false;
                return;
            }
            setError(e?.message || "Error");
        } finally {
            if (mountedRef.current && !signal.aborted) {
                setLoading(false);
            }
            isExecutingRef.current = false;
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        
        // Cancelar petición anterior si existe
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        
        const ac = new AbortController();
        abortControllerRef.current = ac;
        
        executeQuery(ac.signal);

        return () => {
            mountedRef.current = false;
            if (abortControllerRef.current === ac) {
                ac.abort();
                abortControllerRef.current = null;
            }
            isExecutingRef.current = false;
        };
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps

    const refetch = useCallback(() => {
        // Cancelar petición anterior si existe
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        
        const ac = new AbortController();
        abortControllerRef.current = ac;
        executeQuery(ac.signal, false, true); // forceRefresh = true
        return () => ac.abort();
    }, [executeQuery]);

    return { data, loading, error, refetch };
}
