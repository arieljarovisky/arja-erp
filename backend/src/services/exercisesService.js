// src/services/exercisesService.js
// Servicio para cargar y buscar ejercicios del dataset wrkout/exercises.json
// Dataset: https://github.com/wrkout/exercises.json

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { translateExercise } from "./exerciseTranslations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache del dataset
let exercisesCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas

// URL base del dataset en GitHub
const DATASET_BASE_URL = "https://raw.githubusercontent.com/wrkout/exercises.json/master/exercises";

// Mapeo de partes del cuerpo de nuestra app a músculos del dataset
const BODY_PART_TO_MUSCLES = {
  'pecho': ['pectorals', 'chest'],
  'espalda': ['lats', 'middle back', 'lower back', 'traps', 'rhomboids'],
  'hombros': ['shoulders', 'delts', 'rear delts'],
  'brazos': ['biceps', 'triceps', 'forearms'],
  'piernas': ['quadriceps', 'hamstrings', 'calves', 'glutes'],
  'gluteos': ['glutes'],
  'abdomen': ['abdominals', 'abs', 'core', 'obliques'],
  'cardio': [], // Los ejercicios de cardio se filtran por category
  'fullbody': [] // Para cuerpo completo, no filtramos por músculo
};

/**
 * Carga el dataset completo de ejercicios desde GitHub
 * Usa caché para evitar múltiples descargas
 */
async function loadExercisesDataset() {
  try {
    // Verificar si hay caché válido
    if (exercisesCache && cacheTimestamp) {
      const cacheAge = Date.now() - cacheTimestamp;
      if (cacheAge < CACHE_DURATION) {
        console.log(`[ExercisesService] Usando caché (edad: ${Math.round(cacheAge / 1000 / 60)} minutos)`);
        return exercisesCache;
      }
    }

    console.log("[ExercisesService] Cargando dataset de ejercicios desde GitHub...");
    
    // Intentar cargar desde archivo local primero (si existe)
    const localPath = path.join(__dirname, '../../data/exercises.json');
    if (fs.existsSync(localPath)) {
      try {
        const fileContent = fs.readFileSync(localPath, 'utf-8');
        const rawExercises = JSON.parse(fileContent);
        // Traducir todos los ejercicios al español
        exercisesCache = rawExercises.map(ex => translateExercise(ex));
        cacheTimestamp = Date.now();
        console.log(`[ExercisesService] ✅ Dataset cargado desde archivo local (${exercisesCache.length} ejercicios) - Traducido al español`);
        return exercisesCache;
      } catch (error) {
        console.warn("[ExercisesService] Error leyendo archivo local, cargando desde GitHub...");
      }
    }

    // Cargar lista de ejercicios desde el índice del repo
    // Nota: El repo tiene ejercicios individuales, necesitamos obtener la lista
    // Por ahora, usaremos una lista conocida de ejercicios comunes
    // En producción, deberías descargar el dataset completo o usar el archivo exercises.json consolidado
    
    // Lista de ejercicios comunes por categoría (esto es temporal, idealmente deberías tener el dataset completo)
    const commonExercises = await loadCommonExercises();
    
    exercisesCache = commonExercises;
    cacheTimestamp = Date.now();
    
    console.log(`[ExercisesService] ✅ Dataset cargado (${exercisesCache.length} ejercicios)`);
    return exercisesCache;
  } catch (error) {
    console.error("[ExercisesService] Error cargando dataset:", error.message);
    // Retornar dataset mínimo en caso de error
    return getFallbackExercises();
  }
}

/**
 * Carga ejercicios comunes desde GitHub
 * Lista expandida de ejercicios populares por categoría
 */
async function loadCommonExercises() {
  const exercises = [];
  
  // Lista expandida de ejercicios comunes por categoría
  const exerciseList = [
    // Brazos - Biceps
    'Barbell_Curl', 'Dumbbell_Curl', 'Hammer_Curl', 'Alternate_Hammer_Curl',
    'Alternate_Incline_Dumbbell_Curl', 'Cable_Curl', 'Concentration_Curl',
    // Brazos - Triceps
    'Tricep_Dips', 'Close_Grip_Barbell_Bench_Press', 'Overhead_Tricep_Extension',
    'Tricep_Pushdown', 'Dumbbell_Tricep_Extension',
    // Pecho
    'Barbell_Bench_Press', 'Dumbbell_Bench_Press', 'Push_Up', 'Incline_Dumbbell_Press',
    'Decline_Barbell_Bench_Press', 'Cable_Crossover', 'Pec_Deck', 'Dumbbell_Flyes',
    // Espalda
    'Barbell_Row', 'Dumbbell_Row', 'Pull_Up', 'Lat_Pulldown', 'T_Bar_Row',
    'Seated_Cable_Row', 'One_Arm_Dumbbell_Row', 'Deadlift', 'Romanian_Deadlift',
    'Bent_Over_Barbell_Row', 'Cable_Row',
    // Hombros
    'Barbell_Shoulder_Press', 'Dumbbell_Shoulder_Press', 'Lateral_Raise',
    'Front_Raise', 'Rear_Delt_Raise', 'Arnold_Press', 'Upright_Row',
    'Cable_Lateral_Raise', 'Dumbbell_Lateral_Raise',
    // Piernas - Cuádriceps
    'Barbell_Squat', 'Dumbbell_Squat', 'Leg_Press', 'Leg_Extension',
    'Lunges', 'Bulgarian_Split_Squat', 'Front_Squat', 'Goblet_Squat',
    // Piernas - Isquiotibiales
    'Leg_Curl', 'Romanian_Deadlift', 'Stiff_Leg_Deadlift', 'Good_Morning',
    // Glúteos
    'Hip_Thrust', 'Glute_Bridge', 'Bulgarian_Split_Squat', 'Lunges',
    // Pantorrillas
    'Calf_Raise', 'Standing_Calf_Raise', 'Seated_Calf_Raise',
    // Abdomen
    'Crunch', 'Sit_Up', 'Plank', 'Russian_Twist', 'Leg_Raise',
    'Bicycle_Crunch', 'Mountain_Climber', 'Ab_Crunch_Machine', 'Hanging_Leg_Raise',
    'Cable_Crunch', 'Side_Plank',
    // Cardio
    'Running', 'Jumping_Jack', 'Burpee', 'Mountain_Climber', 'High_Knees',
    'Jump_Rope', 'Box_Jump', 'Sprint', 'Air_Bike', 'Rowing_Machine',
    // Full Body
    'Burpee', 'Thruster', 'Clean_And_Jerk', 'Snatch', 'Kettlebell_Swing'
  ];

  console.log(`[ExercisesService] Cargando ${exerciseList.length} ejercicios comunes desde GitHub...`);

  // Cargar ejercicios en paralelo (en lotes para no sobrecargar)
  const batchSize = 10;
  for (let i = 0; i < exerciseList.length; i += batchSize) {
    const batch = exerciseList.slice(i, i + batchSize);
    const batchPromises = batch.map(async (exerciseName) => {
      try {
        const url = `${DATASET_BASE_URL}/${exerciseName}/exercise.json`;
        const response = await fetch(url, { timeout: 5000 });
        
      if (response.ok) {
        const exercise = await response.json();
        const exerciseWithId = {
          ...exercise,
          id: exerciseName, // Usar el nombre como ID
        };
        // Traducir al español
        return translateExercise(exerciseWithId);
      }
        return null;
      } catch (error) {
        console.warn(`[ExercisesService] No se pudo cargar ${exerciseName}:`, error.message);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    const validExercises = batchResults.filter(ex => ex !== null);
    // Los ejercicios ya vienen traducidos de la función loadCommonExercises
    exercises.push(...validExercises);
    
    if ((i + batchSize) % 50 === 0 || i + batchSize >= exerciseList.length) {
      console.log(`[ExercisesService] Progreso: ${Math.min(i + batchSize, exerciseList.length)}/${exerciseList.length} ejercicios procesados`);
    }
  }

  // Si no se cargaron ejercicios, usar fallback
  if (exercises.length === 0) {
    console.warn("[ExercisesService] No se pudieron cargar ejercicios desde GitHub, usando fallback");
    return getFallbackExercises();
  }

  console.log(`[ExercisesService] ✅ Cargados ${exercises.length} ejercicios comunes`);
  return exercises;
}

/**
 * Dataset mínimo de ejercicios en caso de error
 */
function getFallbackExercises() {
  return [
    {
      id: 'barbell_curl',
      name: 'Curl con Barra',
      primaryMuscles: ['Bíceps'],
      secondaryMuscles: ['Antebrazos'],
      equipment: 'Barra',
      category: 'Fuerza',
      level: 'Principiante',
      instructions: [
        'Párate con el torso erguido mientras sostienes una barra con un agarre al ancho de los hombros.',
        'Curl los pesos hacia adelante mientras contraes los bíceps.',
        'Continúa hasta que tus bíceps estén completamente contraídos.',
        'Lentamente regresa a la posición inicial.',
        'Repite por la cantidad recomendada de repeticiones.'
      ]
    },
    {
      id: 'push_up',
      name: 'Flexiones',
      primaryMuscles: ['Pectorales'],
      secondaryMuscles: ['Tríceps', 'Hombros'],
      equipment: 'Solo Cuerpo',
      category: 'Fuerza',
      level: 'Principiante',
      instructions: [
        'Comienza en posición de plancha con las manos ligeramente más anchas que el ancho de los hombros.',
        'Baja tu cuerpo hasta que el pecho casi toque el suelo.',
        'Empuja hacia arriba hasta la posición inicial.',
        'Repite por la cantidad recomendada de repeticiones.'
      ]
    }
  ];
}

/**
 * Obtiene ejercicios filtrados por parte del cuerpo
 */
async function getExercisesByBodyPart(bodyPartId) {
  try {
    const allExercises = await loadExercisesDataset();
    const targetMuscles = BODY_PART_TO_MUSCLES[bodyPartId] || [];
    
    console.log(`[ExercisesService] Buscando ejercicios para ${bodyPartId}, músculos objetivo:`, targetMuscles);
    console.log(`[ExercisesService] Total de ejercicios cargados: ${allExercises.length}`);
    
    if (bodyPartId === 'cardio') {
      // Filtrar por categoría cardio
      const cardioExercises = allExercises.filter(ex => 
        ex.category === 'cardio' || 
        ex.category?.toLowerCase() === 'cardio' ||
        ex.name.toLowerCase().includes('run') ||
        ex.name.toLowerCase().includes('jump') ||
        ex.name.toLowerCase().includes('cardio')
      );
      console.log(`[ExercisesService] ✅ Encontrados ${cardioExercises.length} ejercicios de cardio`);
      return cardioExercises;
    }
    
    if (bodyPartId === 'fullbody') {
      // Para cuerpo completo, retornar todos los ejercicios
      console.log(`[ExercisesService] ✅ Retornando todos los ${allExercises.length} ejercicios para fullbody`);
      return allExercises;
    }
    
    if (targetMuscles.length === 0) {
      console.warn(`[ExercisesService] ⚠️ No hay músculos objetivo definidos para ${bodyPartId}`);
      return [];
    }
    
    // Filtrar ejercicios que trabajen los músculos objetivo
    // Usar músculos originales en inglés (primaryMuscles_en) para comparar con targetMuscles
    const filtered = allExercises.filter(ex => {
      // Usar músculos originales en inglés si están disponibles, sino usar los traducidos
      const primary = ex.primaryMuscles_en || ex.primaryMuscles || [];
      const secondary = ex.secondaryMuscles_en || ex.secondaryMuscles || [];
      const allMuscles = [...primary, ...secondary];
      
      const matches = targetMuscles.some(muscle => 
        allMuscles.some(exMuscle => {
          const exMuscleLower = String(exMuscle).toLowerCase();
          const muscleLower = String(muscle).toLowerCase();
          return exMuscleLower.includes(muscleLower) ||
                 muscleLower.includes(exMuscleLower) ||
                 exMuscleLower === muscleLower;
        })
      );
      
      return matches;
    });
    
    console.log(`[ExercisesService] ✅ Encontrados ${filtered.length} ejercicios para ${bodyPartId}`);
    if (filtered.length === 0 && allExercises.length > 0) {
      // Debug: mostrar algunos ejemplos de músculos en los ejercicios
      const sampleMuscles = allExercises.slice(0, 5).map(ex => ({
        name: ex.name,
        primary: ex.primaryMuscles_en || ex.primaryMuscles,
        secondary: ex.secondaryMuscles_en || ex.secondaryMuscles
      }));
      console.log(`[ExercisesService] 🔍 Ejemplos de músculos en ejercicios:`, JSON.stringify(sampleMuscles, null, 2));
    }
    
    return filtered;
  } catch (error) {
    console.error(`[ExercisesService] Error obteniendo ejercicios para ${bodyPartId}:`, error.message);
    return [];
  }
}

/**
 * Busca un ejercicio por nombre
 */
async function searchExerciseByName(exerciseName) {
  try {
    const allExercises = await loadExercisesDataset();
    const searchTerm = exerciseName.toLowerCase();
    
    // Buscar coincidencia exacta primero
    let match = allExercises.find(ex => 
      ex.name.toLowerCase() === searchTerm
    );
    
    // Si no hay coincidencia exacta, buscar parcial
    if (!match) {
      match = allExercises.find(ex => 
        ex.name.toLowerCase().includes(searchTerm) ||
        searchTerm.includes(ex.name.toLowerCase())
      );
    }
    
    return match || null;
  } catch (error) {
    console.error(`[ExercisesService] Error buscando ejercicio ${exerciseName}:`, error.message);
    return null;
  }
}

/**
 * Obtiene el GIF de un ejercicio desde ExerciseDB API
 * Busca el ejercicio por nombre y obtiene su GIF animado
 * @param {string} exerciseName - Nombre del ejercicio (puede estar en español)
 * @param {string} originalName - Nombre original en inglés (opcional)
 */
/**
 * Traduce nombres de ejercicios comunes de español a inglés
 */
function translateExerciseNameToEnglish(spanishName) {
  const translations = {
    // Pecho
    'Press de Banca con Barra': 'Bench Press',
    'Press de Banca': 'Bench Press',
    'Press de Banca Inclinado': 'Incline Bench Press',
    'Press de Banca Declinado': 'Decline Bench Press',
    'Aperturas': 'Chest Fly',
    'Aperturas en Máquina': 'Pec Deck',
    'Flexiones': 'Push Up',
    'Flexiones Pliométricas': 'Plyometric Push Up',
    'Press de Pecho': 'Chest Press',
    'Press de Pecho en Polea': 'Cable Chest Press',
    
    // Espalda
    'Remo con Barra': 'Barbell Row',
    'Dominadas': 'Pull Up',
    'Jalón al Pecho': 'Lat Pulldown',
    'Peso Muerto': 'Deadlift',
    
    // Hombros
    'Press de Hombros': 'Shoulder Press',
    'Elevación Lateral': 'Lateral Raise',
    
    // Piernas
    'Sentadillas': 'Squat',
    'Prensa de Piernas': 'Leg Press',
    'Zancadas': 'Lunges',
    
    // Brazos
    'Curl con Barra': 'Barbell Curl',
    'Fondos de Tríceps': 'Tricep Dips',
    
    // Estiramientos
    'Estiramiento de Pecho': 'Chest Stretch',
    'Estiramiento de Tríceps': 'Tricep Stretch',
    'Estiramiento de Hombro': 'Shoulder Stretch',
  };
  
  // Buscar traducción exacta
  if (translations[spanishName]) {
    return translations[spanishName];
  }
  
  // Buscar traducción parcial
  for (const [spanish, english] of Object.entries(translations)) {
    if (spanishName.toLowerCase().includes(spanish.toLowerCase())) {
      return english;
    }
  }
  
  return null;
}

/**
 * Extrae keywords del nombre del ejercicio para mejorar la búsqueda
 */
function extractKeywords(exerciseName, bodyPart = null) {
  const keywords = [];
  
  // Mapeo de partes del cuerpo a keywords
  const bodyPartKeywords = {
    'pecho': 'chest workout',
    'espalda': 'back workout',
    'hombros': 'shoulder workout',
    'brazos': 'arm workout',
    'piernas': 'leg workout',
    'gluteos': 'glute workout',
    'abdomen': 'ab workout',
  };
  
  if (bodyPart && bodyPartKeywords[bodyPart]) {
    keywords.push(bodyPartKeywords[bodyPart]);
  }
  
  // Extraer palabras clave del nombre
  const nameLower = exerciseName.toLowerCase();
  if (nameLower.includes('barra') || nameLower.includes('barbell')) {
    keywords.push('barbell');
  }
  if (nameLower.includes('mancuerna') || nameLower.includes('dumbbell')) {
    keywords.push('dumbbell');
  }
  if (nameLower.includes('polea') || nameLower.includes('cable')) {
    keywords.push('cable');
  }
  if (nameLower.includes('máquina') || nameLower.includes('machine')) {
    keywords.push('machine');
  }
  
  return keywords.join(',');
}

async function getExerciseGifUrl(exerciseName, originalName = null, bodyPart = null) {
  console.log(`[ExercisesService] 🔍 Buscando GIF para ejercicio: "${exerciseName}" (original: ${originalName || 'N/A'}, bodyPart: ${bodyPart || 'N/A'})`);
  
  try {
    const rapidApiKey = process.env.RAPIDAPI_KEY;
    
    if (!rapidApiKey) {
      console.warn("[ExercisesService] ⚠️ RAPIDAPI_KEY no configurada, no se puede buscar GIF en ExerciseDB");
      return null;
    }

    // Intentar traducir el nombre al inglés
    let searchName = originalName;
    if (!searchName) {
      const translated = translateExerciseNameToEnglish(exerciseName);
      if (translated) {
        searchName = translated;
        console.log(`[ExercisesService] 🔄 Nombre traducido: "${exerciseName}" → "${searchName}"`);
      } else {
        searchName = exerciseName;
        console.log(`[ExercisesService] ⚠️ No se encontró traducción para "${exerciseName}", usando nombre original`);
      }
    }
    
    // Extraer keywords para mejorar la búsqueda
    const keywords = extractKeywords(exerciseName, bodyPart);
    console.log(`[ExercisesService] 🔍 Buscando en ExerciseDB con nombre: "${searchName}"${keywords ? `, keywords: ${keywords}` : ''}`);
    
    // Construir URL con name y keywords
    let searchUrl = `https://exercisedb-api1.p.rapidapi.com/api/v1/exercises?name=${encodeURIComponent(searchName)}&limit=5`;
    if (keywords) {
      searchUrl += `&keywords=${encodeURIComponent(keywords)}`;
    }
    console.log(`[ExercisesService] 📡 URL de búsqueda: ${searchUrl}`);
    
    const searchResponse = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'exercisedb-api1.p.rapidapi.com'
      }
    });

    console.log(`[ExercisesService] 📡 Respuesta de ExerciseDB: ${searchResponse.status} ${searchResponse.statusText}`);

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error(`[ExercisesService] ❌ Error buscando ejercicio en ExerciseDB: ${searchResponse.status} - ${errorText}`);
      return null;
    }

    const responseData = await searchResponse.json();
    console.log(`[ExercisesService] 📦 Respuesta recibida:`, JSON.stringify(responseData).substring(0, 300));
    
    // La API retorna {success, meta, data: [...]}
    let exercise = null;
    if (responseData.success && responseData.data && Array.isArray(responseData.data) && responseData.data.length > 0) {
      // Tomar el primer resultado (ya está ordenado por relevancia)
      exercise = responseData.data[0];
      console.log(`[ExercisesService] ✅ Encontrado ejercicio en data array: ${exercise.exerciseId || 'sin ID'} - "${exercise.name}"`);
      
      // Validar que el ejercicio sea relevante (el nombre debe tener alguna similitud)
      const exerciseNameLower = exercise.name.toLowerCase();
      const searchNameLower = searchName.toLowerCase();
      const searchWords = searchNameLower.split(/\s+/).filter(w => w.length > 3);
      
      // Palabras clave importantes que deben coincidir
      const importantWords = ['press', 'pull', 'row', 'deadlift', 'squat', 'curl', 'dip', 'fly', 'raise', 'stretch'];
      const hasImportantWord = importantWords.some(word => 
        searchNameLower.includes(word) && exerciseNameLower.includes(word)
      );
      
      // Verificar similitud general
      const hasRelevance = hasImportantWord || searchWords.some(word => 
        exerciseNameLower.includes(word)
      );
      
      if (!hasRelevance && responseData.data.length > 1) {
        // Buscar un resultado más relevante en los siguientes resultados
        for (let i = 1; i < Math.min(responseData.data.length, 5); i++) {
          const candidate = responseData.data[i];
          const candidateNameLower = candidate.name.toLowerCase();
          
          const candidateHasImportantWord = importantWords.some(word => 
            searchNameLower.includes(word) && candidateNameLower.includes(word)
          );
          const candidateHasRelevance = candidateHasImportantWord || searchWords.some(word => 
            candidateNameLower.includes(word)
          );
          
          if (candidateHasRelevance) {
            exercise = candidate;
            console.log(`[ExercisesService] 🔄 Usando resultado más relevante (índice ${i}): "${exercise.name}"`);
            break;
          }
        }
        
        // Si aún no hay relevancia, usar el primero pero advertir
        if (!hasRelevance) {
          console.warn(`[ExercisesService] ⚠️ Ejercicio encontrado puede no ser relevante: "${exercise.name}" para búsqueda "${searchName}"`);
        }
      }
    } else {
      console.warn(`[ExercisesService] ⚠️ Respuesta no tiene formato esperado o no hay resultados`);
      console.warn(`[ExercisesService] ⚠️ success: ${responseData.success}, data length: ${responseData.data?.length || 0}`);
    }

    if (!exercise || !exercise.exerciseId) {
      console.warn(`[ExercisesService] ⚠️ No se encontró ejercicio "${exerciseName}" en ExerciseDB`);
      console.warn(`[ExercisesService] ⚠️ Respuesta completa:`, JSON.stringify(responseData).substring(0, 500));
      return null;
    }

    // El imageUrl viene en la respuesta del ejercicio
    // Ejemplo: "https://cdn.exercisedb.dev/w/images/xPs3BlN/41n2hGNrmUnF58Yy__Reverse-Lunge-(leg-kick)_Thighs.png"
    // Esta URL es pública de CDN y puede usarse directamente
    if (exercise.imageUrl) {
      console.log(`[ExercisesService] ✅ Imagen encontrada para "${exerciseName}" (exerciseId: ${exercise.exerciseId})`);
      console.log(`[ExercisesService] 🔗 imageUrl: ${exercise.imageUrl}`);
      // Usar el imageUrl directamente (es una URL pública de CDN)
      // No necesitamos proxy ya que es una URL pública
      return exercise.imageUrl;
    }

    console.warn(`[ExercisesService] ⚠️ Ejercicio encontrado pero sin imageUrl: ${exercise.exerciseId}`);
    return null;
  } catch (error) {
    console.error(`[ExercisesService] ❌ Error buscando GIF en ExerciseDB:`, error);
    console.error(`[ExercisesService] ❌ Stack trace:`, error.stack);
    return null;
  }
}

/**
 * Busca el primer video de YouTube para un ejercicio usando YouTube Data API v3
 * Retorna el video ID o null si no se encuentra
 */
async function searchYouTubeVideo(exerciseName, language = 'es') {
  try {
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    if (!youtubeApiKey) {
      console.warn("[ExercisesService] YOUTUBE_API_KEY no configurada, usando búsqueda manual");
      return null;
    }

    // Construir query de búsqueda en español o inglés
    const searchQuery = language === 'es' 
      ? `cómo hacer ${exerciseName} gimnasio ejercicio`
      : `how to do ${exerciseName} gym exercise`;
    
    // Buscar en YouTube Data API v3
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&maxResults=1&key=${youtubeApiKey}`;
    
    const response = await fetch(searchUrl);
    
    if (!response.ok) {
      console.warn(`[ExercisesService] Error buscando video en YouTube: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      const videoId = data.items[0].id.videoId;
      console.log(`[ExercisesService] ✅ Video encontrado para "${exerciseName}": ${videoId}`);
      return videoId;
    }

    return null;
  } catch (error) {
    console.warn(`[ExercisesService] Error buscando video en YouTube:`, error.message);
    return null;
  }
}

/**
 * Genera URL de video de YouTube para un ejercicio
 * Intenta buscar automáticamente el primer video, sino genera URL de búsqueda
 */
async function getExerciseVideoUrl(exerciseName, exerciseData = null) {
  // Si ya tenemos una URL de video directa, usarla
  if (exerciseData && exerciseData.videoUrl) {
    // Si es un video ID, convertirlo a URL embed
    if (exerciseData.videoUrl && !exerciseData.videoUrl.includes('http')) {
      // Extraer video ID si viene en formato de URL
      let videoId = exerciseData.videoUrl;
      if (videoId.includes('youtube.com') || videoId.includes('youtu.be')) {
        // Extraer ID de diferentes formatos de URL
        const match = videoId.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        videoId = match ? match[1] : videoId;
      }
      // Convertir a URL de embed usando youtube-nocookie.com para evitar error 153
      return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&autoplay=0&enablejsapi=1`;
    }
    // Si ya es una URL completa de embed, normalizarla a youtube-nocookie.com
    if (exerciseData.videoUrl.includes('youtube.com/embed/') || exerciseData.videoUrl.includes('youtube-nocookie.com/embed/')) {
      const embedMatch = exerciseData.videoUrl.match(/embed\/([^"&?\/\s]{11})/);
      if (embedMatch) {
        // Normalizar a youtube-nocookie.com con parámetros correctos
        return `https://www.youtube-nocookie.com/embed/${embedMatch[1]}?rel=0&modestbranding=1&playsinline=1&autoplay=0&enablejsapi=1`;
      }
    }
    // Si es una URL de watch, convertir a embed
    if (exerciseData.videoUrl.includes('youtube.com/watch') || exerciseData.videoUrl.includes('youtu.be/')) {
      const videoIdMatch = exerciseData.videoUrl.match(/(?:watch\?v=|youtu\.be\/)([^"&?\/\s]{11})/);
      if (videoIdMatch) {
        // Convertir a URL de embed usando youtube-nocookie.com
        return `https://www.youtube-nocookie.com/embed/${videoIdMatch[1]}?rel=0&modestbranding=1&playsinline=1&autoplay=0&enablejsapi=1`;
      }
    }
    return exerciseData.videoUrl;
  }

  // Intentar buscar automáticamente el primer video en YouTube
  const videoId = await searchYouTubeVideo(exerciseName, 'es');
  
  if (videoId) {
    // Retornar URL de embed usando youtube-nocookie.com que es más permisivo
    // y evita problemas de cookies/privacy que pueden causar el error 153
    // Parámetros importantes:
    // - rel=0: no muestra videos relacionados
    // - modestbranding=1: reduce branding
    // - playsinline=1: permite reproducción inline en móviles
    // - autoplay=0: no reproduce automáticamente
    // - enablejsapi=1: permite usar la API de JavaScript
    return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&autoplay=0&enablejsapi=1`;
  }

  // Fallback: URL de búsqueda de YouTube (no embed, sino página de resultados)
  const searchQuery = encodeURIComponent(`${exerciseName} ejercicio tutorial`);
  return `https://www.youtube.com/results?search_query=${searchQuery}`;
}

export {
  loadExercisesDataset,
  getExercisesByBodyPart,
  searchExerciseByName,
  getExerciseVideoUrl,
  getExerciseGifUrl,
  BODY_PART_TO_MUSCLES
};

