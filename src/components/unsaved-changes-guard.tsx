"use client";

import { useEffect } from "react";
import { installNavigationGuard } from "@/lib/navigation/unsaved-changes";

export function UnsavedChangesGuard() {
  useEffect(() => installNavigationGuard(), []);
  return null;
}
