import { Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useMemo, type WheelEvent } from "react";
import { Slider } from "@/components/ui/slider";
import { useVolume } from "@/hooks/use-volume";
import { cn } from "@/lib/utils";

export interface VolumeControlProps {
	className?: string;
	sliderWidth?: string;
	showPercentage?: boolean;
	ariaLabel?: string;
}

export function VolumeControl({
	className,
	sliderWidth = "w-16 sm:w-20",
	showPercentage = true,
	ariaLabel = "Volume Control",
}: VolumeControlProps) {
	const { volume, muted, setVolume, toggleMute, setIsDragging } = useVolume();

	// When muted, audio level is 0, but slider/percentage can show 0 or muted volume
	const displayVolume = muted ? 0 : volume;

	const VolumeIcon = useMemo(() => {
		if (muted || volume === 0) return VolumeX;
		if (volume < 34) return Volume;
		if (volume < 67) return Volume1;
		return Volume2;
	}, [muted, volume]);

	const handleWheel = useCallback(
		(e: WheelEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
			const step = 5;
			const delta = e.deltaY < 0 ? step : -step;
			const current = muted ? 0 : volume;
			const next = Math.max(0, Math.min(100, current + delta));
			setVolume(next, true);
		},
		[muted, volume, setVolume],
	);

	const handleValueChange = useCallback(
		(val: number | readonly number[]) => {
			const next = Array.isArray(val) ? val[0] : val;
			if (typeof next !== "number" || !Number.isFinite(next)) return;
			setVolume(next);
		},
		[setVolume],
	);

	const handleValueCommit = useCallback(
		(val: number | readonly number[]) => {
			const next = Array.isArray(val) ? val[0] : val;
			if (typeof next !== "number" || !Number.isFinite(next)) return;
			setVolume(next, true);
			setIsDragging(false);
		},
		[setVolume, setIsDragging],
	);

	return (
		<div
			className={cn("no-drag flex items-center gap-1.5 select-none", className)}
			onWheel={handleWheel}
			role="group"
			aria-label={ariaLabel}
		>
			{/* Mute / Unmute Button */}
			<button
				type="button"
				onClick={toggleMute}
				aria-label={muted ? "Unmute" : "Mute"}
				title={muted ? "Unmute" : "Mute"}
				className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-hidden"
			>
				<VolumeIcon className="size-3.5" />
			</button>

			{/* Slider */}
			<div
				className={cn("flex items-center", sliderWidth)}
				onPointerDown={() => setIsDragging(true)}
			>
				<Slider
					min={0}
					max={100}
					step={1}
					value={[displayVolume]}
					aria-label="Volume"
					onValueChange={handleValueChange}
					onValueCommitted={handleValueCommit}
					className="w-full"
				/>
			</div>

			{/* Percentage Label */}
			{showPercentage ? (
				<span className="w-7 text-right font-mono text-[10px] font-semibold tabular-nums text-muted-foreground select-none">
					{displayVolume}%
				</span>
			) : null}
		</div>
	);
}

export default VolumeControl;
