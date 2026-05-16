import { OnboardingForm } from "./OnboardingForm";

// Single-page form. "Required everything" per the product decision —
// no defaults are silently chosen for the user; they must pick.
export default function Onboarding() {
  return (
    <section style={{ maxWidth: 720 }}>
      <h1>Add a niche</h1>
      <p style={{ color: "#666" }}>
        Every field is required. The pipeline uses these to drive ideation,
        visuals, voice, scheduling, and the daily spend ceiling.
      </p>

      <OnboardingForm />
    </section>
  );
}
