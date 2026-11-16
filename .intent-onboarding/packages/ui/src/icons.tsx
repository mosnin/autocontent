import type { ReactNode, SVGProps } from 'react';

/** 1.5px-stroke line icons on a 20px grid, inheriting currentColor. */
function Svg({ children, size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  Globe: (p: { size?: number }) => (
    <Svg {...p}><circle cx="10" cy="10" r="7.25" /><path d="M2.75 10h14.5M10 2.75c2 2.1 3 4.5 3 7.25s-1 5.15-3 7.25c-2-2.1-3-4.5-3-7.25s1-5.15 3-7.25Z" /></Svg>
  ),
  Flag: (p: { size?: number }) => (
    <Svg {...p}><path d="M4.5 17.25V3.5m0 0h9.25l-1.5 3.25 1.5 3.25H4.5" /></Svg>
  ),
  Coins: (p: { size?: number }) => (
    <Svg {...p}><path d="M4 6.5h8M4 10h6M4 13.5h4" /><circle cx="14.5" cy="13.5" r="2" /></Svg>
  ),
  Clock: (p: { size?: number }) => (
    <Svg {...p}><circle cx="10" cy="10" r="7.25" /><path d="M10 6v4l2.5 1.5" /></Svg>
  ),
  Check: (p: { size?: number }) => (
    <Svg {...p} strokeWidth={2}><path d="m5 10.5 3.25 3L15 6.75" /></Svg>
  ),
  CheckCircle: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="currentColor" /><path d="m6.5 10.25 2.5 2.25 4.5-4.75" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  Warning: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 20 20" aria-hidden="true"><path d="M8.7 3.25a1.5 1.5 0 0 1 2.6 0l6.45 11.25A1.5 1.5 0 0 1 16.45 16.75H3.55a1.5 1.5 0 0 1-1.3-2.25Z" fill="currentColor" /><path d="M10 7.5v3.75" stroke="#111" strokeWidth="1.75" strokeLinecap="round" /><circle cx="10" cy="13.75" r="1" fill="#111" /></svg>
  ),
  Info: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="currentColor" /><path d="M10 9v4.5" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" /><circle cx="10" cy="6.25" r="1" fill="#fff" /></svg>
  ),
  Question: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="currentColor" /><path d="M7.9 7.6a2.2 2.2 0 1 1 3.1 2c-.65.3-1 .8-1 1.5v.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /><circle cx="10" cy="14.25" r="1" fill="#fff" /></svg>
  ),
  Alert: (p: { size?: number }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 20 20" aria-hidden="true"><path d="M8.7 3.25a1.5 1.5 0 0 1 2.6 0l6.45 11.25A1.5 1.5 0 0 1 16.45 16.75H3.55a1.5 1.5 0 0 1-1.3-2.25Z" fill="currentColor" /><path d="M10 7.5v3.75" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" /><circle cx="10" cy="13.75" r="1" fill="#fff" /></svg>
  ),
  Sparkle: (p: { size?: number }) => (
    <Svg {...p}><path d="M10 2.75v4M10 13.25v4M2.75 10h4M13.25 10h4M5 5l2.5 2.5M12.5 12.5 15 15M15 5l-2.5 2.5M7.5 12.5 5 15" /></Svg>
  ),
  Pen: (p: { size?: number }) => (
    <Svg {...p}><path d="M3.5 16.5c2.5-.5 3.5-2.5 5-2.5s1.25 1.5 2.75 1.5 2.25-1.5 3.5-1.5M12.75 3.75l2.5 2.5-6.5 6.5H6.25v-2.5z" /></Svg>
  ),
  X: (p: { size?: number }) => (
    <Svg {...p}><path d="m5.5 5.5 9 9m0-9-9 9" /></Svg>
  ),
  Lock: (p: { size?: number }) => (
    <Svg {...p}><rect x="4.25" y="8.75" width="11.5" height="8.5" rx="2" /><path d="M7 8.75V6.5a3 3 0 0 1 6 0v2.25" /></Svg>
  ),
  Arrow: (p: { size?: number }) => (
    <Svg {...p}><path d="M4.5 10h11m-4.25-4.25L15.5 10l-4.25 4.25" /></Svg>
  ),
  Info2: (p: { size?: number }) => (
    <Svg {...p}><circle cx="10" cy="10" r="7.25" /><path d="M10 9v4.25M10 6.6v.1" /></Svg>
  ),
};

/**
 * Brand marks: a neutral, consistent tile with the brand color and an initial. Hosts should pass
 * their own licensed logo assets via the `icon` prop on components; these exist so the framework
 * never ships third-party logo artwork.
 */
const MARKS: Record<string, { bg: string; fg: string; glyph: string }> = {
  meta: { bg: '#0866FF', fg: '#fff', glyph: 'M' },
  google: { bg: '#ffffff', fg: '#4285F4', glyph: 'G' },
  tiktok: { bg: '#111111', fg: '#fff', glyph: 'T' },
  instagram: { bg: '#E1306C', fg: '#fff', glyph: 'IG' },
  gmail: { bg: '#ffffff', fg: '#EA4335', glyph: 'M' },
  outlook: { bg: '#0F6CBD', fg: '#fff', glyph: 'O' },
  crm: { bg: '#1F2937', fg: '#fff', glyph: 'FB' },
  slack: { bg: '#4A154B', fg: '#fff', glyph: 'S' },
};

export function Mark({ name, size = 22, icon }: { name?: string; size?: number; icon?: ReactNode }) {
  if (icon) return <span style={{ display: 'inline-grid', width: size, height: size, placeItems: 'center' }}>{icon}</span>;
  if (name === 'sparkle' || !name || !MARKS[name]) {
    return (
      <span style={{ display: 'inline-grid', width: size, height: size, placeItems: 'center', color: 'var(--io-text-secondary)' }}>
        {name === 'sparkle' ? <Icon.Sparkle size={size * 0.8} /> : <Icon.Globe size={size * 0.8} />}
      </span>
    );
  }
  const m = MARKS[name]!;
  const glyphSize = m.glyph.length > 1 ? size * 0.4 : size * 0.55;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: m.bg,
        color: m.fg,
        fontSize: glyphSize,
        fontWeight: 650,
        letterSpacing: '-0.02em',
        boxShadow: m.bg === '#ffffff' ? 'inset 0 0 0 1px rgb(0 0 0 / 0.08)' : undefined,
        flex: 'none',
      }}
    >
      {m.glyph}
    </span>
  );
}
