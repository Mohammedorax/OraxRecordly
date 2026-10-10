import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
export type DashboardProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entries: ProjectLibraryEntry[];
	onOpenProject: (path: string) => Promise<unknown>;
	onImportFile: () => Promise<void>;
	/** Opens a raw recording in the editor (rather than previewing it). */
	onEditRecording?: (path: string) => Promise<unknown> | void;
	error: string | null;
	onDeleteProjects: (paths: string[]) => Promise<string[]>;
	onRenameProject: (path: string, name: string) => Promise<string>;
};
