import type { Metadata } from "next";
import Link from "next/link";

import { ContactForm } from "@/components/marketing/contact-form";

const DESCRIPTION =
  "Talk to the marketer.sh team. Sales, support, press, or legal. A person reads every message.";

export const metadata: Metadata = {
  title: "Contact · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Contact · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/contact" },
};

const CHANNELS = [
  {
    label: "Hello",
    href: "mailto:hello@marketer.sh",
    value: "hello@marketer.sh",
    copy: "Most questions. Product, pricing, getting started.",
  },
  {
    label: "Support",
    href: "mailto:support@marketer.sh",
    value: "support@marketer.sh",
    copy: "Something in the app is stuck. Include your account email.",
  },
  {
    label: "Legal",
    href: "mailto:legal@marketer.sh",
    value: "legal@marketer.sh",
    copy: "Contracts, privacy, and the data addendum.",
  },
];

export default function ContactPage() {
  return (
    <main>
      <section className="mx-auto grid max-w-[1440px] gap-12 px-5 pt-28 pb-16 sm:px-8 sm:pt-36 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:px-10 lg:pb-24">
        <div>
          <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            Contact
          </p>
          <h1 className="text-foreground mt-5 text-[clamp(40px,6vw,72px)] leading-[1.02] font-medium tracking-tight">
            Write us.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-sm text-lg leading-relaxed">
            This is not a chatbot. Tell us what you need. We read every note
            and write back.
          </p>

          <ul className="mt-12 space-y-8">
            {CHANNELS.map((channel) => (
              <li key={channel.href}>
                <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                  {channel.label}
                </p>
                <a
                  href={channel.href}
                  className="focus-ring text-foreground mt-2 inline-block text-lg font-medium tracking-tight underline-offset-4 hover:underline"
                >
                  {channel.value}
                </a>
                <p className="text-muted-foreground mt-2 max-w-xs text-sm leading-relaxed">
                  {channel.copy}
                </p>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground mt-12 text-sm">
            Looking for the rules instead?{" "}
            <Link
              href="/legal"
              className="text-foreground underline underline-offset-4"
            >
              Legal pages
            </Link>
            .
          </p>
        </div>

        <ContactForm />
      </section>
    </main>
  );
}
