"use client";

import { Logo } from "@/components/marketing/nav/logo";
import { MegaMenu } from "@/components/marketing/nav/mega-menu";
import { MenuIcon } from "@/components/marketing/nav/menu-icon";
import {
  COMPANY_LINKS,
  LEGAL_LINKS,
  PRODUCT_LINKS,
  RESOURCE_LINKS,
  SOCIAL_LINKS,
} from "@/components/marketing/nav/menu-data";
import { MorphLabel } from "@/components/marketing/nav/morph-label";
import { ScrollProgress } from "@/components/marketing/nav/scroll-progress";
import { useIntroDone } from "@/lib/marketing/intro";
import { softEase, useIsDesktop, useReducedMotion } from "@/lib/marketing/motion";
import { AnimatePresence, motion, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

const DIRECT_LINKS = [{ label: "Pricing", href: "/pricing" }];

const CLOSED_WIDTH_DESKTOP = 200;
const CLOSED_WIDTH_MOBILE = 128;
const OPEN_WIDTH = 320;
const CONTENT_WIDTH = OPEN_WIDTH - 16;

const ITEM_DELAY = 0.14;
const ITEM_STAGGER = 0.04;

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      opacity: {
        duration: 0.45,
        ease: softEase,
        delay: ITEM_DELAY + i * ITEM_STAGGER,
      },
      y: {
        type: "spring",
        stiffness: 420,
        damping: 42,
        mass: 0.9,
        restDelta: 0.01,
        delay: ITEM_DELAY + i * ITEM_STAGGER,
      },
    },
  }),
};

export function Nav(): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const introDone = useIntroDone();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closedWidth = isDesktop ? CLOSED_WIDTH_DESKTOP : CLOSED_WIDTH_MOBILE;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const closeMenu = (): void => setMenuOpen(false);

  let itemIndex = 0;
  const nextIndex = (): number => {
    itemIndex += 1;
    return itemIndex;
  };

  return (
    <motion.header
      initial={false}
      animate={
        introDone
          ? { opacity: 1, y: 0 }
          : { opacity: 0, y: prefersReducedMotion ? 0 : -16 }
      }
      transition={
        prefersReducedMotion
          ? { duration: 0.01 }
          : introDone
            ? { duration: 0.6, ease: softEase, delay: 0.3 }
            : { duration: 0 }
      }
      style={{ pointerEvents: introDone ? "auto" : "none" }}
      className="fixed inset-x-0 top-0 z-50"
    >
      <div className="relative flex h-20 items-center justify-between px-5 sm:px-8 lg:px-10">
        <div className="flex items-center gap-3">
          <Logo />
          <nav className="bg-background border-border hidden h-13 items-center rounded-full border p-1.5 lg:flex">
            <MegaMenu label="Product" items={PRODUCT_LINKS} variant="product" />
            <MegaMenu label="Resources" items={RESOURCE_LINKS} variant="list" />
            <MegaMenu
              label="Company"
              variant="groups"
              groups={[
                {
                  title: "Company",
                  items: COMPANY_LINKS.filter((link) => link.href !== "/legal"),
                },
                { title: "Legal", items: LEGAL_LINKS },
              ]}
            />
            {DIRECT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="focus-ring text-muted-foreground hover:text-foreground flex h-10 items-center rounded-full px-4 text-sm font-medium transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="absolute top-1.5 right-5 z-50 lg:right-auto lg:left-1/2 lg:-translate-x-1/2">
          <motion.div
            initial={false}
            animate={{
              width: menuOpen ? OPEN_WIDTH : closedWidth,
              boxShadow: menuOpen
                ? "0 30px 70px -24px rgba(0,0,0,0.25)"
                : "0 30px 70px -24px rgba(0,0,0,0)",
            }}
            transition={
              prefersReducedMotion
                ? { duration: 0.01 }
                : { duration: 0.45, ease: softEase }
            }
            className="relative rounded-[28px] p-2"
          >
            <motion.div
              initial={false}
              animate={{ opacity: menuOpen ? 1 : 0 }}
              transition={{ duration: 0.35, ease: softEase }}
              className="bg-background border-border pointer-events-none absolute inset-0 rounded-[28px] border"
            />
            <div className="relative">
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  color: "var(--surface-foreground)",
                }}
                className="flex h-13 w-full items-center justify-end gap-2 rounded-full pr-1.5 pl-1.5 lg:justify-between lg:pr-2"
              >
                <button
                  ref={toggleRef}
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-expanded={menuOpen}
                  aria-label={menuOpen ? "Close menu" : "Open menu"}
                  className="focus-ring flex items-center gap-2.5 rounded-full px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
                >
                  <MenuIcon open={menuOpen} />
                  <MorphLabel value={menuOpen ? "Close" : "Menu"} />
                </button>
                {isDesktop && <ScrollProgress />}
              </div>

              <AnimatePresence initial={false}>
                {menuOpen && (
                  <motion.div
                    key="panel"
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    transition={
                      prefersReducedMotion
                        ? { duration: 0.01 }
                        : { duration: 0.45, ease: softEase }
                    }
                    className="overflow-hidden"
                  >
                    <div className="flex justify-center">
                      <motion.div
                        initial={prefersReducedMotion ? false : "hidden"}
                        animate={prefersReducedMotion ? false : "visible"}
                        style={{ width: CONTENT_WIDTH }}
                        className="shrink-0 px-4 pt-7 pb-3"
                      >
                        <MobileGroup title="Product" index={nextIndex()}>
                          {PRODUCT_LINKS.map((link) => (
                            <MobileLink
                              key={link.href}
                              href={link.href}
                              onClick={closeMenu}
                              index={nextIndex()}
                            >
                              {link.label}
                            </MobileLink>
                          ))}
                        </MobileGroup>

                        <MobileGroup title="Resources" index={nextIndex()}>
                          {RESOURCE_LINKS.map((link) => (
                            <MobileLink
                              key={link.href}
                              href={link.href}
                              onClick={closeMenu}
                              index={nextIndex()}
                            >
                              {link.label}
                            </MobileLink>
                          ))}
                        </MobileGroup>

                        <MobileGroup title="Company" index={nextIndex()}>
                          {COMPANY_LINKS.map((link) => (
                            <MobileLink
                              key={link.href}
                              href={link.href}
                              onClick={closeMenu}
                              index={nextIndex()}
                            >
                              {link.label}
                            </MobileLink>
                          ))}
                          <MobileLink
                            href="/pricing"
                            onClick={closeMenu}
                            index={nextIndex()}
                          >
                            Pricing
                          </MobileLink>
                        </MobileGroup>

                        <motion.div
                          custom={nextIndex()}
                          variants={ITEM_VARIANTS}
                          className="bg-border my-6 h-px w-full"
                        />

                        <div className="flex flex-col gap-3">
                          <motion.span
                            custom={nextIndex()}
                            variants={ITEM_VARIANTS}
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase"
                          >
                            Legal
                          </motion.span>
                          {LEGAL_LINKS.slice(0, 4).map((link) => (
                            <motion.a
                              key={link.href}
                              href={link.href}
                              onClick={closeMenu}
                              custom={nextIndex()}
                              variants={ITEM_VARIANTS}
                              className="focus-ring text-foreground/80 hover:text-foreground w-fit text-sm font-medium transition-colors"
                            >
                              {link.label}
                            </motion.a>
                          ))}
                        </div>

                        <div className="mt-7 flex flex-col gap-3">
                          <motion.span
                            custom={nextIndex()}
                            variants={ITEM_VARIANTS}
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase"
                          >
                            Social media
                          </motion.span>
                          <div className="flex flex-wrap gap-x-5 gap-y-2">
                            {SOCIAL_LINKS.map((link) => (
                              <motion.a
                                key={link.href}
                                href={link.href}
                                onClick={closeMenu}
                                custom={nextIndex()}
                                variants={ITEM_VARIANTS}
                                className="focus-ring text-foreground/80 hover:text-foreground text-sm font-medium transition-colors"
                              >
                                {link.label}
                              </motion.a>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="focus-ring text-foreground hover:text-foreground hidden h-13 items-center rounded-full px-5 text-sm font-medium transition-colors md:inline-flex"
          >
            Login
          </Link>
          <Link
            href="/sign-up"
            className="focus-ring bg-foreground text-background hidden h-13 items-center rounded-full px-6 text-sm font-medium transition-opacity hover:opacity-85 md:inline-flex"
          >
            Sign up
          </Link>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 -z-10 cursor-default"
          />
        )}
      </AnimatePresence>
    </motion.header>
  );
}

function MobileGroup({
  title,
  index,
  children,
}: {
  title: string;
  index: number;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <motion.span
        custom={index}
        variants={ITEM_VARIANTS}
        className="text-muted-foreground mb-1 text-[11px] font-medium tracking-wider uppercase"
      >
        {title}
      </motion.span>
      {children}
    </div>
  );
}

function MobileLink({
  href,
  onClick,
  index,
  children,
}: {
  href: string;
  onClick: () => void;
  index: number;
  children: ReactNode;
}): ReactNode {
  return (
    <motion.a
      href={href}
      onClick={onClick}
      custom={index}
      variants={ITEM_VARIANTS}
      className="focus-ring text-foreground hover:text-foreground/55 w-fit text-[24px] leading-tight font-medium tracking-tight transition-colors"
    >
      {children}
    </motion.a>
  );
}
