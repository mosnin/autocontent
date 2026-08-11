// Fidelity harness for the Opsra transcription. Renders the full #main
// subtree against the verbatim Framer stylesheet so the port can be
// screenshot-diffed against the original export. Not linked from anywhere.
import "@/components/opsra/opsra.css";

import { OpsraPage } from "@/components/opsra/page-full";

export default function OpsraPortPage() {
  return <OpsraPage />;
}
