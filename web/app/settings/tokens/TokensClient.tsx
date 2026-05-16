"use client";

import { useActionState } from "react";

import { EMPTY_STATE, type ActionState } from "../../../lib/action-state";
import {
  createTokenAction,
  revokeTokenAction,
} from "../../../lib/actions";
import type { PersonalAccessToken } from "../../../lib/types";

interface Props {
  tokens: PersonalAccessToken[];
  freshToken: string | null;
}

export function TokensClient({ tokens, freshToken }: Props) {
  const [createState, createFormAction] = useActionState<ActionState, FormData>(
    createTokenAction,
    EMPTY_STATE,
  );

  return (
    <>
      {freshToken && (
        <div style={flashStyle}>
          <strong>New token (shown once):</strong>
          <pre style={{ margin: "8px 0", userSelect: "all" }}>{freshToken}</pre>
          Copy it into <code>AUTOCONTENT_API_TOKEN</code> now — we don&apos;t
          store the plaintext and can&apos;t recover it later.
        </div>
      )}

      <form action={createFormAction} style={formStyle}>
        <h2 style={{ margin: 0 }}>Create token</h2>
        <label>
          Name (for your reference)
          <input
            name="name"
            required
            placeholder="e.g. laptop-cli"
            style={inputStyle}
          />
        </label>
        <label>
          Expires in days (optional)
          <input
            name="expires_in_days"
            type="number"
            min={1}
            max={3650}
            placeholder="leave blank for non-expiring"
            style={inputStyle}
          />
        </label>
        {createState.error && (
          <div style={{ color: "#b00020" }}>{createState.error}</div>
        )}
        <button type="submit" style={buttonStyle}>Create</button>
      </form>

      <h2 style={{ marginTop: 32 }}>Active tokens</h2>
      {tokens.length === 0 ? (
        <p style={{ color: "#666" }}>(none)</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Prefix</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Expires</th>
              <th style={thStyle}>Last used</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <TokenRow key={t.id} token={t} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function TokenRow({ token }: { token: PersonalAccessToken }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    revokeTokenAction,
    EMPTY_STATE,
  );
  return (
    <tr>
      <td style={tdStyle}>{token.name}</td>
      <td style={tdStyle}><code>{token.prefix}</code></td>
      <td style={tdStyle}>{new Date(token.created_at).toLocaleString()}</td>
      <td style={tdStyle}>
        {token.expires_at ? new Date(token.expires_at).toLocaleString() : "—"}
      </td>
      <td style={tdStyle}>
        {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : "never"}
      </td>
      <td style={tdStyle}>
        <form action={formAction}>
          <input type="hidden" name="token_id" value={token.id} />
          <button type="submit" style={revokeButtonStyle}>Revoke</button>
          {state.error && (
            <div style={{ color: "#b00020", fontSize: 12 }}>{state.error}</div>
          )}
        </form>
      </td>
    </tr>
  );
}

const flashStyle: React.CSSProperties = {
  padding: 16,
  margin: "16px 0",
  background: "#fff8e1",
  border: "1px solid #f5d77c",
  borderRadius: 6,
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  marginTop: 16,
  border: "1px solid #e5e5e5",
  borderRadius: 8,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 8,
  marginTop: 4,
  border: "1px solid #ccc",
  borderRadius: 4,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#111",
  color: "white",
  border: 0,
  borderRadius: 6,
  fontWeight: 600,
  cursor: "pointer",
  width: "fit-content",
};

const revokeButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "transparent",
  color: "#b00020",
  border: "1px solid #b00020",
  borderRadius: 4,
  cursor: "pointer",
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  marginTop: 8,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid #ccc",
  fontSize: 13,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #eee",
  fontSize: 14,
};
