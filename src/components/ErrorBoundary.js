import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "Произошла ошибка в интерфейсе",
    };
  }

  componentDidCatch(error) {
    console.error("App render failed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px",
            background: "#f8fafc",
          }}
        >
          <div
            style={{
              maxWidth: "560px",
              width: "100%",
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ fontSize: "22px", fontWeight: 700, marginBottom: 8 }}>
              Интерфейс не смог обработать данные
            </div>
            <div style={{ color: "#475569", lineHeight: 1.5, marginBottom: 14 }}>
              Приложение не упало целиком: ошибка перехвачена, и теперь её можно
              увидеть явно.
            </div>
            <div
              style={{
                background: "#fff1f2",
                color: "#9f1239",
                borderRadius: "14px",
                padding: "12px 14px",
                fontFamily: "monospace",
                fontSize: "13px",
                whiteSpace: "pre-wrap",
              }}
            >
              {this.state.message}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
