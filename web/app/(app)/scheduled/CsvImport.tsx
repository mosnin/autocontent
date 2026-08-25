"use client";

// Bulk CSV import. The endpoint answers 200 with `{created, errors[]}` even
// when every row failed - the per-row report IS the contract, not an error
// envelope - so this component renders the report as a first-class result and
// only treats a transport/format failure (400) as an error.
//
// Import is all-or-nothing server-side: one bad row creates nothing. That is
// said out loud here, because it is the difference between "fix line 7 and
// re-upload" and "fix line 7 and now everything else is duplicated".

import * as React from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CSV_TEMPLATE_HEADER,
  importScheduledPosts,
  scheduledErrorMessage,
  type ImportReport,
} from "@/lib/scheduled-client";

export function CsvImport({ onImported }: { onImported: () => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [report, setReport] = React.useState<ImportReport | null>(null);

  async function handleUpload() {
    if (!file || busy) return;
    setBusy(true);
    setReport(null);
    try {
      const result = await importScheduledPosts(file);
      setReport(result);
      if (result.created > 0) {
        toast.success(`Imported ${result.created} post${result.created === 1 ? "" : "s"}`);
        onImported();
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      } else {
        // Not a toast.error: the file was read fine, the rows just need work.
        toast.message("Nothing imported - see the row report below");
      }
    } catch (err) {
      toast.error(scheduledErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Import from CSV</CardTitle>
        <CardDescription>
          One row per post. Every row is validated before any row is written - if
          one row is wrong, nothing is created, so you can fix the file and
          re-upload without duplicating anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="max-w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Button onClick={() => void handleUpload()} disabled={!file || busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
            Upload
          </Button>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium">Expected header row</p>
          <pre className="mt-1 overflow-x-auto text-xs">{CSV_TEMPLATE_HEADER}</pre>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium">platforms</span> and{" "}
            <span className="font-medium">scheduled_at</span> are required;
            column names are case- and space-insensitive. A bare{" "}
            <span className="font-mono">scheduled_at</span> (no offset) is read in
            that row&apos;s <span className="font-medium">timezone</span> column,
            which is what a spreadsheet author means by &ldquo;2026-03-09
            09:00&rdquo;. Add a <span className="font-mono">variant_&lt;platform&gt;</span>{" "}
            column for per-platform copy.
          </p>
        </div>

        {report ? (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">{report.created}</span> post
              {report.created === 1 ? "" : "s"} created
              {report.errors.length > 0
                ? ` · ${report.errors.length} row${report.errors.length === 1 ? "" : "s"} rejected`
                : null}
              .
            </p>
            {report.errors.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 w-20 text-xs font-medium text-muted-foreground">
                        Row
                      </TableHead>
                      <TableHead className="h-9 text-xs font-medium text-muted-foreground">
                        Why it was rejected
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.errors.map((e, i) => (
                      <TableRow key={`${e.row}-${i}`} className="border-b last:border-0">
                        <TableCell className="py-2 font-mono text-xs tabular-nums">
                          {e.row}
                        </TableCell>
                        <TableCell className="py-2 text-sm">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            {report.created === 0 && report.errors.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Row numbers match your spreadsheet - row 1 is the header. Nothing
                was written, so fix these lines and upload the same file again.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
