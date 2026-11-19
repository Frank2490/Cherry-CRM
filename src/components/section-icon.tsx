export type SectionIconName = "pipeline" | "follow-ups" | "calendar";

type SectionIconProps = {
  name: SectionIconName;
  className?: string;
};

export function SectionIcon({ name, className = "size-5" }: SectionIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "pipeline" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M9 4v16M15 4v16M5.5 8h1M11.5 8h1M17.5 8h1" />
        </>
      )}
      {name === "follow-ups" && (
        <>
          <path d="M3 10a9 9 0 1 1 2.3 8M3 5v5h5" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2" />
        </>
      )}
    </svg>
  );
}
