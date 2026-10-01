import { Plus } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

export function RecordNewButton({
	busy,
	run,
	className,
	first = false,
}: {
	busy: boolean;
	run: (action: () => Promise<void>) => Promise<void>;
	className?: string;
	first?: boolean;
}) {
	const t = useScopedT("editor");
	return (
		<Button
			variant="default"
			disabled={busy}
			onClick={() => void run(() => window.electronAPI.showRecordingHud())}
			className={cn("h-10 shrink-0 gap-2 text-[13px]", className)}
		>
			<Plus className="size-4" />
			{first
				? t("dashboard.recordFirstVideo", "Record your first video")
				: t("dashboard.recordNew", "Record new")}
		</Button>
	);
}
