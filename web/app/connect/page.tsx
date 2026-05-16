import { api } from "../../lib/api";
import { connectAyrshareAction } from "../../lib/actions";
import type { AyrshareConnectStatus } from "../../lib/types";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}

export default async function ConnectPage() {
  const status = await api<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status");

  return (
    <section style={{ maxWidth: 640 }}>
      <h1>Connect your socials</h1>
      <p style={{ color: "#666" }}>
        Scheduling posts requires an Ayrshare User Profile connected to your
        TikTok, Instagram, and/or YouTube accounts. We&apos;ll bounce you to
        Ayrshare&apos;s hosted OAuth chooser to authorize each platform.
      </p>

      {status.connected && status.profile_key ? (
        <div style={boxStyle}>
          <div style={{ marginBottom: 8 }}>
            <strong>Status:</strong> connected
          </div>
          <div style={{ marginBottom: 16, color: "#666", fontFamily: "monospace" }}>
            profile_key: {maskKey(status.profile_key)}
          </div>
          <form action={connectAyrshareAction}>
            <button type="submit" style={buttonStyle}>
              Reconnect / add accounts
            </button>
          </form>
        </div>
      ) : (
        <div style={boxStyle}>
          <div style={{ marginBottom: 12 }}>
            <strong>Status:</strong> not connected
          </div>
          <form action={connectAyrshareAction}>
            <button type="submit" style={buttonStyle}>
              Connect your socials
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

const boxStyle: React.CSSProperties = {
  padding: 16,
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  marginTop: 16,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#111",
  color: "white",
  border: 0,
  borderRadius: 6,
  fontWeight: 600,
  cursor: "pointer",
};
