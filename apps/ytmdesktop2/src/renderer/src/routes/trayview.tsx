import type { LyricsStoreSnapshot } from "@plugins/youtube/lyrics/types";
import { toAppThumbUrl } from "@shared/media/appThumbUrl";
import { createFileRoute } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import { intervalToDuration } from "date-fns";
import { clamp } from "lodash-es";
import { ArrowLeftIcon, GripVerticalIcon, LayersIcon, LockIcon, Mic2Icon, PinIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ButtonHTMLAttributes, type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ApiIcon from "@/assets/icons/chip.svg?react";
import DiscordIcon from "@/assets/icons/discord-rpc.svg?react";
import LastFMIcon from "@/assets/icons/lastfm.svg?react";
import LikeIcon from "@/assets/icons/like.svg?react";
import NextIcon from "@/assets/icons/next.svg?react";
import PauseIcon from "@/assets/icons/pause.svg?react";
import PlayIcon from "@/assets/icons/play.svg?react";
import PrevIcon from "@/assets/icons/prev.svg?react";
import SettingsIcon from "@/assets/icons/settings.svg?react";
import { TrayLyricsDisplay } from "@/components/tray-lyrics/TrayLyricsDisplay";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VolumeControl } from "@/components/VolumeControl";
import { useDiscord } from "@/hooks/use-discord";
import { useLastFm } from "@/hooks/use-lastfm";
import { useLyrics } from "@/hooks/use-lyrics";
import { useSettingsState } from "@/hooks/use-settings";
import { useTrack, useTrackState } from "@/hooks/use-track";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";



export const Route = createFileRoute("/trayview")({
	component: TrayViewPage,
});

interface PlayState {
	playing: boolean;
	progress: number;
	duration: number;
	liked: boolean;
	disliked: boolean;
}

function patchPlayState(utils: ReturnType<typeof trpc.useUtils>, patch: Partial<PlayState>) {
	utils.track.state.setData(undefined, (prev) => {
		if (!prev) return prev;
		return { ...prev, ...patch };
	});
}

const zeroPad = (num: number | undefined): string => String(num ?? 0).padStart(2, "0");

function formatTime(seconds: number): string {
	const elapsed = Math.max(0, Math.floor(seconds));
	const { hours, minutes, seconds: secs } = intervalToDuration({ start: 0, end: elapsed * 1000 });
	const parts = [hours, minutes, secs].filter((p, i) => (i === 0 ? Boolean(p) : true)).map(zeroPad);
	return parts.join(":");
}

const ART_EASE = [0.16, 1, 0.3, 1] as const;
const ART_DURATION = 0.28;

/** Preload image; only expose src once decode-ready. */
function useReadyImage(src: string | null | undefined): string | null {
	const [ready, setReady] = useState<string | null>(null);

	useEffect(() => {
		if (!src) {
			setReady((prev) => (prev === null ? prev : null));
			return;
		}
		let cancelled = false;
		const img = new Image();
		const done = () => {
			if (!cancelled) setReady((prev) => (prev === src ? prev : src));
		};
		img.onload = done;
		img.onerror = done;
		img.src = src;
		if (img.complete) done();
		return () => {
			cancelled = true;
			img.onload = null;
			img.onerror = null;
		};
	}, [src]);

	return ready;
}

/**
 * Commit art + accent together when the image for `thumbnail` is ready,
 * so cover/bleed fades and color lerps start in the same frame.
 */
function useAlignedArtDisplay(thumbnail: string | null | undefined, liveAccent: string | null): { src: string | null; accent: string | null } {
	const loadedSrc = useReadyImage(thumbnail);
	const [display, setDisplay] = useState<{ src: string | null; accent: string | null }>({ src: null, accent: null });

	useLayoutEffect(() => {
		const commit = (src: string | null, accent: string | null) => {
			setDisplay((prev) => (prev.src === src && prev.accent === accent ? prev : { src, accent }));
		};

		if (!thumbnail) {
			commit(null, null);
			return;
		}
		// Still decoding next cover — keep previous art+accent on screen.
		if (loadedSrc !== thumbnail) return;

		// Accent already known — swap art + color together.
		if (liveAccent) {
			commit(loadedSrc, liveAccent);
			return;
		}

		// Image ready first — brief wait so vibrant/playState accent can catch up.
		const timer = window.setTimeout(() => commit(loadedSrc, liveAccent), 80);
		return () => clearTimeout(timer);
	}, [thumbnail, loadedSrc, liveAccent]);

	return display;
}

function TrayBleedArt({ src, accent, opacity = 1 }: { src: string | null; accent: string | null; opacity?: number }) {
	return (
		<div className="pointer-events-none absolute inset-0" aria-hidden>
			<AnimatePresence mode="wait">
				{src ? (
					<motion.div
						key={src}
						className="absolute inset-0"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: ART_DURATION, ease: ART_EASE }}
					>
						<div className="absolute inset-0 scale-110 bg-cover bg-center" style={{ backgroundImage: `url(${src})` }} />
						<div className="absolute inset-0 scale-125 bg-cover bg-center opacity-70 blur-2xl" style={{ backgroundImage: `url(${src})` }} />
					</motion.div>
				) : (
					<motion.div
						key="empty-bleed"
						className="absolute inset-0 bg-muted/30"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: ART_DURATION, ease: ART_EASE }}
					/>
				)}
			</AnimatePresence>
			{/* Accent wash — same duration/ease as pill; color follows displayAccent */}
			<motion.div
				className="absolute inset-0"
				initial={false}
				animate={{
					backgroundColor: accent ?? "var(--accent)",
					opacity: accent ? 0.25 * opacity : 0,
				}}
				transition={{ duration: ART_DURATION, ease: ART_EASE }}
			/>
			<div
				className="absolute inset-0 bg-background"
				style={{ opacity: 0.7 * opacity }}
			/>
		</div>
	);
}

function TrayAccentPill({ accent, drag, expanded }: { accent: string | null; drag?: boolean; expanded?: boolean }) {
	const [dragLayer, setDragLayer] = useState(false);

	useEffect(() => {
		if (!drag || !expanded) {
			setDragLayer(false);
			return;
		}
		const id = window.setTimeout(() => setDragLayer(true), 200);
		return () => clearTimeout(id);
	}, [drag, expanded]);

	return (
		<div
			className={cn(
				"relative z-10 flex shrink-0 items-stretch justify-center py-2.5 ml-1 no-drag transition-[width] duration-200 ease-out",
				expanded ? "w-6" : "w-3",
			)}
			aria-hidden={!drag}
			title={drag ? "Drag" : undefined}
		>
			<motion.div
				className={cn(
					"pointer-events-none flex items-center justify-center overflow-hidden rounded-full bg-accent transition-[width] duration-200 ease-out",
					expanded ? "w-4" : "w-1.5",
				)}
				initial={false}
				animate={{ backgroundColor: accent ?? "var(--accent)" }}
				transition={{ duration: ART_DURATION, ease: ART_EASE }}
			>
				<GripVerticalIcon
					className={cn("size-3.5 shrink-0 text-background/80 transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")}
				/>
			</motion.div>
			{dragLayer ? <div className="drag absolute inset-0 z-10 cursor-grab" /> : null}
		</div>
	);
}

function TrayCoverArt({ src }: { src: string | null }) {
	return (
		<div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted/80 ring-1 ring-border/50 shadow-sm">
			<AnimatePresence mode="wait">
				{src ? (
					<motion.img
						key={src}
						src={src}
						alt=""
						className="no-drag absolute inset-0 size-full object-cover pointer-events-none"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: ART_DURATION, ease: ART_EASE }}
					/>
				) : (
					<motion.div
						key="empty-cover"
						className="no-drag absolute inset-0 flex size-full items-center justify-center text-[9px] font-medium tracking-wide text-muted-foreground"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: ART_DURATION, ease: ART_EASE }}
					>
						YTM
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

const chromeButtonVariants = cva(
	[
		"inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-[transform,background-color,color] duration-100",
		"enabled:hover:bg-accent/20 enabled:hover:text-foreground enabled:active:scale-95",
		"disabled:pointer-events-none disabled:opacity-40",
		"[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
	].join(" "),
	{ variants: { variant: { default: "" } }, defaultVariants: { variant: "default" } },
);

const playerButtonVariants = cva(
	[
		"inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground transition-[transform,background-color,color] duration-100",
		"enabled:hover:bg-foreground/10 enabled:active:scale-95",
		"disabled:pointer-events-none disabled:opacity-50",
		"[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
		"data-[active=true]:text-accent",
	].join(" "),
	{
		variants: {
			variant: {
				default: "",
				hero: "size-9 bg-foreground/10 [&_svg]:size-[1.125rem]",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

const controlToggleVariants = cva(
	[
		"relative inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[transform,background-color,color,opacity] duration-100",
		"enabled:hover:bg-accent/15 enabled:hover:text-foreground enabled:active:scale-95",
		"disabled:pointer-events-none disabled:opacity-40",
		"[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
		"data-[on=true]:bg-accent/20 data-[on=true]:text-foreground",
	].join(" "),
	{ variants: { variant: { default: "" } }, defaultVariants: { variant: "default" } },
);

function ChromeButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
	return <button type={type} className={cn(chromeButtonVariants(), className)} {...props} />;
}

function PlayerButton({
	className,
	variant,
	active,
	type = "button",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "hero"; active?: boolean }) {
	return (
		<button type={type} data-active={active ? "true" : undefined} className={cn(playerButtonVariants({ variant }), className)} {...props} />
	);
}

function ControlToggle({
	className,
	active,
	busy,
	type = "button",
	children,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; busy?: boolean }) {
	return (
		<button type={type} data-on={active ? "true" : undefined} className={cn(controlToggleVariants(), className)} {...props}>
			{children}
			{busy ? (
				<span className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-muted">
					<Spinner className="size-2" />
				</span>
			) : active ? (
				<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-2 ring-background" />
			) : null}
		</button>
	);
}

function pointerInsideWindow(ev: { clientX: number; clientY: number }): boolean {
	return ev.clientX >= 0 && ev.clientY >= 0 && ev.clientX < window.innerWidth && ev.clientY < window.innerHeight;
}

function getLyricsStatusMessage(snap: LyricsStoreSnapshot | null): string {
	if (!snap) return "Loading lyrics…";
	switch (snap.status) {
		case "loading":
			return "Loading lyrics…";
		case "empty":
			return "No lyrics found";
		case "error":
			return snap.errorMessage ? `Lyrics error: ${snap.errorMessage}` : "Failed to load lyrics";
		case "skipped":
			return snap.errorMessage ?? "Lyrics unavailable";
		case "idle":
			return "Play a song to see lyrics";
		default:
			return snap.result?.plain ? snap.result.plain : "No lyrics found";
	}
}

type ResizeDirection = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const RESIZE_HANDLES: { dir: ResizeDirection; className: string; cursor: string }[] = [
	{ dir: "nw", className: "top-0 left-0 size-3 z-50 cursor-nwse-resize", cursor: "nwse-resize" },
	{ dir: "ne", className: "top-0 right-0 size-3 z-50 cursor-nesw-resize", cursor: "nesw-resize" },
	{ dir: "sw", className: "bottom-0 left-0 size-3 z-50 cursor-nesw-resize", cursor: "nesw-resize" },
	{ dir: "se", className: "bottom-0 right-0 size-3 z-50 cursor-nwse-resize", cursor: "nwse-resize" },
	{ dir: "n", className: "top-0 left-3 right-3 h-1.5 z-40 cursor-ns-resize", cursor: "ns-resize" },
	{ dir: "s", className: "bottom-0 left-3 right-3 h-1.5 z-40 cursor-ns-resize", cursor: "ns-resize" },
	{ dir: "w", className: "left-0 top-3 bottom-3 w-1.5 z-40 cursor-ew-resize", cursor: "ew-resize" },
	{ dir: "e", className: "right-0 top-3 bottom-3 w-1.5 z-40 cursor-ew-resize", cursor: "ew-resize" },
];

function TrayViewPage() {
	const utils = trpc.useUtils();
	const track = useTrack();
	const playState = useTrackState();
	const [trackBusy, setTrackBusy] = useState(false);
	const [trackAccent, setTrackAccent] = useState<string | null>(null);
	const playStateRef = useRef(playState);
	playStateRef.current = playState;

	const lyricsSnapshot = useLyrics();
	const lyricsLines = useMemo(() => lyricsSnapshot?.result?.lines ?? [], [lyricsSnapshot?.result?.lines]);

	const { data: serverContentMode = "player" } = trpc.trayView.contentMode.useQuery();
	const { data: desktopOverlay = false } = trpc.trayView.desktopOverlay.useQuery();
	const { data: clickThrough = false } = trpc.trayView.clickThrough.useQuery();
	const { mutateAsync: setServerContentMode } = trpc.trayView.setContentMode.useMutation();
	const { mutateAsync: setDesktopOverlay } = trpc.trayView.setDesktopOverlay.useMutation();
	const { mutateAsync: toggleDesktopOverlay } = trpc.trayView.toggleDesktopOverlay.useMutation();
	const { mutateAsync: setClickThrough } = trpc.trayView.setClickThrough.useMutation();
	const { mutateAsync: setBounds } = trpc.trayView.setBounds.useMutation();

	const isResizingRef = useRef(false);

	const startResize = (direction: ResizeDirection, e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 || clickThrough) return;
		e.preventDefault();
		e.stopPropagation();

		isResizingRef.current = true;
		const startX = e.screenX;
		const startY = e.screenY;
		const startWidth = window.outerWidth;
		const startHeight = window.outerHeight;
		const startScreenX = window.screenX;
		const startScreenY = window.screenY;

		const minW = 360;
		const minH = 140;

		const onPointerMove = (ev: PointerEvent) => {
			if (!isResizingRef.current) return;
			const deltaX = ev.screenX - startX;
			const deltaY = ev.screenY - startY;

			let newX = startScreenX;
			let newY = startScreenY;
			let newW = startWidth;
			let newH = startHeight;

			// Handle Horizontal
			if (direction.includes("e")) {
				newW = Math.max(minW, startWidth + deltaX);
			} else if (direction.includes("w")) {
				const targetW = startWidth - deltaX;
				if (targetW >= minW) {
					newW = targetW;
					newX = startScreenX + deltaX;
				} else {
					newW = minW;
					newX = startScreenX + (startWidth - minW);
				}
			}

			// Handle Vertical
			if (direction.includes("s")) {
				newH = Math.max(minH, startHeight + deltaY);
			} else if (direction.includes("n")) {
				const targetH = startHeight - deltaY;
				if (targetH >= minH) {
					newH = targetH;
					newY = startScreenY + deltaY;
				} else {
					newH = minH;
					newY = startScreenY + (startHeight - minH);
				}
			}

			void setBounds({
				x: Math.round(newX),
				y: Math.round(newY),
				width: Math.round(newW),
				height: Math.round(newH),
			});
		};

		const onPointerUp = () => {
			isResizingRef.current = false;
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
		};

		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
	};

	const { enabled: lastFmEnabled, toggleLastFM, lastFM, lastFMLoading, isBusy: lastFmBusy } = useLastFm();
	const { enabled: discordEnabled, toggle: toggleDiscord, loading: discordLoading, connected: discordConnected, error: discordError } = useDiscord();
	const [apiEnabled, setApiEnabled] = useSettingsState<boolean>("api.enabled", false);
	const [overlayFontSize] = useSettingsState<"small" | "medium" | "large" | "xlarge">("trayView.overlayFontSize", "medium");
	const [overlayOpacity] = useSettingsState<string>("trayView.overlayOpacity", "100");
	const [rawBgOpacity] = useSettingsState<number>("trayView.desktopOverlayBackgroundOpacity", 75);
	const [overlayShowNextLine] = useSettingsState<boolean>("trayView.overlayShowNextLine", true);
	const [overlayAlign] = useSettingsState<"left" | "center">("trayView.overlayAlign", "center");
	const { data: pinned = false } = trpc.trayView.pinned.useQuery();

	const bgOpacityPercent =
		typeof rawBgOpacity === "number" && Number.isFinite(rawBgOpacity)
			? Math.max(10, Math.min(100, rawBgOpacity))
			: 75;
	const bgAlpha = bgOpacityPercent / 100;

	const [contentHovered, setContentHovered] = useState(false);
	const [leftThirdHovered, setLeftThirdHovered] = useState(false);
	const [chromeTooltipOpen, setChromeTooltipOpen] = useState(false);
	/** Portaled tooltips leave the tray DOM — keep chrome up while a chrome tooltip is open. */
	const chromeVisible = contentHovered || chromeTooltipOpen || pinned || desktopOverlay;

	const { mutateAsync: next } = trpc.track.next.useMutation();
	const { mutateAsync: prev } = trpc.track.prev.useMutation();
	const { mutateAsync: pause } = trpc.track.pause.useMutation();
	const { mutateAsync: play } = trpc.track.play.useMutation();
	const { mutateAsync: seek } = trpc.track.seek.useMutation();
	const { mutateAsync: like } = trpc.track.like.useMutation();
	const { mutateAsync: dislike } = trpc.track.dislike.useMutation();
	const { mutateAsync: hideTrayView } = trpc.trayView.hide.useMutation();
	const { mutateAsync: openMain } = trpc.trayView.openMain.useMutation();
	const { mutateAsync: toggleTrayPin } = trpc.trayView.togglePinned.useMutation();
	const { mutateAsync: openSettings } = trpc.app.openSettings.useMutation();

	useEffect(() => {
		document.title = "YouTube Music - Tray";
		document.documentElement.classList.add("translucent");
		return () => {
			document.documentElement.classList.remove("translucent");
		};
	}, []);

	useEffect(() => {
		const collapse = (ev: { clientX: number; clientY: number }) => {
			if (pointerInsideWindow(ev)) return;
			setLeftThirdHovered(false);
		};
		const onBlur = () => setLeftThirdHovered(false);
		const root = document.documentElement;
		root.addEventListener("mouseleave", collapse);
		window.addEventListener("blur", onBlur);
		return () => {
			root.removeEventListener("mouseleave", collapse);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	trpc.trayView.onState.useSubscription(undefined, {
		onData: (state) => {
			if (typeof state?.pinned === "boolean") utils.trayView.pinned.setData(undefined, state.pinned);
			if (state?.contentMode) utils.trayView.contentMode.setData(undefined, state.contentMode);
			if (typeof state?.desktopOverlay === "boolean") utils.trayView.desktopOverlay.setData(undefined, state.desktopOverlay);
			if (typeof state?.clickThrough === "boolean") utils.trayView.clickThrough.setData(undefined, state.clickThrough);
		},
	});


	const thumbnail = toAppThumbUrl(track?.meta?.thumbnail);
	const playing = !!playState?.playing;
	const title = track?.video?.title ?? "Nothing playing";
	const artist = track?.video?.author ?? "";
	const hasLike = typeof playState?.liked === "boolean";
	const hasDislike = typeof playState?.disliked === "boolean";
	const liveAccent = trackAccent || playState?.accent || null;
	const { src: artSrc, accent: displayAccent } = useAlignedArtDisplay(thumbnail, liveAccent);

	useEffect(() => {
		if (!thumbnail) {
			setTrackAccent(null);
			return;
		}
		let cancelled = false;
		void utils.track.accent
			.fetch()
			.then((clr) => {
				if (!cancelled) setTrackAccent(clr || null);
			})
			.catch(() => {
				if (!cancelled) setTrackAccent(null);
			});
		return () => {
			cancelled = true;
		};
		// utils.track.accent identity churns every render — only re-fetch on thumbnail.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
	}, [thumbnail]);

	const time = useMemo((): { current: string; end: string; pct: number } | null => {
		const progress = playState?.progress;
		const duration = playState?.duration || Number(track?.meta?.duration) || 0;
		if (typeof progress !== "number" || duration <= 0) return null;
		const elapsed = clamp(progress, 0, duration);
		return {
			current: formatTime(elapsed),
			end: formatTime(duration),
			pct: clamp((elapsed / duration) * 100, 0, 100),
		};
	}, [playState?.progress, playState?.duration, track?.meta?.duration]);

	function handleNext() {
		setTrackBusy(true);
		return next()
			.finally(() => setTrackBusy(false))
			.then(() => {
				if (playStateRef.current) patchPlayState(utils, { progress: 0 });
			});
	}

	function handlePrev() {
		setTrackBusy(true);
		return prev().finally(() => {
			setTrackBusy(false);
			if (playStateRef.current) patchPlayState(utils, { progress: 0 });
		});
	}

	function likeToggle() {
		if (typeof playStateRef.current?.liked !== "boolean") return;
		const next = !playStateRef.current.liked;
		patchPlayState(utils, { liked: next, ...(next ? { disliked: false } : {}) });
		setTrackBusy(true);
		return like({ liked: next })
			.then((liked) => {
				if (typeof liked === "boolean") {
					patchPlayState(utils, { liked, ...(liked ? { disliked: false } : {}) });
				}
			})
			.finally(() => setTrackBusy(false));
	}

	function dislikeToggle() {
		if (typeof playStateRef.current?.disliked !== "boolean") return;
		const next = !playStateRef.current.disliked;
		patchPlayState(utils, { disliked: next, ...(next ? { liked: false } : {}) });
		setTrackBusy(true);
		return dislike({ disliked: next })
			.then((disliked) => {
				if (typeof disliked === "boolean") {
					patchPlayState(utils, { disliked, ...(disliked ? { liked: false } : {}) });
				}
			})
			.finally(() => setTrackBusy(false));
	}

	async function handleSettings() {
		await hideTrayView();
		await openSettings();
	}

	async function handlePinToggle() {
		try {
			const applied = await toggleTrayPin();
			utils.trayView.pinned.setData(undefined, applied);
		} catch {
			/* keep last known pin */
		}
	}

	const [seekHovering, setSeekHovering] = useState(false);
	const durationSec = playState?.duration || Number(track?.meta?.duration) || 0;
	const durationSecRef = useRef(durationSec);
	durationSecRef.current = durationSec;
	const currentTimeLabel = time?.current ?? "0:00";

	const seekTrackRef = useRef<HTMLDivElement>(null);
	const seekHoverFillRef = useRef<HTMLDivElement>(null);
	const seekThumbRef = useRef<HTMLDivElement>(null);
	const seekTipRef = useRef<HTMLDivElement>(null);
	const seekTimeRef = useRef<HTMLSpanElement>(null);
	const seekHoveringRef = useRef(false);

	useEffect(() => {
		if (seekHoveringRef.current) return;
		if (seekTimeRef.current) seekTimeRef.current.textContent = currentTimeLabel;
	}, [currentTimeLabel]);

	function syncSeekHover(clientX: number) {
		const trackEl = seekTrackRef.current;
		if (!trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		if (rect.width <= 0) return;
		const pct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
		const pctStr = `${pct}%`;
		if (seekHoverFillRef.current) seekHoverFillRef.current.style.width = pctStr;
		if (seekThumbRef.current) seekThumbRef.current.style.left = pctStr;
		if (seekTipRef.current) seekTipRef.current.style.left = pctStr;
		const dur = durationSecRef.current;
		const label = dur > 0 ? formatTime((pct / 100) * dur) : "0:00";
		if (seekTipRef.current) seekTipRef.current.textContent = label;
		if (seekTimeRef.current) seekTimeRef.current.textContent = label;
	}

	function handleSeekHover(ev: MouseEvent<HTMLDivElement>) {
		syncSeekHover(ev.clientX);
	}

	function handleSeekEnter(ev: MouseEvent<HTMLDivElement>) {
		seekHoveringRef.current = true;
		setSeekHovering(true);
		requestAnimationFrame(() => syncSeekHover(ev.clientX));
	}

	function clearSeekHover() {
		seekHoveringRef.current = false;
		setSeekHovering(false);
		if (seekTimeRef.current) seekTimeRef.current.textContent = currentTimeLabel;
	}

	function setCurrentTime(ev: MouseEvent<HTMLDivElement>) {
		if (trackBusy) return;
		const current = playStateRef.current;
		if (!current) return;
		const el = ev.currentTarget;
		const rect = el.getBoundingClientRect();
		const percSelected = (ev.clientX - rect.left) / rect.width;
		const duration = current.duration || Number(track?.meta?.duration) || 0;
		if (duration <= 0) return;
		const seekTime = clamp(duration * percSelected, 0, duration) * 1000;
		setTrackBusy(true);
		void seek({ time: seekTime, type: "seek" })
			.then(() => {
				patchPlayState(utils, { progress: seekTime / 1000, duration });
			})
			.finally(() => setTrackBusy(false));
	}

	return (
		<div
			className={cn(
				"absolute inset-0 flex overflow-hidden select-none",
				desktopOverlay
					? "border border-border/40 text-foreground shadow-lg backdrop-blur-md"
					: "border border-border bg-background text-foreground shadow-sm",
			)}
			style={
				desktopOverlay
					? {
							backgroundColor: `color-mix(in oklab, var(--background) ${bgOpacityPercent}%, transparent)`,
						}
					: undefined
			}
			onMouseEnter={(ev) => {
				setContentHovered(true);
				const { left, width } = ev.currentTarget.getBoundingClientRect();
				if (width <= 0) return;
				setLeftThirdHovered((ev.clientX - left) / width < 1 / 3);
			}}
			onMouseMove={(ev) => {
				const { left, width } = ev.currentTarget.getBoundingClientRect();
				if (width <= 0) return;
				const inLeftThird = (ev.clientX - left) / width < 1 / 3;
				setLeftThirdHovered((prev) => (prev === inLeftThird ? prev : inLeftThird));
			}}
			onMouseLeave={(ev) => {
				setContentHovered(false);
				if (pointerInsideWindow(ev)) return;
				setLeftThirdHovered(false);
			}}
		>
			<TrayBleedArt src={artSrc} accent={displayAccent} opacity={desktopOverlay ? bgAlpha : 1} />
			<TrayAccentPill accent={displayAccent} drag={pinned || desktopOverlay} expanded={(pinned || desktopOverlay) && leftThirdHovered} />

			<div className="no-drag relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
				<div className="relative z-10 flex min-h-0 flex-1">
					{/* Main column */}
					<div className="relative flex min-w-0 flex-1 flex-col px-3 pt-3 pb-2">
						{/* Chrome toolbar: fade in while pointer over content (or tooltip open, or overlay unlocked) */}
						{!clickThrough ? (
							<div
								className={cn(
									"no-drag absolute top-2 right-2 z-20 flex items-center gap-0.5 rounded-full p-1 shadow-md backdrop-blur-md",
									desktopOverlay
										? "border border-border/40 bg-background/80"
										: "bg-background/60",
									"transition-[opacity,transform] duration-200 ease-out",
									chromeVisible
										? "pointer-events-auto translate-y-0 opacity-100"
										: "pointer-events-none -translate-y-0.5 opacity-0",
								)}
							>
								<Tooltip onOpenChange={setChromeTooltipOpen}>
									<TooltipTrigger
										render={
											<ChromeButton
												aria-label={serverContentMode === "lyrics" ? "Player view" : "Lyrics view"}
												aria-pressed={serverContentMode === "lyrics"}
												data-active={serverContentMode === "lyrics" ? "true" : undefined}
												onClick={() =>
													void setServerContentMode(serverContentMode === "player" ? "lyrics" : "player")
												}
												className={cn("no-drag", serverContentMode === "lyrics" && "text-foreground bg-accent/20")}
											>
												<Mic2Icon className={cn(serverContentMode === "lyrics" && "text-accent")} />
											</ChromeButton>
										}
									/>
									<TooltipContent side="bottom">
										{serverContentMode === "lyrics" ? "Show player" : "Show lyrics"}
									</TooltipContent>
								</Tooltip>

								<Tooltip onOpenChange={setChromeTooltipOpen}>
									<TooltipTrigger
										render={
											<ChromeButton
												aria-label="Desktop Overlay"
												aria-pressed={desktopOverlay}
												data-active={desktopOverlay ? "true" : undefined}
												onClick={() => void toggleDesktopOverlay()}
												className={cn("no-drag", desktopOverlay && "text-foreground bg-accent/20")}
											>
												<LayersIcon className={cn("size-3.5", desktopOverlay && "text-accent")} />
											</ChromeButton>
										}
									/>
									<TooltipContent side="bottom">
										{desktopOverlay ? "Exit Desktop Overlay" : "Desktop Overlay"}
									</TooltipContent>
								</Tooltip>

								{desktopOverlay ? (
									<Tooltip onOpenChange={setChromeTooltipOpen}>
										<TooltipTrigger
											render={
												<ChromeButton
													aria-label="Lock (Click-through)"
													onClick={() => void setClickThrough(true)}
													className="no-drag text-amber-500 hover:text-amber-400"
												>
													<LockIcon className="size-3.5" />
												</ChromeButton>
											}
										/>
										<TooltipContent side="bottom">Lock (Click-through). Hotkey: Ctrl+Alt+L</TooltipContent>
									</Tooltip>
								) : null}

								<Tooltip onOpenChange={setChromeTooltipOpen}>
									<TooltipTrigger
										render={
											<ChromeButton
												aria-label={pinned ? "Unpin" : "Pin"}
												aria-pressed={pinned}
												data-active={pinned ? "true" : undefined}
												onPointerDown={(ev) => {
													if (ev.button !== 0) return;
													ev.preventDefault();
													ev.stopPropagation();
													void handlePinToggle();
												}}
												className={cn("no-drag", pinned && "text-foreground bg-accent/20")}
											>
												<PinIcon className={cn(pinned && "fill-current")} />
											</ChromeButton>
										}
									/>
									<TooltipContent side="bottom">{pinned ? "Unpin" : "Pin"}</TooltipContent>
								</Tooltip>

								<Tooltip onOpenChange={setChromeTooltipOpen}>
									<TooltipTrigger
										render={
											<ChromeButton aria-label="Back to app" onClick={() => void openMain()}>
												<ArrowLeftIcon />
											</ChromeButton>
										}
									/>
									<TooltipContent side="bottom">Back to app</TooltipContent>
								</Tooltip>

								<Tooltip onOpenChange={setChromeTooltipOpen}>
									<TooltipTrigger
										render={
											<ChromeButton aria-label="Settings" onClick={() => void handleSettings()}>
												<SettingsIcon />
											</ChromeButton>
										}
									/>
									<TooltipContent side="bottom">Settings</TooltipContent>
								</Tooltip>
							</div>
						) : null}

						{/* Content rendering: Player vs Lyrics */}
						{serverContentMode === "player" ? (
							<div className="flex items-start gap-2.5">
								<TrayCoverArt src={artSrc} />

								<div className="min-w-0 flex-1 pt-0.5">
									<p className="truncate text-base leading-tight font-semibold">{title}</p>
									{artist ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{artist}</p> : null}
								</div>
							</div>
						) : (
							<div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
								<div className="flex items-center gap-1.5 min-w-0 pr-28">
									<p className="truncate text-xs font-medium text-muted-foreground/90">
										{title} {artist ? `· ${artist}` : ""}
									</p>
									{lyricsSnapshot?.result?.provider ? (
										<span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground font-mono">
											{lyricsSnapshot.result.provider}
										</span>
									) : null}
								</div>

								<TrayLyricsDisplay
									lines={lyricsLines}
									progressSec={playState?.progress ?? 0}
									playing={playing}
									durationSec={playState?.duration || Number(track?.meta?.duration) || 0}
									accent={displayAccent}
									emptyMessage={getLyricsStatusMessage(lyricsSnapshot)}
									loading={lyricsSnapshot?.status === "loading"}
									overlayMode={false}
									fontSize={overlayFontSize}
									opacity={overlayOpacity}
									showNextLine={overlayShowNextLine}
									align={overlayAlign}
									onSeek={(timeMs) => {
										void seek({ time: timeMs, type: "seek" });
									}}
								/>
							</div>
						)}

						{/* Progress + duration */}
						<div className="mt-3 flex items-center gap-2">
							<span
								ref={seekTimeRef}
								className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/40"
							/>
							<div
								ref={seekTrackRef}
								className={cn(
									"group relative h-1.5 min-w-0 flex-1 cursor-pointer rounded-full bg-muted/80",
									!track && "pointer-events-none opacity-40",
								)}
								onClick={setCurrentTime}
								onMouseMove={handleSeekHover}
								onMouseEnter={handleSeekEnter}
								onMouseLeave={clearSeekHover}
								role="slider"
								aria-label="Seek"
								aria-valuenow={time?.pct ?? 0}
								aria-valuemin={0}
								aria-valuemax={100}
								tabIndex={0}
							>
								{/* Played */}
								<div
									className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-100 ease-out"
									style={{
										width: `${time?.pct ?? 0}%`,
										...(displayAccent ? { backgroundColor: displayAccent } : {}),
									}}
								/>
								{/* Hover preview */}
								<div
									ref={seekHoverFillRef}
									className={cn("absolute inset-y-0 left-0 rounded-full bg-foreground/25", !seekHovering && "hidden")}
									style={{ width: 0 }}
								/>
								{/* Scrubber thumb + tip */}
								<div
									ref={seekThumbRef}
									className={cn(
										"pointer-events-none absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm ring-2 ring-background",
										!seekHovering && "hidden",
									)}
									style={{ left: 0 }}
								/>
								<div
									ref={seekTipRef}
									className={cn(
										"pointer-events-none absolute bottom-full z-20 mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-background shadow-sm",
										!seekHovering && "hidden",
									)}
									style={{ left: 0 }}
								/>
							</div>
							<span className="w-9 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{time?.end ?? "0:00"}</span>
						</div>

						{/* Transport + Volume row */}
						<div className="mt-auto flex items-center justify-between gap-1.5 pt-2">
								<div className="flex items-center gap-0.5 rounded-full border border-border/50 bg-background/50 p-1 shadow-sm backdrop-blur-md">
									{hasLike ? (
										<PlayerButton
											active={!!playState?.liked}
											disabled={trackBusy || !track}
											aria-label="Like"
											style={
												playState?.liked && displayAccent
													? { color: displayAccent }
													: undefined
											}
											onClick={likeToggle}
										>
											<LikeIcon />
										</PlayerButton>
									) : null}
									<PlayerButton disabled={trackBusy || !track} aria-label="Previous" onClick={handlePrev}>
										<PrevIcon />
									</PlayerButton>
									<PlayerButton
										variant="hero"
										disabled={trackBusy || !track}
										aria-label={playing ? "Pause" : "Play"}
										style={
											displayAccent
												? {
														backgroundColor: `color-mix(in oklab, ${displayAccent} 28%, transparent)`,
														color: displayAccent,
													}
												: undefined
										}
										onClick={() => void (!playing ? play() : pause())}
									>
										{playing ? <PauseIcon /> : <PlayIcon />}
									</PlayerButton>
									<PlayerButton disabled={trackBusy || !track} aria-label="Next" onClick={handleNext}>
										<NextIcon />
									</PlayerButton>
									{hasDislike ? (
										<PlayerButton
											active={!!playState?.disliked}
											disabled={trackBusy || !track}
											aria-label="Dislike"
											style={
												playState?.disliked && displayAccent
													? { color: displayAccent }
													: undefined
											}
											onClick={dislikeToggle}
										>
											<LikeIcon className="rotate-180" />
										</PlayerButton>
									) : null}
								</div>

								<div className="flex items-center rounded-full border border-border/50 bg-background/50 p-1 shadow-sm backdrop-blur-md">
									<VolumeControl ariaLabel="Tray Volume Control" />
								</div>
							</div>
					</div>

					{/* Control center column */}
					<div className="relative z-10 flex w-12 shrink-0 flex-col items-center justify-center gap-1.5 border-l border-border/60 bg-background/40 px-1.5 py-2 backdrop-blur-sm">
						<Tooltip>
							<TooltipTrigger
								render={
									<ControlToggle
										active={lastFmEnabled}
										busy={lastFmBusy || lastFMLoading}
										aria-label={lastFmEnabled ? "Disable Last.fm" : "Enable Last.fm"}
										onClick={() => void toggleLastFM(!lastFmEnabled)}
									>
										<LastFMIcon
											className={cn(
												lastFmEnabled && lastFM.error && "text-red-500",
												lastFmEnabled && lastFM.connected && !lastFM.error && "text-green-500",
											)}
										/>
									</ControlToggle>
								}
							/>
							<TooltipContent side="left">
								{lastFmEnabled ? (lastFM.name ? `Last.fm · ${lastFM.name}` : "Last.fm on") : "Last.fm off"}
							</TooltipContent>
						</Tooltip>

						<Tooltip>
							<TooltipTrigger
								render={
									<ControlToggle
										active={discordEnabled}
										busy={discordLoading}
										aria-label={discordEnabled ? "Disable Discord" : "Enable Discord"}
										onClick={toggleDiscord}
									>
										<DiscordIcon className={cn(discordEnabled && discordError && "text-red-500")} />
									</ControlToggle>
								}
							/>
							<TooltipContent side="left">
								{discordError && discordEnabled
									? `Discord · ${discordError}`
									: discordEnabled
										? discordConnected
											? "Discord on"
											: "Discord connecting…"
										: "Discord off"}
							</TooltipContent>
						</Tooltip>

						<Tooltip>
							<TooltipTrigger
								render={
									<ControlToggle
										active={apiEnabled}
										aria-label={apiEnabled ? "Disable Local API" : "Enable Local API"}
										onClick={() => setApiEnabled((prev) => !prev)}
									>
										<ApiIcon />
									</ControlToggle>
								}
							/>
							<TooltipContent side="left">{apiEnabled ? "Local API on" : "Local API off"}</TooltipContent>
						</Tooltip>
					</div>
				</div>
			</div>

			{/* 8-direction resize handles (only active when not click-through) */}
			{!clickThrough ? (
				<>
					{RESIZE_HANDLES.map(({ dir, className, cursor }) => (
						<div
							key={dir}
							className={cn("no-drag absolute select-none", className)}
							style={{ cursor }}
							onPointerDown={(e) => startResize(dir, e)}
						/>
					))}
				</>
			) : null}
		</div>
	);
}
