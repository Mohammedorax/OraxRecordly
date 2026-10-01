import type {
	CSSProperties,
	PointerEvent as ReactPointerEvent,
	WheelEvent as ReactWheelEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	ArrowUp,
	Check,
	Copy,
	Crop,
	Cursor,
	MagnifyingGlassMinus,
	MagnifyingGlassPlus,
	MoveIcon,
	PaintBrushIcon,
	PaletteIcon,
	PenIcon,
	RadialBlurIcon,
	Scissors,
	TextT,
	Trash,
	UndoLeftIcon,
	UndoRightIcon,
	WarningCircleIcon,
	X,
} from "@/components/ui/icons";
import { Toaster, toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import {
	canWriteClipboardImage,
	fetchTrafficLightsVisible,
	readImageFile,
	readImagePathFromLocation,
	revealInFolder,
	writeClipboardImage,
	writeImageFile,
	writeOptionsForPath,
} from "./imageEditorBridge";
import {
	appendPoint,
	arrowAngle,
	arrowHeadPoints,
	baseName,
	canRedo,
	canUndo,
	canvasBackingSize,
	canvasTransform,
	clampRegionToImage,
	clampZoom,
	computeViewport,
	CROP_HANDLE_SIZE,
	cropHandleSpots,
	cropRectFromDrag,
	type CropHandle,
	ellipseFromDrag,
	fitView,
	hitCropHandle,
	imageToScreen,
	isStackDirty,
	isUsableCrop,
	MAX_HISTORY,
	MIN_ZOOM,
	panKeepingViewCenter,
	pixelBlockSize,
	pixelateRegion,
	type Point,
	pushSnapshot,
	type Rect,
	redoSnapshot,
	resetSnapshotStack,
	resizeCropRect,
	type SnapshotStack,
	type Size,
	screenToImage,
	textInset,
	traceSmoothPath,
	undoSnapshot,
	type Viewport,
	zoomAroundPoint,
} from "./imageEditorGeometry";
import styles from "./ImageEditorWindow.module.css";

/* ------------------------------------------------------------------ *
 * Tool table
 * ------------------------------------------------------------------ */

type ToolId =
	| "select"
	| "crop"
	| "deleteRegion"
	| "pen"
	| "arrow"
	| "rectangle"
	| "ellipse"
	| "highlight"
	| "pixelate"
	| "text";

/** Tools that produce a shape from a press-drag-release gesture. */
type DragToolId = "pen" | "arrow" | "rectangle" | "ellipse" | "highlight";

/**
 * Tools that work on a rectangular region of the document. They share the drag
 * gesture, the eight resize handles, the overlay preview and the apply/cancel
 * actions; only the commit differs (crop keeps the inside, delete removes it).
 */
type RegionToolId = "crop" | "deleteRegion";

function isRegionTool(tool: ToolId): tool is RegionToolId {
	return tool === "crop" || tool === "deleteRegion";
}

const TOOL_IDS: ToolId[] = [
	"select",
	"crop",
	"deleteRegion",
	"pen",
	"arrow",
	"rectangle",
	"ellipse",
	"highlight",
	"pixelate",
	"text",
];

function ToolIcon({ tool }: { tool: ToolId }) {
	switch (tool) {
		case "select":
			return <MoveIcon />;
		case "crop":
			return <Crop weight="bold" />;
		case "deleteRegion":
			return <Scissors />;
		case "pen":
			return <PenIcon />;
		case "arrow":
			return <ArrowUp className="rotate-45" />;
		case "rectangle":
			return <Cursor />;
		case "ellipse":
			return <RadialBlurIcon />;
		case "highlight":
			return <PaintBrushIcon />;
		case "pixelate":
			return <RadialBlurIcon />;
		case "text":
			return <TextT />;
	}
}

/** Colors offered next to the custom picker, tuned to stay legible on screenshots. */
const PALETTE = [
	"#ef4444",
	"#f97316",
	"#facc15",
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
	"#ffffff",
	"#111827",
] as const;

const FONT_FAMILY = '"DM Sans", "Segoe UI", system-ui, sans-serif';

/** Base highlight opacity; the marker tint is drawn as a translucent fill. */
const HIGHLIGHT_ALPHA = 0.35;
/**
 * Colour a deleted region is cleared to when the document cannot store
 * transparency (the JPEG branch of `writeOptionsForPath`, which also covers
 * WebP because the editor re-encodes it as JPEG). White is the conventional
 * opaque background and matches the sheet the stage paints behind the image;
 * alpha-capable files are cleared to transparent instead.
 */
const DELETE_FILL = "#ffffff";
/** Tint the delete preview paints over the pixels that are about to go. */
const DELETE_PREVIEW_FILL = "rgba(239,68,68,0.35)";
/** Unbounded bounds used when normalizing a shape drag into a rectangle. */
const UNBOUNDED: Size = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER };

type DocState = { canvas: HTMLCanvasElement; width: number; height: number };

type DragMode = "draw" | "region-draw" | "region-handle" | "pan";

type DragState = {
	pointerId: number;
	mode: DragMode;
	start: Point;
	last: Point;
	points: Point[];
	handle: CropHandle | null;
	/**
	 * The region rect as it was when the gesture started. Handle drags always
	 * resolve against this rect instead of the current one, so a "move" drag
	 * applies the pointer delta once rather than adding the absolute pointer
	 * position to an already-moved rectangle on every event.
	 */
	regionOrigin: Rect | null;
	panOrigin: Point;
	panStart: Point;
};

function useDocumentDark() {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const root = document.documentElement;
		const update = () =>
			setDark(root.classList.contains("dark") || root.dataset.theme === "dark");
		update();
		const observer = new MutationObserver(update);
		observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
		return () => observer.disconnect();
	}, []);
	return dark;
}

/* ------------------------------------------------------------------ *
 * Canvas helpers
 * ------------------------------------------------------------------ */

function createCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	return canvas;
}

function duplicateCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
	const snapshot = createCanvas(source.width, source.height);
	const ctx = snapshot.getContext("2d");
	if (ctx) {
		ctx.drawImage(source, 0, 0);
		return snapshot;
	}
	return source;
}

/**
 * Crop and pixelate both need the untouched pixels of the current document.
 * The read happens on a throwaway canvas so the visible context never has to
 * opt into `willReadFrequently`.
 */
function readRegion(
	source: HTMLCanvasElement,
	rect: Rect,
): { data: Uint8ClampedArray; width: number; height: number } | null {
	const width = Math.max(1, Math.round(rect.width));
	const height = Math.max(1, Math.round(rect.height));
	const scratch = createCanvas(width, height);
	const ctx = scratch.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	ctx.drawImage(
		source,
		Math.round(rect.x),
		Math.round(rect.y),
		width,
		height,
		0,
		0,
		width,
		height,
	);
	return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("The screenshot could not be decoded"));
		image.src = dataUrl;
	});
}

async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
	// The editor window is usually not focused, where Chromium refuses the web
	// Clipboard API, so write through the native bridge first and keep the web
	// API only as the fallback for the browser build.
	if (canWriteClipboardImage()) {
		const result = await writeClipboardImage(canvas.toDataURL("image/png"));
		if (!result.success) {
			throw new Error(result.error || "The native clipboard write failed");
		}
		return true;
	}
	if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
		return false;
	}
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob((value) => resolve(value), "image/png"),
	);
	if (!blob) return false;
	await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
	return true;
}

/** Light colours get a dark outline so text stays readable on white areas. */
function isLight(hex: string): boolean {
	const normalized = hex.replace("#", "");
	const full =
		normalized.length === 3
			? normalized
					.split("")
					.map((part) => part + part)
					.join("")
			: normalized;
	const value = Number.parseInt(full.slice(0, 6), 16);
	if (!Number.isFinite(value)) return true;
	const red = (value >> 16) & 255;
	const green = (value >> 8) & 255;
	const blue = value & 255;
	return (red * 299 + green * 587 + blue * 114) / 1000 > 140;
}

/* ------------------------------------------------------------------ *
 * Window wrapper: loading / error states
 * ------------------------------------------------------------------ */

export function ImageEditorWindow() {
	const t = useScopedT("dialogs");
	const dark = useDocumentDark();
	const [imagePath] = useState(() => readImagePathFromLocation(window.location.search));
	const [original, setOriginal] = useState<HTMLImageElement | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(() => Boolean(imagePath));

	useEffect(() => {
		if (!imagePath) {
			setLoading(false);
			setError(t("imageEditor.missingPath", "This window was opened without an image."));
			return;
		}
		let active = true;
		let decoded: HTMLImageElement | null = null;
		setLoading(true);
		setError(null);
		void (async () => {
			const result = await readImageFile(imagePath);
			if (!active) return;
			if (!result.success || !result.dataUrl) {
				setError(
					result.error || t("imageEditor.loadFailed", "The image could not be opened."),
				);
				setLoading(false);
				return;
			}
			try {
				decoded = await loadImageElement(result.dataUrl);
			} catch (decodeError) {
				if (!active) return;
				setError(
					decodeError instanceof Error
						? decodeError.message
						: t("imageEditor.loadFailed", "The image could not be opened."),
				);
				setLoading(false);
				return;
			}
			if (!active) return;
			setOriginal(decoded);
			setLoading(false);
		})();
		return () => {
			active = false;
			if (decoded) decoded.src = "";
		};
	}, [imagePath, t]);

	return (
		<div className={cn(styles.window, dark && "dark")}>
			{loading ? (
				<div className={styles.status} role="status" aria-live="polite">
					<div className={styles.spinner} aria-hidden="true" />
					<span>{t("imageEditor.loading", "Loading image…")}</span>
				</div>
			) : error || !imagePath || !original ? (
				<div className={styles.status} role="alert">
					<WarningCircleIcon size={28} weight="fill" className={styles.statusIcon} />
					<span className={styles.statusText}>
						{error ?? t("imageEditor.loadFailed", "")}
					</span>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => window.close()}
					>
						{t("imageEditor.close", "Close")}
					</Button>
				</div>
			) : (
				<ImageEditor
					key={imagePath}
					imagePath={imagePath}
					original={original}
					dark={dark}
				/>
			)}
			{/*
			 * This is a standalone BrowserWindow, so no parent shell mounts a
			 * toast provider for it (HudWindow does the same).
			 */}
			<Toaster className="pointer-events-auto" />
		</div>
	);
}

export default ImageEditorWindow;

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

type EditorProps = {
	imagePath: string;
	original: HTMLImageElement;
	dark: boolean;
};

function ImageEditor({ imagePath, original, dark }: EditorProps) {
	const t = useScopedT("dialogs");
	const fileName = useMemo(() => baseName(imagePath), [imagePath]);
	const originalSize = useMemo<Size>(
		() => ({
			width: original.naturalWidth || original.width,
			height: original.naturalHeight || original.height,
		}),
		[original],
	);
	/**
	 * Whether the file the editor writes back can hold an alpha channel. The
	 * save path already decides this from the extension, so the delete tool
	 * reads the very same answer instead of guessing from the pixels.
	 */
	const documentIsOpaque = useMemo(
		() => writeOptionsForPath(imagePath, false).format === "jpeg",
		[imagePath],
	);

	const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const stageRef = useRef<HTMLDivElement | null>(null);
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
	const originRef = useRef<HTMLImageElement>(original);

	// The committed image plus the bounded snapshot history that backs undo/redo.
	const [doc, setDoc] = useState<DocState>(() => {
		const canvas = createCanvas(originalSize.width, originalSize.height);
		canvas.getContext("2d")?.drawImage(original, 0, 0);
		return { canvas, width: canvas.width, height: canvas.height };
	});
	const [history, setHistory] = useState<SnapshotStack<HTMLCanvasElement>>(() =>
		resetSnapshotStack(doc.canvas),
	);
	const [savedIndex, setSavedIndex] = useState(0);
	const historyRef = useRef(history);
	historyRef.current = history;
	const docRef = useRef(doc);
	docRef.current = doc;

	const [tool, setTool] = useState<ToolId>("select");
	const [color, setColor] = useState<string>(PALETTE[0]);
	const [strokeWidth, setStrokeWidth] = useState<number>(4);
	const [textSize, setTextSize] = useState<number>(32);

	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
	const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
	const [dpr, setDpr] = useState(() =>
		typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
	);

	const [region, setRegion] = useState<Rect | null>(null);
	const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmClose, setConfirmClose] = useState(false);
	const [trafficLights, setTrafficLights] = useState(false);
	const [textEdit, setTextEdit] = useState<{ x: number; y: number; value: string } | null>(null);

	const dragRef = useRef<DragState | null>(null);
	const spaceRef = useRef(false);
	const dirtyRef = useRef(false);

	useEffect(() => {
		originRef.current = original;
	}, [original]);

	useEffect(() => {
		void fetchTrafficLightsVisible().then(setTrafficLights);
	}, []);

	const viewport = useMemo(
		() =>
			computeViewport({ width: doc.width, height: doc.height }, viewportSize, zoom, pan, dpr),
		[doc.width, doc.height, viewportSize, zoom, pan, dpr],
	);
	const viewportRef = useRef(viewport);
	viewportRef.current = viewport;

	const toolRef = useRef(tool);
	toolRef.current = tool;
	const styleRef = useRef({ color, strokeWidth });
	styleRef.current = { color, strokeWidth };
	const regionRef = useRef<Rect | null>(region);
	regionRef.current = region;

	/**
	 * True while the view is still the automatic "fit and centre" one. A manual
	 * zoom or pan clears it, so a window resize re-fits an untouched view but
	 * preserves the zoom the user chose.
	 */
	const autoFitRef = useRef(true);
	const fittedRef = useRef(false);
	const lastViewportRef = useRef<Size>({ width: 0, height: 0 });
	const lastDocSizeKeyRef = useRef("");
	const viewStateRef = useRef({ zoom, pan });
	viewStateRef.current = { zoom, pan };
	const leaveAutoFit = useCallback(() => {
		autoFitRef.current = false;
	}, []);

	/* ---------------- viewport plumbing ---------------- */

	/**
	 * The one element that defines the pixel coordinate space: the canvas the
	 * image is painted into. Its CSS box is measured for the viewport size *and*
	 * used as the pointer origin, and the DOM overlays are absolutely positioned
	 * inside the same `position: relative` stage with the same box. Taking the
	 * rect from the canvas (rather than an outer wrapper that could carry
	 * padding, a border or a scroll offset) removes any constant shift between
	 * the drawn pixels and the pointer math.
	 */
	const surfaceBounds = useCallback((): DOMRect | null => {
		const surface = baseCanvasRef.current ?? stageRef.current;
		return surface ? surface.getBoundingClientRect() : null;
	}, []);

	useEffect(() => {
		const surface = baseCanvasRef.current ?? stageRef.current;
		if (!surface) return;
		const update = () => {
			const rect = surface.getBoundingClientRect();
			setViewportSize({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) });
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(surface);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const update = () => setDpr(window.devicePixelRatio || 1);
		window.addEventListener("resize", update);
		const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		query.addEventListener("change", update);
		return () => {
			window.removeEventListener("resize", update);
			query.removeEventListener("change", update);
		};
	}, []);

	/**
	 * Fit + centre the image. It runs once the surface has been measured, again
	 * whenever the document size changes (a crop, or undoing one) and again on a
	 * window resize — but a resize only re-fits while the view is still the
	 * automatic one. Once the user has zoomed or panned, the image point under
	 * the viewport centre stays under it, so a centred picture never slides off
	 * to one side when the window changes shape.
	 */
	const docSizeKey = `${doc.width}x${doc.height}`;
	useEffect(() => {
		const size = viewportSize;
		if (size.width <= 0 || size.height <= 0) return;
		const image = { width: doc.width, height: doc.height };
		const previousViewport = lastViewportRef.current;
		const docChanged = lastDocSizeKeyRef.current !== docSizeKey;
		const viewportChanged =
			Math.abs(previousViewport.width - size.width) > 0.5 ||
			Math.abs(previousViewport.height - size.height) > 0.5;
		lastDocSizeKeyRef.current = docSizeKey;
		lastViewportRef.current = size;

		if (!fittedRef.current || autoFitRef.current || docChanged) {
			const next = fitView(image, size);
			fittedRef.current = true;
			autoFitRef.current = true;
			setZoom(next.zoom);
			setPan(next.pan);
			return;
		}
		if (!viewportChanged) return;
		const current = viewStateRef.current;
		setPan(
			panKeepingViewCenter(
				{ viewport: previousViewport, zoom: current.zoom, pan: current.pan },
				size,
			),
		);
	}, [docSizeKey, doc.width, doc.height, viewportSize]);

	/* ---------------- painting ---------------- */

	const paintOverlay = useCallback(() => {
		const overlay = overlayCanvasRef.current;
		if (!overlay) return;
		const ctx = overlay.getContext("2d");
		if (!ctx) return;
		const v = viewportRef.current;
		const current = docRef.current;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, overlay.width, overlay.height);
		// Same transform as the committed render, from the same helper.
		ctx.setTransform(...canvasTransform(v));

		const drag = dragRef.current;
		if (drag?.mode === "pan") return;

		if (drag?.mode === "draw") {
			paintShape(ctx, toolRef.current, drag.start, drag.last, drag.points, styleRef.current);
			return;
		}
		if (
			regionRef.current &&
			(isRegionTool(toolRef.current) || drag?.mode === "region-handle")
		) {
			paintRegionOverlay(
				ctx,
				regionRef.current,
				current,
				v,
				toolRef.current === "deleteRegion" ? "delete" : "crop",
			);
		}
	}, []);

	const render = useCallback(() => {
		const base = baseCanvasRef.current;
		const overlay = overlayCanvasRef.current;
		if (!base || !overlay) return;
		const v = viewportRef.current;
		// The canvas CSS box *is* the surface the pointer is measured against, so
		// the bitmap is never rescaled by the browser: device pixel == canvas pixel.
		const backing = canvasBackingSize({ width: v.frameWidth, height: v.frameHeight }, v.dpr);
		for (const canvas of [base, overlay]) {
			if (canvas.width !== backing.width || canvas.height !== backing.height) {
				canvas.width = backing.width;
				canvas.height = backing.height;
			}
		}
		const ctx = base.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, base.width, base.height);
		ctx.setTransform(...canvasTransform(v));
		// Blowing an image up past 1:1 must not smear the pixels: at that point
		// one image pixel covers several device pixels, so show the blocks.
		ctx.imageSmoothingEnabled = v.detailScale <= 1;
		ctx.drawImage(docRef.current.canvas, 0, 0);
		paintOverlay();
	}, [paintOverlay]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: this effect exists to repaint on these inputs.
	useEffect(() => {
		render();
	}, [render, doc, zoom, pan.x, pan.y, viewportSize.width, viewportSize.height, dpr, region]);

	/* ---------------- history + commits ---------------- */

	const showSnapshot = useCallback((next: SnapshotStack<HTMLCanvasElement>) => {
		const canvas = next.past[next.index];
		setDoc({ canvas, width: canvas.width, height: canvas.height });
		setHistory(next);
	}, []);

	const undo = useCallback(() => {
		const next = undoSnapshot(historyRef.current);
		if (next !== historyRef.current) showSnapshot(next);
	}, [showSnapshot]);

	const redo = useCallback(() => {
		const next = redoSnapshot(historyRef.current);
		if (next !== historyRef.current) showSnapshot(next);
	}, [showSnapshot]);

	const commitCanvas = useCallback((canvas: HTMLCanvasElement) => {
		const snapshot = duplicateCanvas(canvas);
		setHistory(pushSnapshot(historyRef.current, snapshot, MAX_HISTORY));
		setDoc({ canvas: snapshot, width: snapshot.width, height: snapshot.height });
	}, []);

	const commitStroke = useCallback(
		(toolId: DragToolId, start: Point, end: Point, points: Point[]) => {
			const current = docRef.current;
			const next = duplicateCanvas(current.canvas);
			const ctx = next.getContext("2d");
			if (!ctx) return;
			paintShape(ctx, toolId, start, end, points, styleRef.current);
			commitCanvas(next);
		},
		[commitCanvas],
	);

	const commitCrop = useCallback(
		(rect: Rect) => {
			if (!isUsableCrop(rect)) return;
			const current = docRef.current;
			const next = createCanvas(rect.width, rect.height);
			const ctx = next.getContext("2d");
			if (!ctx) return;
			ctx.drawImage(
				current.canvas,
				Math.round(rect.x),
				Math.round(rect.y),
				rect.width,
				rect.height,
				0,
				0,
				rect.width,
				rect.height,
			);
			commitCanvas(next);
		},
		[commitCanvas],
	);

	/**
	 * Remove a rectangular region from the document. The pixels inside the rect
	 * are cleared, so an alpha-capable file (PNG and friends) gets a transparent
	 * hole there; an opaque document (JPEG after `writeOptionsForPath`) is
	 * filled with `DELETE_FILL` white instead, because the encoder would flatten
	 * a transparent hole to black. The rect is snapped to whole image pixels and
	 * clamped to the document, so a drag that runs off the edge still clears
	 * exactly the visible part. It goes through `commitCanvas`, which pushes a
	 * snapshot, so the edit is undoable like any other.
	 */
	const commitDeleteRegion = useCallback(
		(rect: Rect) => {
			const current = docRef.current;
			const target = clampRegionToImage(rect, current);
			if (!isUsableCrop(target)) return;
			const next = duplicateCanvas(current.canvas);
			const ctx = next.getContext("2d");
			if (!ctx) return;
			ctx.clearRect(target.x, target.y, target.width, target.height);
			if (documentIsOpaque) {
				ctx.fillStyle = DELETE_FILL;
				ctx.fillRect(target.x, target.y, target.width, target.height);
			}
			commitCanvas(next);
		},
		[commitCanvas, documentIsOpaque],
	);

	const commitPixelate = useCallback(
		(rect: Rect) => {
			if (rect.width < 4 || rect.height < 4) return;
			const current = docRef.current;
			const sampled = readRegion(current.canvas, rect);
			if (!sampled) return;
			const block = pixelBlockSize(sampled.width, sampled.height);
			const pixelated = pixelateRegion(sampled.data, sampled.width, sampled.height, block);
			const scratch = createCanvas(sampled.width, sampled.height);
			const scratchCtx = scratch.getContext("2d");
			if (!scratchCtx) return;
			// `Uint8ClampedArray.from` produces the ArrayBuffer-backed view that
			// the ImageData constructor accepts.
			scratchCtx.putImageData(
				new ImageData(Uint8ClampedArray.from(pixelated), sampled.width, sampled.height),
				0,
				0,
			);
			const next = duplicateCanvas(current.canvas);
			const ctx = next.getContext("2d");
			if (!ctx) return;
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(
				scratch,
				0,
				0,
				sampled.width,
				sampled.height,
				Math.round(rect.x),
				Math.round(rect.y),
				sampled.width,
				sampled.height,
			);
			commitCanvas(next);
		},
		[commitCanvas],
	);

	const commitText = useCallback(
		(x: number, y: number, value: string) => {
			const trimmed = value.replace(/\s+$/u, "");
			if (!trimmed.trim()) return;
			const current = docRef.current;
			const next = duplicateCanvas(current.canvas);
			const ctx = next.getContext("2d");
			if (!ctx) return;
			const style = styleRef.current;
			// The same inset the inline editor pads its content by, so the box the
			// user typed into and the committed glyphs share one origin.
			const padding = textInset(textSize);
			ctx.textBaseline = "top";
			ctx.font = `600 ${textSize}px ${FONT_FAMILY}`;
			ctx.fillStyle = style.color;
			for (const [index, line] of trimmed.split("\n").entries()) {
				const textX = x + padding;
				const textY = y + padding + index * textSize * 1.3;
				if (isLight(style.color)) {
					ctx.lineWidth = Math.max(2, textSize * 0.12);
					ctx.strokeStyle = "rgba(0,0,0,0.45)";
					ctx.strokeText(line, textX, textY);
				}
				ctx.fillText(line, textX, textY);
			}
			commitCanvas(next);
		},
		[commitCanvas, textSize],
	);

	const resetToOriginal = useCallback(() => {
		const image = originRef.current;
		const canvas = createCanvas(
			image.naturalWidth || image.width,
			image.naturalHeight || image.height,
		);
		canvas.getContext("2d")?.drawImage(image, 0, 0);
		setRegion(null);
		setTextEdit(null);
		setHistory(resetSnapshotStack(canvas));
		setSavedIndex(0);
		setDoc({ canvas, width: canvas.width, height: canvas.height });
	}, []);

	/* ---------------- pointer interaction ---------------- */

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0 && event.button !== 1) return;
			const stage = stageRef.current;
			const bounds = surfaceBounds();
			if (!stage || !bounds) return;
			const screenPoint = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
			const v = viewportRef.current;
			const point = screenToImage(screenPoint, v);
			const base: Omit<DragState, "mode" | "handle"> = {
				pointerId: event.pointerId,
				start: point,
				last: point,
				points: [point],
				regionOrigin: null,
				panOrigin: { x: v.offsetX, y: v.offsetY },
				panStart: screenPoint,
			};

			if (event.button === 1 || spaceRef.current || toolRef.current === "select") {
				dragRef.current = { ...base, mode: "pan", handle: null };
				stage.setPointerCapture(event.pointerId);
				setCursorPoint(null);
				return;
			}

			if (toolRef.current === "text") {
				event.preventDefault();
				setTextEdit({ x: Math.round(point.x), y: Math.round(point.y), value: "" });
				requestAnimationFrame(() => textAreaRef.current?.focus());
				return;
			}

			if (isRegionTool(toolRef.current)) {
				// Crop and delete-region share the rect, the eight handles and
				// the preview. Hit-testing reads the same image-space rect and
				// the same screen-to-image scale the chrome is painted with, so
				// a press outside the rect starts a fresh one anywhere in the
				// image and a press on any handle or the body adjusts it.
				const handle = regionRef.current
					? hitCropHandle(point, regionRef.current, v.zoom)
					: null;
				dragRef.current = {
					...base,
					mode: handle ? "region-handle" : "region-draw",
					handle,
					regionOrigin: regionRef.current,
				};
				stage.setPointerCapture(event.pointerId);
				event.preventDefault();
				if (!handle) setRegion(cropRectFromDrag(point, point, docRef.current));
				else paintOverlay();
				return;
			}

			dragRef.current = { ...base, mode: "draw", handle: null };
			stage.setPointerCapture(event.pointerId);
			event.preventDefault();
			paintOverlay();
		},
		[paintOverlay, surfaceBounds],
	);

	const onPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const bounds = surfaceBounds();
			if (!bounds) return;
			const screenPoint = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
			const point = screenToImage(screenPoint, viewportRef.current);
			setCursorPoint(screenPoint);

			const drag = dragRef.current;
			if (!drag) return;

			if (drag.mode === "pan") {
				if (
					Math.abs(screenPoint.x - drag.panStart.x) > 0.5 ||
					Math.abs(screenPoint.y - drag.panStart.y) > 0.5
				) {
					leaveAutoFit();
				}
				setPan({
					x: drag.panOrigin.x + (screenPoint.x - drag.panStart.x),
					y: drag.panOrigin.y + (screenPoint.y - drag.panStart.y),
				});
				return;
			}

			drag.last = point;
			if (drag.mode === "region-draw") {
				setRegion(cropRectFromDrag(drag.start, point, docRef.current));
				return;
			}
			if (drag.mode === "region-handle" && drag.handle && drag.regionOrigin) {
				// "move" takes a delta from where the gesture started; the eight
				// edge handles take the absolute pointer position. Both resolve
				// against the rect captured at pointer-down, so the rectangle
				// never accumulates the pointer's absolute position.
				const target =
					drag.handle === "move"
						? { x: point.x - drag.start.x, y: point.y - drag.start.y }
						: point;
				setRegion(resizeCropRect(drag.regionOrigin, drag.handle, target, docRef.current));
				return;
			}

			if (toolRef.current === "pen") drag.points = appendPoint(drag.points, point);
			paintOverlay();
		},
		[leaveAutoFit, paintOverlay, surfaceBounds],
	);

	const finishDrag = useCallback(
		(_event: ReactPointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			dragRef.current = null;
			if (!drag) return;
			const stage = stageRef.current;
			if (stage?.hasPointerCapture(drag.pointerId)) {
				stage.releasePointerCapture(drag.pointerId);
			}
			if (drag.mode === "pan") return;

			if (drag.mode === "region-draw" || drag.mode === "region-handle") {
				const rect =
					drag.mode === "region-draw"
						? cropRectFromDrag(drag.start, drag.last, docRef.current)
						: regionRef.current;
				if (rect && isUsableCrop(rect)) setRegion(rect);
				else if (drag.mode === "region-draw") setRegion(null);
				paintOverlay();
				return;
			}

			const toolId = toolRef.current;
			if (toolId === "pixelate") {
				const rect = cropRectFromDrag(drag.start, drag.last, docRef.current);
				paintOverlay();
				if (rect.width >= 4 && rect.height >= 4) commitPixelate(rect);
				else paintOverlay();
				return;
			}
			if (toolId !== "select" && !isRegionTool(toolId) && toolId !== "text") {
				commitStroke(toolId as DragToolId, drag.start, drag.last, drag.points);
			}
			paintOverlay();
		},
		[commitPixelate, commitStroke, paintOverlay],
	);

	/* ---------------- zoom ---------------- */

	const zoomBy = useCallback(
		(factor: number) => {
			const bounds = surfaceBounds();
			const anchor = bounds
				? { x: bounds.width / 2, y: bounds.height / 2 }
				: { x: viewportRef.current.offsetX, y: viewportRef.current.offsetY };
			const next = clampZoom(viewportRef.current.zoom * factor);
			leaveAutoFit();
			setPan(zoomAroundPoint(next, anchor, viewportRef.current));
			setZoom(next);
		},
		[leaveAutoFit, surfaceBounds],
	);

	/** Back to the automatic view: whole image visible, centred, still resizable. */
	const fitToWindow = useCallback(() => {
		const bounds = surfaceBounds();
		if (!bounds) return;
		const current = docRef.current;
		const next = fitView({ width: current.width, height: current.height }, bounds);
		autoFitRef.current = true;
		fittedRef.current = true;
		setZoom(next.zoom);
		setPan(next.pan);
	}, [surfaceBounds]);

	const onWheel = useCallback(
		(event: ReactWheelEvent<HTMLDivElement>) => {
			const bounds = surfaceBounds();
			if (!bounds) return;
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
				const next = clampZoom(viewportRef.current.zoom * Math.exp(-event.deltaY * 0.0015));
				leaveAutoFit();
				setPan(zoomAroundPoint(next, anchor, viewportRef.current));
				setZoom(next);
				return;
			}
			const v = viewportRef.current;
			const overflows = v.displayWidth > bounds.width || v.displayHeight > bounds.height;
			if (!overflows) return;
			event.preventDefault();
			leaveAutoFit();
			setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
		},
		[leaveAutoFit, surfaceBounds],
	);

	/* ---------------- save / clipboard ---------------- */

	// Text that is still in the inline editor counts as unsaved work even
	// before it is rasterized onto the canvas.
	const dirty = isStackDirty(history, savedIndex) || Boolean(textEdit?.value.trim());
	dirtyRef.current = dirty;

	const toolRefCommit = useRef({ commitText, textEdit });
	toolRefCommit.current = { commitText, textEdit };

	/**
	 * Commit the inline text box exactly once. Clearing `textEdit` up front
	 * means the blur fired by a tool switch (or by clicking away) is a no-op,
	 * so the string is never rasterized twice.
	 */
	const commitPendingText = useCallback(() => {
		const pending = toolRefCommit.current.textEdit;
		if (!pending) return;
		setTextEdit(null);
		toolRefCommit.current.commitText(pending.x, pending.y, pending.value);
	}, []);

	useEffect(() => {
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!dirtyRef.current) return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, []);

	const save = useCallback(
		async (saveAs: boolean) => {
			// An inline text box that is still open has not been rasterized yet;
			// commit it first so Ctrl+S never drops the visible text.
			commitPendingText();
			const canvas = docRef.current.canvas;
			setBusy(true);
			const result = await writeImageFile(
				imagePath,
				canvas.toDataURL("image/png"),
				writeOptionsForPath(imagePath, saveAs),
			);
			setBusy(false);
			if (!result.success) {
				if (!result.canceled) {
					toast.error(t("imageEditor.saveFailed", "Could not save the image"), {
						description: result.error,
					});
				}
				return;
			}
			setSavedIndex(historyRef.current.index);
			const savedPath = result.path ?? imagePath;
			toast.success(t("imageEditor.saveSuccess", "Image saved"), {
				description: savedPath,
				action: {
					label: t("imageEditor.showInFolder", "Show in folder"),
					onClick: () => {
						void revealInFolder(savedPath);
					},
				},
			});
		},
		[commitPendingText, imagePath, t],
	);

	const copyToClipboard = useCallback(async () => {
		setBusy(true);
		try {
			const copied = await copyCanvasToClipboard(docRef.current.canvas);
			if (!copied) {
				toast.warning(
					t(
						"imageEditor.clipboardUnavailable",
						"Clipboard images are not available here",
					),
				);
				return;
			}
			toast.success(t("imageEditor.copySuccess", "Copied to clipboard"));
		} catch (error) {
			toast.error(t("imageEditor.copyFailed", "Could not copy the image"), {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	}, [t]);

	const requestClose = useCallback(() => {
		if (!dirtyRef.current) {
			window.close();
			return;
		}
		setConfirmClose(true);
	}, []);

	/* ---------------- tools + keyboard ---------------- */

	const chooseTool = useCallback(
		(next: ToolId) => {
			commitPendingText();
			if (!isRegionTool(next)) setRegion(null);
			setTool(next);
		},
		[commitPendingText],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === "Space" && !event.repeat) {
				spaceRef.current = true;
				return;
			}
			const target = event.target as HTMLElement | null;
			const typing = Boolean(target && /^(INPUT|TEXTAREA)$/u.test(target.tagName));
			if (event.key === "Escape") {
				if (isRegionTool(toolRef.current)) setRegion(null);
				else if (toolRef.current !== "select") setTool("select");
				return;
			}
			if (typing || !(event.ctrlKey || event.metaKey)) return;
			const key = event.key.toLowerCase();
			if (key === "z" && !event.shiftKey) {
				event.preventDefault();
				undo();
			} else if (key === "y" || (key === "z" && event.shiftKey)) {
				event.preventDefault();
				redo();
			} else if (key === "s") {
				event.preventDefault();
				void save(event.shiftKey);
			} else if (key === "0") {
				event.preventDefault();
				fitToWindow();
			} else if (key === "=" || key === "+") {
				event.preventDefault();
				zoomBy(1.25);
			} else if (key === "-") {
				event.preventDefault();
				zoomBy(0.8);
			}
		};
		const onKeyUp = (keyUpEvent: KeyboardEvent) => {
			if (keyUpEvent.code === "Space") spaceRef.current = false;
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
		};
	}, [fitToWindow, redo, save, undo, zoomBy]);

	/* ---------------- text overlay ---------------- */

	const textScreen = textEdit ? imageToScreen({ x: textEdit.x, y: textEdit.y }, viewport) : null;

	const textMetrics = useMemo(() => {
		// The box mirrors what `commitText` paints: padding plus room for the
		// dark outline that keeps light text legible on light screenshots.
		const innerPadding = textInset(textSize);
		const outline = Math.ceil(textSize * 0.14);
		const padding = innerPadding * 2 + outline * 2;
		const fallback = { width: 240, height: Math.round(textSize * 1.6) };
		if (!textEdit) return fallback;
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) return fallback;
		ctx.font = `600 ${textSize}px ${FONT_FAMILY}`;
		const lines = textEdit.value.split("\n");
		const widest = lines.reduce(
			(max, line) => Math.max(max, ctx.measureText(line || " ").width),
			0,
		);
		return {
			width: Math.max(80, Math.ceil(widest + padding + 8)),
			height: Math.max(
				Math.round(textSize * 1.6),
				Math.ceil(lines.length * textSize * 1.3 + padding),
			),
		};
	}, [textEdit, textSize]);

	const finishTextEdit = useCallback(
		(commit: boolean) => {
			if (commit) {
				commitPendingText();
				return;
			}
			setTextEdit(null);
		},
		[commitPendingText],
	);

	/* ---------------- render ---------------- */

	const canUndoNow = canUndo(history);
	const canRedoNow = canRedo(history);
	const dragging = dragRef.current;

	return (
		<div className={cn(styles.shell, dark && "dark")}>
			<header
				className={styles.header}
				style={
					{
						paddingLeft: trafficLights ? 78 : undefined,
						WebkitAppRegion: "drag",
					} as CSSProperties
				}
			>
				<div className={styles.headerTitle}>
					<span className={styles.appName}>{t("imageEditor.title", "Image editor")}</span>
					<span className={styles.fileName} title={imagePath}>
						{fileName}
					</span>
					{dirty ? (
						<span
							className={styles.dirtyDot}
							title={t("imageEditor.unsavedBadge", "Unsaved changes")}
						/>
					) : null}
				</div>

				<div
					className={styles.headerControls}
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						isDisabled={!canUndoNow}
						onClick={undo}
						title={t("imageEditor.undo", "Undo")}
					>
						<UndoLeftIcon />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						isDisabled={!canRedoNow}
						onClick={redo}
						title={t("imageEditor.redo", "Redo")}
					>
						<UndoRightIcon />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						onClick={resetToOriginal}
						title={t("imageEditor.reset", "Reset to original")}
					>
						<Trash />
					</Button>

					<span className={styles.headerDivider} aria-hidden="true" />

					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						onClick={() => zoomBy(0.8)}
						isDisabled={viewport.zoom <= MIN_ZOOM}
						title={t("imageEditor.zoomOut", "Zoom out")}
					>
						<MagnifyingGlassMinus />
					</Button>
					<button
						type="button"
						className={styles.zoomValue}
						onClick={fitToWindow}
						title={t("imageEditor.fitToWindow", "Fit to window")}
					>
						{Math.round(viewport.zoom * 100)}%
					</button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						onClick={() => zoomBy(1.25)}
						title={t("imageEditor.zoomIn", "Zoom in")}
					>
						<MagnifyingGlassPlus />
					</Button>

					<span className={styles.headerDivider} aria-hidden="true" />

					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						onClick={() => void copyToClipboard()}
						isDisabled={busy}
						title={t("imageEditor.copy", "Copy")}
					>
						<Copy />
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => void save(true)}
						isDisabled={busy}
					>
						{t("imageEditor.saveAs", "Save as…")}
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={() => void save(false)}
						isDisabled={busy}
					>
						{t("imageEditor.save", "Save")}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						iconSize="sm"
						onClick={requestClose}
						title={t("imageEditor.close", "Close")}
					>
						<X />
					</Button>
				</div>
			</header>

			<div className={styles.toolbar}>
				{TOOL_IDS.map((id) => (
					<button
						key={id}
						type="button"
						className={cn(styles.toolButton, tool === id && styles.toolButtonActive)}
						onClick={() => chooseTool(id)}
						aria-pressed={tool === id}
						title={t(`imageEditor.tools.${id}`, id)}
					>
						<ToolIcon tool={id} />
						<span>{t(`imageEditor.tools.${id}`, id)}</span>
					</button>
				))}

				<div className={styles.toolbarSpacer} />

				<StyleOptions
					tool={tool}
					color={color}
					setColor={setColor}
					strokeWidth={strokeWidth}
					setStrokeWidth={setStrokeWidth}
					textSize={textSize}
					setTextSize={setTextSize}
				/>

				{isRegionTool(tool) ? (
					<div className={styles.cropActions}>
						{tool === "deleteRegion" && documentIsOpaque ? (
							<span className={styles.regionNote}>
								{t(
									"imageEditor.deleteOpaqueNote",
									"This format has no transparency, so the removed area is filled with white.",
								)}
							</span>
						) : null}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => {
								setRegion(null);
								setTool("select");
							}}
						>
							{t("imageEditor.cropCancel", "Cancel")}
						</Button>
						<Button
							type="button"
							size="sm"
							isDisabled={!region || !isUsableCrop(region)}
							onClick={() => {
								if (region) {
									if (tool === "deleteRegion") commitDeleteRegion(region);
									else commitCrop(region);
								}
								setTool("select");
								setRegion(null);
							}}
						>
							<Check />
							{tool === "deleteRegion"
								? t("imageEditor.deleteApply", "Delete region")
								: t("imageEditor.cropApply", "Apply crop")}
						</Button>
					</div>
				) : null}
			</div>

			{/*
			 * The drawing surface is a pixel coordinate grid, so it is pinned to
			 * LTR while the surrounding chrome keeps the document direction. The
			 * canvases are not mirrored by `dir`, but every DOM overlay inside
			 * (the text editor, the brush cursor) would otherwise inherit RTL and
			 * lay its content out in the opposite direction from the canvas
			 * paint. `dir="ltr"` puts the DOM handles and the canvas math in the
			 * same physical space.
			 */}
			<div
				ref={stageRef}
				className={styles.stage}
				dir="ltr"
				style={{ cursor: cursorStyle(tool, Boolean(region), dragging) }}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={finishDrag}
				onPointerCancel={finishDrag}
				onWheel={onWheel}
				onContextMenu={(event) => event.preventDefault()}
				onDoubleClick={fitToWindow}
			>
				<canvas ref={baseCanvasRef} className={styles.canvas} />
				<canvas ref={overlayCanvasRef} className={styles.canvas} />

				{textScreen && textEdit ? (
					<textarea
						ref={textAreaRef}
						className={styles.textInput}
						style={{
							// Physical properties only: `dir="ltr"` above keeps the
							// element's own layout LTR, and left/top match the canvas
							// origin rather than a logical (start/end) edge.
							left: textScreen.x,
							top: textScreen.y,
							width: textMetrics.width * viewport.zoom,
							height: textMetrics.height * viewport.zoom,
							paddingTop: textInset(textSize) * viewport.zoom,
							paddingLeft: textInset(textSize) * viewport.zoom,
							fontSize: textSize * viewport.zoom,
							color,
						}}
						value={textEdit.value}
						placeholder={t("imageEditor.textPlaceholder", "Type…")}
						onChange={(event) =>
							setTextEdit((current) =>
								current ? { ...current, value: event.target.value } : current,
							)
						}
						onPointerDown={(event) => event.stopPropagation()}
						onBlur={() => finishTextEdit(true)}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Escape") {
								event.preventDefault();
								finishTextEdit(false);
								setTool("select");
							} else if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								finishTextEdit(true);
								setTool("select");
							}
						}}
					/>
				) : null}

				{cursorPoint && tool === "pen" ? (
					<span
						className={styles.brushCursor}
						style={{
							left: cursorPoint.x,
							top: cursorPoint.y,
							width: Math.max(6, strokeWidth * viewport.zoom),
							height: Math.max(6, strokeWidth * viewport.zoom),
							borderColor: color,
						}}
					/>
				) : null}
			</div>

			<footer className={styles.footer}>
				<span>
					{doc.width} × {doc.height}
				</span>
				<span>
					{t("imageEditor.hint", "Ctrl+wheel to zoom · Space or middle-drag to pan")}
				</span>
			</footer>

			<Dialog open={confirmClose} onOpenChange={setConfirmClose}>
				<DialogContent
					role="alertdialog"
					aria-label={t("imageEditor.unsavedTitle", "Unsaved changes")}
				>
					<DialogHeader>
						<DialogTitle>
							{t("imageEditor.unsavedTitle", "Unsaved changes")}
						</DialogTitle>
					</DialogHeader>
					<p className={styles.dialogBody}>
						{t(
							"imageEditor.unsavedMessage",
							"Your edits have not been saved yet. Close the editor anyway?",
						)}
					</p>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setConfirmClose(false)}
						>
							{t("imageEditor.unsavedStay", "Keep editing")}
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => {
								setConfirmClose(false);
								void save(false);
							}}
						>
							{t("imageEditor.unsavedSave", "Save and close")}
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							onClick={() => {
								dirtyRef.current = false;
								setConfirmClose(false);
								window.close();
							}}
						>
							{t("imageEditor.unsavedDiscard", "Discard and close")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * Style controls
 * ------------------------------------------------------------------ */

function StyleOptions({
	tool,
	color,
	setColor,
	strokeWidth,
	setStrokeWidth,
	textSize,
	setTextSize,
}: {
	tool: ToolId;
	color: string;
	setColor: (value: string) => void;
	strokeWidth: number;
	setStrokeWidth: (value: number) => void;
	textSize: number;
	setTextSize: (value: number) => void;
}) {
	const t = useScopedT("dialogs");
	const showsStroke =
		tool === "pen" || tool === "arrow" || tool === "rectangle" || tool === "ellipse";

	return (
		<div className={styles.styleOptions}>
			<div
				className={styles.swatches}
				role="group"
				aria-label={t("imageEditor.color", "Colour")}
			>
				{PALETTE.map((swatch) => (
					<button
						key={swatch}
						type="button"
						className={cn(styles.swatch, color === swatch && styles.swatchActive)}
						style={{ background: swatch }}
						onClick={() => setColor(swatch)}
						aria-label={swatch}
						title={swatch}
					/>
				))}
				<label
					className={styles.customColor}
					title={t("imageEditor.customColor", "Custom colour")}
				>
					<PaletteIcon />
					<input
						type="color"
						value={color}
						onChange={(event) => setColor(event.target.value)}
						aria-label={t("imageEditor.customColor", "Custom colour")}
					/>
				</label>
			</div>

			{showsStroke ? (
				<label className={styles.slider}>
					<span>{t("imageEditor.strokeWidth", "Thickness")}</span>
					<input
						type="range"
						min={1}
						max={40}
						step={1}
						value={strokeWidth}
						onChange={(event) => setStrokeWidth(Number(event.target.value))}
						aria-label={t("imageEditor.strokeWidth", "Thickness")}
					/>
					<span className={styles.sliderValue}>{strokeWidth}</span>
				</label>
			) : null}

			{tool === "text" ? (
				<label className={styles.slider}>
					<span>{t("imageEditor.fontSize", "Font size")}</span>
					<input
						type="range"
						min={10}
						max={96}
						step={2}
						value={textSize}
						onChange={(event) => setTextSize(Number(event.target.value))}
						aria-label={t("imageEditor.fontSize", "Font size")}
					/>
					<span className={styles.sliderValue}>{textSize}</span>
				</label>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * Painting
 * ------------------------------------------------------------------ */

type PaintStyle = { color: string; strokeWidth: number };

function paintShape(
	ctx: CanvasRenderingContext2D,
	tool: ToolId,
	start: Point,
	end: Point,
	points: Point[],
	style: PaintStyle,
): void {
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.strokeStyle = style.color;
	ctx.fillStyle = style.color;
	ctx.lineWidth = style.strokeWidth;

	switch (tool) {
		case "pen": {
			traceSmoothPath(ctx, points.length >= 2 ? points : [start, end]);
			ctx.stroke();
			break;
		}
		case "arrow": {
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
			const head = arrowHeadPoints(end, arrowAngle(start, end), ctx.lineWidth);
			ctx.beginPath();
			ctx.moveTo(head[0].x, head[0].y);
			ctx.lineTo(head[1].x, head[1].y);
			ctx.lineTo(head[2].x, head[2].y);
			ctx.closePath();
			ctx.fill();
			break;
		}
		case "rectangle": {
			const rect = cropRectFromDrag(start, end, UNBOUNDED);
			if (rect.width > 0 && rect.height > 0) {
				ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
			}
			break;
		}
		case "ellipse": {
			const { centerX, centerY, radiusX, radiusY } = ellipseFromDrag(start, end);
			if (radiusX > 0 && radiusY > 0) {
				ctx.beginPath();
				ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
				ctx.stroke();
			}
			break;
		}
		case "highlight": {
			const rect = cropRectFromDrag(start, end, UNBOUNDED);
			ctx.globalAlpha = HIGHLIGHT_ALPHA;
			ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
			break;
		}
		default:
			break;
	}
	ctx.restore();
}

/**
 * Chrome for a region gesture, drawn on the overlay canvas in image space.
 *
 * `kind === "crop"` dims everything *outside* the rect, which is what the crop
 * will keep. `kind === "delete"` instead tints the rect itself red, so the
 * preview shows the pixels that are about to be removed while the rest of the
 * picture stays at full brightness.
 */
function paintRegionOverlay(
	ctx: CanvasRenderingContext2D,
	rect: Rect,
	doc: DocState,
	v: Viewport,
	kind: "crop" | "delete",
): void {
	// The chrome is laid out in image space from the same rect and the same
	// CSS-pixels-per-image-pixel scale `hitCropHandle` grabs with, so each handle
	// is drawn centred on the point that grabs it and keeps a constant on-screen
	// size (the grab reach is that same CROP_HANDLE_SIZE, in CSS pixels).
	const zoom = v.zoom > 0 ? v.zoom : 1;
	ctx.save();

	if (kind === "crop") {
		ctx.fillStyle = "rgba(0,0,0,0.45)";
		ctx.beginPath();
		ctx.rect(0, 0, doc.width, doc.height);
		ctx.rect(rect.x, rect.y, rect.width, rect.height);
		ctx.fill("evenodd");
	} else {
		ctx.fillStyle = DELETE_PREVIEW_FILL;
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
	}

	ctx.strokeStyle = kind === "delete" ? "#ef4444" : "rgba(255,255,255,0.95)";
	ctx.lineWidth = 1.5 / zoom;
	ctx.setLineDash([6 / zoom, 4 / zoom]);
	ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
	ctx.setLineDash([]);

	const size = CROP_HANDLE_SIZE / zoom;
	const half = size / 2;
	const spots = cropHandleSpots(rect).map((entry) => entry.point);
	ctx.fillStyle = "#ffffff";
	ctx.strokeStyle = "rgba(0,0,0,0.6)";
	ctx.lineWidth = 1 / zoom;
	for (const spot of spots) {
		ctx.fillRect(spot.x - half, spot.y - half, size, size);
		ctx.strokeRect(spot.x - half, spot.y - half, size, size);
	}
	ctx.restore();
}

function cursorStyle(tool: ToolId, hasRegion: boolean, drag: DragState | null): string {
	if (drag?.mode === "pan") return "grabbing";
	switch (tool) {
		case "select":
			return "grab";
		case "crop":
		case "deleteRegion":
			return hasRegion ? "default" : "crosshair";
		case "text":
			return "text";
		default:
			return "crosshair";
	}
}
