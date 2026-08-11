import type { Metadata } from "next";

import { LegalDoc } from "@/components/marketing/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Cookie Policy · marketer.sh",
  description: "The cookies and local storage marketer.sh uses.",
};

export default function CookiesPage() {
  return (
    <LegalDoc
      title="Cookie Policy"
      intro="We keep cookies to a minimum. The platform runs on a small set of essential cookies and local storage — we do not use advertising or cross-site tracking cookies."
    >
      <h2>Essential</h2>
      <p>
        These are required for the platform to work and cannot be turned off:
      </p>
      <ul>
        <li>
          <strong>Authentication</strong> — session cookies set by our auth
          provider to keep you signed in and protect against request forgery.
        </li>
        <li>
          <strong>Security and load</strong> — cookies used for rate limiting
          and to route requests safely.
        </li>
      </ul>

      <h2>Preferences</h2>
      <p>
        We use browser local storage to remember interface preferences such as
        your light or dark theme and sidebar state. This never leaves your
        device and carries no personal data.
      </p>

      <h2>Analytics</h2>
      <p>
        If we use privacy-respecting, aggregate analytics, they are limited to
        understanding product usage and never build cross-site advertising
        profiles. Any non-essential analytics are subject to your consent where
        the law requires it.
      </p>

      <h2>Controlling cookies</h2>
      <p>
        You can clear or block cookies in your browser settings, though blocking
        essential cookies will sign you out and break core features. See our{" "}
        <a href="/legal/privacy">Privacy Policy</a> for how we handle the data
        these cookies relate to.
      </p>
    </LegalDoc>
  );
}
