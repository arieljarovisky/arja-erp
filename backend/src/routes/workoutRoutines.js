// src/routes/workoutRoutines.js
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import mammoth from "mammoth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const videosDir = path.join(uploadsDir, 'videos');
const imagesDir = path.join(uploadsDir, 'images');

// Crear directorios si no existen
[uploadsDir, videosDir, imagesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configurar almacenamiento para videos
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, videosDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `video-${uniqueSuffix}${ext}`);
  }
});

// Configurar almacenamiento para imágenes
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `image-${uniqueSuffix}${ext}`);
  }
});

// Filtros de archivos
const videoFilter = (req, file, cb) => {
  const allowedMimes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos de video (MP4, MPEG, MOV, AVI, WEBM)'), false);
  }
};

const imageFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos de imagen (JPEG, PNG, GIF, WEBP)'), false);
  }
};

const uploadVideo = multer({
  storage: videoStorage,
  fileFilter: videoFilter,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB máximo
});

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB máximo
});

// Configurar almacenamiento para documentos Word
const wordStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(uploadsDir, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `word-${uniqueSuffix}${ext}`);
  }
});

const wordFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
  ];
  const allowedExts = ['.docx', '.doc'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos Word (.docx, .doc)'), false);
  }
};

const uploadWord = multer({
  storage: wordStorage,
  fileFilter: wordFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB máximo
});

import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import {
  getExercisesByBodyPart as getExercisesByBodyPartFromService,
  searchExerciseByName
} from "../services/exercisesService.js";
import { translateMuscles } from "../services/exerciseTranslations.js";
import fetch from "node-fetch";

export const workoutRoutines = Router();

// Inicializar Gemini
let gemini = null;
try {
  if (process.env.GEMINI_API_KEY) {
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log("[WorkoutRoutines] Google Gemini inicializado");
  }
} catch (error) {
  console.warn("[WorkoutRoutines] Error al configurar Gemini:", error.message);
}

// Función wrapper para obtener ejercicios usando el nuevo servicio
// Dataset: https://github.com/wrkout/exercises.json
async function getExercisesByBodyPart(bodyPartId) {
  try {
    const exercises = await getExercisesByBodyPartFromService(bodyPartId);
    
    console.log(`[WorkoutRoutines] Obtenidos ${exercises.length} ejercicios del servicio para ${bodyPartId}`);
    
    // Convertir al formato esperado
    // Aceptar ejercicios con instrucciones como array o string, o sin instrucciones (se generará una por defecto)
    const validExercises = exercises
      .filter(ex => {
        if (!ex.name) return false;
        // Aceptar si tiene instrucciones (array o string) o si no tiene (se generará una por defecto)
        return true;
      })
      .map(ex => {
        // Normalizar instrucciones: si es string, convertir a array; si es array, usar tal cual; si no existe, crear array vacío
        let instructions = ex.instructions;
        if (typeof instructions === 'string') {
          instructions = [instructions];
        } else if (!Array.isArray(instructions)) {
          instructions = [];
        }
        
        return {
          id: ex.id || ex.name?.toLowerCase().replace(/\s+/g, '_'),
          name: ex.name,
          bodyPart: ex.primaryMuscles?.[0] || 'general',
          target: ex.primaryMuscles?.[0] || 'general',
          equipment: ex.equipment || 'body only',
          gifUrl: null, // El dataset de wrkout no incluye GIFs por defecto
          instructions: instructions.length > 0 ? instructions : [`Realiza ${ex.name} con técnica correcta.`]
        };
      });

    console.log(`[WorkoutRoutines] ✅ ${validExercises.length} ejercicios válidos para ${bodyPartId}`);

    // Mezclar aleatoriamente para variedad
    return { 
      exercises: validExercises.sort(() => Math.random() - 0.5),
      hasSubscriptionError: false // Ya no hay problemas de suscripción
    };
  } catch (error) {
    console.warn("[WorkoutRoutines] Error obteniendo ejercicios:", error.message);
    return { exercises: [], hasSubscriptionError: false };
  }
}

// Función para generar rutina completa usando Gemini
async function generateRoutineWithGemini(availableExercises, bodyParts, difficulty, duration, customRequest) {
  if (!gemini) {
    throw new Error("Gemini no está disponible");
  }

  const difficultyLevel = difficulty || 'intermedio';
  const durationMinutes = duration || 60;
  
  // Generar nombre de las partes del cuerpo
  const bodyPartsNames = bodyParts.map(id => {
    const part = BODY_PARTS.find(p => p.id === id);
    return part ? part.name : id;
  }).join(' y ');
  
  // Preparar lista de ejercicios disponibles para el prompt
  const exercisesList = availableExercises.slice(0, 20).map(ex => ({
    nombre: ex.name,
    parte_cuerpo: ex.bodyPart || ex.target || 'general',
    equipo: ex.equipment || 'Solo cuerpo'
  }));
  
  // Construir prompt para Gemini en español
  const geminiPrompt = `Eres un entrenador personal experto. Genera una rutina de ejercicios completa en ESPAÑOL.

CONTEXTO:
- Partes del cuerpo a trabajar: ${bodyPartsNames}
- Nivel de dificultad: ${difficultyLevel}
- Duración total: ${durationMinutes} minutos
${customRequest ? `- Solicitud personalizada: ${customRequest}` : ''}

EJERCICIOS DISPONIBLES (puedes usar estos o sugerir otros similares):
${exercisesList.map(ex => `- ${ex.nombre} (${ex.parte_cuerpo}, ${ex.equipo})`).join('\n')}

INSTRUCCIONES:
1. Genera una rutina completa con nombre, descripción, ejercicios principales, calentamiento y enfriamiento
2. TODO debe estar en ESPAÑOL (nombres, descripciones, tips, etc.)
3. Ajusta la cantidad de ejercicios según la dificultad:
   - Principiante: 4-5 ejercicios
   - Intermedio: 6-7 ejercicios
   - Avanzado: 8-10 ejercicios
4. Cada ejercicio debe incluir: nombre, parte del cuerpo, series, repeticiones, descanso, descripción detallada y tips
5. El calentamiento debe tener 3 ejercicios de activación
6. El enfriamiento debe tener 3 ejercicios de estiramiento

FORMATO DE RESPUESTA (JSON estricto):
{
  "name": "Nombre de la rutina en español",
  "description": "Descripción detallada de la rutina en español",
  "duration_minutes": ${durationMinutes},
  "difficulty": "${difficultyLevel}",
  "exercises": [
    {
      "name": "Nombre del ejercicio en español",
      "body_part": "Parte del cuerpo en español",
      "sets": número,
      "reps": "número o rango (ej: '10-12' o '30 segundos')",
      "rest_seconds": número,
      "description": "Descripción detallada en español de cómo hacer el ejercicio paso a paso",
      "tips": "Consejos de técnica en español"
    }
  ],
  "warmup": [
    {
      "name": "Nombre del ejercicio de calentamiento en español",
      "duration_seconds": número,
      "description": "Descripción en español"
    }
  ],
  "cooldown": [
    {
      "name": "Nombre del ejercicio de enfriamiento en español",
      "duration_seconds": número,
      "description": "Descripción en español"
    }
  ]
}

IMPORTANTE: 
- Responde SOLO con el JSON, sin texto adicional
- TODO debe estar en ESPAÑOL
- Las descripciones deben ser claras y detalladas
- Los nombres de ejercicios deben estar en español`;

  // Listar modelos disponibles
  let availableModels = [];
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    );
    
    if (response.ok) {
      const data = await response.json();
      availableModels = data.models?.map(m => m.name.replace('models/', '')) || [];
    }
  } catch (listError) {
    console.warn("[WorkoutRoutines] Error al listar modelos:", listError.message);
  }
  
  const defaultModels = [
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-pro-latest",
    "gemini-1.5-pro",
    "gemini-pro",
  ];
  
  const modelNames = availableModels.length > 0
    ? [process.env.GEMINI_MODEL, ...availableModels].filter(Boolean)
    : [process.env.GEMINI_MODEL, ...defaultModels].filter(Boolean);
  
  const modelsToTry = availableModels.length > 0 
    ? modelNames.filter(name => 
        availableModels.some(available => 
          available.includes(name) || name.includes(available.split('/').pop())
        )
      )
    : modelNames;
  
  let model = null;
  let result = null;
  let lastError = null;
  
  // Probar cada modelo
  for (const modelName of modelsToTry.length > 0 ? modelsToTry : modelNames) {
    try {
      model = gemini.getGenerativeModel({ model: modelName });
      result = await model.generateContent(geminiPrompt);
      console.log(`[WorkoutRoutines] ✅ Usando modelo Gemini: ${modelName}`);
      break;
    } catch (modelError) {
      lastError = modelError;
      const isNotFound = modelError.message?.includes('404') || 
                        modelError.message?.includes('not found') ||
                        modelError.message?.includes('not available');
      if (!isNotFound) {
        console.warn(`[WorkoutRoutines] ⚠️ Modelo ${modelName} falló:`, modelError.message);
      }
      model = null;
      result = null;
    }
  }
  
  if (!result || !model) {
    console.error("[WorkoutRoutines] ❌ No se encontró ningún modelo de Gemini disponible");
    throw new Error("El servicio de IA no está disponible. Por favor, intentá más tarde.");
  }

  // Obtener la respuesta
  const response = result.response;
  let text = response.text();

  // Limpiar la respuesta
  text = text.trim();
  if (text.startsWith('```json')) {
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  } else if (text.startsWith('```')) {
    text = text.replace(/```\n?/g, '').trim();
  }

  // Parsear el JSON
  let routineData;
  try {
    routineData = JSON.parse(text);
  } catch (parseError) {
    console.error("[WorkoutRoutines] Error parseando JSON de Gemini:", parseError);
    console.error("[WorkoutRoutines] Respuesta recibida:", text);
    throw new Error("Error al generar la rutina. Por favor, intentá nuevamente.");
  }

  // Validar estructura básica
  if (!routineData.name || !routineData.exercises || !Array.isArray(routineData.exercises)) {
    throw new Error("La rutina generada no tiene el formato correcto");
  }

  // Ya no buscamos GIFs - los usuarios pueden buscar en YouTube
  const exercisesWithGifs = routineData.exercises.map(ex => ({
    ...ex,
    video_url: null,
    gif_url: null
  }));

  // Ya no buscamos GIFs - los usuarios pueden buscar en YouTube
  const warmupWithGifs = (routineData.warmup || []).map(ex => ({
    ...ex,
    video_url: null,
    gif_url: null
  }));

  const cooldownWithGifs = (routineData.cooldown || []).map(ex => ({
    ...ex,
    video_url: null,
    gif_url: null
  }));

  return {
    name: routineData.name,
    description: routineData.description || '',
    duration_minutes: routineData.duration_minutes || durationMinutes,
    difficulty: routineData.difficulty || difficultyLevel,
    exercises: exercisesWithGifs,
    warmup: warmupWithGifs,
    cooldown: cooldownWithGifs
  };
}

// La función getExerciseVideoUrl ahora viene del servicio exercisesService

// Partes del cuerpo disponibles con iconos SVG realistas
// Iconos que representan claramente cada parte del cuerpo humano de forma realista
const BODY_PARTS = [
  { 
    id: 'pecho', 
    name: 'Pecho', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c-2.5 0-5 1.5-5 4 0 1.5 1 2.5 3 3s4-0.5 4-0.5 1.5 0 4 0.5 3-1.5 3-3c0-2.5-2.5-4-5-4z"/><path d="M7 6.5c0.5 1 1.5 1.8 2.5 2.2"/><path d="M17 6.5c-0.5 1-1.5 1.8-2.5 2.2"/><path d="M7 8.5c0.8 0.8 2 1.3 3.2 1.5"/><path d="M17 8.5c-0.8 0.8-2 1.3-3.2 1.5"/><path d="M9 10.5c0.5 0.5 1.2 0.8 2 1"/><path d="M15 10.5c-0.5 0.5-1.2 0.8-2 1"/><path d="M10 12h4"/><path d="M10.5 13.5h3"/><path d="M11 15h2"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'espalda', 
    name: 'Espalda', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c-2 0-4 1-4 3v2c0 1 1 1.5 2 2s4 0.5 4 0.5 2.5 0 4-0.5 2-1 2-2v-2c0-2-2-3-4-3z"/><path d="M8 7.5c0.5 0.5 1 1 2 1.2"/><path d="M16 7.5c-0.5 0.5-1 1-2 1.2"/><path d="M8 9.5c0.8 0.8 1.8 1.2 2.8 1.4"/><path d="M16 9.5c-0.8 0.8-1.8 1.2-2.8 1.4"/><path d="M9 11.5c0.6 0.6 1.4 1 2.2 1.2"/><path d="M15 11.5c-0.6 0.6-1.4 1-2.2 1.2"/><path d="M10 13.5c0.5 0.5 1.2 0.8 2 1"/><path d="M14 13.5c-0.5 0.5-1.2 0.8-2 1"/><path d="M10.5 15.5h3"/><path d="M11 17.5h2"/><path d="M11.5 19.5h1"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'hombros', 
    name: 'Hombros', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5"/><path d="M14 8c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5"/><path d="M5 8c0.5 1 1.5 1.8 2.5 2.2"/><path d="M19 8c-0.5 1-1.5 1.8-2.5 2.2"/><path d="M7.5 10.2c0.8 0.5 1.8 0.8 2.7 1"/><path d="M16.5 10.2c-0.8 0.5-1.8 0.8-2.7 1"/><path d="M8.5 12c0.5 0.5 1.2 0.8 2 1"/><path d="M15.5 12c-0.5 0.5-1.2 0.8-2 1"/><path d="M9.5 13.5c0.3 0.3 0.8 0.5 1.2 0.6"/><path d="M14.5 13.5c-0.3 0.3-0.8 0.5-1.2 0.6"/><path d="M10 15h4"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'brazos', 
    name: 'Brazos', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3c0 1 1 1.5 2.5 1.5s2.5-0.5 2.5-1.5"/><path d="M13 3c0 1 1 1.5 2.5 1.5s2.5-0.5 2.5-1.5"/><path d="M6 3v6c0 1.2 1 2 2.5 2s2.5-0.8 2.5-2V3"/><path d="M13 3v6c0 1.2 1 2 2.5 2s2.5-0.8 2.5-2V3"/><path d="M6.5 5c0.3 0.5 0.8 1 1.5 1.2"/><path d="M17.5 5c-0.3 0.5-0.8 1-1.5 1.2"/><path d="M7 7c0.5 0.8 1.2 1.3 2 1.5"/><path d="M17 7c-0.5 0.8-1.2 1.3-2 1.5"/><path d="M7.5 9c0.4 0.6 1 1 1.7 1.2"/><path d="M16.5 9c-0.4 0.6-1 1-1.7 1.2"/><path d="M8 11c0.3 0.5 0.8 0.8 1.3 1"/><path d="M16 11c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M8.5 13c0.2 0.3 0.6 0.5 1 0.6"/><path d="M15.5 13c-0.2 0.3-0.6 0.5-1 0.6"/><path d="M9 15h6"/><path d="M9.5 17h5"/><path d="M10 19h4"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'piernas', 
    name: 'Piernas', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3c0 0.8 0.8 1.5 2 1.5s2-0.7 2-1.5"/><path d="M12 3c0 0.8 0.8 1.5 2 1.5s2-0.7 2-1.5"/><path d="M8 3v3c0 1 0.8 1.5 2 1.5s2-0.5 2-1.5V3"/><path d="M12 3v3c0 1 0.8 1.5 2 1.5s2-0.5 2-1.5V3"/><path d="M8.5 6c0.3 0.5 0.8 0.8 1.3 1"/><path d="M15.5 6c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M8 7v4c0 1.2 1 2 2.5 2s2.5-0.8 2.5-2V7"/><path d="M12 7v4c0 1.2 1 2 2.5 2s2.5-0.8 2.5-2V7"/><path d="M8.5 8c0.4 0.6 1 1 1.7 1.2"/><path d="M15.5 8c-0.4 0.6-1 1-1.7 1.2"/><path d="M9 10c0.5 0.8 1.2 1.3 2 1.5"/><path d="M15 10c-0.5 0.8-1.2 1.3-2 1.5"/><path d="M9 12v5c0 1.2 1 2 2.5 2s2.5-0.8 2.5-2v-5"/><path d="M13 12v5c0 1.2 1 2 2.5 2s2.5-0.8 2.5-2v-5"/><path d="M9.5 13c0.3 0.5 0.8 0.8 1.3 1"/><path d="M15.5 13c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M10 15c0.4 0.6 1 1 1.7 1.2"/><path d="M14 15c-0.4 0.6-1 1-1.7 1.2"/><path d="M10.5 17c0.2 0.3 0.6 0.5 1 0.6"/><path d="M13.5 17c-0.2 0.3-0.6 0.5-1 0.6"/><path d="M11 19h2"/><path d="M11.5 21h1"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'gluteos', 
    name: 'Glúteos', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8c0 1.5 1 2.5 2.5 2.5s2.5-1 2.5-2.5"/><path d="M13 8c0 1.5 1 2.5 2.5 2.5s2.5-1 2.5-2.5"/><path d="M6 8v8c0 1.5 1.2 2.5 3 2.5s3-1 3-2.5V8"/><path d="M13 8v8c0 1.5 1.2 2.5 3 2.5s3-1 3-2.5V8"/><path d="M6.5 10c0.3 0.5 0.8 0.8 1.3 1"/><path d="M17.5 10c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M7 12c0.4 0.6 1 1 1.7 1.2"/><path d="M17 12c-0.4 0.6-1 1-1.7 1.2"/><path d="M7.5 14c0.3 0.5 0.8 0.8 1.3 1"/><path d="M16.5 14c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M8 16c0.2 0.3 0.6 0.5 1 0.6"/><path d="M16 16c-0.2 0.3-0.6 0.5-1 0.6"/><path d="M8.5 18h7"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'abdomen', 
    name: 'Abdomen', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6c0-1 1-2 3-2s3 1 3 2"/><path d="M12 6c0-1 1-2 3-2s3 1 3 2"/><path d="M6 6v12c0 1.5 1.2 2.5 3 2.5s3-1 3-2.5V6"/><path d="M12 6v12c0 1.5 1.2 2.5 3 2.5s3-1 3-2.5V6"/><path d="M6.5 8c0.3 0.5 0.8 0.8 1.3 1"/><path d="M17.5 8c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M7 10c0.4 0.6 1 1 1.7 1.2"/><path d="M17 10c-0.4 0.6-1 1-1.7 1.2"/><path d="M7.5 12c0.3 0.5 0.8 0.8 1.3 1"/><path d="M16.5 12c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M8 14c0.4 0.6 1 1 1.7 1.2"/><path d="M16 14c-0.4 0.6-1 1-1.7 1.2"/><path d="M8.5 16c0.3 0.5 0.8 0.8 1.3 1"/><path d="M15.5 16c-0.3 0.5-0.8 0.8-1.3 1"/><path d="M9 18h6"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'cardio', 
    name: 'Cardio', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/><path d="M8 10c0.5 1 1.5 1.5 2.5 1.5s2-0.5 2.5-1.5"/><path d="M12 8.5c0.3 0.5 0.8 0.8 1.2 1"/><path d="M10.5 12c0.2 0.3 0.5 0.5 0.9 0.6"/></svg>',
    iconType: 'svg'
  },
  { 
    id: 'fullbody', 
    name: 'Cuerpo completo', 
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="3" r="2.5"/><path d="M12 5.5v2"/><path d="M9 7.5c0.5 0.5 1.2 0.8 2 1"/><path d="M15 7.5c-0.5 0.5-1.2 0.8-2 1"/><path d="M10 8.5c0.3 0.3 0.7 0.5 1.2 0.6"/><path d="M14 8.5c-0.3 0.3-0.7 0.5-1.2 0.6"/><path d="M12 7.5v3"/><path d="M9.5 10.5c0.4 0.4 1 0.7 1.5 0.9"/><path d="M14.5 10.5c-0.4 0.4-1 0.7-1.5 0.9"/><path d="M10.5 12.5c0.3 0.3 0.7 0.5 1.1 0.6"/><path d="M13.5 12.5c-0.3 0.3-0.7 0.5-1.1 0.6"/><path d="M12 10.5v3.5"/><path d="M9.5 14c0.4 0.4 1 0.7 1.5 0.9"/><path d="M14.5 14c-0.4 0.4-1 0.7-1.5 0.9"/><path d="M10 15.5v4c0 1 0.8 1.5 2 1.5s2-0.5 2-1.5v-4"/><path d="M14 15.5v4c0 1 0.8 1.5 2 1.5s2-0.5 2-1.5v-4"/><path d="M10.5 16.5c0.3 0.3 0.7 0.5 1.1 0.6"/><path d="M13.5 16.5c-0.3 0.3-0.7 0.5-1.1 0.6"/><path d="M11 19.5c0.2 0.2 0.5 0.3 0.8 0.4"/><path d="M13 19.5c-0.2 0.2-0.5 0.3-0.8 0.4"/><path d="M11.5 21h1"/></svg>',
    iconType: 'svg'
  },
];

/**
 * GET /api/workout-routines/body-parts
 * Obtener lista de partes del cuerpo disponibles
 * 
 * NOTA PARA EL FRONTEND:
 * El campo 'icon' contiene un SVG como string HTML.
 * Para renderizarlo en React, usa dangerouslySetInnerHTML:
 * 
 * <div dangerouslySetInnerHTML={{ __html: bodyPart.icon }} />
 * 
 * O crea un componente:
 * const Icon = ({ svgString }) => <span dangerouslySetInnerHTML={{ __html: svgString }} />;
 */
workoutRoutines.get("/body-parts", (req, res) => {
  res.json({ ok: true, data: BODY_PARTS });
});

/**
 * GET /api/workout-routines/exercise-gif/:exerciseId
 * DEPRECADO: Ya no se usan GIFs. Los usuarios pueden buscar en YouTube.
 * Este endpoint se mantiene por compatibilidad pero retorna 404.
 */
workoutRoutines.get("/exercise-gif/:exerciseId", async (req, res) => {
  return res.status(404).json({ ok: false, error: "Este endpoint ya no está disponible. Usa YouTube para buscar videos del ejercicio." });
});

/**
 * POST /api/workout-routines/generate
 * Generar rutina de ejercicios con IA
 * SOLO para entrenadores (admin, staff, user) - NO para customers
 */
workoutRoutines.post("/generate", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { bodyParts, customRequest, duration, difficulty, assignedToCustomerId } = req.body;
    const tenantId = req.tenant_id;
    const trainerId = req.user?.id; // ID del entrenador que genera la rutina
    
    // Si se especifica assignedToCustomerId, la rutina es para ese customer
    // Si no, el entrenador la está creando para sí mismo (puede ser útil para templates)
    const targetCustomerId = assignedToCustomerId || trainerId;

    if (!tenantId || !trainerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    // Si se asigna a un customer específico, validar que existe
    if (assignedToCustomerId) {
      const [customerCheck] = await pool.query(
        `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [assignedToCustomerId, tenantId]
      );
      if (customerCheck.length === 0) {
        return res.status(400).json({ ok: false, error: "El cliente especificado no existe" });
      }
    }

    // Verificar límite de rutinas según el plan del customer objetivo (si es customer)
    try {
      // Obtener la suscripción activa del customer objetivo
      const [subscriptions] = await pool.query(
        `SELECT mp.max_workout_routines
         FROM customer_subscription cs
         INNER JOIN membership_plan mp ON cs.membership_plan_id = mp.id
         WHERE cs.customer_id = ? AND cs.tenant_id = ? AND cs.status = 'active'
         ORDER BY cs.created_at DESC
         LIMIT 1`,
        [targetCustomerId, tenantId]
      );

      if (subscriptions.length > 0 && subscriptions[0].max_workout_routines !== null) {
        // Contar rutinas existentes del customer objetivo
        const [countResult] = await pool.query(
          `SELECT COUNT(*) as count FROM workout_routine 
           WHERE tenant_id = ? AND (customer_id = ? OR assigned_to_customer_id = ?)`,
          [tenantId, targetCustomerId, targetCustomerId]
        );

        const currentCount = countResult[0]?.count || 0;
        const maxRoutines = subscriptions[0].max_workout_routines;

        if (currentCount >= maxRoutines) {
          return res.status(403).json({
            ok: false,
            error: `Has alcanzado el límite de ${maxRoutines} rutina${maxRoutines > 1 ? 's' : ''} según tu plan. Elimina una rutina existente o actualiza tu plan para crear más.`
          });
        }
      }
    } catch (limitError) {
      console.warn("[WorkoutRoutines] Error verificando límite de rutinas:", limitError.message);
      // Continuar si hay error al verificar el límite (no bloquear la creación)
    }

    // Validar que haya al menos una parte del cuerpo o una solicitud personalizada
    if ((!bodyParts || bodyParts.length === 0) && !customRequest) {
      return res.status(400).json({ 
        ok: false, 
        error: "Debes seleccionar al menos una parte del cuerpo o escribir una solicitud personalizada" 
      });
    }

    // Obtener ejercicios del dataset de wrkout basados en las partes del cuerpo
    console.log("[WorkoutRoutines] Obteniendo ejercicios del dataset de wrkout...");
    let availableExercises = [];
    
    if (bodyParts && bodyParts.length > 0) {
      // Obtener ejercicios de cada parte del cuerpo seleccionada
      const exercisePromises = bodyParts.map(bodyPartId => getExercisesByBodyPart(bodyPartId));
      const exerciseResults = await Promise.all(exercisePromises);
      
      // Combinar todos los ejercicios
      availableExercises = exerciseResults.flatMap(result => result.exercises);
      
      // Eliminar duplicados por ID
      const uniqueExercises = [];
      const seenIds = new Set();
      for (const ex of availableExercises) {
        if (!seenIds.has(ex.id)) {
          seenIds.add(ex.id);
          uniqueExercises.push(ex);
        }
      }
      availableExercises = uniqueExercises;
      
      console.log(`[WorkoutRoutines] ✅ Obtenidos ${availableExercises.length} ejercicios únicos del dataset`);
    }

    // Validar que tengamos ejercicios disponibles
    if (availableExercises.length === 0) {
      const bodyPartsNames = bodyParts.map(id => {
        const part = BODY_PARTS.find(p => p.id === id);
        return part ? part.name : id;
      }).join(', ');
      
      return res.status(400).json({ 
        ok: false, 
        error: `No se encontraron ejercicios disponibles para ${bodyPartsNames}. Por favor, intentá seleccionando otras partes del cuerpo.` 
      });
    }

    // Generar rutina usando Gemini
    console.log("[WorkoutRoutines] Generando rutina con Gemini...");
    const difficultyLevel = difficulty || 'intermedio';
    const durationMinutes = duration || 60;
    
    if (!gemini) {
      return res.status(503).json({ 
        ok: false, 
        error: "El servicio de IA no está disponible. Por favor, configurá GEMINI_API_KEY." 
      });
    }
    
    let routineData;
    try {
      routineData = await generateRoutineWithGemini(
        availableExercises,
        bodyParts || [],
        difficultyLevel,
        durationMinutes,
        customRequest
      );
      console.log("[WorkoutRoutines] ✅ Rutina generada exitosamente con Gemini");
    } catch (error) {
      console.error("[WorkoutRoutines] Error generando rutina con Gemini:", error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message || "Error al generar la rutina. Por favor, intentá nuevamente." 
      });
    }

    // Validar estructura básica
    if (!routineData.name || !routineData.exercises || !Array.isArray(routineData.exercises)) {
      return res.status(500).json({ 
        ok: false, 
        error: "La rutina generada no tiene el formato correcto" 
      });
    }

    // Guardar la rutina en la base de datos
    console.log("[WorkoutRoutines] Guardando rutina - tenantId:", tenantId, "trainerId:", trainerId, "targetCustomerId:", targetCustomerId);
    
    // Asegurar que bodyParts sea un array
    let bodyPartsArray = [];
    if (bodyParts) {
      if (Array.isArray(bodyParts)) {
        bodyPartsArray = bodyParts;
      } else if (typeof bodyParts === 'string') {
        bodyPartsArray = [bodyParts];
      } else {
        bodyPartsArray = [bodyParts];
      }
    }
    
    console.log("[WorkoutRoutines] Datos de rutina:", {
      name: routineData.name,
      duration: routineData.duration_minutes || 60,
      difficulty: difficultyLevel,
      bodyParts: bodyPartsArray,
      bodyPartsType: typeof bodyParts,
      bodyPartsIsArray: Array.isArray(bodyParts),
    });

    const [insertResult] = await pool.query(
      `INSERT INTO workout_routine 
       (tenant_id, customer_id, created_by_user_id, assigned_to_customer_id, name, description, duration_minutes, difficulty, 
        body_parts, exercises_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tenantId,
        targetCustomerId, // El customer al que pertenece la rutina
        trainerId, // El entrenador que la creó
        assignedToCustomerId || targetCustomerId, // El customer al que se asignó (puede ser diferente si el entrenador la creó para otro)
        routineData.name,
        routineData.description || '',
        routineData.duration_minutes || 60,
        difficultyLevel,
        JSON.stringify(bodyPartsArray), // Siempre guardar como array JSON
        JSON.stringify(routineData),
      ]
    );

    const routineId = insertResult.insertId;
    console.log("[WorkoutRoutines] ✅ Rutina guardada con ID:", routineId);

    // Retornar la rutina generada
    res.json({
      ok: true,
      data: {
        id: routineId,
        ...routineData,
        body_parts: bodyParts || [],
      }
    });

  } catch (error) {
    console.error("[WorkoutRoutines] Error generando rutina:", error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Error al generar la rutina" 
    });
  }
});

/**
 * GET /api/workout-routines
 * Obtener rutinas del usuario
 * Customers solo ven rutinas asignadas por entrenadores
 * Entrenadores ven todas sus rutinas generadas
 */
workoutRoutines.get("/", requireAuth, identifyTenant, async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const userId = req.user?.id;
    const isCustomer = req.user?.type === 'customer';
    const isTrainer = req.user?.role && ['admin', 'staff', 'user'].includes(req.user.role);

    console.log("[WorkoutRoutines] GET /api/workout-routines - tenantId:", tenantId, "userId:", userId, "isCustomer:", isCustomer, "isTrainer:", isTrainer);
    console.log("[WorkoutRoutines] req.user:", req.user);

    if (!tenantId || !userId) {
      console.error("[WorkoutRoutines] ❌ No autorizado - tenantId:", tenantId, "userId:", userId);
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    let query;
    let params;

    if (isCustomer) {
      // Customers solo ven rutinas asignadas a ellos
      query = `SELECT id, tenant_id, customer_id, created_by_user_id, assigned_to_customer_id, 
                      name, description, duration_minutes, difficulty, body_parts, exercises_data, 
                      created_at, updated_at
               FROM workout_routine
               WHERE tenant_id = ? AND (customer_id = ? OR assigned_to_customer_id = ?)
               ORDER BY created_at DESC`;
      params = [tenantId, userId, userId];
    } else if (isTrainer) {
      // Entrenadores ven rutinas que crearon o que están asignadas a customers
      query = `SELECT id, tenant_id, customer_id, created_by_user_id, assigned_to_customer_id,
                      name, description, duration_minutes, difficulty, body_parts, exercises_data,
                      created_at, updated_at
               FROM workout_routine
               WHERE tenant_id = ? AND (created_by_user_id = ? OR assigned_to_customer_id IS NOT NULL)
               ORDER BY created_at DESC`;
      params = [tenantId, userId];
    } else {
      return res.status(403).json({ ok: false, error: "Tipo de usuario no válido" });
    }

    const [routines] = await pool.query(query, params);

    console.log("[WorkoutRoutines] ✅ Rutinas encontradas:", routines.length);
    if (routines.length > 0) {
      console.log("[WorkoutRoutines] Primera rutina:", {
        id: routines[0].id,
        name: routines[0].name,
        tenant_id: routines[0].tenant_id,
        customer_id: routines[0].customer_id,
      });
    }

    const formattedRoutines = routines.map(routine => {
      // Parsear body_parts de forma segura
      let body_parts = [];
      try {
        if (routine.body_parts) {
          // Si ya es un array (desde la DB), usarlo directamente
          if (Array.isArray(routine.body_parts)) {
            body_parts = routine.body_parts;
          } else if (typeof routine.body_parts === 'string') {
            // Intentar parsear como JSON
            const parsed = JSON.parse(routine.body_parts);
            body_parts = Array.isArray(parsed) ? parsed : [parsed];
          }
        }
      } catch (parseError) {
        console.warn("[WorkoutRoutines] Error parseando body_parts:", parseError.message, "Valor:", routine.body_parts);
        // Si falla el parseo, intentar como string simple
        if (typeof routine.body_parts === 'string' && routine.body_parts.trim()) {
          body_parts = [routine.body_parts];
        }
      }

      // Parsear exercises_data de forma segura
      let exercises = [];
      let warmup = [];
      let cooldown = [];
      try {
        if (routine.exercises_data) {
          const exercisesData = typeof routine.exercises_data === 'string' 
            ? JSON.parse(routine.exercises_data) 
            : routine.exercises_data;
          exercises = exercisesData.exercises || [];
          warmup = exercisesData.warmup || [];
          cooldown = exercisesData.cooldown || [];
        }
      } catch (parseError) {
        console.warn("[WorkoutRoutines] Error parseando exercises_data:", parseError.message);
      }

      return {
        id: routine.id,
        name: routine.name,
        description: routine.description,
        duration_minutes: routine.duration_minutes,
        difficulty: routine.difficulty,
        body_parts,
        exercises,
        warmup,
        cooldown,
        created_at: routine.created_at,
        updated_at: routine.updated_at,
      };
    });

    res.json({ ok: true, data: formattedRoutines });
  } catch (error) {
    console.error("[WorkoutRoutines] ❌ Error obteniendo rutinas:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/workout-routines/available
 * Obtener rutinas disponibles para asignar (solo para admins/staff)
 * Muestra todas las rutinas creadas por entrenadores del tenant
 * IMPORTANTE: Esta ruta debe ir ANTES de /:id para que no sea capturada
 */
workoutRoutines.get("/available", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    // Obtener todas las rutinas creadas por entrenadores del tenant con información del cliente asignado
    const [routines] = await pool.query(
      `SELECT 
        wr.id, 
        wr.name, 
        wr.description, 
        wr.duration_minutes, 
        wr.difficulty, 
        wr.assigned_to_customer_id, 
        wr.created_at,
        c.name AS assigned_customer_name
       FROM workout_routine wr
       LEFT JOIN customer c ON c.id = wr.assigned_to_customer_id AND c.tenant_id = wr.tenant_id
       WHERE wr.tenant_id = ? AND wr.created_by_user_id IS NOT NULL
       ORDER BY wr.created_at DESC`,
      [tenantId]
    );

    const formattedRoutines = routines.map(routine => ({
      id: routine.id,
      name: routine.name,
      description: routine.description,
      duration_minutes: routine.duration_minutes,
      difficulty: routine.difficulty,
      assigned_to_customer_id: routine.assigned_to_customer_id,
      assigned_customer_name: routine.assigned_customer_name,
      created_at: routine.created_at,
    }));

    res.json({ ok: true, data: formattedRoutines });
  } catch (error) {
    console.error("[WorkoutRoutines] Error obteniendo rutinas disponibles:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/workout-routines/customer/:customerId
 * Obtener rutinas asignadas a un cliente específico (solo para admins/staff)
 * IMPORTANTE: Esta ruta debe ir ANTES de /:id para que no sea capturada
 */
workoutRoutines.get("/customer/:customerId", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { customerId } = req.params;
    const tenantId = req.tenant_id;

    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    // Verificar que el cliente existe en el tenant
    const [customers] = await pool.query(
      `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [customerId, tenantId]
    );

    if (customers.length === 0) {
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    }

    // Obtener rutinas asignadas a este cliente
    const [routines] = await pool.query(
      `SELECT id, name, description, duration_minutes, difficulty, assigned_to_customer_id, created_at
       FROM workout_routine
       WHERE tenant_id = ? AND assigned_to_customer_id = ?
       ORDER BY created_at DESC`,
      [tenantId, customerId]
    );

    const formattedRoutines = routines.map(routine => ({
      id: routine.id,
      name: routine.name,
      description: routine.description,
      duration_minutes: routine.duration_minutes,
      difficulty: routine.difficulty,
      assigned_to_customer_id: routine.assigned_to_customer_id,
      created_at: routine.created_at,
    }));

    res.json({ ok: true, data: formattedRoutines });
  } catch (error) {
    console.error("[WorkoutRoutines] Error obteniendo rutinas del cliente:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/workout-routines/:id
 * Obtener una rutina específica
 * Customers solo pueden ver rutinas asignadas a ellos
 * Entrenadores pueden ver rutinas que crearon o asignaron
 */
workoutRoutines.get("/:id", requireAuth, identifyTenant, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenant_id;
    const userId = req.user?.id;
    const isCustomer = req.user?.type === 'customer';
    const isTrainer = req.user?.role && ['admin', 'staff', 'user'].includes(req.user.role);

    if (!tenantId || !userId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    let query;
    let params;

    if (isCustomer) {
      // Customers solo pueden ver rutinas asignadas a ellos
      query = `SELECT id, tenant_id, customer_id, created_by_user_id, assigned_to_customer_id,
                      name, description, duration_minutes, difficulty, body_parts, exercises_data,
                      created_at, updated_at
               FROM workout_routine
               WHERE id = ? AND tenant_id = ? AND (customer_id = ? OR assigned_to_customer_id = ?)
               LIMIT 1`;
      params = [id, tenantId, userId, userId];
    } else if (isTrainer) {
      // Entrenadores pueden ver rutinas que crearon o asignaron
      query = `SELECT id, tenant_id, customer_id, created_by_user_id, assigned_to_customer_id,
                      name, description, duration_minutes, difficulty, body_parts, exercises_data,
                      created_at, updated_at
               FROM workout_routine
               WHERE id = ? AND tenant_id = ? AND (created_by_user_id = ? OR assigned_to_customer_id IS NOT NULL)
               LIMIT 1`;
      params = [id, tenantId, userId];
    } else {
      return res.status(403).json({ ok: false, error: "Tipo de usuario no válido" });
    }

    const [routines] = await pool.query(query, params);

    if (routines.length === 0) {
      return res.status(404).json({ ok: false, error: "Rutina no encontrada" });
    }

    const routine = routines[0];
    
    // Parsear body_parts de forma segura
    let body_parts = [];
    try {
      if (routine.body_parts) {
        // Si ya es un array (desde la DB), usarlo directamente
        if (Array.isArray(routine.body_parts)) {
          body_parts = routine.body_parts;
        } else if (typeof routine.body_parts === 'string') {
          // Intentar parsear como JSON
          const parsed = JSON.parse(routine.body_parts);
          body_parts = Array.isArray(parsed) ? parsed : [parsed];
        }
      }
    } catch (parseError) {
      console.warn("[WorkoutRoutines] Error parseando body_parts en GET /:id:", parseError.message, "Valor:", routine.body_parts);
      // Si falla el parseo, intentar como string simple
      if (typeof routine.body_parts === 'string' && routine.body_parts.trim()) {
        body_parts = [routine.body_parts];
      }
    }

    // Parsear exercises_data de forma segura
    let exercises = [];
    let warmup = [];
    let cooldown = [];
    try {
      if (routine.exercises_data) {
        let exercisesData;
        if (typeof routine.exercises_data === 'string') {
          exercisesData = JSON.parse(routine.exercises_data);
        } else if (typeof routine.exercises_data === 'object') {
          // Ya es un objeto, usarlo directamente
          exercisesData = routine.exercises_data;
        } else {
          exercisesData = {};
        }
        exercises = exercisesData.exercises || [];
        warmup = exercisesData.warmup || [];
        cooldown = exercisesData.cooldown || [];
      }
    } catch (parseError) {
      console.warn("[WorkoutRoutines] Error parseando exercises_data en GET /:id:", parseError.message);
      console.warn("[WorkoutRoutines] Valor exercises_data:", routine.exercises_data);
    }

    res.json({
      ok: true,
      data: {
        id: routine.id,
        name: routine.name,
        description: routine.description,
        duration_minutes: routine.duration_minutes,
        difficulty: routine.difficulty,
        body_parts,
        exercises,
        warmup,
        cooldown,
        created_at: routine.created_at,
        updated_at: routine.updated_at,
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error obteniendo rutina:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/workout-routines/:id/exercise/:exerciseIndex
 * Actualizar un ejercicio específico de una rutina
 */
workoutRoutines.put("/:id/exercise/:exerciseIndex", requireAuth, identifyTenant, async (req, res) => {
  try {
    const { id, exerciseIndex } = req.params;
    const { exercise } = req.body; // El ejercicio actualizado
    const tenantId = req.tenant_id;
    const customerId = req.user?.id;

    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    if (!exercise) {
      return res.status(400).json({ ok: false, error: "Se requiere el ejercicio a actualizar" });
    }

    const index = parseInt(exerciseIndex);
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ ok: false, error: "Índice de ejercicio inválido" });
    }

    // Obtener la rutina actual
    const [routines] = await pool.query(
      `SELECT exercises_data FROM workout_routine
       WHERE id = ? AND tenant_id = ? AND customer_id = ?
       LIMIT 1`,
      [id, tenantId, customerId]
    );

    if (routines.length === 0) {
      return res.status(404).json({ ok: false, error: "Rutina no encontrada" });
    }

    const routine = routines[0];
    
    // Parsear exercises_data
    let exercisesData;
    try {
      exercisesData = typeof routine.exercises_data === 'string' 
        ? JSON.parse(routine.exercises_data) 
        : routine.exercises_data;
    } catch (parseError) {
      return res.status(500).json({ ok: false, error: "Error al parsear datos de la rutina" });
    }

    // Validar que el índice existe
    if (!exercisesData.exercises || !Array.isArray(exercisesData.exercises) || index >= exercisesData.exercises.length) {
      return res.status(400).json({ ok: false, error: "Índice de ejercicio fuera de rango" });
    }

    // Actualizar el ejercicio en el índice especificado
    exercisesData.exercises[index] = {
      ...exercisesData.exercises[index],
      ...exercise,
    };

    // Actualizar en la base de datos
    await pool.query(
      `UPDATE workout_routine 
       SET exercises_data = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ? AND customer_id = ?`,
      [JSON.stringify(exercisesData), id, tenantId, customerId]
    );

    console.log(`[WorkoutRoutines] ✅ Ejercicio ${index} actualizado en rutina ${id}`);

    res.json({
      ok: true,
      data: {
        exercise: exercisesData.exercises[index],
        message: "Ejercicio actualizado correctamente"
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error actualizando ejercicio:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/workout-routines/:id/exercise/:exerciseIndex/regenerate
 * Regenerar un ejercicio específico con IA usando un prompt personalizado
 */
workoutRoutines.put("/:id/exercise/:exerciseIndex/regenerate", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { id, exerciseIndex } = req.params;
    const { prompt } = req.body; // Prompt del usuario, ej: "quiero algo más fácil"
    const tenantId = req.tenant_id;
    const customerId = req.user?.id;

    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    if (!gemini) {
      return res.status(503).json({ 
        ok: false, 
        error: "El servicio de IA no está disponible" 
      });
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ ok: false, error: "Se requiere un prompt para regenerar el ejercicio" });
    }

    const index = parseInt(exerciseIndex);
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ ok: false, error: "Índice de ejercicio inválido" });
    }

    // Obtener la rutina actual
    const [routines] = await pool.query(
      `SELECT exercises_data, name, difficulty FROM workout_routine
       WHERE id = ? AND tenant_id = ? AND customer_id = ?
       LIMIT 1`,
      [id, tenantId, customerId]
    );

    if (routines.length === 0) {
      return res.status(404).json({ ok: false, error: "Rutina no encontrada" });
    }

    const routine = routines[0];
    
    // Parsear exercises_data
    let exercisesData;
    try {
      exercisesData = typeof routine.exercises_data === 'string' 
        ? JSON.parse(routine.exercises_data) 
        : routine.exercises_data;
    } catch (parseError) {
      return res.status(500).json({ ok: false, error: "Error al parsear datos de la rutina" });
    }

    // Validar que el índice existe
    if (!exercisesData.exercises || !Array.isArray(exercisesData.exercises) || index >= exercisesData.exercises.length) {
      return res.status(400).json({ ok: false, error: "Índice de ejercicio fuera de rango" });
    }

    const currentExercise = exercisesData.exercises[index];

    // Construir prompt para Gemini
    const geminiPrompt = `Eres un entrenador personal experto. El usuario quiere modificar un ejercicio de su rutina.

EJERCICIO ACTUAL:
- Nombre: ${currentExercise.name}
- Parte del cuerpo: ${currentExercise.body_part || 'No especificada'}
- Series: ${currentExercise.sets}
- Repeticiones: ${currentExercise.reps}
- Descanso: ${currentExercise.rest_seconds} segundos
- Descripción: ${currentExercise.description || 'Sin descripción'}
- Dificultad de la rutina: ${routine.difficulty}

SOLICITUD DEL USUARIO: "${prompt.trim()}"

Genera un NUEVO ejercicio que reemplace al actual, siguiendo la solicitud del usuario. El nuevo ejercicio debe:
- Mantener la misma parte del cuerpo si es posible
- Ajustar la dificultad según la solicitud del usuario
- Ser apropiado para el nivel de dificultad de la rutina (${routine.difficulty})
- Incluir descripción clara de cómo hacerlo
- Incluir consejos de técnica si es relevante

FORMATO DE RESPUESTA (JSON estricto):
{
  "name": "Nombre del nuevo ejercicio",
  "body_part": "parte del cuerpo",
  "sets": número,
  "reps": "número o rango (ej: '10-12' o '30 segundos')",
  "rest_seconds": número,
  "description": "Descripción detallada de cómo hacer el ejercicio",
  "tips": "Consejos de técnica (opcional)",
  "video_url": "URL de video de YouTube si conoces una específica, o null"
}

IMPORTANTE: Responde SOLO con el JSON, sin texto adicional.`;

    // Listar modelos disponibles
    let availableModels = [];
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
      );
      
      if (response.ok) {
        const data = await response.json();
        availableModels = data.models?.map(m => m.name.replace('models/', '')) || [];
      }
    } catch (listError) {
      console.warn("[WorkoutRoutines] Error al listar modelos:", listError.message);
    }
    
    const defaultModels = [
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash",
      "gemini-1.5-pro-latest",
      "gemini-1.5-pro",
      "gemini-pro",
    ];
    
    const modelNames = availableModels.length > 0
      ? [process.env.GEMINI_MODEL, ...availableModels].filter(Boolean)
      : [process.env.GEMINI_MODEL, ...defaultModels].filter(Boolean);
    
    const modelsToTry = availableModels.length > 0 
      ? modelNames.filter(name => 
          availableModels.some(available => 
            available.includes(name) || name.includes(available.split('/').pop())
          )
        )
      : modelNames;
    
    let model = null;
    let result = null;
    let lastError = null;
    
    // Probar cada modelo
    for (const modelName of modelsToTry.length > 0 ? modelsToTry : modelNames) {
      try {
        model = gemini.getGenerativeModel({ model: modelName });
        result = await model.generateContent(geminiPrompt);
        console.log(`[WorkoutRoutines] ✅ Usando modelo para regenerar ejercicio: ${modelName}`);
        break;
      } catch (modelError) {
        lastError = modelError;
        const isNotFound = modelError.message?.includes('404') || 
                          modelError.message?.includes('not found') ||
                          modelError.message?.includes('not available');
        if (!isNotFound) {
          console.warn(`[WorkoutRoutines] ⚠️ Modelo ${modelName} falló:`, modelError.message);
        }
        model = null;
        result = null;
      }
    }
    
    if (!result || !model) {
      console.error("[WorkoutRoutines] ❌ No se encontró ningún modelo de Gemini disponible");
      return res.status(503).json({ 
        ok: false, 
        error: "El servicio de IA no está disponible. Por favor, intentá más tarde." 
      });
    }

    // Obtener la respuesta
    const response = result.response;
    let text = response.text();

    // Limpiar la respuesta
    text = text.trim();
    if (text.startsWith('```json')) {
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } else if (text.startsWith('```')) {
      text = text.replace(/```\n?/g, '').trim();
    }

    // Parsear el JSON
    let newExercise;
    try {
      newExercise = JSON.parse(text);
    } catch (parseError) {
      console.error("[WorkoutRoutines] Error parseando JSON de Gemini:", parseError);
      console.error("[WorkoutRoutines] Respuesta recibida:", text);
      return res.status(500).json({ 
        ok: false, 
        error: "Error al generar el ejercicio. Por favor, intentá nuevamente." 
      });
    }

    // Validar estructura básica
    if (!newExercise.name || !newExercise.sets || !newExercise.reps) {
      return res.status(500).json({ 
        ok: false, 
        error: "El ejercicio generado no tiene el formato correcto" 
      });
    }

    // Asegurar que todos los campos necesarios estén presentes
    const updatedExercise = {
      name: newExercise.name,
      body_part: newExercise.body_part || currentExercise.body_part || '',
      sets: newExercise.sets || currentExercise.sets,
      reps: newExercise.reps || currentExercise.reps,
      rest_seconds: newExercise.rest_seconds || currentExercise.rest_seconds,
      description: newExercise.description || '',
      tips: newExercise.tips || null,
      video_url: null,
      gif_url: null, // Ya no usamos GIFs - los usuarios pueden buscar en YouTube
    };

    // Actualizar el ejercicio en el array
    exercisesData.exercises[index] = updatedExercise;

    // Actualizar en la base de datos
    await pool.query(
      `UPDATE workout_routine 
       SET exercises_data = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ? AND customer_id = ?`,
      [JSON.stringify(exercisesData), id, tenantId, customerId]
    );

    console.log(`[WorkoutRoutines] ✅ Ejercicio ${index} regenerado con IA en rutina ${id}`);

    res.json({
      ok: true,
      data: {
        exercise: updatedExercise,
        message: "Ejercicio regenerado correctamente con IA"
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error regenerando ejercicio con IA:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/workout-routines
 * Crear una rutina manualmente (sin IA)
 * Body: { name, description, duration_minutes, difficulty, body_parts, exercises_data, assigned_to_customer_id }
 */
workoutRoutines.post("/", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { name, description, duration_minutes, difficulty, body_parts, exercises_data, assigned_to_customer_id } = req.body;
    const tenantId = req.tenant_id;
    const trainerId = req.user?.id;

    if (!tenantId || !trainerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: "El nombre de la rutina es requerido" });
    }

    // Validar que el cliente existe si se especifica
    if (assigned_to_customer_id) {
      const [customerCheck] = await pool.query(
        `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [assigned_to_customer_id, tenantId]
      );
      if (customerCheck.length === 0) {
        return res.status(400).json({ ok: false, error: "El cliente especificado no existe" });
      }
    }

    // Preparar datos de la rutina
    const routineData = {
      name: name.trim(),
      description: description?.trim() || '',
      duration_minutes: duration_minutes || 60,
      difficulty: difficulty || 'intermedio',
      exercises: exercises_data?.exercises || [],
      warmup: exercises_data?.warmup || [],
      cooldown: exercises_data?.cooldown || [],
    };

    // Preparar body_parts
    let bodyPartsArray = [];
    if (body_parts) {
      if (Array.isArray(body_parts)) {
        bodyPartsArray = body_parts;
      } else if (typeof body_parts === 'string') {
        bodyPartsArray = [body_parts];
      }
    }

    // Insertar la rutina
    const [insertResult] = await pool.query(
      `INSERT INTO workout_routine 
       (tenant_id, customer_id, created_by_user_id, assigned_to_customer_id, name, description, duration_minutes, difficulty, 
        body_parts, exercises_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tenantId,
        assigned_to_customer_id || trainerId,
        trainerId,
        assigned_to_customer_id || null,
        routineData.name,
        routineData.description,
        routineData.duration_minutes,
        routineData.difficulty,
        JSON.stringify(bodyPartsArray),
        JSON.stringify(routineData),
      ]
    );

    const routineId = insertResult.insertId;
    console.log(`[WorkoutRoutines] ✅ Rutina manual creada con ID: ${routineId}`);

    res.json({
      ok: true,
      data: {
        id: routineId,
        name: routineData.name,
        description: routineData.description,
        duration_minutes: routineData.duration_minutes,
        difficulty: routineData.difficulty,
        body_parts: bodyPartsArray,
        assigned_to_customer_id: assigned_to_customer_id || null,
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error creando rutina manual:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/workout-routines/upload/video
 * Subir un video para un ejercicio
 * IMPORTANTE: Esta ruta debe ir ANTES de /:id para que no sea capturada
 */
workoutRoutines.post("/upload/video", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se proporcionó ningún archivo de video" });
    }

    const fileUrl = `/uploads/videos/${req.file.filename}`;
    const fullUrl = `${req.protocol}://${req.get('host')}${fileUrl}`;

    res.json({
      ok: true,
      data: {
        url: fullUrl,
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error subiendo video:", error);
    // Manejar error de archivo demasiado grande
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        ok: false, 
        error: "El archivo es demasiado grande. Tamaño máximo: 500MB" 
      });
    }
    res.status(500).json({ ok: false, error: error.message || "Error al subir el video" });
  }
});

/**
 * POST /api/workout-routines/upload/image
 * Subir una imagen para un ejercicio
 * IMPORTANTE: Esta ruta debe ir ANTES de /:id para que no sea capturada
 */
workoutRoutines.post("/upload/image", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), uploadImage.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se proporcionó ningún archivo de imagen" });
    }

    const fileUrl = `/uploads/images/${req.file.filename}`;
    const fullUrl = `${req.protocol}://${req.get('host')}${fileUrl}`;

    res.json({
      ok: true,
      data: {
        url: fullUrl,
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error subiendo imagen:", error);
    // Manejar error de archivo demasiado grande
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        ok: false, 
        error: "El archivo es demasiado grande. Tamaño máximo: 10MB" 
      });
    }
    res.status(500).json({ ok: false, error: error.message || "Error al subir la imagen" });
  }
});

/**
 * POST /api/workout-routines/import/word
 * Importar rutina desde un archivo Word (.docx)
 * IMPORTANTE: Esta ruta debe ir ANTES de /import para que no sea capturada
 */
workoutRoutines.post("/import/word", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), uploadWord.single('word'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se proporcionó ningún archivo Word" });
    }

    const tenantId = req.tenant_id;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const filePath = req.file.path;

    try {
      // Convertir Word a texto/HTML
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value;

      console.log("[WorkoutRoutines] Texto extraído del Word (primeras 500 chars):", text.substring(0, 500));
      console.log("[WorkoutRoutines] Total de caracteres:", text.length);

      // Parsear el texto para extraer información de la rutina
      const routineData = parseWordRoutine(text);

      console.log("[WorkoutRoutines] Datos parseados:", {
        name: routineData.name,
        exercisesCount: routineData.exercises?.length || 0,
        warmupCount: routineData.warmup?.length || 0,
        cooldownCount: routineData.cooldown?.length || 0,
        exercises: routineData.exercises,
      });

      if (!routineData.name) {
        return res.status(400).json({ ok: false, error: "No se pudo extraer el nombre de la rutina del documento" });
      }

      // Preparar datos de la rutina
      const routine = {
        name: routineData.name.trim(),
        description: routineData.description || '',
        duration_minutes: routineData.duration_minutes || 60,
        difficulty: routineData.difficulty || 'intermedio',
        exercises: routineData.exercises || [],
        warmup: routineData.warmup || [],
        cooldown: routineData.cooldown || [],
      };

      // Preparar body_parts
      let bodyPartsArray = [];
      if (routineData.body_parts) {
        if (Array.isArray(routineData.body_parts)) {
          bodyPartsArray = routineData.body_parts;
        } else if (typeof routineData.body_parts === 'string') {
          bodyPartsArray = [routineData.body_parts];
        }
      }

      // Obtener un customer_id válido
      let validCustomerId = null;
      if (routineData.assigned_to_customer_id) {
        // Verificar que el customer existe
        const [customerCheck] = await pool.query(
          `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [routineData.assigned_to_customer_id, tenantId]
        );
        if (customerCheck.length > 0) {
          validCustomerId = routineData.assigned_to_customer_id;
        }
      }
      
      // Si no hay customer asignado, buscar el primer customer del tenant como fallback
      if (!validCustomerId) {
        const [firstCustomer] = await pool.query(
          `SELECT id FROM customer WHERE tenant_id = ? LIMIT 1`,
          [tenantId]
        );
        if (firstCustomer.length > 0) {
          validCustomerId = firstCustomer[0].id;
        }
      }

      if (!validCustomerId) {
        return res.status(400).json({ ok: false, error: "No se encontró un cliente válido para asociar la rutina" });
      }

      // Insertar la rutina
      const [insertResult] = await pool.query(
        `INSERT INTO workout_routine 
         (tenant_id, customer_id, created_by_user_id, assigned_to_customer_id, name, description, duration_minutes, difficulty, 
          body_parts, exercises_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          tenantId,
          validCustomerId,
          userId,
          routineData.assigned_to_customer_id || null,
          routine.name,
          routine.description,
          routine.duration_minutes,
          routine.difficulty,
          JSON.stringify(bodyPartsArray),
          JSON.stringify({
            exercises: routine.exercises,
            warmup: routine.warmup,
            cooldown: routine.cooldown,
          }),
        ]
      );

      // Eliminar archivo temporal
      fs.unlinkSync(filePath);

      res.json({
        ok: true,
        data: {
          id: insertResult.insertId,
          name: routine.name,
          message: "Rutina importada correctamente desde Word",
        }
      });
    } catch (parseError) {
      // Eliminar archivo temporal en caso de error
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw parseError;
    }
  } catch (error) {
    console.error("[WorkoutRoutines] Error importando rutina desde Word:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Función para parsear el texto de Word y extraer información de la rutina
 * Busca patrones comunes en documentos de rutinas
 */
function parseWordRoutine(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  console.log("[WorkoutRoutines] Total de líneas después de filtrar:", lines.length);
  console.log("[WorkoutRoutines] Primeras 20 líneas:", lines.slice(0, 20));
  
  let routineData = {
    name: '',
    description: '',
    duration_minutes: 60,
    difficulty: 'intermedio',
    body_parts: [],
    exercises: [],
    warmup: [],
    cooldown: [],
  };

  let currentSection = 'main';
  let currentExercise = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const originalLine = lines[i];

    // Detectar nombre de la rutina (primera línea o línea con "RUTINA", "NOMBRE", etc.)
    if (!routineData.name && (
      originalLine.length > 0 && originalLine.length < 100 &&
      (!line.includes('ejercicio') && !line.includes('series') && !line.includes('repeticiones'))
    )) {
      if (i === 0 || line.includes('rutina') || line.includes('nombre')) {
        routineData.name = originalLine.replace(/^(rutina|nombre)[:\s]*/i, '').trim();
        continue;
      }
    }

    // Detectar secciones
    if (line.includes('calentamiento') || line.includes('warmup')) {
      currentSection = 'warmup';
      continue;
    }
    if (line.includes('enfriamiento') || line.includes('cooldown') || line.includes('estiramiento')) {
      currentSection = 'cooldown';
      continue;
    }
    if (line.includes('ejercicio') && !line.includes('ejercicios')) {
      currentSection = 'main';
      continue;
    }

    // Detectar dificultad
    if (line.includes('dificultad') || line.includes('nivel')) {
      const difficultyMatch = originalLine.match(/(principiante|intermedio|avanzado|básico|intermedio|experto)/i);
      if (difficultyMatch) {
        const diff = difficultyMatch[1].toLowerCase();
        if (diff.includes('principiante') || diff.includes('básico')) {
          routineData.difficulty = 'principiante';
        } else if (diff.includes('avanzado') || diff.includes('experto')) {
          routineData.difficulty = 'avanzado';
        } else {
          routineData.difficulty = 'intermedio';
        }
      }
      continue;
    }

    // Detectar duración
    if (line.includes('duración') || line.includes('tiempo') || line.includes('minutos')) {
      const durationMatch = originalLine.match(/(\d+)\s*(min|minutos|minuto)/i);
      if (durationMatch) {
        routineData.duration_minutes = parseInt(durationMatch[1]);
      }
      continue;
    }

    // Detectar descripción
    if (line.includes('descripción') || line.includes('descripcion')) {
      routineData.description = originalLine.replace(/^(descripción|descripcion)[:\s]*/i, '').trim();
      continue;
    }

    // Detectar ejercicios
    // Buscar líneas que parezcan ejercicios (contienen números de series/repeticiones)
    // Patrones más flexibles: "3 series x 10", "3x10", "3 series de 10 repeticiones", etc.
    const exercisePatterns = [
      /(\d+)\s*(series|x|×|de)\s*(\d+[\-\d]*)\s*(rep|repeticiones|reps|rep\.?)/i,
      /(\d+)\s*(series|x|×)\s*(\d+[\-\d]*)/i,
      /(\d+)\s*x\s*(\d+[\-\d]*)/i,
      /(\d+)\s*series/i, // Solo "3 series" sin repeticiones
    ];
    
    let exerciseMatch = null;
    let matchedPattern = null;
    for (const pattern of exercisePatterns) {
      exerciseMatch = originalLine.match(pattern);
      if (exerciseMatch) {
        matchedPattern = pattern;
        console.log(`[WorkoutRoutines] Ejercicio detectado en línea ${i + 1}: "${originalLine}" con patrón: ${pattern}`);
        break;
      }
    }
    
    if (exerciseMatch) {
      // Si hay un ejercicio anterior, guardarlo
      if (currentExercise && currentExercise.name) {
        const targetArray = currentSection === 'warmup' ? routineData.warmup :
                           currentSection === 'cooldown' ? routineData.cooldown :
                           routineData.exercises;
        targetArray.push(currentExercise);
        console.log(`[WorkoutRoutines] Ejercicio guardado: ${currentExercise.name}`);
      }

      // Crear nuevo ejercicio
      const sets = parseInt(exerciseMatch[1]);
      // El patrón puede tener diferentes grupos, intentar obtener reps
      let reps = exerciseMatch[3] || exerciseMatch[2] || '10';
      
      // Buscar nombre del ejercicio (líneas anteriores, hasta 5 líneas atrás)
      let exerciseName = '';
      for (let j = Math.max(0, i - 5); j < i; j++) {
        const prevLine = lines[j].toLowerCase();
        if (lines[j].length > 0 && lines[j].length < 100 && 
            !prevLine.match(/(\d+)\s*(series|x|×|de)\s*(\d+)/i) &&
            !prevLine.includes('series') &&
            !prevLine.includes('repeticiones') &&
            !prevLine.includes('descanso') &&
            !prevLine.includes('rest') &&
            !prevLine.includes('duración') &&
            !prevLine.includes('dificultad') &&
            !prevLine.includes('calentamiento') &&
            !prevLine.includes('enfriamiento') &&
            !prevLine.includes('ejercicio') &&
            !prevLine.includes('principal')) {
          exerciseName = lines[j];
          break;
        }
      }

      currentExercise = {
        name: exerciseName || `Ejercicio ${routineData.exercises.length + routineData.warmup.length + routineData.cooldown.length + 1}`,
        body_part: '',
        sets: sets,
        reps: reps,
        rest_seconds: 60,
        description: '',
        tips: '',
        video_url: '',
        image_url: '',
      };
      console.log(`[WorkoutRoutines] Nuevo ejercicio creado: ${currentExercise.name} (${sets} series x ${reps} reps)`);
    } else if (currentExercise) {
      // Agregar información adicional al ejercicio actual
      if (line.includes('descanso') || line.includes('rest')) {
        const restMatch = originalLine.match(/(\d+)\s*(seg|segundos|s)/i);
        if (restMatch) {
          currentExercise.rest_seconds = parseInt(restMatch[1]);
        }
      } else if (originalLine.length > 10 && originalLine.length < 200 && !currentExercise.description) {
        currentExercise.description = originalLine;
      }
    }
  }

  // Agregar último ejercicio si existe
  if (currentExercise && currentExercise.name) {
    const targetArray = currentSection === 'warmup' ? routineData.warmup :
                       currentSection === 'cooldown' ? routineData.cooldown :
                       routineData.exercises;
    targetArray.push(currentExercise);
  }

  // Si no se encontró nombre, usar primera línea
  if (!routineData.name && lines.length > 0) {
    routineData.name = lines[0];
  }

  return routineData;
}

/**
 * POST /api/workout-routines/import
 * Importar rutinas desde un archivo JSON
 * Body: { routines: [...] } donde cada rutina tiene: name, description, duration_minutes, difficulty, body_parts, exercises_data
 */
workoutRoutines.post("/import", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { routines } = req.body;
    const tenantId = req.tenant_id;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    if (!routines || !Array.isArray(routines) || routines.length === 0) {
      return res.status(400).json({ ok: false, error: "Se requiere un array de rutinas para importar" });
    }

    const importedRoutines = [];
    const errors = [];

    for (let i = 0; i < routines.length; i++) {
      const routineData = routines[i];
      
      try {
        // Validar campos requeridos
        if (!routineData.name || !routineData.name.trim()) {
          errors.push(`Rutina ${i + 1}: El nombre es requerido`);
          continue;
        }

        // Preparar datos de la rutina
        const routine = {
          name: routineData.name.trim(),
          description: routineData.description || '',
          duration_minutes: routineData.duration_minutes || 60,
          difficulty: routineData.difficulty || 'intermedio',
          exercises: routineData.exercises || routineData.exercises_data?.exercises || [],
          warmup: routineData.warmup || routineData.exercises_data?.warmup || [],
          cooldown: routineData.cooldown || routineData.exercises_data?.cooldown || [],
        };

        // Preparar body_parts
        let bodyPartsArray = [];
        if (routineData.body_parts) {
          if (Array.isArray(routineData.body_parts)) {
            bodyPartsArray = routineData.body_parts;
          } else if (typeof routineData.body_parts === 'string') {
            bodyPartsArray = [routineData.body_parts];
          }
        }

        // Obtener un customer_id válido
        let validCustomerId = null;
        if (routineData.assigned_to_customer_id) {
          // Verificar que el customer existe
          const [customerCheck] = await pool.query(
            `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
            [routineData.assigned_to_customer_id, tenantId]
          );
          if (customerCheck.length > 0) {
            validCustomerId = routineData.assigned_to_customer_id;
          }
        }
        
        // Si no hay customer asignado, buscar el primer customer del tenant como fallback
        if (!validCustomerId) {
          const [firstCustomer] = await pool.query(
            `SELECT id FROM customer WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
          );
          if (firstCustomer.length > 0) {
            validCustomerId = firstCustomer[0].id;
          }
        }

        if (!validCustomerId) {
          errors.push(`Rutina ${i + 1}: No se encontró un cliente válido para asociar la rutina`);
          continue;
        }

        // Insertar la rutina
        const [insertResult] = await pool.query(
          `INSERT INTO workout_routine 
           (tenant_id, customer_id, created_by_user_id, assigned_to_customer_id, name, description, duration_minutes, difficulty, 
            body_parts, exercises_data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            tenantId,
            validCustomerId,
            userId,
            routineData.assigned_to_customer_id || null,
            routine.name,
            routine.description,
            routine.duration_minutes,
            routine.difficulty,
            JSON.stringify(bodyPartsArray),
            JSON.stringify({
              exercises: routine.exercises,
              warmup: routine.warmup,
              cooldown: routine.cooldown,
            }),
          ]
        );

        importedRoutines.push({
          id: insertResult.insertId,
          name: routine.name,
          originalIndex: i + 1,
        });

        console.log(`[WorkoutRoutines] ✅ Rutina importada: ${routine.name} (ID: ${insertResult.insertId})`);
      } catch (error) {
        console.error(`[WorkoutRoutines] Error importando rutina ${i + 1}:`, error);
        errors.push(`Rutina ${i + 1} (${routineData.name || 'sin nombre'}): ${error.message}`);
      }
    }

    res.json({
      ok: true,
      data: {
        imported: importedRoutines.length,
        total: routines.length,
        routines: importedRoutines,
        errors: errors.length > 0 ? errors : undefined,
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error importando rutinas:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/workout-routines/:id
 * Actualizar una rutina completa (solo para admins/staff)
 * Body: { name, description, duration_minutes, difficulty, body_parts, exercises_data, assigned_to_customer_id }
 */
workoutRoutines.put("/:id", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, duration_minutes, difficulty, body_parts, exercises_data, assigned_to_customer_id } = req.body;
    const tenantId = req.tenant_id;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    // Verificar que la rutina existe y pertenece al usuario
    const [routines] = await pool.query(
      `SELECT id FROM workout_routine 
       WHERE id = ? AND tenant_id = ? AND created_by_user_id = ?
       LIMIT 1`,
      [id, tenantId, userId]
    );

    if (routines.length === 0) {
      return res.status(404).json({ ok: false, error: "Rutina no encontrada o no tienes permiso para editarla" });
    }

    // Validar cliente si se especifica
    if (assigned_to_customer_id) {
      const [customerCheck] = await pool.query(
        `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [assigned_to_customer_id, tenantId]
      );
      if (customerCheck.length === 0) {
        return res.status(400).json({ ok: false, error: "El cliente especificado no existe" });
      }
    }

    // Preparar datos para actualizar
    const updates = [];
    const values = [];

    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ ok: false, error: "El nombre de la rutina es requerido" });
      }
      updates.push("name = ?");
      values.push(name.trim());
    }

    if (description !== undefined) {
      updates.push("description = ?");
      values.push(description?.trim() || '');
    }

    if (duration_minutes !== undefined) {
      updates.push("duration_minutes = ?");
      values.push(duration_minutes || 60);
    }

    if (difficulty !== undefined) {
      updates.push("difficulty = ?");
      values.push(difficulty || 'intermedio');
    }

    if (body_parts !== undefined) {
      let bodyPartsArray = [];
      if (body_parts) {
        if (Array.isArray(body_parts)) {
          bodyPartsArray = body_parts;
        } else if (typeof body_parts === 'string') {
          bodyPartsArray = [body_parts];
        }
      }
      updates.push("body_parts = ?");
      values.push(JSON.stringify(bodyPartsArray));
    }

    if (exercises_data !== undefined) {
      updates.push("exercises_data = ?");
      values.push(JSON.stringify(exercises_data || { exercises: [], warmup: [], cooldown: [] }));
    }

    if (assigned_to_customer_id !== undefined) {
      updates.push("assigned_to_customer_id = ?");
      values.push(assigned_to_customer_id || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    updates.push("updated_at = NOW()");
    values.push(id, tenantId, userId);

    // Actualizar la rutina
    await pool.query(
      `UPDATE workout_routine 
       SET ${updates.join(", ")}
       WHERE id = ? AND tenant_id = ? AND created_by_user_id = ?`,
      values
    );

    console.log(`[WorkoutRoutines] ✅ Rutina ${id} actualizada`);

    // Obtener la rutina actualizada
    const [updated] = await pool.query(
      `SELECT id, name, description, duration_minutes, difficulty, assigned_to_customer_id, created_at, updated_at
       FROM workout_routine
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, tenantId]
    );

    res.json({
      ok: true,
      data: updated[0]
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error actualizando rutina:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * DELETE /api/workout-routines/:id
 * Eliminar una rutina (solo para admins/staff)
 */
workoutRoutines.delete("/:id", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenant_id;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    // Verificar que la rutina existe y pertenece al usuario
    const [routines] = await pool.query(
      `SELECT id, name FROM workout_routine 
       WHERE id = ? AND tenant_id = ? AND created_by_user_id = ?
       LIMIT 1`,
      [id, tenantId, userId]
    );

    if (routines.length === 0) {
      return res.status(404).json({ ok: false, error: "Rutina no encontrada o no tienes permiso para eliminarla" });
    }

    // Eliminar la rutina
    await pool.query(
      `DELETE FROM workout_routine 
       WHERE id = ? AND tenant_id = ? AND created_by_user_id = ?`,
      [id, tenantId, userId]
    );

    console.log(`[WorkoutRoutines] ✅ Rutina ${id} eliminada por usuario ${userId}`);

    res.json({
      ok: true,
      message: "Rutina eliminada correctamente"
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error eliminando rutina:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/workout-routines/:id/assign
 * Asignar una rutina a un cliente (solo para admins/staff)
 * Body: { customer_id }
 */
workoutRoutines.put("/:id/assign", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_id } = req.body;
    const tenantId = req.tenant_id;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    if (!customer_id) {
      return res.status(400).json({ ok: false, error: "Se requiere customer_id" });
    }

    // Verificar que la rutina existe y pertenece al tenant
    const [routines] = await pool.query(
      `SELECT id, name, assigned_to_customer_id 
       FROM workout_routine 
       WHERE id = ? AND tenant_id = ? AND created_by_user_id = ?
       LIMIT 1`,
      [id, tenantId, userId]
    );

    if (routines.length === 0) {
      return res.status(404).json({ ok: false, error: "Rutina no encontrada o no tienes permiso para asignarla" });
    }

    // Verificar que el cliente existe en el tenant
    const [customers] = await pool.query(
      `SELECT id FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [customer_id, tenantId]
    );

    if (customers.length === 0) {
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    }

    // Actualizar la asignación
    await pool.query(
      `UPDATE workout_routine 
       SET assigned_to_customer_id = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [customer_id, id, tenantId]
    );

    console.log(`[WorkoutRoutines] ✅ Rutina ${id} asignada a cliente ${customer_id}`);

    res.json({
      ok: true,
      message: "Rutina asignada exitosamente",
      data: {
        routine_id: id,
        customer_id: customer_id
      }
    });
  } catch (error) {
    console.error("[WorkoutRoutines] Error asignando rutina:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * DELETE /api/workout-routines/:id
 * Eliminar una rutina
 */
workoutRoutines.delete("/:id", requireAuth, identifyTenant, requireRole("admin", "staff", "user"), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenant_id;
    const customerId = req.user?.id;

    if (!tenantId || !customerId) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const [result] = await pool.query(
      `DELETE FROM workout_routine
       WHERE id = ? AND tenant_id = ? AND customer_id = ?`,
      [id, tenantId, customerId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Rutina no encontrada" });
    }

    res.json({ ok: true, message: "Rutina eliminada exitosamente" });
  } catch (error) {
    console.error("[WorkoutRoutines] Error eliminando rutina:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});


