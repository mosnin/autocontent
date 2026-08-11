import type { Metadata } from "next";

import { LegalDoc } from "@/components/marketing/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Data Processing Addendum · marketer.sh",
  description: "Our processor commitments for business customers (GDPR Art. 28).",
};

export default function DpaPage() {
  return (
    <LegalDoc
      title="Data Processing Addendum"
      intro="This addendum applies where marketer.sh processes personal data on behalf of a business customer (the controller). It forms part of the Terms of Service for those customers and reflects Article 28 of the GDPR."
    >
      <h2>1. Roles</h2>
      <p>
        For data you upload or that your end users provide, you are the
        controller and we are the processor. For account and billing data about
        you, we are the controller under our{" "}
        <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>2. Scope and instructions</h2>
      <p>
        We process personal data only to provide the service and on your
        documented instructions, including as configured through the product and
        API. We will tell you if an instruction appears to infringe applicable
        law.
      </p>

      <h2>3. Confidentiality</h2>
      <p>
        Personnel authorized to process personal data are bound by
        confidentiality and access it on a least-privilege basis.
      </p>

      <h2>4. Security</h2>
      <p>
        We maintain technical and organizational measures appropriate to the
        risk, including encryption in transit and at rest, role-based access
        control, and an append-only audit log of privileged actions.
      </p>

      <h2>5. Subprocessors</h2>
      <p>
        You authorize the use of the subprocessors listed on our{" "}
        <a href="/legal/subprocessors">Subprocessors</a> page. We impose data
        protection terms on each and remain responsible for their performance.
        We will give notice before adding a subprocessor that materially affects
        your data, so you may object on reasonable grounds.
      </p>

      <h2>6. Data subject rights</h2>
      <p>
        We provide self-service export and deletion, and will otherwise assist
        you in responding to data-subject requests taking into account the
        nature of the processing.
      </p>

      <h2>7. Breach notification</h2>
      <p>
        We will notify you without undue delay after becoming aware of a
        personal-data breach affecting your data, with the information you need
        to meet your own obligations.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Where we transfer personal data internationally, we rely on appropriate
        safeguards such as the EU Standard Contractual Clauses.
      </p>

      <h2>9. Deletion and return</h2>
      <p>
        On termination, we delete or return personal data at your choice, subject
        to limited retention required by law. Account deletion in-product
        cascades across your records.
      </p>

      <h2>10. Audits</h2>
      <p>
        We will make available information reasonably necessary to demonstrate
        compliance with this addendum. To request a copy of this DPA for
        signature, email{" "}
        <a href="mailto:legal@marketer.sh">legal@marketer.sh</a>.
      </p>
    </LegalDoc>
  );
}
