import { describe, expect, it } from "vitest";
import type { PlayerApi } from "ytm-client-api";
import { trackControls } from "./api-controls.cmds";

function createMockPlayer(initialVolume = 50, initialMuted = false) {
	let volume = initialVolume;
	let muted = initialMuted;

	const player = {
		getVolume: () => volume,
		setVolume: (v: number) => {
			volume = v;
		},
		isMuted: () => muted,
		mute: () => {
			muted = true;
		},
		unMute: () => {
			muted = false;
		},
	} as unknown as PlayerApi;

	return { player, getVolume: () => volume, isMuted: () => muted };
}

describe("trackControls volume and mute", () => {
	it("gets volume and muted state without changes", () => {
		const { player } = createMockPlayer(65, false);
		const result = trackControls.volume(player);
		expect(result).toEqual({ volume: 65, muted: false });
	});

	it("sets volume clamped between 0 and 100", () => {
		const { player, getVolume } = createMockPlayer(50, false);

		trackControls.volume(player, { volume: 80 });
		expect(getVolume()).toBe(80);

		trackControls.volume(player, { volume: 150 });
		expect(getVolume()).toBe(100);

		trackControls.volume(player, { volume: -20 });
		expect(getVolume()).toBe(0);
	});

	it("unmutes when setting non-zero volume while muted", () => {
		const { player, isMuted } = createMockPlayer(50, true);
		expect(isMuted()).toBe(true);

		const result = trackControls.volume(player, { volume: 75 });
		expect(isMuted()).toBe(false);
		expect(result).toEqual({ volume: 75, muted: false });
	});

	it("mutes and unmutes via dedicated actions", () => {
		const { player, isMuted } = createMockPlayer(60, false);

		const muteRes = trackControls.mute(player);
		expect(isMuted()).toBe(true);
		expect(muteRes).toEqual({ volume: 60, muted: true });

		const unMuteRes = trackControls.unMute(player);
		expect(isMuted()).toBe(false);
		expect(unMuteRes).toEqual({ volume: 60, muted: false });
	});

	it("toggles mute correctly", () => {
		const { player, isMuted } = createMockPlayer(45, false);

		// 1st toggle: mute
		const res1 = trackControls.toggleMute(player);
		expect(isMuted()).toBe(true);
		expect(res1.muted).toBe(true);

		// 2nd toggle: unmute
		const res2 = trackControls.toggleMute(player);
		expect(isMuted()).toBe(false);
		expect(res2.muted).toBe(false);
	});

	it("volumeUp and volumeDown adjust volume with clamping and un-mute on volumeUp", () => {
		const { player, getVolume, isMuted } = createMockPlayer(95, true);

		// volumeUp by default 5 should clamp to 100 and unmute
		const upRes = trackControls.volumeUp(player);
		expect(getVolume()).toBe(100);
		expect(isMuted()).toBe(false);
		expect(upRes).toEqual({ volume: 100, muted: false });

		// volumeDown by 30 should set 70
		const downRes = trackControls.volumeDown(player, { amount: 30 });
		expect(getVolume()).toBe(70);
		expect(downRes).toEqual({ volume: 70, muted: false });

		// volumeDown beyond 0 should clamp to 0
		trackControls.volumeDown(player, { amount: 100 });
		expect(getVolume()).toBe(0);
	});
});
