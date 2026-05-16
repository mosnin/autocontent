"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createNicheAction,
  EMPTY_STATE,
  type ActionState,
} from "../../lib/actions";
import { PLATFORMS, QUALITIES, RESOLUTIONS } from "../../lib/types";

export function OnboardingForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createNicheAction,
    EMPTY_STATE,
  );

  return (
    <form action={formAction} style={formStyle}>
      <Field label="Title (channel/niche name)">
        <input name="title" required style={inputStyle} />
      </Field>

      <Field label="Description (what this channel is about)">
        <textarea name="description" required rows={3} style={inputStyle} />
      </Field>

      <Field label="Target audience">
        <input name="target_audience" required style={inputStyle} />
      </Field>

      <Field label="Hashtags (comma separated, no #)">
        <input name="hashtags" placeholder="econ, macro, fed" style={inputStyle} />
      </Field>

      <Field label="Visual style (used verbatim by the visual director)">
        <textarea
          name="visual_style"
          required
          rows={3}
          placeholder="soft 3D claymation, pastel palette, shallow DOF"
          style={inputStyle}
        />
      </Field>

      <div style={rowStyle}>
        <Field label="Voice (OpenAI TTS id)">
          <select name="voice" defaultValue="onyx" style={inputStyle}>
            {["alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "sage", "coral"].map(
              (v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field label="Target total duration (sec)">
          <input
            name="target_duration_sec"
            type="number"
            min={15}
            max={90}
            defaultValue={60}
            required
            style={inputStyle}
          />
        </Field>

        <Field label="Scene count">
          <input
            name="scene_count"
            type="number"
            min={2}
            max={12}
            defaultValue={6}
            required
            style={inputStyle}
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Per-niche provider overrides</h3>
      <div style={rowStyle}>
        <Field label="Image quality (cost per scene)">
          <select name="image_quality" defaultValue="medium" style={inputStyle}>
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Video resolution">
          <select name="video_resolution" defaultValue="480p" style={inputStyle}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Max scene duration (sec, 1–15)">
          <input
            name="scene_max_duration_sec"
            type="number"
            min={1}
            max={15}
            defaultValue={5}
            required
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="TTS style directions (optional — passed verbatim to gpt-4o-mini-tts)">
        <input
          name="tts_style_directions"
          placeholder="calm, conspiratorial narrator with deliberate pauses"
          style={inputStyle}
        />
      </Field>

      <h3 style={{ marginTop: 24 }}>Scheduling</h3>
      <div style={rowStyle}>
        <Field label="Post at (hour, 0–23)">
          <input
            name="posting_hour"
            type="number"
            min={0}
            max={23}
            defaultValue={9}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Minute (0–59)">
          <input
            name="posting_minute"
            type="number"
            min={0}
            max={59}
            defaultValue={0}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Timezone (IANA)">
          <input
            name="tz"
            defaultValue="America/Los_Angeles"
            required
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Platforms">
        <div style={{ display: "flex", gap: 16 }}>
          {PLATFORMS.map((p) => (
            <label key={p}>
              <input type="checkbox" name="platforms" value={p} /> {p}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Daily spend cap (USD)">
        <input
          name="daily_spend_cap_usd"
          type="number"
          step="0.01"
          min={0.5}
          defaultValue={5}
          required
          style={inputStyle}
        />
        <small style={{ color: "#666" }}>
          At medium image quality and 480p Grok output, a single 6-scene
          video runs about $1.80. $5/day &asymp; 2&ndash;3 videos.
        </small>
      </Field>

      {state.error && <div style={formErrorStyle}>{state.error}</div>}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={submitStyle}>
      {pending ? "Working…" : "Create niche"}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldStyle}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const rowStyle: React.CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, flex: 1 };
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
};
const submitStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "10px 18px",
  background: "#111",
  color: "white",
  border: 0,
  borderRadius: 6,
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-start",
};
const formErrorStyle: React.CSSProperties = {
  background: "#fdecec",
  border: "1px solid #f4b6b6",
  color: "#933",
  padding: 10,
  borderRadius: 6,
  fontSize: 13,
};
