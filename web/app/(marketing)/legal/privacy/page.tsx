import type { Metadata } from "next";

import { LegalDoc } from "@/components/marketing/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Privacy Policy · marketer.sh",
  description: "What marketer.sh collects, why, and the rights you have.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      intro="This policy explains what we collect, why we collect it, who we share it with, and the control you have. We collect the minimum needed to run the platform."
    >
      <h2>1. Who we are</h2>
      <p>
        marketer.sh (&ldquo;we&rdquo;) is the controller of the personal data
        described here. For business customers, we also act as a processor of
        end-user data under our{" "}
        <a href="/legal/dpa">Data Processing Addendum</a>.
      </p>

      <h2>2. What we collect</h2>
      <h3>You give us</h3>
      <ul>
        <li>
          <strong>Account data</strong>: your email and authentication
          identity (via our auth provider), and team membership.
        </li>
        <li>
          <strong>Content and configuration</strong>: channels, briefs, brand
          kits, and the outputs generated for you.
        </li>
        <li>
          <strong>Connections</strong>: tokens and account identifiers for the
          social, ad, and payment services you link. Provider secrets are stored
          server-side and never exposed to the browser.
        </li>
        <li>
          <strong>Billing</strong>: prepaid credit balance and transaction
          history. Card details are handled by our payment processor, not by us.
        </li>
      </ul>
      <h3>We collect automatically</h3>
      <ul>
        <li>
          <strong>Usage and diagnostics</strong>: request metadata, spend
          ledger entries, and an audit log of privileged and spend-affecting
          actions (actor, IP, and user agent) for security and accounting.
        </li>
        <li>
          <strong>Cookies</strong>: a small set described in our{" "}
          <a href="/legal/cookies">Cookie Policy</a>.
        </li>
      </ul>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To operate the pipelines, publish content, and run campaigns.</li>
        <li>To meter spend, enforce caps, bill, and prevent abuse.</li>
        <li>To secure the platform and maintain an audit trail.</li>
        <li>To support you and improve the service.</li>
        <li>To comply with legal obligations.</li>
      </ul>
      <p>
        Our legal bases (where GDPR applies) are performance of our contract
        with you, our legitimate interests in operating and securing the
        service, your consent (for non-essential cookies), and compliance with
        law.
      </p>

      <h2>4. AI model providers</h2>
      <p>
        To generate content we send the relevant inputs to model and media
        providers listed as <a href="/legal/subprocessors">subprocessors</a>.
        We use providers under terms that prohibit training on your content by
        default where such controls are offered. We do not sell your personal
        data.
      </p>

      <h2>5. Sharing</h2>
      <p>
        We share data only with: the subprocessors that run the service on our
        behalf; the third-party platforms you explicitly connect (to publish or
        advertise); and authorities where required by law. We do not share your
        data for others&rsquo; advertising.
      </p>

      <h2>6. Retention</h2>
      <p>
        We keep account and content data for as long as your account is active.
        Audit and billing records are retained as needed for security and
        accounting obligations. When you delete your account, we delete or
        anonymize your personal data, subject to those limited retention needs.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct,
        export, or delete your personal data, to object to or restrict certain
        processing, and to withdraw consent. We build these in:
      </p>
      <ul>
        <li>
          <strong>Export</strong>: download everything we hold from{" "}
          <a href="/settings/privacy">Settings → Data &amp; privacy</a>.
        </li>
        <li>
          <strong>Deletion</strong>: erase your account and data from the same
          screen; deletion cascades across your records.
        </li>
      </ul>
      <p>
        You can also email{" "}
        <a href="mailto:privacy@marketer.sh">privacy@marketer.sh</a>. You may
        lodge a complaint with your local data-protection authority.
      </p>

      <h2>8. International transfers</h2>
      <p>
        We and our subprocessors may process data in the United States and other
        countries. Where required, we rely on appropriate safeguards such as the
        EU Standard Contractual Clauses.
      </p>

      <h2>9. Security</h2>
      <p>
        We use encryption in transit and at rest, least-privilege access,
        role-based administration, and an append-only audit log. No system is
        perfectly secure, but we work to protect your data and will notify you
        of a breach where the law requires.
      </p>

      <h2>10. Children</h2>
      <p>
        The service is not directed to anyone under 18, and we do not knowingly
        collect their data.
      </p>

      <h2>11. Changes and contact</h2>
      <p>
        We will post updates here with a new effective date. Contact us at{" "}
        <a href="mailto:privacy@marketer.sh">privacy@marketer.sh</a>.
      </p>
    </LegalDoc>
  );
}
