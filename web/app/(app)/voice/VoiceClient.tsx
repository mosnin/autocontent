"use client";

import * as React from "react";

import { DashHeading, DashPanel } from "@/components/hub/dashboard-kit";
import { Button } from "@/components/square/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/square/ui/card";
import { clientFetch, clientPost } from "@/lib/client-fetcher";
import type { VoiceSession, VoiceStatus } from "@/lib/jev-types";

const REALTIME_URL = "https://api.openai.com/v1/realtime";

export function VoiceClient({ initial }: { initial: VoiceStatus | null }) {
  const [status, setStatus] = React.useState<VoiceStatus | null>(initial);
  const [live, setLive] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    clientFetch<VoiceStatus>("/api/v1/voice/status")
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSession() {
    setError(null);
    try {
      const session = await clientPost<VoiceSession>("/api/v1/voice/session");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.ontrack = (event) => {
        const el = audioRef.current;
        if (el) {
          el.srcObject = event.streams[0] ?? null;
          void el.play();
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(
        `${REALTIME_URL}?model=${encodeURIComponent(session.model)}`,
        {
          method: "POST",
          body: offer.sdp ?? "",
          headers: {
            authorization: `Bearer ${session.client_secret}`,
            "content-type": "application/sdp",
            "openai-beta": "realtime=v1",
          },
        }
      );
      if (!sdpResponse.ok) {
        throw new Error(`Realtime SDP exchange failed (${sdpResponse.status})`);
      }
      const answer = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      setLive(true);
    } catch (err) {
      stopSession();
      setError(err instanceof Error ? err.message : "Voice session failed");
    }
  }

  function stopSession() {
    pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
  }

  return (
    <div className="space-y-10">
      <DashHeading
        as="h1"
        sub="OpenAI Realtime for conversation. Jev still owns decisions; Qwen still writes."
      >
        Voice mode
      </DashHeading>

      <DashPanel delay={0.08} title="Talk to marketer">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              {status?.ready ? "Ready" : "Not configured"}
            </CardTitle>
            <CardDescription>
              Model {status?.model ?? "—"} · voice {status?.voice ?? "—"}.
              The session cannot publish or move ad spend — it queues work
              for the harness.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                onClick={startSession}
                disabled={!status?.ready || live}
              >
                Start talking
              </Button>
              <Button
                variant="outline"
                onClick={stopSession}
                disabled={!live}
              >
                Hang up
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {live ? "Listening — speak naturally." : "Idle."}
            </p>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <audio ref={audioRef} autoPlay className="hidden" />
          </CardContent>
        </Card>
      </DashPanel>
    </div>
  );
}
