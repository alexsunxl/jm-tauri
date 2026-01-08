import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastPayload = {
  ok: boolean;
  text: string;
  durationMs?: number;
};

type ToastState = {
  ok: boolean;
  text: string;
} | null;

type ToastContextValue = {
  showToast: (payload: ToastPayload) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export function ToastProvider(props: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useState<{ id: number | null }>(() => ({ id: null }))[0];

  const showToast = useCallback((payload: ToastPayload) => {
    if (timerRef.id != null) {
      window.clearTimeout(timerRef.id);
      timerRef.id = null;
    }
    setToast({ ok: payload.ok, text: payload.text });
    const duration = payload.durationMs ?? (payload.ok ? 1600 : 2200);
    timerRef.id = window.setTimeout(() => {
      setToast(null);
      timerRef.id = null;
    }, duration);
  }, [timerRef]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {props.children}
      {toast ? (
        <div className="fixed right-4 top-10 z-40">
          <div
            className={`rounded-md px-3 py-2 text-sm text-white shadow-lg ${
              toast.ok ? "bg-teal-500/90" : "bg-red-600/90"
            }`}
          >
            {toast.text}
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
