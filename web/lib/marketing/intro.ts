"use client";

import { useSyncExternalStore } from "react";

let done = false;
const listeners = new Set<() => void>();

export function markIntroDone(): void {
  if (done) return;
  done = true;
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useIntroDone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => done,
    () => false
  );
}
