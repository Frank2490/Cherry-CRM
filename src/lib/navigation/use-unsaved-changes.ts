"use client";

import { useEffect, type MouseEvent } from "react";
import { confirmDiscardChanges, registerUnsavedChanges } from "@/lib/navigation/unsaved-changes";

export function useUnsavedChanges(dirty: boolean, blocked = false) {
  useEffect(() => {
    if (!dirty && !blocked) return;
    return registerUnsavedChanges({ dirty, blocked });
  }, [dirty, blocked]);
  return (reason?: string) => confirmDiscardChanges(dirty, blocked, reason);
}

export function isDialogBackdropClick(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom;
}
