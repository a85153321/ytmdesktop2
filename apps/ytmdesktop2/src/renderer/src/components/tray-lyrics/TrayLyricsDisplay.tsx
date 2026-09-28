import { activeWordIndex, primaryActiveLineIndex } from "@plugins/youtube/lyrics/lrc";
import { wordProgress } from "@plugins/youtube/lyrics/progress";
import type { LyricLine, LyricWord } from "@plugins/youtube/lyrics/types";
import { memo } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useLyricsClock } from "@/hooks/use-lyrics-clock";
import { cn } from "@/lib/utils";

interface TrayLyricsDisplayProps {
	lines: LyricLine[];
	progressSec: number;
	playing: boolean;
	durationSec: number;
	accent: string | null;
	emptyMessage?: string;
	loading?: boolean;
	onSeek?: (timeMs: number) => void;
	className?: string;
	showNextLine?: boolean;
	overlayMode?: boolean;
	align?: "left" | "center";
	fontSize?: "small" | "medium" | "large" | "xlarge";
	opacity?: number | string;
}

const WordItem = memo(function WordItem({
	word,
	timeMs,
	isCurrentWord,
	isPastWord,
	accent,
	overlayMode,
}: {
	word: LyricWord;
	timeMs: number;
	isCurrentWord: boolean;
	isPastWord: boolean;
	accent: string | null;
	overlayMode?: boolean;
}) {
	const pct = isPastWord ? 1 : isCurrentWord ? wordProgress(word, timeMs) : 0;
	const activeColor = accent ?? (overlayMode ? "#38bdf8" : "#ffffff");
	const dimColor = overlayMode ? "rgba(255, 255, 255, 0.6)" : "rgba(255, 255, 255, 0.4)";

	return (
		<span
			className={cn(
				"inline transition-opacity duration-100",
				isPastWord && "opacity-100",
				isCurrentWord && "opacity-100 font-bold scale-[1.02]",
				!isPastWord && !isCurrentWord && (overlayMode ? "opacity-60" : "opacity-45"),
			)}
			style={{
				backgroundImage: `linear-gradient(to right, ${activeColor} ${pct * 100}%, ${dimColor} ${pct * 100}%)`,
				WebkitBackgroundClip: "text",
				WebkitTextFillColor: "transparent",
			}}
		>
			{word.text}
		</span>
	);
});

export const TrayLyricsDisplay = memo(function TrayLyricsDisplay({
	lines,
	progressSec,
	playing,
	durationSec,
	accent,
	emptyMessage = "No lyrics found",
	loading = false,
	onSeek,
	className,
	showNextLine = true,
	overlayMode = false,
	align = "left",
	fontSize = "medium",
	opacity = 100,
}: TrayLyricsDisplayProps) {
	const timeMs = useLyricsClock({ progressSec, playing, durationSec });

	const isCenter = align === "center";
	const numericOpacity = opacity != null ? Number(opacity) / 100 : 1;

	const textShadowStyle: React.CSSProperties = overlayMode
		? {
				filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.95)) drop-shadow(0 0 12px rgba(0,0,0,0.85))",
				opacity: Number.isFinite(numericOpacity) ? numericOpacity : 1,
			}
		: {};

	if (loading) {
		return (
			<div className={cn("flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-2", className)}>
				<Spinner className="size-3.5" />
				<span>Loading lyrics…</span>
			</div>
		);
	}

	if (!lines.length) {
		return (
			<div
				className={cn(
					"flex items-center justify-center text-xs py-2 text-center",
					overlayMode ? "text-white/80 font-medium" : "text-muted-foreground",
					className,
				)}
				style={textShadowStyle}
			>
				<span>{emptyMessage}</span>
			</div>
		);
	}

	const activeIdx = primaryActiveLineIndex(lines, timeMs);
	const currentLine = activeIdx >= 0 && activeIdx < lines.length ? lines[activeIdx] : null;
	const nextLine = activeIdx + 1 < lines.length ? lines[activeIdx + 1] : null;

	const hasWords = !!currentLine?.words?.length;
	const activeWord = hasWords ? activeWordIndex(currentLine!.words!, timeMs) : -1;

	// Line progress for line-only cues
	const lineDuration = currentLine?.durationMs ?? 0;
	const lineRatio =
		currentLine && Number.isFinite(lineDuration) && lineDuration > 0
			? Math.min(1, Math.max(0, (timeMs - currentLine.timeMs) / lineDuration))
			: 0;

	const isBeforeFirstLine = timeMs < (lines[0]?.timeMs ?? 0);

	const currentFontClass = overlayMode
		? fontSize === "small"
			? "text-base font-semibold"
			: fontSize === "large"
				? "text-xl md:text-2xl font-bold"
				: fontSize === "xlarge"
					? "text-2xl md:text-3xl font-extrabold"
					: "text-lg md:text-xl font-bold"
		: "text-sm font-semibold";

	const nextFontClass = overlayMode
		? fontSize === "small"
			? "text-xs font-medium text-white/75 hover:text-white"
			: fontSize === "large"
				? "text-base font-medium text-white/75 hover:text-white"
				: fontSize === "xlarge"
					? "text-lg font-medium text-white/75 hover:text-white"
					: "text-sm font-medium text-white/75 hover:text-white"
		: "text-xs text-muted-foreground/70 hover:text-muted-foreground";

	return (
		<div
			className={cn(
				"flex flex-col justify-center px-1",
				overlayMode ? "min-h-[70px] select-none" : "min-h-[50px]",
				isCenter ? "items-center text-center" : "items-start text-left",
				className,
			)}
			style={textShadowStyle}
		>
			{/* Current Line */}
			<div
				className="cursor-pointer max-w-full"
				onClick={() => {
					if (currentLine && onSeek) onSeek(currentLine.timeMs);
				}}
			>
				{currentLine ? (
					hasWords ? (
						<div className={cn("line-clamp-2 leading-snug tracking-wide", currentFontClass, overlayMode && "text-white")}>
							{currentLine.words!.map((word, w) => (
								<WordItem
									key={`${word.timeMs}-${w}`}
									word={word}
									timeMs={timeMs}
									isCurrentWord={w === activeWord}
									isPastWord={w < activeWord}
									accent={accent}
									overlayMode={overlayMode}
								/>
							))}
						</div>
					) : (
						<div className="relative max-w-full">
							<p className={cn("line-clamp-2 tracking-wide leading-snug", currentFontClass, overlayMode ? "text-white" : "text-foreground")}>
								{currentLine.text || "♪"}
							</p>
							{/* Subtle progress indicator line */}
							<div
								className={cn(
									"mt-1.5 h-1 w-full overflow-hidden rounded-full",
									overlayMode ? "bg-white/20 shadow-sm" : "bg-foreground/15",
								)}
							>
								<div
									className="h-full rounded-full transition-[width] duration-75 ease-linear"
									style={{
										width: `${lineRatio * 100}%`,
										backgroundColor: accent ?? (overlayMode ? "#38bdf8" : "var(--accent, #3b82f6)"),
									}}
								/>
							</div>
						</div>
					)
				) : (
					<p
						className={cn(
							"line-clamp-1 tracking-wide",
							overlayMode
								? cn(currentFontClass, "text-white/80")
								: "text-sm font-semibold text-muted-foreground/80",
						)}
					>
						{isBeforeFirstLine ? "♪ (Intro)" : "…"}
					</p>
				)}
			</div>

			{/* Next Line Preview */}
			{showNextLine && nextLine ? (
				<p
					className={cn(
						"mt-1 line-clamp-1 leading-tight cursor-pointer transition-colors duration-150",
						nextFontClass,
					)}
					onClick={() => {
						if (onSeek) onSeek(nextLine.timeMs);
					}}
				>
					{nextLine.text}
				</p>
			) : null}
		</div>
	);
});
