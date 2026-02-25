// Helper para obtener el logo de la empresa en formato base64 para emails
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache del logo para no leerlo cada vez (por variante)
const logoCache = {};

/**
 * Obtiene el logo de la empresa como SVG para incrustar directamente en HTML
 * Muchos clientes de email bloquean data URIs, así que incrustamos el SVG directamente
 * @param {string} variant - 'light', 'dark', o 'default' (por defecto)
 * @param {string} prefix - Prefijo único para IDs (para evitar colisiones cuando hay múltiples logos)
 * @returns {string} SVG como string HTML (listo para incrustar)
 */
export function getEmailLogo(variant = 'default', prefix = 'logo') {
  const cacheKey = `${variant}_${prefix}`;
  if (logoCache[cacheKey]) {
    return logoCache[cacheKey];
  }

  try {
    let logoPath;
    
    switch (variant) {
      case 'light':
        logoPath = join(__dirname, '../../public/arja-logo-light.svg');
        break;
      case 'dark':
        logoPath = join(__dirname, '../../public/arja-logo-dark.svg');
        break;
      default:
        logoPath = join(__dirname, '../../public/arja-logo.svg');
    }

    // Leer el archivo SVG
    let svgContent = readFileSync(logoPath, 'utf-8');
    
    // Hacer IDs únicos para evitar colisiones cuando hay múltiples logos
    svgContent = svgContent
      .replace(/id="arja_left"/g, `id="${prefix}_arja_left"`)
      .replace(/id="arja_right"/g, `id="${prefix}_arja_right"`)
      .replace(/id="arja_highlight"/g, `id="${prefix}_arja_highlight"`)
      .replace(/id="arja_gear"/g, `id="${prefix}_arja_gear"`)
      .replace(/url\(#arja_left\)/g, `url(#${prefix}_arja_left)`)
      .replace(/url\(#arja_right\)/g, `url(#${prefix}_arja_right)`)
      .replace(/url\(#arja_highlight\)/g, `url(#${prefix}_arja_highlight)`)
      .replace(/url\(#arja_gear\)/g, `url(#${prefix}_arja_gear)`);
    
    // Agregar estilos inline al SVG para mejor compatibilidad en emails
    // Muchos clientes de email requieren estilos inline y no soportan CSS externo
    svgContent = svgContent.replace(
      /<svg\s+([^>]*)>/,
      (match, attrs) => {
        // Agregar width y height si no existen
        if (!attrs.includes('width') && !attrs.includes('height')) {
          return `<svg ${attrs} width="200" height="200" style="max-width: 100%; height: auto; display: block;">`;
        }
        // Si ya tiene width/height, solo agregar estilos
        return `<svg ${attrs} style="max-width: 100%; height: auto; display: block;">`;
      }
    );
    
    // Limpiar el SVG: remover espacios innecesarios y optimizar
    const cleanedSvg = svgContent
      .replace(/\s+/g, ' ') // Reemplazar múltiples espacios por uno
      .replace(/>\s+</g, '><') // Remover espacios entre tags
      .trim();
    
    // Cachear el SVG limpio
    logoCache[cacheKey] = cleanedSvg;
    
    console.log(`[emailLogo] ✅ Logo cargado: ${variant} (${cleanedSvg.length} caracteres, incrustado como SVG)`);
    
    return logoCache[cacheKey];
  } catch (error) {
    console.error('[emailLogo] ❌ Error al cargar el logo:', error.message);
    console.error('[emailLogo]   Path intentado:', logoPath || 'N/A');
    
    // Logo por defecto embebido como fallback
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220"><rect width="220" height="220" fill="#0d7fd4" rx="12"/><text x="50%" y="50%" font-family="Arial" font-size="24" fill="white" text-anchor="middle" dominant-baseline="middle">ARJA ERP</text></svg>`;
    return fallbackSvg;
  }
}

/**
 * Resetea el cache del logo (útil para desarrollo)
 */
export function resetLogoCache() {
  Object.keys(logoCache).forEach(key => delete logoCache[key]);
}

