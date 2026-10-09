import { toast as heroToast, Toast } from "@heroui/react";
import { type ComponentProps, isValidElement, type ReactNode } from "react";
import { translateForActiveLocale } from "@/contexts/I18nContext";
import { writeClipboardText } from "@/lib/clipboard";

type Options = {
	id?: string | number;
	description?: ReactNode;
	duration?: number;
	action?: { label: ReactNode; onClick: () => void };
	onDismiss?: () => void;
};
type Variant = "default" | "accent" | "success" | "warning" | "danger";
const ids = new Map<string | number, string>();

function plainText(value: ReactNode): string {
	if (typeof value === "string" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(plainText).join("");
	if (isValidElement<{ children?: ReactNode }>(value)) return plainText(value.props.children);
	return "";
}

// Keep existing callers compatible while HeroUI owns the queue and presentation.
function notify(title: ReactNode, options: Options = {}, variant: Variant = "default") {
	const errorText = [plainText(title), plainText(options.description)]
		.filter(Boolean)
		.join("\n\n");
	const action = options.action;
	const nativeOptions = {
		variant,
		description: options.description,
		timeout:
			options.duration === Infinity
				? 0
				: (options.duration ?? (variant === "danger" ? 8000 : 4000)),
		onClose: () => {
			if (options.id !== undefined) ids.delete(options.id);
			options.onDismiss?.();
		},
		actionProps: action
			? {
					children: action.label,
					onPress: action.onClick,
				}
			: variant === "danger" && errorText
				? {
						// `notify` runs outside React, so resolve these through the
						// module-level translator rather than the `useI18n` hook.
						children: translateForActiveLocale("common.toast.copy", "Copy"),
						onPress: () => {
							void writeClipboardText(errorText).then(
								() =>
									heroToast.success(
										translateForActiveLocale(
											"common.toast.errorCopied",
											"Error copied",
										),
									),
								() =>
									heroToast.danger(
										translateForActiveLocale(
											"common.toast.copyErrorFailed",
											"Could not copy error",
										),
										{
											description: errorText,
										},
									),
							);
						},
					}
				: undefined,
	};
	const previous = options.id === undefined ? undefined : ids.get(options.id);
	const key = previous
		? heroToast.update(previous, title, nativeOptions)
		: heroToast(title, nativeOptions);
	if (options.id !== undefined) ids.set(options.id, key);
	return key;
}
export const toast = Object.assign(notify, {
	success: (message: ReactNode, options?: Options) => notify(message, options, "success"),
	error: (message: ReactNode, options?: Options) => notify(message, options, "danger"),
	info: (message: ReactNode, options?: Options) => notify(message, options, "accent"),
	warning: (message: ReactNode, options?: Options) => notify(message, options, "warning"),
	dismiss: (id?: string | number) => {
		if (id === undefined) {
			heroToast.clear();
			ids.clear();
		} else heroToast.close(ids.get(id) ?? String(id));
	},
});
export function Toaster({
	className,
	placement = "bottom end",
}: {
	className?: string;
	/**
	 * The editor and dashboard windows toast into the screen corner, but the
	 * recording HUD is a compact bottom-anchored window, so a bottom-placed
	 * toast would cover the recording controls. It asks for "top end" instead.
	 */
	placement?: ComponentProps<typeof Toast.Provider>["placement"];
}) {
	return <Toast.Provider placement={placement} className={className} />;
}
