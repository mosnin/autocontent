import type { Metadata } from "next";

import { LegalDoc } from "@/components/marketing/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Terms of Service · marketer.sh",
  description: "The agreement that governs your use of marketer.sh.",
};

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      intro="These terms are a binding agreement between you and marketer.sh. By creating an account or using the platform, including through an AI agent acting on your behalf, you agree to them."
    >
      <h2>1. The service</h2>
      <p>
        marketer.sh is a marketing platform that produces, publishes, and helps
        manage content (short-form video, long-form articles, and paid ad
        campaigns) on your behalf and, where you authorize it, on behalf of AI
        agents you operate. We provide the software, the pipelines, and the
        agent surfaces (REST API, SDK, CLI, and MCP server); you provide the
        direction, the connected accounts, and the funds to run them.
      </p>

      <h2>2. Accounts and eligibility</h2>
      <p>
        You must be at least 18 and able to form a binding contract. You are
        responsible for everything that happens under your account, including
        actions taken by agents, API tokens, or team members you authorize.
        Keep your credentials and personal access tokens secret; treat a token
        as you would a password. Notify us promptly at{" "}
        <a href="mailto:security@marketer.sh">security@marketer.sh</a> if you
        suspect unauthorized use.
      </p>

      <h2>3. Your content and licenses</h2>
      <p>
        You retain ownership of the briefs, brand assets, and other materials
        you provide (&ldquo;Your Content&rdquo;) and of the outputs the platform
        generates for you. You grant us a limited license to host, process, and
        transmit Your Content solely to operate the service: for example, to
        run a pipeline, publish a post, or serve an ad. You represent that you
        have the rights to Your Content and that it, and the outputs you choose
        to publish, do not infringe others&rsquo; rights or violate our{" "}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a>.
      </p>

      <h2>4. AI-generated output</h2>
      <p>
        The platform uses machine-learning models. Output can be inaccurate,
        derivative, or unsuitable for a given use, and similar output may be
        generated for other customers. You are responsible for reviewing output
        before publishing it and for ensuring it complies with the policies of
        any platform you post to and with applicable law (including disclosure
        rules for advertising and AI-generated media).
      </p>

      <h2>5. Spend, credits, and paid campaigns</h2>
      <p>
        Content generation consumes provider resources that are metered and, on
        paid plans, billed against prepaid credits. Each niche carries a daily
        spend cap and you may set an account-wide cap; we check these before
        spending. Paid ad campaigns spend real money on third-party ad
        platforms from budgets you set. Those budgets pass a fail-closed guard
        and, above your threshold, require your approval, but you remain
        responsible for the amounts you authorize. Billing and refunds are
        described in our <a href="/legal/refund">Refund Policy</a>.
      </p>

      <h2>6. Agent and programmatic access</h2>
      <p>
        You may let AI agents use the platform through our API, SDK, MCP server,
        or the x402 payment flow. You are responsible for the actions of any
        agent you operate as if they were your own, including any spend they
        incur. Spend-affecting actions are governed by the same caps, approvals,
        and audit trail that apply to you directly. Do not use programmatic
        access to circumvent rate limits, caps, or approvals.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        The platform connects to third parties you authorize: social networks,
        ad platforms, payment facilitators, and model providers. Your use of
        those services is governed by their terms, and we are not responsible
        for their acts or omissions. See our{" "}
        <a href="/legal/subprocessors">Subprocessors</a> list for the parties
        that process data on our behalf.
      </p>

      <h2>8. Acceptable use</h2>
      <p>
        Your use of the platform is subject to our{" "}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a>, which is
        incorporated into these terms. We may suspend or terminate accounts that
        violate it, that create risk or legal exposure, or that abuse the
        service.
      </p>

      <h2>9. Suspension and termination</h2>
      <p>
        You may stop using the service and delete your account at any time from
        your settings; deletion removes your data as described in our{" "}
        <a href="/legal/privacy">Privacy Policy</a>. We may suspend or terminate
        access for violations of these terms, non-payment, or to protect the
        service or other users. Unused prepaid credits are handled under the{" "}
        <a href="/legal/refund">Refund Policy</a>.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; and &ldquo;as
        available,&rdquo; without warranties of any kind, whether express or
        implied, including merchantability, fitness for a particular purpose,
        and non-infringement. We do not warrant that the service will be
        uninterrupted, error-free, or that output will meet your requirements or
        any platform&rsquo;s policies.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, marketer.sh will not be liable
        for any indirect, incidental, special, consequential, or punitive
        damages, or for lost profits, revenues, data, or goodwill. Our total
        liability arising out of or relating to the service is limited to the
        greater of the amounts you paid us in the twelve months before the claim
        or one hundred U.S. dollars.
      </p>

      <h2>12. Indemnification</h2>
      <p>
        You will defend and indemnify marketer.sh against claims arising from
        Your Content, your use of the service, your published outputs, your ad
        spend, or your violation of these terms or applicable law.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update these terms. Material changes will be posted here with a
        new effective date and, where appropriate, notified to you. Continued
        use after a change means you accept the updated terms.
      </p>

      <h2>14. Governing law and contact</h2>
      <p>
        These terms are governed by the laws of the State of Delaware, USA,
        excluding its conflict-of-laws rules. Reach us at{" "}
        <a href="mailto:legal@marketer.sh">legal@marketer.sh</a>.
      </p>
    </LegalDoc>
  );
}
