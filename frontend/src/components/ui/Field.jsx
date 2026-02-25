// src/components/ui/Field.jsx - Versión mejorada modo oscuro
export function Field({ label, hint, error, children, required }) {
  return (
    <label className="block">
      {label && (
        <div className="mb-2 text-sm font-medium dark:text-slate-200 text-slate-700 flex items-center gap-1">
          {label}
          {required && <span className="text-red-400">*</span>}
        </div>
      )}
      {children}
      <div className="min-h-[1.25rem] mt-1.5 text-xs">
        {error ? (
          <span className="text-red-400 flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </span>
        ) : hint ? (
          <span className="dark:text-slate-400 text-slate-500 flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            {hint}
          </span>
        ) : null}
      </div>
    </label>
  );
}
