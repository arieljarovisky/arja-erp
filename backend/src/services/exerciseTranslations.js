// src/services/exerciseTranslations.js
// Traducciones de ejercicios, músculos y equipos al español

// Traducción de nombres de ejercicios comunes
export const EXERCISE_NAME_TRANSLATIONS = {
  // Brazos
  'Barbell Curl': 'Curl con Barra',
  'Dumbbell Curl': 'Curl con Mancuernas',
  'Hammer Curl': 'Curl Martillo',
  'Alternate Hammer Curl': 'Curl Martillo Alterno',
  'Tricep Dips': 'Fondos de Tríceps',
  'Close Grip Barbell Bench Press': 'Press de Banca Agarre Cerrado',
  'Overhead Tricep Extension': 'Extensión de Tríceps por Encima',
  'Tricep Pushdown': 'Jalón de Tríceps',
  
  // Pecho
  'Barbell Bench Press': 'Press de Banca con Barra',
  'Dumbbell Bench Press': 'Press de Banca con Mancuernas',
  'Push Up': 'Flexiones',
  'Incline Dumbbell Press': 'Press Inclinado con Mancuernas',
  'Decline Barbell Bench Press': 'Press Declinado con Barra',
  'Cable Crossover': 'Aperturas con Polea',
  'Dumbbell Flyes': 'Aperturas con Mancuernas',
  
  // Espalda
  'Barbell Row': 'Remo con Barra',
  'Dumbbell Row': 'Remo con Mancuerna',
  'Pull Up': 'Dominadas',
  'Lat Pulldown': 'Jalón al Pecho',
  'T-Bar Row': 'Remo T',
  'Seated Cable Row': 'Remo Sentado con Polea',
  'One Arm Dumbbell Row': 'Remo a Un Brazo',
  'Deadlift': 'Peso Muerto',
  'Romanian Deadlift': 'Peso Muerto Rumano',
  'Bent Over Barbell Row': 'Remo Inclinado con Barra',
  
  // Hombros
  'Barbell Shoulder Press': 'Press de Hombros con Barra',
  'Dumbbell Shoulder Press': 'Press de Hombros con Mancuernas',
  'Lateral Raise': 'Elevación Lateral',
  'Front Raise': 'Elevación Frontal',
  'Rear Delt Raise': 'Elevación Posterior',
  'Arnold Press': 'Press Arnold',
  'Upright Row': 'Remo Vertical',
  'Cable Lateral Raise': 'Elevación Lateral con Polea',
  
  // Piernas
  'Barbell Squat': 'Sentadillas con Barra',
  'Dumbbell Squat': 'Sentadillas con Mancuernas',
  'Leg Press': 'Prensa de Piernas',
  'Leg Extension': 'Extensión de Piernas',
  'Lunges': 'Zancadas',
  'Bulgarian Split Squat': 'Sentadilla Búlgara',
  'Front Squat': 'Sentadilla Frontal',
  'Goblet Squat': 'Sentadilla Goblet',
  'Leg Curl': 'Curl de Piernas',
  'Stiff Leg Deadlift': 'Peso Muerto Piernas Rígidas',
  'Good Morning': 'Buenos Días',
  'Hip Thrust': 'Empuje de Cadera',
  'Glute Bridge': 'Puente de Glúteos',
  'Calf Raise': 'Elevación de Gemelos',
  'Standing Calf Raise': 'Elevación de Gemelos de Pie',
  'Seated Calf Raise': 'Elevación de Gemelos Sentado',
  
  // Abdomen
  'Crunch': 'Abdominales',
  'Sit Up': 'Abdominales Completos',
  'Plank': 'Plancha',
  'Russian Twist': 'Giro Ruso',
  'Leg Raise': 'Elevación de Piernas',
  'Bicycle Crunch': 'Abdominales Bicicleta',
  'Mountain Climber': 'Escalador',
  'Ab Crunch Machine': 'Máquina de Abdominales',
  'Hanging Leg Raise': 'Elevación de Piernas Colgado',
  'Cable Crunch': 'Abdominales con Polea',
  'Side Plank': 'Plancha Lateral',
  
  // Cardio
  'Running': 'Correr',
  'Jumping Jack': 'Salto de Tijera',
  'Burpee': 'Burpees',
  'High Knees': 'Rodillas al Pecho',
  'Jump Rope': 'Saltar la Cuerda',
  'Box Jump': 'Salto al Cajón',
  'Sprint': 'Sprint',
  'Air Bike': 'Bicicleta de Aire',
  'Rowing Machine': 'Remo en Máquina',
  
  // Full Body
  'Thruster': 'Thruster',
  'Clean And Jerk': 'Cargada y Envión',
  'Snatch': 'Arranque',
  'Kettlebell Swing': 'Balanceo con Kettlebell',
};

// Traducción de músculos
export const MUSCLE_TRANSLATIONS = {
  'biceps': 'Bíceps',
  'triceps': 'Tríceps',
  'forearms': 'Antebrazos',
  'pectorals': 'Pectorales',
  'chest': 'Pecho',
  'lats': 'Dorsales',
  'middle back': 'Espalda Media',
  'lower back': 'Espalda Baja',
  'traps': 'Trapecios',
  'rhomboids': 'Romboides',
  'shoulders': 'Hombros',
  'delts': 'Deltoides',
  'rear delts': 'Deltoides Posterior',
  'quadriceps': 'Cuádriceps',
  'hamstrings': 'Isquiotibiales',
  'calves': 'Gemelos',
  'glutes': 'Glúteos',
  'abdominals': 'Abdominales',
  'abs': 'Abdominales',
  'core': 'Core',
  'obliques': 'Oblicuos',
};

// Traducción de equipos
export const EQUIPMENT_TRANSLATIONS = {
  'barbell': 'Barra',
  'dumbbell': 'Mancuernas',
  'body only': 'Solo Cuerpo',
  'cable': 'Polea',
  'machine': 'Máquina',
  'kettlebell': 'Kettlebell',
  'bands': 'Bandas',
  'medicine ball': 'Balón Medicinal',
  'ez barbell': 'Barra EZ',
  'other': 'Otro',
};

// Traducción de categorías
export const CATEGORY_TRANSLATIONS = {
  'strength': 'Fuerza',
  'cardio': 'Cardio',
  'stretching': 'Estiramiento',
  'powerlifting': 'Powerlifting',
  'strongman': 'Strongman',
  'olympic weightlifting': 'Halterofilia Olímpica',
  'plyometrics': 'Pliometría',
};

// Traducción de niveles
export const LEVEL_TRANSLATIONS = {
  'beginner': 'Principiante',
  'intermediate': 'Intermedio',
  'expert': 'Avanzado',
};

/**
 * Traduce el nombre de un ejercicio al español
 */
export function translateExerciseName(name) {
  if (!name) return name;
  
  // Buscar traducción exacta
  if (EXERCISE_NAME_TRANSLATIONS[name]) {
    return EXERCISE_NAME_TRANSLATIONS[name];
  }
  
  // Buscar traducción parcial (para variaciones)
  for (const [english, spanish] of Object.entries(EXERCISE_NAME_TRANSLATIONS)) {
    if (name.toLowerCase().includes(english.toLowerCase()) || 
        english.toLowerCase().includes(name.toLowerCase())) {
      return spanish;
    }
  }
  
  // Si no hay traducción, intentar traducir palabras comunes
  let translated = name;
  translated = translated.replace(/Barbell/gi, 'Barra');
  translated = translated.replace(/Dumbbell/gi, 'Mancuernas');
  translated = translated.replace(/Curl/gi, 'Curl');
  translated = translated.replace(/Press/gi, 'Press');
  translated = translated.replace(/Squat/gi, 'Sentadilla');
  translated = translated.replace(/Deadlift/gi, 'Peso Muerto');
  translated = translated.replace(/Raise/gi, 'Elevación');
  translated = translated.replace(/Extension/gi, 'Extensión');
  translated = translated.replace(/Row/gi, 'Remo');
  translated = translated.replace(/Pull/gi, 'Jalón');
  translated = translated.replace(/Push/gi, 'Empuje');
  translated = translated.replace(/Dip/gi, 'Fondos');
  translated = translated.replace(/Fly/gi, 'Aperturas');
  translated = translated.replace(/Lunge/gi, 'Zancada');
  translated = translated.replace(/Crunch/gi, 'Abdominales');
  translated = translated.replace(/Plank/gi, 'Plancha');
  translated = translated.replace(/Bridge/gi, 'Puente');
  translated = translated.replace(/Thrust/gi, 'Empuje');
  translated = translated.replace(/Swing/gi, 'Balanceo');
  translated = translated.replace(/Jump/gi, 'Salto');
  translated = translated.replace(/Run/gi, 'Correr');
  translated = translated.replace(/Alternate/gi, 'Alterno');
  translated = translated.replace(/Incline/gi, 'Inclinado');
  translated = translated.replace(/Decline/gi, 'Declinado');
  translated = translated.replace(/Seated/gi, 'Sentado');
  translated = translated.replace(/Standing/gi, 'De Pie');
  translated = translated.replace(/Hanging/gi, 'Colgado');
  translated = translated.replace(/Close Grip/gi, 'Agarre Cerrado');
  translated = translated.replace(/Wide Grip/gi, 'Agarre Amplio');
  
  return translated;
}

/**
 * Traduce músculos al español
 */
export function translateMuscles(muscles) {
  if (!muscles || !Array.isArray(muscles)) return muscles;
  
  return muscles.map(muscle => {
    const lowerMuscle = muscle.toLowerCase();
    return MUSCLE_TRANSLATIONS[lowerMuscle] || 
           MUSCLE_TRANSLATIONS[muscle] || 
           muscle;
  });
}

/**
 * Traduce equipo al español
 */
export function translateEquipment(equipment) {
  if (!equipment) return equipment;
  
  const lowerEquipment = equipment.toLowerCase();
  return EQUIPMENT_TRANSLATIONS[lowerEquipment] || 
         EQUIPMENT_TRANSLATIONS[equipment] || 
         equipment;
}

/**
 * Traduce instrucciones al español
 */
export function translateInstructions(instructions) {
  if (!instructions || !Array.isArray(instructions)) return instructions;
  
  // Traducciones comunes de frases en instrucciones
  const commonPhrases = {
    'Stand up': 'Párate',
    'Sit down': 'Siéntate',
    'Lie down': 'Acuéstate',
    'Hold': 'Sostén',
    'Lift': 'Levanta',
    'Lower': 'Baja',
    'Push': 'Empuja',
    'Pull': 'Jala',
    'Squeeze': 'Contrae',
    'Release': 'Relaja',
    'Repeat': 'Repite',
    'Breathe in': 'Inhala',
    'Breathe out': 'Exhala',
    'Keep': 'Mantén',
    'Slowly': 'Lentamente',
    'Quickly': 'Rápidamente',
    'Control': 'Controla',
    'Focus': 'Enfócate',
    'Make sure': 'Asegúrate',
    'Avoid': 'Evita',
    'Start': 'Comienza',
    'Finish': 'Termina',
    'Position': 'Posición',
    'Movement': 'Movimiento',
    'Exercise': 'Ejercicio',
    'Repetitions': 'Repeticiones',
    'Sets': 'Series',
    'Rest': 'Descansa',
    'Seconds': 'Segundos',
    'Minutes': 'Minutos',
  };
  
  return instructions.map(instruction => {
    let translated = instruction;
    
    // Reemplazar frases comunes
    for (const [english, spanish] of Object.entries(commonPhrases)) {
      const regex = new RegExp(`\\b${english}\\b`, 'gi');
      translated = translated.replace(regex, spanish);
    }
    
    // Traducciones específicas
    translated = translated.replace(/This will be your starting position/gi, 'Esta será tu posición inicial');
    translated = translated.replace(/starting position/gi, 'posición inicial');
    translated = translated.replace(/recommended amount of repetitions/gi, 'cantidad recomendada de repeticiones');
    translated = translated.replace(/for the recommended/gi, 'por la cantidad recomendada');
    translated = translated.replace(/while contracting/gi, 'mientras contraes');
    translated = translated.replace(/fully contracted/gi, 'completamente contraído');
    translated = translated.replace(/slowly begin/gi, 'comienza lentamente');
    translated = translated.replace(/return to/gi, 'regresa a');
    
    return translated;
  });
}

/**
 * Obtiene el nombre original en inglés de un ejercicio traducido
 */
export function getOriginalEnglishName(spanishName) {
  if (!spanishName) return null;
  
  // Buscar en el diccionario de traducciones (inverso)
  for (const [english, spanish] of Object.entries(EXERCISE_NAME_TRANSLATIONS)) {
    if (spanish === spanishName || spanish.toLowerCase() === spanishName.toLowerCase()) {
      return english;
    }
  }
  
  // Si no se encuentra, intentar revertir traducciones comunes
  let english = spanishName;
  english = english.replace(/Curl con Barra/gi, 'Barbell Curl');
  english = english.replace(/Curl con Mancuernas/gi, 'Dumbbell Curl');
  english = english.replace(/Press de Banca/gi, 'Bench Press');
  english = english.replace(/Flexiones/gi, 'Push Up');
  english = english.replace(/Sentadillas/gi, 'Squat');
  english = english.replace(/Peso Muerto/gi, 'Deadlift');
  english = english.replace(/Elevación/gi, 'Raise');
  english = english.replace(/Remo/gi, 'Row');
  
  return english;
}

/**
 * Traduce un ejercicio completo al español
 */
export function translateExercise(exercise) {
  if (!exercise) return exercise;
  
  const originalName = exercise.name; // Guardar nombre original
  const originalPrimaryMuscles = exercise.primaryMuscles || []; // Guardar músculos originales
  const originalSecondaryMuscles = exercise.secondaryMuscles || []; // Guardar músculos originales
  
  return {
    ...exercise,
    name: translateExerciseName(exercise.name),
    name_en: originalName, // Guardar nombre original en inglés para búsquedas
    primaryMuscles: translateMuscles(exercise.primaryMuscles),
    primaryMuscles_en: originalPrimaryMuscles, // Guardar músculos originales en inglés para filtrado
    secondaryMuscles: translateMuscles(exercise.secondaryMuscles),
    secondaryMuscles_en: originalSecondaryMuscles, // Guardar músculos originales en inglés para filtrado
    equipment: translateEquipment(exercise.equipment),
    category: CATEGORY_TRANSLATIONS[exercise.category?.toLowerCase()] || exercise.category,
    level: LEVEL_TRANSLATIONS[exercise.level?.toLowerCase()] || exercise.level,
    instructions: translateInstructions(exercise.instructions),
  };
}

