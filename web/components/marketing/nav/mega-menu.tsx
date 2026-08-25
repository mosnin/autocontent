"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { MenuLink } from "./menu-data";

type MegaGroup = {
  title: string;
  items: MenuLink[];
};

type MegaMenuProps = {
  label: string;
  items?: MenuLink[];
  groups?: MegaGroup[];
  variant: "product" | "list" | "groups";
};

export function MegaMenu({
  label,
  items = [],
  groups = [],
  variant,
}: MegaMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="focus-ring text-muted-foreground hover:text-foreground flex h-10 items-center gap-1 rounded-full px-4 text-sm font-medium transition-colors"
      >
        {label}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-200",
            open && "rotate-180"
          )}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>

      <div
        id={menuId}
        hidden={!open}
        className={cn(
          "border-border bg-background absolute top-full left-0 z-50 mt-3 overflow-hidden rounded-3xl border shadow-[0_24px_60px_-28px_rgba(0,0,0,0.28)]",
          variant === "product"
            ? "w-[min(720px,calc(100vw-2.5rem))]"
            : variant === "groups"
              ? "w-[min(520px,calc(100vw-2.5rem))]"
              : "w-72"
        )}
      >
        {variant === "product" ? (
          <div className="grid gap-px sm:grid-cols-3">
            {items.map((item) => (
              <MegaItem
                key={item.href}
                item={item}
                onClick={() => setOpen(false)}
                className="p-5"
              />
            ))}
          </div>
        ) : variant === "groups" ? (
          <div className="grid gap-6 p-5 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                  {group.title}
                </p>
                <ul className="mt-3 space-y-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <MegaItem
                        item={item}
                        onClick={() => setOpen(false)}
                        className="hover:bg-muted rounded-2xl px-3 py-2"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="p-2">
            {items.map((item) => (
              <li key={item.href}>
                <MegaItem
                  item={item}
                  onClick={() => setOpen(false)}
                  className="hover:bg-muted rounded-2xl px-4 py-3"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MegaItem({
  item,
  onClick,
  className,
}: {
  item: MenuLink;
  onClick: () => void;
  className: string;
}): ReactNode {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn("focus-ring block transition-colors", className)}
    >
      <p className="text-foreground text-sm font-medium tracking-tight">
        {item.label}
      </p>
      {item.body ? (
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {item.body}
        </p>
      ) : null}
    </Link>
  );
}
