"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, cx, EmptyLine, Input, Modal, Notice, Skeleton, usePending } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import { httpsOnly, type SeoArticle, type UnsplashCover, type UnsplashPhoto } from "@/lib/seo";

/** Unsplash's required credit: photographer and Unsplash, both linked. */
export function UnsplashCredit({ cover, className }: { cover: Pick<UnsplashCover, "author_name" | "author_url" | "unsplash_url">; className?: string }) {
  const author = httpsOnly(cover.author_url);
  const home = httpsOnly(cover.unsplash_url);
  return (
    <span className={cx("text-[12px] text-fg-muted", className)}>
      Photo by{" "}
      {author ? (
        <a href={author} target="_blank" rel="noopener noreferrer" className="text-fg hover:underline">
          {cover.author_name}
        </a>
      ) : (
        cover.author_name
      )}{" "}
      on{" "}
      {home ? (
        <a href={home} target="_blank" rel="noopener noreferrer" className="text-fg hover:underline">
          Unsplash
        </a>
      ) : (
        "Unsplash"
      )}
    </span>
  );
}

/** The article's cover, credited. Hotlinked from Unsplash, per its guidelines. */
export function CoverImage({ cover, action }: { cover: UnsplashCover; action?: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // A cached image can finish before hydration attaches onLoad.
  useEffect(() => {
    if (img.current?.complete) setLoaded(true);
  }, []);
  return (
    <figure className="space-y-1.5">
      <div className="relative overflow-hidden rounded-ds-lg border border-hairline bg-surface-2" style={{ aspectRatio: "16/9" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={img}
          src={cover.url}
          alt={cover.alt || "Article cover"}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cx("absolute inset-0 size-full object-cover transition-opacity duration-300 ease-[var(--ds-ease-out)]", loaded ? "opacity-100" : "opacity-0")}
        />
      </div>
      <figcaption className="flex min-h-6 items-center justify-between gap-3">
        <UnsplashCredit cover={cover} />
        {action}
      </figcaption>
    </figure>
  );
}

/** Choose a cover: one focused sheet with an Unsplash search grid. */
export function CoverPicker({ article, open, onClose, fixture }: { article: SeoArticle; open: boolean; onClose: () => void; fixture?: UnsplashPhoto[] }) {
  const router = useRouter();
  const [q, setQ] = useState(article.focus_keyword || article.topic);
  const [photos, setPhotos] = useState<UnsplashPhoto[] | null>(fixture ?? null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(article.cover_image?.id ?? null);
  const { busy, error, run } = usePending<"use" | "remove">();

  const search = async (term: string) => {
    if (fixture) return;
    setLoading(true);
    setSearchError(null);
    try {
      const data = await proxyFetch<{ photos: UnsplashPhoto[] }>(`/api/v1/articles/${article.id}/cover/search?q=${encodeURIComponent(term)}`, "GET");
      setPhotos(data.photos);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Couldn't search Unsplash.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && photos === null) void search(q);
    // Search once per opening with the article's keyword.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const use = () =>
    run("use", async () => {
      await proxyFetch(`/api/v1/articles/${article.id}/cover`, "PUT", { photo_id: picked });
      router.refresh();
      onClose();
    });
  const remove = () =>
    run("remove", async () => {
      await proxyFetch(`/api/v1/articles/${article.id}/cover`, "DELETE");
      router.refresh();
      onClose();
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cover photo"
      width="lg"
      footer={
        <>
          {article.cover_image && (
            <Button variant="ghost" className="mr-auto" onClick={() => void remove()} loading={busy === "remove"} disabled={busy !== null}>
              Remove cover
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void use()} loading={busy === "use"} disabled={!picked || picked === article.cover_image?.id || busy !== null}>
            Use photo
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <form
          role="search"
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            void search(q.trim());
          }}
        >
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Unsplash" placeholder="Search Unsplash" className="pl-8" />
        </form>
        <Notice error={searchError ?? error} />
        {loading || photos === null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[3/2] rounded-ds-md" />
            ))}
          </div>
        ) : photos.length === 0 ? (
          <EmptyLine>No photos for “{q}”. Try a broader word.</EmptyLine>
        ) : (
          <div role="radiogroup" aria-label="Photos" className="grid max-h-[46vh] grid-cols-2 gap-x-2 gap-y-3 overflow-y-auto p-0.5 sm:grid-cols-3">
            {photos.map((p) => {
              const on = picked === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${p.alt || "Photo"} by ${p.author_name}`}
                  onClick={() => setPicked(p.id)}
                  className="ds-press group min-w-0 space-y-1 rounded-ds-md text-left active:scale-[0.98]"
                >
                  <span className={cx("relative block aspect-[3/2] overflow-hidden rounded-ds-md border bg-surface-2 transition-[border-color,box-shadow] duration-150", on ? "border-ds-accent ring-2 ring-ds-accent/40" : "border-hairline group-hover:border-hairline-strong")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb_url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                  </span>
                  <span className="block truncate px-0.5 text-[12px] text-fg-muted">{p.author_name}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[12px] text-fg-faint">Photos come from Unsplash and are credited wherever the cover appears.</p>
      </div>
    </Modal>
  );
}
