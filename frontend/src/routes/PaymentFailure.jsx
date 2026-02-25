// src/routes/PaymentFailure.jsx
import { useNavigate, useParams } from 'react-router-dom';
import { XCircle } from 'lucide-react';

export default function PaymentFailure() {
  const navigate = useNavigate();
  const { tenantSlug } = useParams();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-xl rounded-2xl border border-red-500/30 p-8 text-center">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <XCircle className="w-12 h-12 text-red-400" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          Pago rechazado
        </h1>
        <p className="text-gray-300 mb-6">
          No pudimos procesar tu pago. Por favor, intentá nuevamente o contactanos.
        </p>

        <div className="space-y-3">
          <button
            onClick={() => navigate(`/${tenantSlug}/appointments`)}
            className="w-full py-3 px-6 bg-gradient-to-r from-primary to-[#6A8EB8] text-white font-semibold rounded-xl hover:from-primary-hover hover:to-[#56779F] transition-all"
          >
            Intentar nuevamente
          </button>
          
          <button
            onClick={() => navigate(`/${tenantSlug}`)}
            className="w-full py-3 px-6 bg-gray-700 text-white font-semibold rounded-xl hover:bg-gray-600 transition-all"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}