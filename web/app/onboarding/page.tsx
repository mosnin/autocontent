import { OnboardingForm } from "./OnboardingForm";

// Single-page form. "Required everything" per the product decision —
// no defaults are silently chosen for the user; they must pick.
export default function Onboarding() {
  return (
    <section style={{ maxWidth: 720 }}>
      <div
        style={{
          padding: "10px 12px",
          marginBottom: 16,
          background: "#fff8e1",
          border: "1px solid #f5d77c",
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        Schedule posts require Ayrshare connected. <a href="/connect">Connect now</a>.
      </div>
      <h1>Add a niche</h1>
      <p style={{ color: "#666" }}>
        Every field is required. The pipeline uses these to drive ideation,
        visuals, voice, scheduling, and the daily spend ceiling.
      </p>

      <OnboardingForm />
    </section>
  );
}
