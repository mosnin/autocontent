export interface JevStatus {
  jev_enabled: boolean;
  typesafe_configured: boolean;
  qwen_fallback_configured: boolean;
  available: boolean;
  jev_model: string;
  fallback_model: string;
  default_generation_model: string;
  voice_realtime_model: string;
  voice_ready: boolean;
}

export interface VoiceStatus {
  ready: boolean;
  model: string;
  voice: string;
}

export interface VoiceSession {
  model: string;
  voice: string;
  client_secret: string;
  expires_at: number | null;
}

export interface RouteResult {
  intent: {
    kind: string;
    skill: string;
    urgency: number;
    confidence: number;
    gate: string;
    backend: string;
  };
  model: {
    tier: string;
    model_id: string;
    confidence: number;
    backend: string;
  };
  company: {
    surface: string;
    task: string;
    knowledge_write: boolean;
    confidence: number;
    gate: string;
    backend: string;
  };
}
