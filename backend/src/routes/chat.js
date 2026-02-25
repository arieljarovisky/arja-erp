// src/routes/chat.js
import { Router } from "express";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const chat = Router();

// Determinar qué proveedor de IA usar
const AI_PROVIDER = process.env.AI_PROVIDER || "gemini"; // "openai" | "gemini" | "groq" | "none"

// Inicializar proveedores de IA
let openai = null;
let gemini = null;
let geminiModel = null;

try {
  // OpenAI (de pago, pero mejor calidad)
  if (process.env.OPENAI_API_KEY && AI_PROVIDER === "openai") {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log("[Chat] OpenAI configurado");
  }
  
  // Google Gemini (GRATIS - 60 requests/minuto)
  if (process.env.GEMINI_API_KEY && (AI_PROVIDER === "gemini" || !openai)) {
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log("[Chat] Google Gemini inicializado (GRATIS)");
  }
} catch (error) {
  console.warn("[Chat] Error al configurar IA:", error.message);
}

// Contexto del sistema para el asistente
const SYSTEM_PROMPT = `Eres un asistente virtual de ARJA ERP, un sistema de gestión empresarial completo.

Tu función es ayudar a los clientes potenciales y usuarios con:
- Información sobre las funcionalidades del sistema (gestión de turnos, clientes, pagos, stock, facturación)
- Preguntas sobre planes y precios
- Cómo comenzar a usar el sistema
- Resolución de dudas técnicas básicas

IMPORTANTE:
- Sé amable, profesional y conciso
- Si no sabes algo, sugiere contactar por WhatsApp o email
- Responde en español argentino
- No inventes funcionalidades que no existen
- Si preguntan por precios, menciona que hay planes desde $14.900/mes con prueba gratuita de 14 días
- Si preguntan por características, menciona: gestión de turnos, base de clientes, pagos con Mercado Pago, notificaciones automáticas, WhatsApp bot, control de stock, facturación AFIP/ARCA

Si la pregunta es muy técnica o requiere atención personalizada, sugiere contactar directamente.`;

/**
 * POST /api/chat/message
 * Envía un mensaje al asistente de IA
 */
chat.post("/message", async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        error: "El mensaje es requerido",
      });
    }

    // Construir el historial de conversación
    const userMessage = message.trim();
    let aiResponse = null;
    let fromAI = false;

    // Intentar usar IA según el proveedor configurado
    if (openai && AI_PROVIDER === "openai") {
      // OpenAI (de pago)
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...conversationHistory.slice(-10),
        { role: "user", content: userMessage },
      ];

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
      });

      aiResponse = completion.choices[0]?.message?.content;
      fromAI = true;
    } else if (gemini) {
      // Google Gemini (GRATIS)
      try {
        // Listar modelos disponibles usando la API REST directamente
        let availableModels = [];
        try {
          const apiKey = process.env.GEMINI_API_KEY;
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
          );
          
          if (response.ok) {
            const data = await response.json();
            availableModels = data.models?.map(m => m.name.replace('models/', '')) || [];
            console.log("[Chat] ✅ Modelos Gemini disponibles:", availableModels);
          } else {
            const errorData = await response.json();
            console.warn("[Chat] ⚠️ No se pudieron listar modelos:", errorData.error?.message || response.statusText);
            
            // Si es 403, la API no está habilitada
            if (response.status === 403) {
              throw new Error("La API Generative Language no está habilitada. Ve a https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com y habilítala.");
            }
          }
        } catch (listError) {
          console.warn("[Chat] ⚠️ Error al listar modelos:", listError.message);
        }
        
        // Intentar diferentes modelos hasta encontrar uno que funcione
        // Si tenemos modelos disponibles, usar solo esos
        const defaultModels = [
          "gemini-1.5-flash",
          "gemini-1.5-pro", 
          "gemini-pro",
          "gemini-1.5-flash-latest",
          "gemini-1.5-pro-latest",
        ];
        
        const modelNames = availableModels.length > 0
          ? [process.env.GEMINI_MODEL, ...availableModels].filter(Boolean)
          : [process.env.GEMINI_MODEL, ...defaultModels].filter(Boolean);
        
        // Si tenemos lista de modelos disponibles, usar solo esos
        const modelsToTry = availableModels.length > 0 
          ? modelNames.filter(name => 
              availableModels.some(available => 
                available.includes(name) || name.includes(available.split('/').pop())
              )
            )
          : modelNames;
        
        let model = null;
        let workingModelName = null;
        let lastError = null;
        
        // Probar cada modelo
        for (const modelName of modelsToTry.length > 0 ? modelsToTry : modelNames) {
          try {
            model = gemini.getGenerativeModel({ model: modelName });
            // Hacer una prueba rápida con un prompt simple
            const testResult = await model.generateContent("Hola");
            const testResponse = await testResult.response;
            const testText = testResponse.text();
            
            if (testText) {
              workingModelName = modelName;
              console.log(`[Chat] ✅ Modelo Gemini funcionando: ${modelName}`);
              break;
            }
          } catch (testError) {
            lastError = testError;
            console.warn(`[Chat] ❌ Modelo ${modelName} falló:`, testError.message);
            model = null;
          }
        }
        
        if (!model) {
          console.error("[Chat] ❌ No se encontró ningún modelo de Gemini disponible");
          console.error("[Chat] Último error:", lastError?.message);
          if (availableModels.length > 0) {
            console.error("[Chat] Modelos disponibles según API:", availableModels);
          }
          throw new Error("No se encontró ningún modelo de Gemini disponible. Verifica tu API key y que la API esté habilitada.");
        }
        
        // Construir el prompt completo
        let fullPrompt = SYSTEM_PROMPT + "\n\n";
        
        // Agregar historial de conversación
        conversationHistory.slice(-10).forEach(msg => {
          if (msg.role === "user") {
            fullPrompt += `Usuario: ${msg.content}\n`;
          } else if (msg.role === "assistant") {
            fullPrompt += `Asistente: ${msg.content}\n`;
          }
        });
        
        fullPrompt += `Usuario: ${userMessage}\nAsistente:`;

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        aiResponse = response.text();
        fromAI = true;
      } catch (geminiError) {
        console.error("[Chat] Error con Gemini:", geminiError.message);
        console.error("[Chat] Stack:", geminiError.stack);
        // Fallback a respuesta por defecto
      }
    } else if (AI_PROVIDER === "groq" && process.env.GROQ_API_KEY) {
      // Groq (GRATIS - muy rápido)
      try {
        const { default: Groq } = await import("groq-sdk");
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        
        const messages = [
          { role: "system", content: SYSTEM_PROMPT },
          ...conversationHistory.slice(-10),
          { role: "user", content: userMessage },
        ];

        const completion = await groq.chat.completions.create({
          model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
          messages: messages,
          temperature: 0.7,
          max_tokens: 500,
        });

        aiResponse = completion.choices[0]?.message?.content;
        fromAI = true;
      } catch (groqError) {
        console.error("[Chat] Error con Groq:", groqError);
        // Fallback a respuesta por defecto
      }
    }

    // Si no hay respuesta de IA, usar respuesta por defecto
    if (!aiResponse) {
      console.warn("[Chat] No hay IA configurada, usando respuesta por defecto");
      aiResponse = "Gracias por tu mensaje. Para una atención más personalizada, te recomiendo contactarnos directamente por WhatsApp o email. Nuestro equipo te responderá pronto.";
      fromAI = false;
    }

    res.json({
      response: aiResponse,
      fromAI: fromAI,
    });
  } catch (error) {
    console.error("[Chat] Error al procesar mensaje:", error);

    // Si es un error de API de OpenAI, devolver mensaje amigable
    if (error.response?.status === 401) {
      return res.status(500).json({
        error: "Error de configuración del servicio de IA. Por favor, contacta directamente por WhatsApp o email.",
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: "El servicio de IA está temporalmente sobrecargado. Por favor, intenta nuevamente en unos momentos o contacta directamente por WhatsApp.",
      });
    }

    // Error genérico
    res.status(500).json({
      error: "Error al procesar tu mensaje. Por favor, contacta directamente por WhatsApp o email.",
    });
  }
});

/**
 * GET /api/chat/diagnose
 * Endpoint de diagnóstico para verificar la configuración de Gemini
 */
chat.get("/diagnose", async (req, res) => {
  try {
    if (!gemini) {
      return res.json({
        error: "Gemini no está inicializado",
        geminiApiKey: process.env.GEMINI_API_KEY ? "Configurada" : "No configurada",
      });
    }

    const diagnostics = {
      geminiInitialized: gemini !== null,
      apiKeyConfigured: !!process.env.GEMINI_API_KEY,
      apiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
      provider: AI_PROVIDER,
    };

    // Intentar listar modelos
    try {
      // Nota: listModels() puede no estar disponible en todas las versiones
      // Intentamos usar el método si existe
      if (typeof gemini.listModels === 'function') {
        const models = await gemini.listModels();
        diagnostics.availableModels = models.map(m => m.name || m);
      } else {
        diagnostics.availableModels = "listModels() no disponible en esta versión";
      }
    } catch (listError) {
      diagnostics.listModelsError = listError.message;
    }

    // Probar modelos comunes
    const testModels = ["gemini-pro", "gemini-1.5-flash", "gemini-1.5-pro"];
    diagnostics.modelTests = {};

    for (const modelName of testModels) {
      try {
        const testModel = gemini.getGenerativeModel({ model: modelName });
        const testResult = await testModel.generateContent("test");
        const testResponse = await testResult.response;
        diagnostics.modelTests[modelName] = {
          available: true,
          response: testResponse.text().substring(0, 50) + "...",
        };
      } catch (error) {
        diagnostics.modelTests[modelName] = {
          available: false,
          error: error.message,
        };
      }
    }

    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({
      error: "Error en diagnóstico",
      message: error.message,
    });
  }
});

/**
 * GET /api/chat/diagnose
 * Endpoint de diagnóstico para verificar la configuración de Gemini
 */
chat.get("/diagnose", async (req, res) => {
  try {
    if (!gemini) {
      return res.json({
        error: "Gemini no está inicializado",
        geminiApiKey: process.env.GEMINI_API_KEY ? "Configurada" : "No configurada",
        aiProvider: AI_PROVIDER,
      });
    }

    const diagnostics = {
      geminiInitialized: gemini !== null,
      apiKeyConfigured: !!process.env.GEMINI_API_KEY,
      apiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
      provider: AI_PROVIDER,
    };

    // Probar modelos comunes
    const testModels = ["gemini-pro", "gemini-1.5-flash", "gemini-1.5-pro"];
    diagnostics.modelTests = {};

    for (const modelName of testModels) {
      try {
        const testModel = gemini.getGenerativeModel({ model: modelName });
        const testResult = await testModel.generateContent("Hola");
        const testResponse = await testResult.response;
        diagnostics.modelTests[modelName] = {
          available: true,
          response: testResponse.text().substring(0, 50) + "...",
        };
      } catch (error) {
        diagnostics.modelTests[modelName] = {
          available: false,
          error: error.message,
        };
      }
    }

    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({
      error: "Error en diagnóstico",
      message: error.message,
    });
  }
});

/**
 * GET /api/chat/status
 * Verifica si el servicio de IA está disponible
 */
chat.get("/status", async (req, res) => {
  const available = openai !== null || gemini !== null || (AI_PROVIDER === "groq" && process.env.GROQ_API_KEY);
  
  let provider = "none";
  let model = "none";
  
  if (openai && AI_PROVIDER === "openai") {
    provider = "openai";
    model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
  } else if (gemini) {
    provider = "gemini";
    model = process.env.GEMINI_MODEL || "gemini-pro";
  } else if (AI_PROVIDER === "groq" && process.env.GROQ_API_KEY) {
    provider = "groq";
    model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  }
  
  res.json({
    available,
    provider,
    model,
    isFree: provider === "gemini" || provider === "groq",
  });
});

