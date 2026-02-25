import { useState, useEffect } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { chatConfig } from "../config/chatConfig";
import apiClient from "../api/client";
import { logger } from "../utils/logger.js";

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      text: chatConfig.botMessages.greeting,
      sender: "bot",
      timestamp: new Date(),
      fromAI: false,
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);

  // Configuración desde archivo de config
  const supportEmail = chatConfig.supportEmail;

  // Verificar si la IA está disponible al montar el componente
  useEffect(() => {
    const checkAIAvailability = async () => {
      try {
        const response = await apiClient.get("/api/chat/status");
        setAiAvailable(response.data?.available || false);
      } catch (error) {
        logger.warn("[Chat] No se pudo verificar disponibilidad de IA:", error);
        setAiAvailable(false);
      }
    };
    checkAIAvailability();
  }, []);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessageText = inputMessage.trim();
    
    // Agregar mensaje del usuario
    const userMessage = {
      id: messages.length + 1,
      text: userMessageText,
      sender: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    try {
      // Preparar historial de conversación (solo últimos mensajes)
      const conversationHistory = messages
        .filter((msg) => msg.sender !== "bot" || msg.fromAI)
        .slice(-10)
        .map((msg) => ({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.text,
        }));

      // Llamar a la API de chat con IA
      const response = await apiClient.post("/api/chat/message", {
        message: userMessageText,
        conversationHistory,
      });

      const botResponse = {
        id: messages.length + 2,
        text: response.data.response || chatConfig.botMessages.defaultResponse,
        sender: "bot",
        timestamp: new Date(),
        fromAI: response.data.fromAI || false,
      };

      setMessages((prev) => [...prev, botResponse]);
    } catch (error) {
      logger.error("[Chat] Error al enviar mensaje:", error);
      
      // Respuesta de fallback
      const botResponse = {
        id: messages.length + 2,
        text: error.response?.data?.error || 
              chatConfig.botMessages.defaultResponse,
        sender: "bot",
        timestamp: new Date(),
        fromAI: false,
      };

      setMessages((prev) => [...prev, botResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <>
      {/* Botón flotante del chat */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-[70] w-14 h-14 bg-primary text-white rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all flex items-center justify-center sm:bottom-6 sm:right-6"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Abrir chat de soporte"
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <MessageCircle className="w-6 h-6" />
        )}
        {!isOpen && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
        )}
      </motion.button>

      {/* Ventana del chat */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Overlay para mobile, permite cerrar tocando fuera */}
            <motion.div
              className="fixed inset-0 z-[65] bg-black/40 sm:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
            />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-0 right-0 left-0 top-0 sm:bottom-24 sm:right-6 sm:left-auto sm:top-auto z-[70] w-full h-full sm:w-96 sm:h-[500px] sm:max-h-[calc(100vh-8rem)] sm:max-w-[calc(100vw-1.5rem)] bg-background border-0 sm:border border-border rounded-none sm:rounded-lg shadow-2xl flex flex-col"
          >
            {/* Header del chat */}
            <div className="bg-primary text-white p-4 rounded-t-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Soporte ARJA ERP</h3>
                  <p className="text-xs text-white/80">Generalmente respondemos en minutos</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-white/80 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-full"
                aria-label="Cerrar chat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.sender === "user"
                        ? "bg-primary text-white"
                        : "bg-background-secondary text-foreground border border-border"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p
                        className={`text-xs ${
                          message.sender === "user"
                            ? "text-white/70"
                            : "text-foreground-muted"
                        }`}
                      >
                        {message.timestamp.toLocaleTimeString("es-AR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      {message.fromAI && (
                        <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full">
                          IA
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-background-secondary text-foreground border border-border rounded-lg px-4 py-2 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Escribiendo...</span>
                  </div>
                </div>
              )}
            </div>


            {/* Botón para cerrar en mobile */}
            <div className="sm:hidden p-4 border-t border-border bg-background">
              <button
                onClick={() => setIsOpen(false)}
                className="w-full py-2 border border-border rounded-lg text-foreground hover:bg-background-secondary transition-colors"
              >
                Cerrar chat
              </button>
            </div>

            {/* Input del mensaje */}
            <div className="p-4 border-t border-border sm:border-t">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Escribe tu mensaje..."
                  className="flex-1 px-4 py-2 bg-background-secondary border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isLoading}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label="Enviar mensaje"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-foreground-muted mt-2 text-center">
                {aiAvailable 
                  ? "💬 Asistente IA activo • O contáctanos por email para atención personalizada"
                  : "O contáctanos directamente por email para respuesta inmediata"
                }
              </p>
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

