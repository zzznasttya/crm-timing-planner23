import React, { useEffect, useRef } from "react";

// Simple toast context & hook
import { createContext, useContext, useState, useCallback } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = "success") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: "108px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 400,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background:
                t.type === "error"
                  ? "#dc2626"
                  : t.type === "warn"
                  ? "#d97706"
                  : "#0a0a0a",
              color: "#fff",
              borderRadius: "10px",
              padding: "10px 18px",
              fontSize: "13px",
              fontWeight: 600,
              boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
              whiteSpace: "nowrap",
              animation: "toastIn 0.2s ease",
              letterSpacing: "-0.01em",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
