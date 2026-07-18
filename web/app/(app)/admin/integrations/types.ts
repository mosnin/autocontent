// Mirrors backend/routes/admin.py::IntegrationsStatus. Presence booleans
// only — the backend never returns a key value, so there is nothing secret
// in this shape.

export interface IntegrationFlag {
  configured: boolean;
}

export interface IntegrationsStatus {
  openai: IntegrationFlag;
  xai: IntegrationFlag;
  ayrshare: IntegrationFlag;
  pixabay: IntegrationFlag;
  exa: IntegrationFlag;
  fal: IntegrationFlag;
  composio: IntegrationFlag;
  google_oauth: IntegrationFlag;
  resend: IntegrationFlag;
  stripe: IntegrationFlag;
  inngest: IntegrationFlag;
  sentry: IntegrationFlag;

  ads_enabled: boolean;
  billing_enabled: boolean;
  press_autopilot_enabled: boolean;
  newsletters_enabled: boolean;
  x402_enabled: boolean;
}
