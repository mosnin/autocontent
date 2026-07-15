import type { Metadata } from "next";

import { LegalDoc } from "@/components/marketing/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Acceptable Use Policy · marketer.sh",
  description: "What you may and may not do with marketer.sh and its agents.",
};

export default function AcceptableUsePage() {
  return (
    <LegalDoc
      title="Acceptable Use Policy"
      intro="This policy keeps the platform safe and lawful. It applies to you and to any agent, token, or team member acting under your account."
    >
      <h2>Prohibited content</h2>
      <p>Do not use marketer.sh to create, publish, or promote:</p>
      <ul>
        <li>Illegal content, or content that facilitates illegal activity.</li>
        <li>
          Child sexual abuse material, or any sexual content involving minors.
        </li>
        <li>
          Content that harasses, threatens, defames, or incites violence against
          people or groups, including on the basis of protected characteristics.
        </li>
        <li>
          Deceptive impersonation of a real person or organization, forged
          records, or synthetic media designed to mislead about real events.
        </li>
        <li>
          Fraud, scams, deceptive advertising, or unsubstantiated health,
          financial, or earnings claims.
        </li>
        <li>Malware, phishing, or content that compromises security.</li>
        <li>
          Infringement of intellectual-property or privacy rights, including
          publishing others&rsquo; personal data without a lawful basis.
        </li>
      </ul>

      <h2>Prohibited conduct</h2>
      <ul>
        <li>
          Circumventing spend caps, approvals, rate limits, or the ad-spend
          guard, or attempting to spend beyond what you have authorized.
        </li>
        <li>
          Accessing accounts, data, or campaigns that are not yours, or probing
          the platform for vulnerabilities without authorization.
        </li>
        <li>
          Reselling or sublicensing the service in a way that violates these
          policies, or operating agents that generate abusive load.
        </li>
        <li>
          Violating the terms or policies of any connected platform, including
          rules on automation, disclosure, and advertising.
        </li>
      </ul>

      <h2>Advertising and disclosure</h2>
      <p>
        Paid campaigns must comply with the policies of the ad platform and with
        applicable advertising law, including truthful claims and any required
        disclosure of AI-generated media. You are responsible for the targeting,
        claims, and creative you run.
      </p>

      <h2>Enforcement</h2>
      <p>
        We may remove content, suspend agents or tokens, or suspend or terminate
        accounts that violate this policy, and we may report unlawful activity
        to authorities. Where practical we will give notice, but we may act
        immediately to prevent harm. Report abuse to{" "}
        <a href="mailto:abuse@marketer.sh">abuse@marketer.sh</a>.
      </p>
    </LegalDoc>
  );
}
