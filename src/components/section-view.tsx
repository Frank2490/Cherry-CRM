import {
  SectionIcon,
  type SectionIconName,
} from "@/components/section-icon";

type SectionViewProps = {
  title: string;
  description: string;
  icon: SectionIconName;
  emptyTitle: string;
  emptyDescription: string;
};

export function SectionView({
  title,
  description,
  icon,
  emptyTitle,
  emptyDescription,
}: SectionViewProps) {
  return (
    <div>
      <header className="mb-8 sm:mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-[34px]">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600 sm:text-base">
          {description}
        </p>
      </header>

      <section
        aria-labelledby="empty-state-title"
        className="flex min-h-90 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-6 py-14 shadow-xs sm:min-h-112 sm:px-10 lg:min-h-120"
      >
        <div className="max-w-md text-center">
          <div className="mx-auto mb-7 flex size-17 items-center justify-center rounded-2xl border border-[#ebdfe3] bg-[#faf5f7] text-[#734353]">
            <SectionIcon name={icon} className="size-8" />
          </div>
          <h2
            id="empty-state-title"
            className="text-xl font-semibold tracking-tight text-zinc-900"
          >
            {emptyTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-zinc-500">
            {emptyDescription}
          </p>
        </div>
      </section>
    </div>
  );
}
