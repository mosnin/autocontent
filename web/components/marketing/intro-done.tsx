"use client";

import { markIntroDone } from "@/lib/marketing/intro";
import { useEffect } from "react";

/** Auth and onboarding never play the homepage intro loader. */
export function IntroDone() {
  useEffect(() => {
    markIntroDone();
  }, []);
  return null;
}
