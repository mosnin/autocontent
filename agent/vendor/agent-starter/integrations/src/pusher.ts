import { AgentError, HttpError, type TelemetryEvent, type TelemetrySink, TenantIsolationError, hmacSha256Hex } from "@agent-starter/core";

/**
 * Pusher Channels over the raw HTTP API (no SDK): Workers-compatible signing
 * with Web Crypto HMAC-SHA256 plus a pure-TypeScript MD5 (Workers' crypto.subtle
 * has no MD5, which Pusher requires for `body_md5`).
 */

// ---------------------------------------------------------------------------
// MD5 (RFC 1321)
// ---------------------------------------------------------------------------

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 digest as lowercase hex. Strings are UTF-8 encoded. */
export function md5Hex(input: string | Uint8Array): string {
  const message = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const bitLength = message.length * 8;
  const paddedLength = (((message.length + 8) >>> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(message);
  buffer[message.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + (MD5_K[i] as number) + (m[g] as number)) >>> 0;
      const shift = MD5_S[i] as number;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  let hex = "";
  for (const word of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Channel naming + tenant boundary
// ---------------------------------------------------------------------------

/** Pusher channel names: letters, digits and `_ - = @ , . ;`, at most 164 characters. */
export const PUSHER_CHANNEL_PATTERN = /^[A-Za-z0-9_\-=@,.;]{1,164}$/;
/**
 * Tenant-room private channel: `private-tenant-{tenantId}-room-{roomId}`.
 * Core tenant ids may contain `:`, which Pusher forbids in channel names, so
 * `:` is written as `=` (core tenant ids never contain `=`, so the mapping is
 * reversible and collision-free). Both forms parse.
 */
export const TENANT_CHANNEL_PATTERN = /^private-tenant-([A-Za-z0-9_.:=-]+)-room-(.+)$/;
const SOCKET_ID_PATTERN = /^\d+\.\d+$/;
const ROOM_SEPARATOR = "-room-";
const TENANT_ID_CHARS = /^[A-Za-z0-9_.:-]+$/;

/**
 * Build the private channel for a tenant room. Tenant and room ids may not
 * contain the `-room-` separator, so a channel name always parses back to
 * exactly one (tenant, room) pair and two tenants can never share a channel.
 */
export function tenantChannelName(tenantId: string, roomId: string): string {
  if (!tenantId || tenantId.includes(ROOM_SEPARATOR) || !TENANT_ID_CHARS.test(tenantId)) {
    throw new TenantIsolationError(`Tenant id "${tenantId}" cannot be used in a Pusher channel name.`, { tenantId });
  }
  if (!roomId || roomId.includes(ROOM_SEPARATOR)) throw new AgentError("CONFIG_INVALID", `Room id "${roomId}" cannot be used in a Pusher channel name.`);
  const channel = `private-tenant-${tenantId.replace(/:/g, "=")}${ROOM_SEPARATOR}${roomId}`;
  if (!PUSHER_CHANNEL_PATTERN.test(channel)) {
    throw new AgentError("CONFIG_INVALID", `Channel "${channel}" is not a valid Pusher channel name (allowed: A-Z a-z 0-9 _ - = @ , . ; up to 164 chars).`);
  }
  return channel;
}

/** Parse a tenant-room channel; returns null for anything else (including ambiguous names). */
export function parseTenantChannel(channelName: string): { tenantId: string; roomId: string } | null {
  const match = TENANT_CHANNEL_PATTERN.exec(channelName);
  if (!match) return null;
  const encodedTenant = match[1] as string;
  const roomId = match[2] as string;
  // Greedy capture means the room part never contains the separator; a tenant part that does is ambiguous.
  if (encodedTenant.includes(ROOM_SEPARATOR) || !roomId) return null;
  return { tenantId: encodedTenant.replace(/=/g, ":"), roomId };
}

export interface AuthorizePrivateChannelInput {
  socketId: string;
  channelName: string;
  appKey: string;
  secret: string;
  /** Tenant of the authenticated user (from your session/JWT, never from the request body). */
  userTenantId: string;
}

/**
 * Private-channel authorization endpoint logic. Enforces the tenant boundary:
 * a user may only subscribe to `private-tenant-{their tenant}-room-*`.
 * Returns the body Pusher expects: `{ auth: "key:signature" }`.
 */
export async function authorizePrivateChannel(input: AuthorizePrivateChannelInput): Promise<{ auth: string }> {
  if (!SOCKET_ID_PATTERN.test(input.socketId)) throw new AgentError("SIGNATURE_INVALID", "Malformed Pusher socket id.");
  if (!PUSHER_CHANNEL_PATTERN.test(input.channelName)) throw new TenantIsolationError("Malformed Pusher channel name.", { channelName: input.channelName });
  const parsed = parseTenantChannel(input.channelName);
  if (!parsed) throw new TenantIsolationError("Only tenant room channels can be authorized.", { channelName: input.channelName });
  if (parsed.tenantId !== input.userTenantId) {
    throw new TenantIsolationError("Cross-tenant channel subscription rejected.", { channelTenant: parsed.tenantId, userTenant: input.userTenantId });
  }
  const signature = await hmacSha256Hex(input.secret, `${input.socketId}:${input.channelName}`);
  return { auth: `${input.appKey}:${signature}` };
}

// ---------------------------------------------------------------------------
// HTTP API signing + client
// ---------------------------------------------------------------------------

export interface SignPusherRequestInput {
  method: string;
  path: string;
  key: string;
  secret: string;
  body?: string;
  timestampSeconds?: number;
  params?: Record<string, string>;
}

/**
 * Sign a Pusher HTTP API request: auth_key, auth_timestamp, auth_version=1.0,
 * body_md5 (when there is a body), then HMAC-SHA256 over
 * `METHOD\nPATH\nsorted_query` as auth_signature. Returns the full query string.
 */
export async function signPusherRequest(input: SignPusherRequestInput): Promise<{ query: string; signature: string; params: Record<string, string> }> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.params ?? {})) params[k.toLowerCase()] = v;
  params.auth_key = input.key;
  params.auth_timestamp = String(input.timestampSeconds ?? Math.floor(Date.now() / 1000));
  params.auth_version = "1.0";
  if (input.body !== undefined && input.body.length > 0) params.body_md5 = md5Hex(input.body);
  const ordered = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const signature = await hmacSha256Hex(input.secret, `${input.method.toUpperCase()}\n${input.path}\n${ordered}`);
  const query = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] as string)}`)
    .concat(`auth_signature=${signature}`)
    .join("&");
  return { query, signature, params };
}

export interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  /** e.g. "mt1", "eu", "ap2". Ignored when `host` is set. */
  cluster?: string;
  /** Custom API host (no scheme), e.g. a self-hosted Soketi. */
  host?: string;
  useTLS?: boolean;
  fetch?: typeof fetch;
  clock?: () => number;
}

/** Minimal Pusher HTTP API client (trigger events). */
export class PusherClient {
  constructor(private readonly config: PusherConfig) {}

  private baseUrl(): string {
    const host = this.config.host ?? `api-${this.config.cluster ?? "mt1"}.pusher.com`;
    return `${this.config.useTLS === false ? "http" : "https"}://${host}`;
  }

  /** POST /apps/{app_id}/events — one channel or up to 100 channels; `data` is JSON-encoded. */
  async trigger(channels: string | string[], event: string, data: unknown, options: { socketId?: string } = {}): Promise<void> {
    const list = Array.isArray(channels) ? channels : [channels];
    if (list.length === 0 || list.length > 100) throw new AgentError("CONFIG_INVALID", "Pusher trigger needs between 1 and 100 channels.");
    for (const channel of list) if (!PUSHER_CHANNEL_PATTERN.test(channel)) throw new AgentError("CONFIG_INVALID", `Invalid Pusher channel "${channel}".`);
    if (!event || event.length > 200) throw new AgentError("CONFIG_INVALID", "Pusher event names must be 1-200 characters.");
    if (options.socketId !== undefined && !SOCKET_ID_PATTERN.test(options.socketId)) throw new AgentError("CONFIG_INVALID", "Malformed Pusher socket id.");
    const body = JSON.stringify({
      name: event,
      data: typeof data === "string" ? data : JSON.stringify(data),
      ...(list.length === 1 ? { channel: list[0] } : { channels: list }),
      ...(options.socketId ? { socket_id: options.socketId } : {}),
    });
    const path = `/apps/${encodeURIComponent(this.config.appId)}/events`;
    const { query } = await signPusherRequest({
      method: "POST",
      path,
      key: this.config.key,
      secret: this.config.secret,
      body,
      timestampSeconds: Math.floor((this.config.clock ?? Date.now)() / 1000),
    });
    const response = await (this.config.fetch ?? fetch)(`${this.baseUrl()}${path}?${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) throw await HttpError.fromResponse(response, "Pusher trigger");
  }
}

/**
 * Default Pusher event name for agent telemetry. `useAgentTelemetry` (`@agent-starter/react`) binds the same name by
 * default, so a publisher and a hook with no `eventName` always meet.
 */
export const PUSHER_TELEMETRY_EVENT = "agent-turn-executed";

export interface PusherPublisherOptions extends PusherConfig {
  /** Event name on the channel. Default "agent-turn-executed". */
  eventName?: string;
  /** Only publish events that pass this filter (e.g. skip high-volume "memory" events). */
  filter?: (event: TelemetryEvent) => boolean;
  /** Pusher's default message size limit is 10KB; larger events are compacted. Default 10_000 bytes. */
  maxPayloadBytes?: number;
}

/**
 * Telemetry sink that fans every agent event out to the tenant's room channel
 * `private-tenant-${tenantId}-room-${roomId ?? runId}` as `agent-turn-executed`.
 */
export class PusherPublisher implements TelemetrySink {
  private readonly client: PusherClient;
  private readonly eventName: string;
  private readonly maxBytes: number;

  constructor(private readonly options: PusherPublisherOptions) {
    this.client = new PusherClient(options);
    this.eventName = options.eventName ?? PUSHER_TELEMETRY_EVENT;
    this.maxBytes = options.maxPayloadBytes ?? 10_000;
  }

  channelFor(event: Pick<TelemetryEvent, "tenantId" | "roomId" | "runId">): string {
    return tenantChannelName(event.tenantId, event.roomId ?? event.runId);
  }

  async publish(event: TelemetryEvent): Promise<void> {
    if (this.options.filter && !this.options.filter(event)) return;
    await this.client.trigger(this.channelFor(event), this.eventName, this.fit(event));
  }

  /** Keep the payload under Pusher's size limit: drop `data`, then truncate `content`. */
  private fit(event: TelemetryEvent): string {
    const encoder = new TextEncoder();
    let payload = JSON.stringify(event);
    if (encoder.encode(payload).length <= this.maxBytes) return payload;
    const { data: _data, ...rest } = event;
    const compact: TelemetryEvent & { truncated?: boolean } = { ...rest, truncated: true };
    payload = JSON.stringify(compact);
    let content = event.content;
    while (encoder.encode(payload).length > this.maxBytes && content.length > 0) {
      content = content.slice(0, Math.floor(content.length * 0.7));
      payload = JSON.stringify({ ...compact, content: `${content}…` });
    }
    return payload;
  }
}
