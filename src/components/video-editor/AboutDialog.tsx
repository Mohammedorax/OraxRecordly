import { Link, Modal } from "@heroui/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ArrowSquareOut, Info } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useI18n, useScopedT } from "@/contexts/I18nContext";

/**
 * Public links the About surface points at. They describe the distributed build
 * (licence, upstream project, notices), so they are constants rather than
 * settings, and they are always opened through the external-open bridge.
 */
const ABOUT_LINKS = {
	recordly: "https://github.com/webadderallorg/Recordly",
	repository: "https://github.com/Mohammedorax/OraxRecordly",
	releases: "https://github.com/Mohammedorax/OraxRecordly/releases",
	licence: "https://github.com/Mohammedorax/OraxRecordly/blob/main/LICENSE.md",
	thirdPartyNotices:
		"https://github.com/Mohammedorax/OraxRecordly/blob/main/THIRD_PARTY_NOTICES.md",
} as const;

/** A link that hands the URL to the main process instead of navigating the renderer. */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
	const t = useScopedT("dialogs");
	return (
		<Link
			href={href}
			className="inline-flex w-fit items-center gap-1.5 text-[13px] text-accent underline underline-offset-4"
			onAuxClick={(event) => event.preventDefault()}
			onClick={(event) => {
				event.preventDefault();
				void window.electronAPI
					.openExternalUrl(href)
					.then((result) => {
						if (!result.success)
							throw new Error(
								result.error ||
									t("about.openLinkFailed", "Could not open the link"),
							);
					})
					.catch((error) => toast.error(String(error)));
			}}
		>
			{children}
			<ArrowSquareOut className="size-3.5 shrink-0" aria-hidden="true" />
		</Link>
	);
}

function AboutSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-2">
			<h2 className="text-[13px] font-medium text-foreground">{title}</h2>
			{children}
		</section>
	);
}

export function AboutDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useScopedT("dialogs");
	const [version, setVersion] = useState<string | null>(null);

	// The version comes from the packaged app (`app.getVersion()`), never from a
	// constant in the renderer, so it always matches the build the user runs.
	useEffect(() => {
		if (!open) return;

		let active = true;
		void window.electronAPI
			.getAppVersion()
			.then((value) => {
				if (active) setVersion(value);
			})
			.catch((error) => {
				if (active) setVersion(null);
				console.error("Failed to read the app version:", error);
			});

		return () => {
			active = false;
		};
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] max-w-lg overflow-hidden">
				<DialogHeader className="shrink-0">
					<DialogTitle className="flex items-center gap-2 text-base font-semibold">
						<Info className="size-4 text-accent" />
						{t("about.title", "About OraxRecordly")}
					</DialogTitle>
				</DialogHeader>

				<Modal.Body className="min-h-0 space-y-6 overflow-y-auto">
					<AboutDialogBody version={version} />
				</Modal.Body>

				<DialogFooter className="shrink-0">
					<Button size="sm" onClick={() => onOpenChange(false)}>
						{t("common.actions.close", "Close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The licensing content itself. Split from the modal shell so the attribution,
 * licence and warranty copy can be asserted without mounting a portal.
 */
export function AboutDialogBody({ version }: { version: string | null }) {
	const { t } = useI18n();
	const tAbout = useScopedT("dialogs");

	return (
		<>
			<div className="space-y-1">
				<p className="text-[13px] font-medium text-foreground">
					{t("common.app.name", "OraxRecordly")}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("common.app.subtitle", "Screen recording and editing")}
				</p>
				<p className="text-xs text-muted-foreground">
					{tAbout("about.versionLabel", "Version {{version}}", {
						version: version ?? "…",
					})}
				</p>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{tAbout("about.description")}
				</p>
			</div>

			<AboutSection title={tAbout("about.attributionTitle", "Attribution")}>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{tAbout("about.attribution")}
				</p>
				<ExternalLink href={ABOUT_LINKS.recordly}>
					{tAbout("about.attributionLink", "Recordly on GitHub")}
				</ExternalLink>
			</AboutSection>

			<AboutSection title={tAbout("about.licenceTitle", "Licence")}>
				<p className="text-[13px] font-medium text-foreground">
					{tAbout("about.licenceName")}
				</p>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{tAbout("about.licenceDescription")}
				</p>
				<ExternalLink href={ABOUT_LINKS.licence}>
					{tAbout("about.licenceLink", "Read the full licence")}
				</ExternalLink>
			</AboutSection>

			<AboutSection title={tAbout("about.thirdPartyTitle", "Third-party components")}>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{tAbout("about.thirdPartyNotice")}
				</p>
			</AboutSection>

			<AboutSection title={tAbout("about.linksTitle", "Links")}>
				<div className="flex flex-col gap-1.5">
					<ExternalLink href={ABOUT_LINKS.repository}>
						{tAbout("about.repositoryLink", "Source code repository")}
					</ExternalLink>
					<ExternalLink href={ABOUT_LINKS.releases}>
						{tAbout("about.releasesLink", "Releases and changelog")}
					</ExternalLink>
					<ExternalLink href={ABOUT_LINKS.thirdPartyNotices}>
						{tAbout("about.thirdPartyLink", "Third-party notices")}
					</ExternalLink>
				</div>
			</AboutSection>

			<div className="rounded-lg border border-warning/20 bg-warning-soft p-3">
				<p className="text-[13px] font-medium text-warning">
					{tAbout("about.warrantyTitle", "No warranty")}
				</p>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					{tAbout("about.warranty")}
				</p>
			</div>
		</>
	);
}

interface AboutDialogContextValue {
	openAbout: () => void;
}

const AboutDialogContext = createContext<AboutDialogContextValue | null>(null);

/**
 * Hosts the single About dialog and exposes `openAbout()` to the surfaces that
 * can reach it: the dashboard settings row and the application menu.
 */
export function AboutDialogProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const openAbout = useCallback(() => setOpen(true), []);

	useEffect(() => window.electronAPI.onMenuAbout?.(openAbout), [openAbout]);

	const value = useMemo<AboutDialogContextValue>(() => ({ openAbout }), [openAbout]);

	return (
		<AboutDialogContext.Provider value={value}>
			{children}
			<AboutDialog open={open} onOpenChange={setOpen} />
		</AboutDialogContext.Provider>
	);
}

export function useAboutDialog() {
	const context = useContext(AboutDialogContext);
	if (!context) throw new Error("useAboutDialog must be used within <AboutDialogProvider>");
	return context;
}
