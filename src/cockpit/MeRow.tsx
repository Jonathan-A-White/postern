// src/cockpit/MeRow.tsx — a label with its value, the row every Me section is made of.
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-[14px] text-muted">{label}</span>
      <span className="min-w-0 text-right text-[14px]">{children}</span>
    </div>
  );
}
