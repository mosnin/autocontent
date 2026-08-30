"use client";

/**
 * User avatars.
 *
 * Clerk always hands back an `imageUrl` — when a person has never uploaded a
 * photo it's a generated initials tile from img.clerk.com. So "do they have a
 * profile photo?" is `user.hasImage`, never `!!user.imageUrl`. When there's no
 * real photo we render a deterministic AgentAvatar preset seeded by the user's
 * id, so the same person carries the same mark on every surface.
 */

import * as React from "react";
import { UserButton, useUser } from "@clerk/nextjs";

import AgentAvatar from "@/components/smoothui/agent-avatar";
import { cn } from "@/lib/utils";

/** Clerk's default UserButton avatar box, in px. */
const CLERK_AVATAR_PX = 28;

export interface UserAvatarProps {
  /** Stable identity for the preset — use the user id, never an email. */
  seed: string;
  /** Clerk's imageUrl. Only used when `hasImage` is true. */
  imageUrl?: string | null;
  /** Clerk's `hasImage`: true only when a real photo is saved. */
  hasImage?: boolean;
  /** Diameter in px. */
  size?: number;
  /** Accessible name — omit for decorative use next to a visible name. */
  alt?: string;
  className?: string;
  animated?: boolean;
}

/**
 * A person's photo when they've saved one, otherwise their preset. Also falls
 * back to the preset if the photo fails to load.
 */
export function UserAvatar({
  seed,
  imageUrl,
  hasImage = false,
  size = 32,
  alt,
  className,
  animated = true,
}: UserAvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const showPhoto = hasImage && !!imageUrl && !failed;

  if (showPhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt ?? ""}
        className={cn("shrink-0 rounded-full object-cover", className)}
        height={size}
        onError={() => setFailed(true)}
        src={imageUrl}
        width={size}
      />
    );
  }

  return (
    <AgentAvatar
      aria-hidden={alt ? undefined : true}
      aria-label={alt || undefined}
      className={cn("shrink-0", className)}
      animated={animated}
      seed={seed}
      size={size}
    />
  );
}

/**
 * The signed-in account control: Clerk's UserButton (menu, sign-out, and
 * accessibility all intact) wearing the preset when no photo is saved.
 *
 * Clerk gives no render slot for the trigger's avatar, so we pin the avatar
 * box to a known size, make its generated image transparent, and paint our
 * canvas underneath. The button itself is untouched and still owns every
 * interaction.
 */
export function AccountAvatar({ size = CLERK_AVATAR_PX }: { size?: number }) {
  const { isLoaded, user } = useUser();
  const usePreset = isLoaded && !!user && !user.hasImage;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ height: size, width: size }}
    >
      {usePreset && user && (
        // Static: this sits in the sidebar on every page, and a permanent
        // requestAnimationFrame loop is a poor trade for motion on a 28px
        // mark. The presets animate where they're a focal element.
        <AgentAvatar
          animated={false}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          seed={user.id}
          size={size}
        />
      )}
      <UserButton
        afterSignOutUrl="/"
        appearance={{
          elements: {
            // Pin the box so the canvas underneath always lines up.
            userButtonAvatarBox: {
              height: size,
              width: size,
              ...(usePreset ? { background: "transparent" } : {}),
            },
            // Clerk's generated initials tile — hidden, not removed, so the
            // trigger keeps its size, hit area, and accessible name.
            ...(usePreset ? { userButtonAvatarImage: { opacity: 0 } } : {}),
          },
        }}
      />
    </span>
  );
}
