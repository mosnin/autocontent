import type { DeliveredDocumentAttachment, DeliveredImageAttachment } from "@flue/sdk";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { cx } from "../../internal/format.ts";
import type { AttachmentOptions } from "./types.ts";

export interface PendingFile {
  id: string;
  name: string;
  mimeType: string;
  /** Base64 bytes. */
  data: string;
  size: number;
}

export interface ComposerSubmission {
  text: string;
  images: DeliveredImageAttachment[];
  documents: DeliveredDocumentAttachment[];
}

export interface ComposerProps {
  onSubmit: (submission: ComposerSubmission) => void;
  onStop: () => void;
  busy: boolean;
  stopping: boolean;
  disabled: boolean;
  placeholder: string;
  attachments: Required<AttachmentOptions> | null;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  compact?: boolean;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function isAccepted(file: File, accept: string): boolean {
  const tokens = accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return tokens.some((token) => (token.endsWith("/*") ? type.startsWith(token.slice(0, -1)) : token.startsWith(".") ? name.endsWith(token) : type === token));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

let fileCounter = 0;

/**
 * Message composer: auto-growing textarea (Enter sends, Shift+Enter inserts a
 * newline, IME-safe), optional image/PDF attachments (picker, paste, drop),
 * and a stop button while the agent works.
 */
export function Composer({ onSubmit, onStop, busy, stopping, disabled, placeholder, attachments, textareaRef, compact }: ComposerProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = textareaRef ?? ownRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
  }, [value, inputRef]);

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      if (!attachments) return;
      setFileError(null);
      const incoming = [...list];
      const room = attachments.maxFiles - files.length;
      if (incoming.length > room) setFileError(`You can attach up to ${attachments.maxFiles} files.`);
      const accepted: PendingFile[] = [];
      for (const file of incoming.slice(0, Math.max(0, room))) {
        if (!isAccepted(file, attachments.accept)) {
          setFileError(`${file.name} is not a supported file type.`);
          continue;
        }
        if (file.size > attachments.maxFileBytes) {
          setFileError(`${file.name} is larger than ${formatBytes(attachments.maxFileBytes)}.`);
          continue;
        }
        try {
          accepted.push({ id: `file-${++fileCounter}`, name: file.name, mimeType: file.type || "application/octet-stream", data: await readAsBase64(file), size: file.size });
        } catch (cause) {
          setFileError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      if (accepted.length) setFiles((previous) => [...previous, ...accepted].slice(0, attachments.maxFiles));
    },
    [attachments, files.length],
  );

  const submit = () => {
    const text = value.trim();
    if (disabled || (!text && files.length === 0)) return;
    const images: DeliveredImageAttachment[] = [];
    const documents: DeliveredDocumentAttachment[] = [];
    for (const file of files) {
      if (file.mimeType === "application/pdf") documents.push({ type: "document", data: file.data, mimeType: "application/pdf", filename: file.name });
      else images.push({ type: "image", data: file.data, mimeType: file.mimeType, filename: file.name });
    }
    onSubmit({ text, images, documents });
    setValue("");
    setFiles([]);
    setFileError(null);
    inputRef.current?.focus();
  };

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachments || event.clipboardData.files.length === 0) return;
    event.preventDefault();
    void addFiles(event.clipboardData.files);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!attachments || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };

  const canSend = !disabled && (value.trim().length > 0 || files.length > 0);

  return (
    <form
      className={cx("as-composer", compact && "as-composer--compact")}
      onSubmit={onFormSubmit}
      onDragOver={attachments ? (event) => event.preventDefault() : undefined}
      onDrop={onDrop}
      aria-label="Send a message"
    >
      {files.length ? (
        <ul className="as-composer__files" aria-label="Attachments">
          {files.map((file) => (
            <li key={file.id} className="as-chip">
              <span className="as-chip__label">{file.name}</span>
              <button
                type="button"
                className="as-chip__remove"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((previous) => previous.filter((entry) => entry.id !== file.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="as-composer__row">
        {attachments ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="as-sr-only"
              tabIndex={-1}
              aria-hidden="true"
              accept={attachments.accept}
              multiple={attachments.maxFiles > 1}
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="as-icon-btn"
              aria-label="Attach files"
              disabled={disabled || files.length >= attachments.maxFiles}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path d="M16.5 6.5 8.9 14.1a2 2 0 1 0 2.8 2.8l7.4-7.4a4 4 0 1 0-5.7-5.7L5.9 11.3a6 6 0 0 0 8.5 8.5l6.1-6.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </>
        ) : null}
        <textarea
          ref={inputRef}
          className="as-composer__input"
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label="Message"
          aria-describedby={fileError ? `${hintId} ${errorId}` : hintId}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {busy ? (
          <button type="button" className="as-icon-btn as-icon-btn--stop" aria-label={stopping ? "Stopping" : "Stop generating"} disabled={stopping} onClick={onStop}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          </button>
        ) : null}
        <button type="submit" className="as-icon-btn as-icon-btn--send" aria-label="Send message" disabled={!canSend}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p id={hintId} className="as-sr-only">
        Press Enter to send, Shift+Enter for a new line.
      </p>
      {fileError ? (
        <p id={errorId} className="as-error-text" role="alert">
          {fileError}
        </p>
      ) : null}
    </form>
  );
}
