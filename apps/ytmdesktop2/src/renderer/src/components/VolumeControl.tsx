import { Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useMemo, useState, type WheelEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useVolume } from "@/hooks/use-volume";
import { cn } from "@/lib/utils";

export interface VolumeControlProps {
	className?: string;
	ariaLabel?: string;
}

export function VolumeControl({
	className,
	ariaLabel = "Volume Control",
}: VolumeControlProps) {
	const { volume, muted, setVolume, toggleMute, setIsDragging } = useVolume();
	const [open, setOpen] = useState(false);

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
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				type="button"
				aria-label={ariaLabel}
				title={muted ? `Muted (${volume}%)` : `Volume: ${volume}%`}
				className={cn(
					"no-drag flex size-7 shrink-0 items-center justify-center rounded-full text-foreground transition-[transform,background-color,color] duration-100 hover:bg-foreground/10 active:scale-95 focus-visible:outline-hidden",
					open && "bg-foreground/15 text-accent",
					className,
				)}
			>
				<VolumeIcon className="size-4" />
			</PopoverTrigger>

			<PopoverContent
				side="top"
				align="end"
				sideOffset={8}
				className="no-drag z-50 flex w-auto flex-row items-center gap-2 rounded-full border border-border/50 bg-background/95 px-3 py-1.5 shadow-xl backdrop-blur-md"
				onWheel={handleWheel}
				role="group"
				aria-label={ariaLabel}
			>
				{/* Mute / Unmute Button inside popover */}
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
					className="flex w-24 items-center"
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
				<span className="w-7 text-right font-mono text-[10px] font-semibold tabular-nums text-muted-foreground select-none">
					{displayVolume}%
				</span>
			</PopoverContent>
		</Popover>
	);
}

export default VolumeControl;
