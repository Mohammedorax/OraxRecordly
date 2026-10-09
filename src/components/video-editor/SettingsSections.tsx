import { createContext, type ReactNode, useContext, useState } from "react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { useScopedT } from "@/contexts/I18nContext";

type Category = "general" | "motion" | "recording" | "files" | "advanced" | "about";
const labels: Record<Category, { key: string; fallback: string }> = {
	general: { key: "categories.general", fallback: "General" },
	motion: { key: "categories.motion", fallback: "Motion" },
	recording: { key: "categories.recording", fallback: "Recording" },
	files: { key: "categories.files", fallback: "Files" },
	advanced: { key: "categories.advanced", fallback: "Advanced" },
	about: { key: "categories.about", fallback: "About" },
};
const SettingsCategoryContext = createContext<Category | null>(null);

/** Dashboard and editor share the same controls and category selection. */
export function SettingsSections({
	children,
	categories,
}: {
	children: ReactNode;
	categories: Category[];
}) {
	const parent = useContext(SettingsCategoryContext);
	const [selected, setSelected] = useState<Category>("general");
	const t = useScopedT("settings");
	if (parent) return <div className="space-y-6">{children}</div>;
	const active = categories.includes(selected) ? selected : categories[0];
	const activeLabel = t(labels[active].key, labels[active].fallback);
	return (
		<SettingsCategoryContext.Provider value={active}>
			<div className="space-y-6">
				<ChoiceGroup
					aria-label={t("categories.ariaLabel", "Settings sections")}
					value={active}
					onValueChange={(value) => setSelected(value as Category)}
					size="sm"
				>
					{categories.map((category) => (
						<ChoiceItem key={category} value={category}>
							{t(labels[category].key, labels[category].fallback)}
						</ChoiceItem>
					))}
				</ChoiceGroup>
				<div
					role="region"
					aria-label={t("categories.regionLabel", "{{category}} settings", {
						category: activeLabel,
					})}
					className="space-y-6"
				>
					{children}
				</div>
			</div>
		</SettingsCategoryContext.Provider>
	);
}

export function SettingsCategory({
	category,
	children,
}: {
	category: Category | Category[];
	children: ReactNode;
}) {
	const active = useContext(SettingsCategoryContext);
	const visible = Array.isArray(category)
		? active !== null && category.includes(active)
		: active === category;
	return visible ? <div className="space-y-6">{children}</div> : null;
}
