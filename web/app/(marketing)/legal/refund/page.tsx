import type { Metadata } from "next";

import { LegalDoc } from "@/components/marketing/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Refund Policy · marketer.sh",
  description: "How prepaid credits, billing, and refunds work at marketer.sh.",
};

export default function RefundPage() {
  return (
    <LegalDoc
      title="Refund Policy"
      intro="This policy explains how prepaid credits work and when refunds are available. It is part of the Terms of Service."
    >
      <h2>Prepaid credits</h2>
      <p>
        Paid usage runs on prepaid credits you purchase in advance. Credits are
        consumed as the platform meters spend on generation and other billable
        actions, at the rates shown in-product at the time of use. Your balance
        and every charge — down to the individual API call — are visible in{" "}
        <a href="/settings/billing">Settings → Billing</a>.
      </p>

      <h2>Unused credits</h2>
      <p>
        Unused prepaid credits remain available on your account and do not
        expire while your account is active. You can stop purchasing at any time;
        we do not auto-charge you beyond the credits you buy unless you enable an
        explicit top-up.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>
          <strong>Unused balance</strong> — you may request a refund of your
          remaining, unused prepaid balance within 30 days of purchase. We refund
          to the original payment method.
        </li>
        <li>
          <strong>Consumed credits</strong> — credits already spent on completed
          generation or third-party costs are non-refundable, because the
          underlying provider work has been performed.
        </li>
        <li>
          <strong>Billing errors</strong> — if you were charged in error or a
          run failed and still consumed credits due to our fault, we will credit
          you back. Reach us and we will make it right.
        </li>
      </ul>

      <h2>Ad spend</h2>
      <p>
        Money spent on third-party ad platforms is paid to those platforms from
        budgets you authorize and is subject to their refund policies, not ours.
      </p>

      <h2>Agent payments (x402)</h2>
      <p>
        Credits added by agents through the x402 payment flow follow this same
        policy. On-chain settlement is final; refunds of an unused balance funded
        that way are issued as account credit or to a wallet you designate.
      </p>

      <h2>How to request</h2>
      <p>
        Email <a href="mailto:billing@marketer.sh">billing@marketer.sh</a> from
        your account email with your request. We aim to respond within a few
        business days.
      </p>
    </LegalDoc>
  );
}
