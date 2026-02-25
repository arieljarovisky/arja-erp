import React, { useEffect, useState } from "react";
import { apiClient } from "../api";
import { useQuery } from "../shared/useQuery.js";
import { toast } from "sonner";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Save, Loader2, X, Image as ImageIcon } from "lucide-react";

export default function WorkoutRoutineEditPage() {
  const { id, tenantSlug } = useParams();
  const navigate = useNavigate();
  const [routine, setRoutine] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [warmup, setWarmup] = useState([]);
  const [cooldown, setCooldown] = useState([]);
  const [saving, setSaving] = useState(false);
  const [editingExercise, setEditingExercise] = useState(null);
  const [uploadingImage, setUploadingImage] = useState({ section: null, index: null });

  const { data, loading, error, refetch } = useQuery(
    (signal) => apiClient.getWorkoutRoutine(id),
    [id]
  );

  useEffect(() => {
    if (data) {
      setRoutine(data);
      // El backend devuelve exercises, warmup, cooldown directamente
      setExercises(data.exercises || []);
      setWarmup(data.warmup || []);
      setCooldown(data.cooldown || []);
    }
  }, [data]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const exercisesData = {
        exercises,
        warmup,
        cooldown,
      };

      await apiClient.updateWorkoutRoutine(id, {
        exercises_data: exercisesData,
      });

      toast.success("Rutina actualizada correctamente");
      await refetch();
    } catch (error) {
      console.error("Error guardando rutina:", error);
      toast.error(error?.response?.data?.error || "Error al guardar la rutina");
    } finally {
      setSaving(false);
    }
  };

  const addExercise = (section) => {
    const newExercise = {
      name: "",
      body_part: "",
      sets: 3,
      reps: "10",
      rest_seconds: 60,
      description: "",
      tips: "",
      video_url: "",
      image_url: "",
    };

    if (section === "exercises") {
      setExercises([...exercises, newExercise]);
      setEditingExercise({ section: "exercises", index: exercises.length });
    } else if (section === "warmup") {
      setWarmup([...warmup, newExercise]);
      setEditingExercise({ section: "warmup", index: warmup.length });
    } else if (section === "cooldown") {
      setCooldown([...cooldown, newExercise]);
      setEditingExercise({ section: "cooldown", index: cooldown.length });
    }
  };

  const updateExercise = (section, index, field, value) => {
    if (section === "exercises") {
      const updated = [...exercises];
      updated[index] = { ...updated[index], [field]: value };
      setExercises(updated);
    } else if (section === "warmup") {
      const updated = [...warmup];
      updated[index] = { ...updated[index], [field]: value };
      setWarmup(updated);
    } else if (section === "cooldown") {
      const updated = [...cooldown];
      updated[index] = { ...updated[index], [field]: value };
      setCooldown(updated);
    }
  };

  const deleteExercise = (section, index) => {
    if (window.confirm("¿Estás seguro de que deseas eliminar este ejercicio?")) {
      if (section === "exercises") {
        setExercises(exercises.filter((_, i) => i !== index));
      } else if (section === "warmup") {
        setWarmup(warmup.filter((_, i) => i !== index));
      } else if (section === "cooldown") {
        setCooldown(cooldown.filter((_, i) => i !== index));
      }
    }
  };

  const renderExerciseForm = (exercise, section, index) => {
    const isEditing = editingExercise?.section === section && editingExercise?.index === index;

    if (!isEditing) {
      return (
        <div className="p-4 rounded-lg border border-border bg-background-secondary/40">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4 className="font-semibold text-foreground">{exercise.name || "Ejercicio sin nombre"}</h4>
              {exercise.body_part && (
                <p className="text-sm text-foreground-muted mt-1">Parte del cuerpo: {exercise.body_part}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-sm text-foreground-secondary">
                {exercise.sets && <span>Series: {exercise.sets}</span>}
                {exercise.reps && <span>Reps: {exercise.reps}</span>}
                {exercise.rest_seconds && <span>Descanso: {exercise.rest_seconds}s</span>}
              </div>
              {exercise.description && (
                <p className="text-sm text-foreground-secondary mt-2">{exercise.description}</p>
              )}
              {exercise.video_url && (
                <div className="mt-2">
                  {exercise.video_url.includes('youtube.com') || exercise.video_url.includes('youtu.be') ? (
                    <a
                      href={exercise.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      Ver video en YouTube →
                    </a>
                  ) : (
                    <video
                      src={exercise.video_url}
                      controls
                      className="max-w-md rounded-lg border border-border"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    >
                      Tu navegador no soporta la reproducción de video.
                    </video>
                  )}
                </div>
              )}
              {exercise.image_url && (
                <div className="mt-2">
                  <img
                    src={exercise.image_url}
                    alt={exercise.name}
                    className="max-w-xs rounded-lg border border-border"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => setEditingExercise({ section, index })}
                className="px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:text-foreground border border-border rounded-lg hover:bg-background-secondary"
              >
                Editar
              </button>
              <button
                onClick={() => deleteExercise(section, index)}
                className="px-3 py-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 border border-rose-500/20 rounded-lg hover:bg-rose-500/10"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                Nombre del ejercicio *
              </label>
              <input
                type="text"
                value={exercise.name || ""}
                onChange={(e) => updateExercise(section, index, "name", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                placeholder="Ej: Sentadillas"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                Parte del cuerpo
              </label>
              <input
                type="text"
                value={exercise.body_part || ""}
                onChange={(e) => updateExercise(section, index, "body_part", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                placeholder="Ej: Piernas"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                Series
              </label>
              <input
                type="number"
                value={exercise.sets || 3}
                onChange={(e) => updateExercise(section, index, "sets", Number(e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                min="1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                Repeticiones
              </label>
              <input
                type="text"
                value={exercise.reps || ""}
                onChange={(e) => updateExercise(section, index, "reps", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                placeholder="Ej: 10-12"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                Descanso (segundos)
              </label>
              <input
                type="number"
                value={exercise.rest_seconds || 60}
                onChange={(e) => updateExercise(section, index, "rest_seconds", Number(e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                min="0"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              Descripción
            </label>
            <textarea
              value={exercise.description || ""}
              onChange={(e) => updateExercise(section, index, "description", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background min-h-20"
              placeholder="Describe cómo realizar el ejercicio..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              Tips / Consejos
            </label>
            <textarea
              value={exercise.tips || ""}
              onChange={(e) => updateExercise(section, index, "tips", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background min-h-16"
              placeholder="Consejos de técnica..."
            />
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-2">
                Video del ejercicio
              </label>
              <div className="space-y-2">
                <input
                  type="url"
                  value={exercise.video_url || ""}
                  onChange={(e) => {
                    const url = e.target.value;
                    // Validar que sea YouTube o Vimeo
                    if (url && !url.includes('youtube.com') && !url.includes('youtu.be') && !url.includes('vimeo.com')) {
                      toast.error("Solo se permiten enlaces de YouTube o Vimeo");
                      return;
                    }
                    updateExercise(section, index, "video_url", url);
                  }}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  placeholder="URL de YouTube o Vimeo (ej: https://www.youtube.com/watch?v=...)"
                />
                {exercise.video_url && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateExercise(section, index, "video_url", "")}
                      className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Eliminar
                    </button>
                  </div>
                )}
                <p className="text-xs text-foreground-secondary">
                  Solo se permiten enlaces de YouTube o Vimeo
                </p>
                {exercise.video_url && (
                  <div className="mt-2">
                    {exercise.video_url.includes('youtube.com') || exercise.video_url.includes('youtu.be') ? (
                      <a
                        href={exercise.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        Ver video en YouTube →
                      </a>
                    ) : (
                      <video
                        src={exercise.video_url}
                        controls
                        className="max-w-md rounded-lg border border-border"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      >
                        Tu navegador no soporta la reproducción de video.
                      </video>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-2">
                Imagen del ejercicio
              </label>
              <div className="space-y-2">
                <input
                  type="url"
                  value={exercise.image_url || ""}
                  onChange={(e) => updateExercise(section, index, "image_url", e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  placeholder="URL de la imagen o sube un archivo"
                  disabled={uploadingImage.section === section && uploadingImage.index === index}
                />
                <div className="flex items-center gap-2">
                  <label className={`px-3 py-1.5 text-xs font-medium text-primary hover:text-primary-hover border border-primary/20 rounded-lg hover:bg-primary/10 cursor-pointer flex items-center gap-2 ${
                    (uploadingImage.section === section && uploadingImage.index === index) ? 'opacity-50 cursor-not-allowed' : ''
                  }`}>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingImage.section === section && uploadingImage.index === index}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        // Validar tamaño del archivo (10MB máximo)
                        const maxSize = 10 * 1024 * 1024; // 10MB
                        if (file.size > maxSize) {
                          toast.error(`El archivo es demasiado grande. Tamaño máximo: 10MB`);
                          e.target.value = '';
                          return;
                        }
                        
                        setUploadingImage({ section, index });
                        try {
                          const result = await apiClient.uploadWorkoutImage(file);
                          if (result?.data?.url) {
                            updateExercise(section, index, "image_url", result.data.url);
                            toast.success("Imagen subida correctamente");
                          }
                        } catch (error) {
                          console.error("Error subiendo imagen:", error);
                          if (error?.response?.data?.error?.includes('too large') || error?.response?.data?.error?.includes('File too large')) {
                            toast.error("El archivo es demasiado grande. Tamaño máximo: 10MB");
                          } else {
                            toast.error(error?.response?.data?.error || "Error al subir la imagen");
                          }
                        } finally {
                          setUploadingImage({ section: null, index: null });
                        }
                        e.target.value = ''; // Reset input
                      }}
                    />
                    {uploadingImage.section === section && uploadingImage.index === index ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Cargando imagen...</span>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="w-4 h-4" />
                        <span>Subir imagen</span>
                      </>
                    )}
                  </label>
                  {exercise.image_url && !(uploadingImage.section === section && uploadingImage.index === index) && (
                    <button
                      type="button"
                      onClick={() => updateExercise(section, index, "image_url", "")}
                      className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Eliminar
                    </button>
                  )}
                </div>
                <p className="text-xs text-foreground-secondary">
                  Tamaño máximo: 10MB. Formatos: JPG, PNG, GIF, WEBP.
                </p>
              </div>
            </div>
          </div>

          {exercise.image_url && (
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                Vista previa de la imagen
              </label>
              <img
                src={exercise.image_url}
                alt={exercise.name || "Ejercicio"}
                className="max-w-xs rounded-lg border border-border"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              onClick={() => setEditingExercise(null)}
              className="px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={() => setEditingExercise(null)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-hover"
            >
              Guardar ejercicio
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (error || !routine) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-sm text-red-400 mb-2">Error al cargar la rutina</p>
        <Link
          to={`/${tenantSlug}/workout-routines`}
          className="text-sm text-primary hover:underline"
        >
          Volver a rutinas
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={`/${tenantSlug}/workout-routines`}
            className="text-foreground-muted hover:text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{routine.name}</h1>
            {routine.description && (
              <p className="text-sm text-foreground-secondary mt-1">{routine.description}</p>
            )}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>

      {/* Ejercicios principales */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Ejercicios principales</h2>
          <button
            onClick={() => addExercise("exercises")}
            className="px-3 py-1.5 text-sm font-medium text-primary hover:text-primary-hover border border-primary/20 rounded-lg hover:bg-primary/10 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Agregar ejercicio
          </button>
        </div>
        {exercises.length === 0 ? (
          <p className="text-sm text-foreground-muted text-center py-8">
            No hay ejercicios. Haz clic en "Agregar ejercicio" para comenzar.
          </p>
        ) : (
          <div className="space-y-3">
            {exercises.map((exercise, index) => (
              <div key={index}>
                {renderExerciseForm(exercise, "exercises", index)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Calentamiento */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Calentamiento</h2>
          <button
            onClick={() => addExercise("warmup")}
            className="px-3 py-1.5 text-sm font-medium text-primary hover:text-primary-hover border border-primary/20 rounded-lg hover:bg-primary/10 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Agregar ejercicio
          </button>
        </div>
        {warmup.length === 0 ? (
          <p className="text-sm text-foreground-muted text-center py-8">
            No hay ejercicios de calentamiento.
          </p>
        ) : (
          <div className="space-y-3">
            {warmup.map((exercise, index) => (
              <div key={index}>
                {renderExerciseForm(exercise, "warmup", index)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Enfriamiento */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Enfriamiento</h2>
          <button
            onClick={() => addExercise("cooldown")}
            className="px-3 py-1.5 text-sm font-medium text-primary hover:text-primary-hover border border-primary/20 rounded-lg hover:bg-primary/10 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Agregar ejercicio
          </button>
        </div>
        {cooldown.length === 0 ? (
          <p className="text-sm text-foreground-muted text-center py-8">
            No hay ejercicios de enfriamiento.
          </p>
        ) : (
          <div className="space-y-3">
            {cooldown.map((exercise, index) => (
              <div key={index}>
                {renderExerciseForm(exercise, "cooldown", index)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

