import { describe, expect, it } from "vitest";

function clampOpacity(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return 75;
	return Math.max(10, Math.min(100, Math.round(raw)));
}

function computeBackgroundAlpha(raw: unknown, desktopOverlay: boolean): { alpha: number; backgroundStyle?: string } {
	if (!desktopOverlay) {
		return { alpha: 1 };
	}
	const opacity = clampOpacity(raw);
	return {
		alpha: opacity / 100,
		backgroundStyle: `color-mix(in oklab, var(--background) ${opacity}%, transparent)`,
	};
}

describe("Desktop Overlay Background Opacity Specification", () => {
	it("defaults to 75% when undefined, null, or NaN", () => {
		expect(clampOpacity(undefined)).toBe(75);
		expect(clampOpacity(null)).toBe(75);
		expect(clampOpacity(NaN)).toBe(75);
		expect(clampOpacity("75")).toBe(75);
	});

	it("enforces minimum bounds at 10%", () => {
		expect(clampOpacity(5)).toBe(10);
		expect(clampOpacity(0)).toBe(10);
		expect(clampOpacity(-50)).toBe(10);
	});

	it("enforces maximum bounds at 100%", () => {
		expect(clampOpacity(100)).toBe(100);
		expect(clampOpacity(105)).toBe(100);
		expect(clampOpacity(999)).toBe(100);
	});

	it("preserves valid in-range values", () => {
		expect(clampOpacity(10)).toBe(10);
		expect(clampOpacity(25)).toBe(25);
		expect(clampOpacity(50)).toBe(50);
		expect(clampOpacity(75)).toBe(75);
		expect(clampOpacity(90)).toBe(90);
		expect(clampOpacity(100)).toBe(100);
	});

	it("does not apply overlay background style when desktopOverlay is false (Normal Tray)", () => {
		const resNormal = computeBackgroundAlpha(25, false);
		expect(resNormal.alpha).toBe(1);
		expect(resNormal.backgroundStyle).toBeUndefined();
	});

	it("applies settings-driven background alpha when desktopOverlay is true", () => {
		const resOverlay25 = computeBackgroundAlpha(25, true);
		expect(resOverlay25.alpha).toBe(0.25);
		expect(resOverlay25.backgroundStyle).toBe("color-mix(in oklab, var(--background) 25%, transparent)");

		const resOverlay75 = computeBackgroundAlpha(75, true);
		expect(resOverlay75.alpha).toBe(0.75);
		expect(resOverlay75.backgroundStyle).toBe("color-mix(in oklab, var(--background) 75%, transparent)");

		const resOverlay100 = computeBackgroundAlpha(100, true);
		expect(resOverlay100.alpha).toBe(1);
		expect(resOverlay100.backgroundStyle).toBe("color-mix(in oklab, var(--background) 100%, transparent)");
	});

	it("clamps invalid runtime values safely when overlay is true", () => {
		const resNegative = computeBackgroundAlpha(-10, true);
		expect(resNegative.alpha).toBe(0.10);
		expect(resNegative.backgroundStyle).toBe("color-mix(in oklab, var(--background) 10%, transparent)");

		const resHuge = computeBackgroundAlpha(999, true);
		expect(resHuge.alpha).toBe(1);
		expect(resHuge.backgroundStyle).toBe("color-mix(in oklab, var(--background) 100%, transparent)");
	});
});
