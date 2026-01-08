import { LayoutGrid, List } from "lucide-react";

type ListViewToggleProps = {
  value: "list" | "card";
  onChange: (next: "list" | "card") => void;
};

export default function ListViewToggle(props: ListViewToggleProps) {
  const isCard = props.value === "card";
  return (
    <div className="flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-1 text-xs">
      <button
        type="button"
        className={`h-7 rounded-md px-2 ${!isCard ? "bg-zinc-900 text-white" : "text-zinc-700"}`}
        onClick={() => props.onChange("list")}
      >
        <span className="flex items-center gap-1">
          <List className="h-3.5 w-3.5" />
          列表
        </span>
      </button>
      <button
        type="button"
        className={`h-7 rounded-md px-2 ${isCard ? "bg-zinc-900 text-white" : "text-zinc-700"}`}
        onClick={() => props.onChange("card")}
      >
        <span className="flex items-center gap-1">
          <LayoutGrid className="h-3.5 w-3.5" />
          卡片
        </span>
      </button>
    </div>
  );
}
