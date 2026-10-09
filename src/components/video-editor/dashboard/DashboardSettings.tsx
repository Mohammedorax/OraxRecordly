import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { supportsHudCaptureProtection } from "@/lib/hudCaptureProtection";
import { useAboutDialog } from "../AboutDialog";
import { SettingsRow } from "../SettingsRow";
import { SettingsCategory, SettingsSections } from "../SettingsSections";
export const DashboardSettingsContext = createContext<ReactNode>(null);
export function DashboardSettings({ onImportFile }: { onImportFile: () => Promise<void> }) {
	const t = useScopedT("editor");
	const { openAbout } = useAboutDialog();
	const settingsContent = useContext(DashboardSettingsContext);
	const [directory, setDirectory] = useState("");
	const [recordings, setRecordings] = useState("");
	const [hideHud, setHideHud] = useState(true);
	const [captureSupported, setCaptureSupported] = useState(false);
	const [startOpenAtLogin, setStartOpenAtLogin] = useState(false);
	const [startMinimized, setStartMinimized] = useState(false);
	const [startupSupported, setStartupSupported] = useState(true);
	const [startupError, setStartupError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} catch (error) {
			toast.error(String(error));
		} finally {
			setBusy(false);
		}
	};
	useEffect(() => {
		let active = true;
		void Promise.all([
			window.electronAPI.getRecordingsDirectory(),
			window.electronAPI.getHudOverlayCaptureProtection(),
			window.electronAPI.getPlatform(),
		])
			.then(([directory, protection, platform]) => {
				if (!active) return;
				if (directory.success) setRecordings(directory.path);
				if (protection.success) setHideHud(protection.enabled);
				setCaptureSupported(supportsHudCaptureProtection(platform));
			})
			.catch((error) => toast.error(String(error)));
		return () => {
			active = false;
		};
	}, []);
	useEffect(() => {
		let active = true;
		void window.electronAPI
			.getStartupPreferences()
			.then((preferences) => {
				if (!active) return;
				setStartOpenAtLogin(preferences.openAtLogin);
				setStartMinimized(preferences.startMinimized);
				setStartupSupported(preferences.supported);
				if (!preferences.supported) {
					setStartupError(
						t(
							"dashboard.startupUnsupported",
							"Launching Recordly at sign-in is not supported on this system.",
						),
					);
				}
			})
			.catch((error) => {
				if (active) setStartupError(String(error));
			});
		return () => {
			active = false;
		};
	}, [t]);
	const updateStartup = (patch: { openAtLogin?: boolean; startMinimized?: boolean }) => {
		setBusy(true);
		void window.electronAPI
			.setStartupPreferences(patch)
			.then((result) => {
				setStartOpenAtLogin(result.openAtLogin);
				setStartMinimized(result.startMinimized);
				setStartupSupported(result.supported);
				setStartupError(
					result.success
						? null
						: (result.error ??
								t(
									"dashboard.startupRegisterFailed",
									"Could not update the system login item.",
								)),
				);
			})
			.catch((error) => setStartupError(String(error)))
			.finally(() => setBusy(false));
	};
	return (
		<section
			aria-label={t("dashboard.settingsSection", "Dashboard settings")}
			className="dashboard-settings max-w-2xl py-10"
		>
			<h1 className="mb-8 text-lg font-semibold">
				{t("dashboard.settingsTitle", "Settings")}
			</h1>
			<SettingsSections
				categories={["general", "motion", "recording", "files", "advanced", "about"]}
			>
				<SettingsCategory category={["general", "motion", "advanced"]}>
					{settingsContent}
				</SettingsCategory>
				<SettingsCategory category="general">
					<div className="space-y-6">
						<h2 className="text-sm font-semibold">
							{t("dashboard.startup", "Startup")}
						</h2>
						<SettingsRow
							title={t(
								"dashboard.startRecordlyOnSignIn",
								"Start Recordly when I sign in",
							)}
							description={t(
								"dashboard.startRecordlyOnSignInDescription",
								"Launch Recordly automatically when you log in to this computer.",
							)}
						>
							<Switch
								aria-label={t(
									"dashboard.startRecordlyOnSignIn",
									"Start Recordly when I sign in",
								)}
								checked={startOpenAtLogin}
								disabled={busy || !startupSupported}
								onCheckedChange={(enabled) =>
									updateStartup({ openAtLogin: enabled })
								}
							/>
						</SettingsRow>
						<SettingsRow
							title={t("dashboard.startMinimized", "Start minimized")}
							description={t(
								"dashboard.startMinimizedDescription",
								"Launch Recordly without showing its windows until you open it.",
							)}
						>
							<Switch
								aria-label={t("dashboard.startMinimized", "Start minimized")}
								checked={startMinimized}
								disabled={busy}
								onCheckedChange={(enabled) =>
									updateStartup({ startMinimized: enabled })
								}
							/>
						</SettingsRow>
						{startupError && (
							<p role="alert" className="text-xs text-destructive">
								{startupError}
							</p>
						)}
					</div>
				</SettingsCategory>
				<SettingsCategory category="files">
					<SettingsRow title={t("dashboard.openVideoOrProject", "Open video or project")}>
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() => void run(onImportFile)}
						>
							{t("dashboard.openFile", "Open file")}
						</Button>
					</SettingsRow>
				</SettingsCategory>
				<SettingsCategory category="recording">
					<SettingsRow
						title={t("dashboard.recordingsFolder", "Recordings folder")}
						description={
							<span className="block truncate" title={recordings}>
								{recordings}
							</span>
						}
					>
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const result =
										await window.electronAPI.chooseRecordingsDirectory();
									if (result.canceled) return;
									if (!result.success || !result.path)
										throw Error(
											t(
												"dashboard.changeRecordingsFolderFailed",
												"Could not change recordings folder",
											),
										);
									setRecordings(result.path);
								})
							}
						>
							{t("dashboard.changeFolder", "Change folder")}
						</Button>
					</SettingsRow>
					{captureSupported && (
						<SettingsRow
							title={t("dashboard.hideHudFromRecordings", "Hide HUD from recordings")}
							description={t(
								"dashboard.hideHudDescription",
								"Only while recording. The idle HUD stays visible in captures.",
							)}
						>
							<Switch
								aria-label={t(
									"dashboard.hideHudFromRecordings",
									"Hide HUD from recordings",
								)}
								checked={hideHud}
								disabled={busy}
								onCheckedChange={(enabled) =>
									void run(async () => {
										const result =
											await window.electronAPI.setHudOverlayCaptureProtection(
												enabled,
											);
										if (!result.success)
											throw Error(
												t(
													"dashboard.updateCaptureProtectionFailed",
													"Could not update capture protection",
												),
											);
										setHideHud(result.enabled);
									})
								}
							/>
						</SettingsRow>
					)}
				</SettingsCategory>
				<SettingsCategory category="advanced">
					{import.meta.env.DEV && (
						<SettingsRow title={t("dashboard.previewUpdateUi", "Preview update UI")}>
							<Button
								variant="secondary"
								size="sm"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await window.electronAPI.previewUpdateToast();
									})
								}
							>
								{t("dashboard.preview", "Preview")}
							</Button>
						</SettingsRow>
					)}
				</SettingsCategory>
				<SettingsCategory category="files">
					<SettingsRow
						title={t("dashboard.projectsFolder", "Projects folder")}
						description={
							directory ||
							t("dashboard.namedProjectsSave", "Named projects save automatically.")
						}
					>
						<Button
							variant="secondary"
							size="sm"
							onClick={async () => {
								try {
									const result = await window.electronAPI.getProjectsDirectory();
									if (!result.success || !result.path)
										throw Error(
											t(
												"dashboard.openProjectsFolderFailed",
												"Could not open projects folder",
											),
										);
									setDirectory(result.path);
									await window.electronAPI.revealInFolder(result.path);
								} catch (e) {
									toast.error(String(e));
								}
							}}
						>
							{t("dashboard.showFolder", "Show folder")}
						</Button>
					</SettingsRow>
					<p className="text-xs text-muted-foreground">
						{t(
							"dashboard.namedProjectsSaveDescription",
							"Named projects save automatically. Previews refresh when you return to Projects.",
						)}
					</p>
				</SettingsCategory>
				<SettingsCategory category="about">
					<SettingsRow
						title={t("dashboard.aboutTitle", "About OraxRecordly")}
						description={t(
							"dashboard.aboutDescription",
							"Version, licence, attribution and third-party notices.",
						)}
					>
						<Button variant="secondary" size="sm" onClick={openAbout}>
							{t("dashboard.aboutOpen", "View")}
						</Button>
					</SettingsRow>
				</SettingsCategory>
			</SettingsSections>
		</section>
	);
}
