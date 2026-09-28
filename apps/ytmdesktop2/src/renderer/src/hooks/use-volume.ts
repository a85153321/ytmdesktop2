import type { AppRouter } from "@main/trpc/router";
import type { inferRouterOutputs } from "@trpc/server";
import { throttle } from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type VolumeState = NonNullable<inferRouterOutputs<AppRouter>["track"]["volumeState"]>;

export function useVolume() {
	const utils = trpc.useUtils();
	const { data: serverVolumeState } = trpc.track.volumeState.useQuery();

	const [volume, setVolumeState] = useState<number>(() => serverVolumeState?.volume ?? 100);
	const [muted, setMutedState] = useState<boolean>(() => serverVolumeState?.muted ?? false);
	const isDraggingRef = useRef(false);

	// Sync from query on initial load or cache update
	useEffect(() => {
		if (serverVolumeState && !isDraggingRef.current) {
			setVolumeState(serverVolumeState.volume);
			setMutedState(serverVolumeState.muted);
		}
	}, [serverVolumeState?.volume, serverVolumeState?.muted]);

	// Real-time subscription from main / YouTube web UI
	trpc.track.onVolume.useSubscription(undefined, {
		onData: (next) => {
			if (!next) return;
			const nextState = next as VolumeState;
			utils.track.volumeState.setData(undefined, nextState);
			if (!isDraggingRef.current) {
				setVolumeState(nextState.volume);
				setMutedState(nextState.muted);
			}
		},
	});

	const { mutate: mutateVolume } = trpc.track.volume.useMutation();
	const { mutate: mutateToggleMute } = trpc.track.toggleMute.useMutation();
	const { mutate: mutateMute } = trpc.track.mute.useMutation();
	const { mutate: mutateUnMute } = trpc.track.unMute.useMutation();

	// Throttle volume changes to 50ms so rapid dragging doesn't overwhelm IPC
	const throttledVolumeMutation = useMemo(
		() =>
			throttle(
				(vol: number) => {
					mutateVolume({ volume: vol });
				},
				50,
				{ leading: true, trailing: true },
			),
		[mutateVolume],
	);

	const setVolume = useCallback(
		(nextVolume: number, commit = false) => {
			const clamped = Math.max(0, Math.min(100, Math.round(nextVolume)));
			setVolumeState(clamped);
			if (clamped > 0 && muted) {
				setMutedState(false);
			}
			if (commit) {
				throttledVolumeMutation.cancel();
				mutateVolume({ volume: clamped });
			} else {
				throttledVolumeMutation(clamped);
			}
		},
		[muted, mutateVolume, throttledVolumeMutation],
	);

	const toggleMute = useCallback(() => {
		setMutedState((prev) => !prev);
		mutateToggleMute();
	}, [mutateToggleMute]);

	const mute = useCallback(() => {
		setMutedState(true);
		mutateMute();
	}, [mutateMute]);

	const unMute = useCallback(() => {
		setMutedState(false);
		mutateUnMute();
	}, [mutateUnMute]);

	const setIsDragging = useCallback(
		(dragging: boolean) => {
			isDraggingRef.current = dragging;
			if (!dragging) {
				throttledVolumeMutation.flush();
			}
		},
		[throttledVolumeMutation],
	);

	return {
		volume,
		muted,
		setVolume,
		toggleMute,
		mute,
		unMute,
		setIsDragging,
	};
}
