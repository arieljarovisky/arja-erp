// Script para descargar todos los ejercicios del dataset wrkout/exercises.json
// Uso: node scripts/download-exercises.js

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXERCISES_DIR = path.join(__dirname, "../data/exercises");
const EXERCISES_JSON = path.join(__dirname, "../data/exercises.json");
const GITHUB_API_BASE = "https://api.github.com/repos/wrkout/exercises.json/contents/exercises";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/wrkout/exercises.json/master/exercises";

async function downloadExercises() {
  try {
    console.log("📥 Descargando lista de ejercicios desde GitHub...");
    
    // Crear directorio si no existe
    if (!fs.existsSync(EXERCISES_DIR)) {
      fs.mkdirSync(EXERCISES_DIR, { recursive: true });
      console.log("✅ Directorio creado:", EXERCISES_DIR);
    }

    // Obtener lista de ejercicios desde GitHub API
    const response = await fetch(GITHUB_API_BASE);
    if (!response.ok) {
      throw new Error(`Error al obtener lista: ${response.status} ${response.statusText}`);
    }

    const files = await response.json();
    const exerciseFiles = files.filter(f => f.type === "dir");
    
    console.log(`📊 Encontrados ${exerciseFiles.length} ejercicios`);

    const allExercises = [];
    let successCount = 0;
    let errorCount = 0;

    // Descargar cada ejercicio
    for (let i = 0; i < exerciseFiles.length; i++) {
      const exerciseDir = exerciseFiles[i];
      const exerciseName = exerciseDir.name;
      
      try {
        // Intentar descargar el archivo exercise.json
        const exerciseUrl = `${GITHUB_RAW_BASE}/${exerciseName}/exercise.json`;
        const exerciseResponse = await fetch(exerciseUrl);
        
        if (exerciseResponse.ok) {
          const exercise = await exerciseResponse.json();
          // Agregar ID basado en el nombre del directorio
          exercise.id = exerciseName;
          allExercises.push(exercise);
          successCount++;
          
          if ((i + 1) % 50 === 0) {
            console.log(`⏳ Procesados ${i + 1}/${exerciseFiles.length} ejercicios...`);
          }
        } else {
          console.warn(`⚠️  No se pudo descargar ${exerciseName}: ${exerciseResponse.status}`);
          errorCount++;
        }
      } catch (error) {
        console.warn(`⚠️  Error descargando ${exerciseName}:`, error.message);
        errorCount++;
      }
    }

    // Guardar todos los ejercicios en un solo archivo JSON
    console.log("\n💾 Guardando ejercicios en exercises.json...");
    fs.writeFileSync(EXERCISES_JSON, JSON.stringify(allExercises, null, 2), "utf-8");
    
    console.log("\n✅ Descarga completada!");
    console.log(`   ✅ Exitosos: ${successCount}`);
    console.log(`   ❌ Errores: ${errorCount}`);
    console.log(`   📁 Archivo guardado en: ${EXERCISES_JSON}`);
    console.log(`   📊 Total de ejercicios: ${allExercises.length}`);
    
  } catch (error) {
    console.error("❌ Error descargando ejercicios:", error.message);
    process.exit(1);
  }
}

// Ejecutar
downloadExercises();

