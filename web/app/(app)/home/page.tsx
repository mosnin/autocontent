import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { GradientText } from "@/components/ui/gradient-text";
import {
  PRODUCTS,
  productAccentClass,
  type Product,
} from "@/lib/products";

export const dynamic = "force-dynamic";

// The suite launcher — the Google-Workspace "home" that presents each product
// as its own tile. From here you enter a product and get its focused
// dashboard + sidebar; the products never blur together.
export default function HomePage() {
  const primary = PRODUCTS.filter((p) => p.id !== "suite");
  const suite = PRODUCTS.find((p) => p.id === "suite");

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          marketer.sh
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Your marketing <GradientText>suite</GradientText>
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          One workspace, distinct products. Pick where you want to work and each
          opens its own dashboard. Agents, spend controls, and your brand kit
          carry across all of them.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {primary.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {suite && (
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Account
          </h2>
          <Link
            href={suite.home}
            className={cn(
              "group flex items-center gap-4 rounded-xl border border-border/60 bg-card/40 p-4 transition-colors",
              "hover:border-brand/30 hover:bg-card/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
            )}
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm",
                productAccentClass(suite.accent),
              )}
            >
              <suite.icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{suite.label}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {suite.tagline}
              </span>
            </span>
            <ArrowRight
              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
              aria-hidden
            />
          </Link>
        </div>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const Icon = product.icon;
  return (
    <Link
      href={product.home}
      className={cn(
        "group flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/50 p-6 transition-all",
        "hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_8px_28px_-18px_rgb(0_0_0/0.25)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
      )}
    >
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-xl text-white shadow-sm",
          productAccentClass(product.accent),
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">
          {product.label}
        </h3>
        <p className="text-sm text-muted-foreground">{product.tagline}</p>
      </div>
      <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand">
        Open
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}
