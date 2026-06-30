import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "64px",
          background: "linear-gradient(135deg, #0d1422 0%, #141c28 60%, #1a2235 100%)",
          fontFamily: "Georgia, serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background grid pattern */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              "linear-gradient(rgba(201,168,76,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(201,168,76,0.03) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Gold accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "3px",
            background: "linear-gradient(90deg, #c9a84c, #e8cc7a, #c9a84c)",
          }}
        />

        {/* Logo mark */}
        <div
          style={{
            position: "absolute",
            top: "56px",
            left: "64px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "8px",
              background: "#1e2a3d",
              border: "1px solid rgba(201,168,76,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "24px",
              fontWeight: "700",
              color: "#c9a84c",
            }}
          >
            E
          </div>
          <span style={{ color: "#94a3b8", fontSize: "16px", letterSpacing: "0.12em", fontFamily: "sans-serif" }}>
            EQUITIE
          </span>
        </div>

        {/* Main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              fontSize: "58px",
              fontWeight: "700",
              color: "#f1f5f9",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            Investor Portal
          </div>
          <div
            style={{
              fontSize: "22px",
              color: "#64748b",
              fontFamily: "sans-serif",
              fontWeight: "400",
              lineHeight: 1.5,
              maxWidth: "680px",
            }}
          >
            Deterministic finance engine · Evidence-grounded answers · Policy-guarded access
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              gap: "48px",
              marginTop: "12px",
            }}
          >
            {[
              ["112", "Investors"],
              ["381", "Tests"],
              ["10", "Policy guards"],
            ].map(([val, label]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "32px", fontWeight: "700", color: "#c9a84c" }}>{val}</span>
                <span style={{ fontSize: "14px", color: "#475569", fontFamily: "sans-serif", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
