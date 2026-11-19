const allowedDestinations = ["/pipeline", "/follow-ups", "/calendar"];

export function getSafeRedirect(value: unknown): string {
  return typeof value === "string" && allowedDestinations.includes(value)
    ? value
    : "/pipeline";
}
