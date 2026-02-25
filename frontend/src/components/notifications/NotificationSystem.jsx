import { Toaster } from 'sonner';

export function NotificationSystem() {
  return (
    <Toaster
      position="top-right"
      theme="dark"
      richColors
      expand={true}
      duration={4000}
      closeButton
      toastOptions={{
        style: {
          background: 'linear-gradient(135deg, #0f3a56, #0d7fd4)',
          border: '1px solid rgba(19, 135, 185, 0.65)',
          color: '#e6f9ff',
          boxShadow: '0 16px 32px rgba(5, 24, 38, 0.4)',
        },
      }}
    />
  );
}

export { toast } from 'sonner';