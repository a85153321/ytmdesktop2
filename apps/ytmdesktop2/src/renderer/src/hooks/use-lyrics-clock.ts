import { useEffect, useRef, useState } from "react";

export interface LyricsClockOptions {
	progressSec: number;
	playing: boolean;
	durationSec: number;
}

/**
 * High-performance, zero-IPC clock that provides smooth sub-frame playback time in ms.
 * Anchored to the player's progress updates and interpolated using performance.now()
 * while playing. Pauses animation loop when playback is paused.
 */
export function useLyricsClock({ progressSec, playing, durationSec }: LyricsClockOptions): number {
	const [timeMs, setTimeMs] = useState(progressSec * 1000);
	const anchorTimeMsRef = useRef(progressSec * 1000);
	const anchorPerfRef = useRef(performance.now());
	const rafIdRef = useRef<number | null>(null);

	// Re-anchor whenever progress changes significantly (e.g. seek, sync tick, or track swap)
	useEffect(() => {
		const newBaseMs = progressSec * 1000;
		const currentEstimated = playing
			? anchorTimeMsRef.current + (performance.now() - anchorPerfRef.current)
			: anchorTimeMsRef.current;

		// Re-anchor if paused, or if actual progress differs from estimate by > 250ms
		if (!playing || Math.abs(newBaseMs - currentEstimated) > 250) {
			anchorTimeMsRef.current = newBaseMs;
			anchorPerfRef.current = performance.now();
			setTimeMs(newBaseMs);
		}
	}, [progressSec, playing]);

	useEffect(() => {
		if (!playing) {
			if (rafIdRef.current != null) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = null;
			}
			return;
		}

		let mounted = true;
		const maxMs = durationSec > 0 ? durationSec * 1000 : Number.POSITIVE_INFINITY;

		const tick = () => {
			if (!mounted) return;
			const elapsed = performance.now() - anchorPerfRef.current;
			const current = Math.min(maxMs, Math.max(0, anchorTimeMsRef.current + elapsed));
			setTimeMs(current);
			rafIdRef.current = requestAnimationFrame(tick);
		};

		rafIdRef.current = requestAnimationFrame(tick);

		return () => {
			mounted = false;
			if (rafIdRef.current != null) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = null;
			}
		};
	}, [playing, durationSec]);

	return timeMs;
}
