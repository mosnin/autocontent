import { approvalArgsHash, sha256Hex, stableStringify } from "@agent-starter/core";

/**
 * Canonical arguments (docs/rails/approvals.md). The harness binds every approval to `approvalArgsHash(args)`
 * (sha256 of `stableStringify`: keys sorted, undefined dropped, no whitespace). The rails reuse that exact hash, so
 * the dispatch log line joins with the approval record (`as_approvals.args_hash`) of the call it executes.
 * The backend's `marketer/rails/canonical.py` produces the same bytes for JSON-native values; both test suites
 * pin the same vectors.
 */
export const canonicalJson = (value: unknown): string => stableStringify(value);
export const canonicalHash = (value: unknown): Promise<string> => sha256Hex(stableStringify(value));
/** The hash an approval of this call was bound to. */
export const railsArgsHash = (args: unknown): Promise<string> => approvalArgsHash(args);
