export default function Loading(props: { className?: string }) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-3 py-6 text-sm text-zinc-600",
        props.className ?? "",
      ].join(" ")}
    >
      <img src="/loading.gif" alt="loading" className="h-40 w-40" />
    </div>
  );
}
