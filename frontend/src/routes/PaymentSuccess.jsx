// src/routes/PaymentSuccess.jsx
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { CheckCircle2, Loader2, Clock } from 'lucide-react';

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const [status, setStatus] = useState('loading');
  const [appointmentId, setAppointmentId] = useState(null);

  useEffect(() => {
    const paymentId = searchParams.get('payment_id');
    const externalRef = searchParams.get('external_reference');

    if (externalRef) {
      const parts = externalRef.split(':');
      const apptId = parts[1];
      setAppointmentId(apptId);

      // Verificar estado del pago
      apiClient.checkPaymentStatus(apptId)
        .then(res => {
          if (res.payment?.mp_payment_status === 'approved') {
            setStatus('success');
          } else if (res.payment?.mp_payment_status === 'pending') {
            setStatus('pending');
          } else {
            setStatus('checking');
          }
        })
        .catch(() => setStatus('error'));
    } else {
      setStatus('success'); // Asumir éxito si no hay ref
    }
  }, [searchParams]);

  if (status === 'loading' || status === 'checking') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-xl rounded-2xl border border-gray-700/50 p-8 text-center">
          <Loader2 className="w-16 h-16 text-primary animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">
            Verificando pago...
          </h2>
          <p className="text-gray-400">
            Estamos confirmando tu pago con Mercado Pago
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-xl rounded-2xl border border-gray-700/50 p-8 text-center">
        {status === 'success' ? (
          <>
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">
              ¡Pago exitoso!
            </h1>
            <p className="text-gray-300 mb-6">
              Tu turno ha sido confirmado. Te enviaremos un recordatorio por WhatsApp.
            </p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-12 h-12 text-yellow-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Pago pendiente
            </h1>
            <p className="text-gray-300 mb-6">
              Estamos esperando la confirmación de tu pago. Te avisaremos cuando se acredite.
            </p>
          </>
        )}

        <button
          onClick={() => navigate(`/${tenantSlug}/appointments`)}
          className="w-full py-3 px-6 bg-gradient-to-r from-primary to-[#6A8EB8] text-white font-semibold rounded-xl hover:from-primary-hover hover:to-[#56779F] transition-all transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Volver al inicio
        </button>
      </div>
    </div>
  );
}