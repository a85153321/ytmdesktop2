import { platform } from "@electron-toolkit/utils";
import { AfterInit, BaseProvider, OnDestroy } from "@main/core/baseProvider";
import { showOnActiveDesktop } from "@main/domain/showOnActiveDesktop";
import { positionNearTray } from "@main/domain/trayPosition";
import { isAppQuitting, shouldCancelWindowClose } from "@main/handlers/quitPolicy";
import SettingsProvider from "@main/trpc/routers/settings/service";
import TrayProvider from "@main/trpc/routers/tray/service";
import { createAppWindow, wrapWindowHandler } from "@main/windows/windowUtils";
import { App, BrowserWindow, globalShortcut, screen } from "electron";
import { debounce } from "lodash-es";

const TRAY_VIEW_WIDTH = 420;
const TRAY_VIEW_HEIGHT = 168;
const OVERLAY_VIEW_WIDTH = 760;
const OVERLAY_VIEW_HEIGHT = 120;

export type TrayViewMode = "player" | "lyrics" | "overlay";

function clampToVisibleWorkArea(x: number, y: number, width = TRAY_VIEW_WIDTH, height = TRAY_VIEW_HEIGHT): { x: number; y: number } {
	const b = screen.getDisplayNearestPoint({ x, y }).workArea;
	return {
		x: Math.round(Math.min(Math.max(x, b.x), b.x + b.width - width)),
		y: Math.round(Math.min(Math.max(y, b.y), b.y + b.height - height)),
	};
}

export default class TrayViewProvider extends BaseProvider implements AfterInit, OnDestroy {
	private _ready: Promise<BrowserWindow> | null = null;
	private _blurHiddenAt = 0;
	private _suppressBlurUntil = 0;
	private _pinned = false;
	private _mode: TrayViewMode = "player";
	private _clickThrough = false;
	private _registeredHotkey: string | null = null;
	private _saveWindowState: (() => void) | null = null;
	private _restoredBounds: { x: number; y: number } | null = null;
	private _overlayBounds: { x: number; y: number; width: number; height: number } | null = null;
	private persistMoved = debounce(() => this._saveWindowState?.(), 250);
	private _settingsWired = false;

	constructor(_app: App) {
		super("trayView");
	}

	private get settings(): SettingsProvider {
		return this.getProvider("settings");
	}

	private get trayProvider(): TrayProvider {
		return this.getProvider("tray");
	}

	get mode(): TrayViewMode {
		return this._mode;
	}

	isClickThrough(): boolean {
		return this._clickThrough;
	}

	private registerHotkey(hotkey: string) {
		try {
			if (this._registeredHotkey) {
				globalShortcut.unregister(this._registeredHotkey);
				this._registeredHotkey = null;
			}
			if (hotkey && hotkey.trim()) {
				const trimmed = hotkey.trim();
				const registered = globalShortcut.register(trimmed, () => {
					if (this._mode === "overlay") {
						void this.toggleClickThrough();
					} else {
						void this.setMode("overlay");
					}
				});
				if (registered) {
					this._registeredHotkey = trimmed;
				} else {
					this.logger.warn(`Failed to register trayView hotkey: ${trimmed}`);
				}
			}
		} catch (err) {
			this.logger.error("trayView hotkey registration failed", err);
		}
	}

	async AfterInit() {
		this._pinned = !!this.settings.get("trayView.pinned", false);
		if (!this._settingsWired) {
			this._settingsWired = true;
			this.settings.onSettingChange("trayView.pinned", (value) => {
				const pinned = !!value;
				if (pinned === this._pinned) return;
				this.setPinned(pinned, false);
			});
			this.settings.onSettingChange("trayView.overlayHotkey", (val) => {
				if (typeof val === "string") {
					this.registerHotkey(val);
				}
			});
		}

		const initialHotkey = this.settings.get("trayView.overlayHotkey", "CommandOrControl+Alt+L") || "CommandOrControl+Alt+L";
		this.registerHotkey(initialHotkey);

		void this.tryRestorePinned();
	}

	private async tryRestorePinned() {
		this._pinned = !!this.settings.get("trayView.pinned", false);
		if (!this._pinned) return;
		const existing = this.getWindow();
		if (existing?.isVisible()) return;
		try {
			this.revealPinned(await this.ensureWindow());
		} catch (err) {
			this.logger.error("trayView restore failed", err);
		}
	}

	/** Do not hide() before first show — skipTaskbar HWND never maps. */
	private revealPinned(win: BrowserWindow) {
		if (win.isDestroyed()) return;
		this.persistMoved.cancel();
		this.restorePosition(win);
		this.suppressBlur(2000);
		this.applyPinFlags(win);
		if (win.isMinimized()) win.restore();
		win.show();
		win.moveTop();
		this.restorePosition(win);
		this.emitState(true);
	}

	private getWindow(): BrowserWindow | null {
		const win = this.windowContext.views.trayViewWindow;
		if (!win || win.isDestroyed()) return null;
		return win;
	}

	private suppressBlur(ms = 300) {
		this._suppressBlurUntil = Date.now() + ms;
	}

	private dockToTray(win: BrowserWindow) {
		const tray = this.trayProvider?.Tray;
		positionNearTray(win, tray && !tray.isDestroyed() ? tray : null, {
			width: TRAY_VIEW_WIDTH,
			height: TRAY_VIEW_HEIGHT,
		});
	}

	private async ensureWindow(): Promise<BrowserWindow> {
		const existing = this.getWindow();
		if (existing) return existing;
		if (this._ready) return this._ready;

		this._ready = (async () => {
			const isOverlay = this._mode === "overlay";
			const initialW = isOverlay ? OVERLAY_VIEW_WIDTH : TRAY_VIEW_WIDTH;
			const initialH = isOverlay ? OVERLAY_VIEW_HEIGHT : TRAY_VIEW_HEIGHT;

			const win = await createAppWindow({
				path: "/trayview",
				width: initialW,
				height: initialH,
				minWidth: 320,
				minHeight: 80,
				maxWidth: 2560,
				maxHeight: 1440,
				show: false,
				showTaskBar: false,
				minimizeable: false,
				maximizeable: false,
				devtools: false,
				transparent: true,
				...(platform.isMacOS ? { type: "panel" as const } : {}),
			});

			win.setResizable(isOverlay);
			win.setMinimizable(false);
			win.setMaximizable(false);
			win.webContents.setBackgroundThrottling(false);

			const { state, saveState, restored } = await wrapWindowHandler(win, "trayview", {
				width: TRAY_VIEW_WIDTH,
				height: TRAY_VIEW_HEIGHT,
				persist: () => this._pinned && this._mode !== "overlay",
			});
			this._saveWindowState = saveState;
			if (restored && typeof state?.x === "number" && typeof state?.y === "number") {
				this._restoredBounds = { x: state.x, y: state.y };
			}

			this.applyPinFlags(win);
			const onOverlayChange = () => {
				if (this._mode === "overlay") {
					this._overlayBounds = win.getBounds();
				}
			};
			win.on("move", () => {
				onOverlayChange();
				this.persistMoved();
			});
			win.on("moved", () => {
				onOverlayChange();
				this.persistMoved();
			});
			win.on("resize", onOverlayChange);

			const dismiss = () => {
				if (this._pinned || this._mode === "overlay") return;
				win.hide();
				this.emitState(false);
			};

			win.on("close", (ev) => {
				if (!shouldCancelWindowClose({ quitting: isAppQuitting() })) return;
				ev.preventDefault();
				dismiss();
			});
			win.on("blur", () => {
				if (win.isDestroyed() || !win.isVisible()) return;
				if (this._pinned || this._mode === "overlay") return;
				if (Date.now() < this._suppressBlurUntil) return;
				this._blurHiddenAt = Date.now();
				dismiss();
			});
			win.webContents.on("before-input-event", (_ev, input) => {
				if (input.type === "keyDown" && input.key === "Escape") dismiss();
			});

			this.windowContext.views.trayViewWindow = win;
			return win;
		})();

		try {
			return await this._ready;
		} catch (err) {
			this.windowContext.views.trayViewWindow = undefined;
			throw err;
		} finally {
			this._ready = null;
		}
	}

	private emitState(active: boolean) {
		this.windowContext.sendToAllViews("trayview.state", {
			active,
			pinned: this._pinned,
			mode: this._mode,
			clickThrough: this._clickThrough,
		});
	}

	private applyPinFlags(win: BrowserWindow) {
		if (win.isDestroyed()) return;
		this.suppressBlur(400);
		if (this._mode === "overlay") {
			win.setMovable(true);
			win.setAlwaysOnTop(true, "screen-saver");
			win.setSkipTaskbar(true);
			win.setVisibleOnAllWorkspaces(true, {
				visibleOnFullScreen: true,
				skipTransformProcessType: true,
			});
			win.setIgnoreMouseEvents(this._clickThrough, { forward: true });
			return;
		}

		win.setIgnoreMouseEvents(false);
		win.setMovable(this._pinned);
		if (this._pinned) {
			win.setAlwaysOnTop(true, "floating");
			win.setSkipTaskbar(false);
			win.setVisibleOnAllWorkspaces(true, {
				visibleOnFullScreen: true,
				skipTransformProcessType: true,
			});
		} else {
			win.setSkipTaskbar(true);
			win.setVisibleOnAllWorkspaces(false);
			win.setAlwaysOnTop(true, "pop-up-menu");
		}
	}

	setPinned(pinned: boolean, persist = true): boolean {
		this._pinned = pinned;
		if (persist) this.settings.set("trayView.pinned", pinned);
		const win = this.getWindow();
		if (win) {
			this.applyPinFlags(win);
			if (!this._pinned && this._mode !== "overlay") this.dockToTray(win);
			else this._saveWindowState?.();
		}
		this.emitState(win?.isVisible() ?? false);
		return this._pinned;
	}

	togglePinned(): boolean {
		return this.setPinned(!this._pinned);
	}

	isPinned(): boolean {
		return this._pinned;
	}

	async setMode(mode: TrayViewMode): Promise<TrayViewMode> {
		this._mode = mode;
		const win = await this.ensureWindow();
		if (mode === "overlay") {
			win.setResizable(true);
			win.setMovable(true);
			win.setAlwaysOnTop(true, "screen-saver");
			win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
			win.setSkipTaskbar(true);

			const nearest = screen.getDisplayNearestPoint(win.getBounds()).workArea;
			const targetW = this._overlayBounds?.width ?? OVERLAY_VIEW_WIDTH;
			const targetH = this._overlayBounds?.height ?? OVERLAY_VIEW_HEIGHT;
			const targetX = this._overlayBounds?.x ?? Math.round(nearest.x + (nearest.width - targetW) / 2);
			const targetY = this._overlayBounds?.y ?? Math.round(nearest.y + nearest.height - targetH - 60);

			win.setBounds({ x: targetX, y: targetY, width: targetW, height: targetH });
			win.setIgnoreMouseEvents(this._clickThrough, { forward: true });
			if (!win.isVisible()) win.show();
			win.moveTop();
		} else {
			win.setIgnoreMouseEvents(false);
			win.setBounds({ width: TRAY_VIEW_WIDTH, height: TRAY_VIEW_HEIGHT });
			this.applyPinFlags(win);
			if (!this._pinned) {
				this.dockToTray(win);
			} else {
				this.restorePosition(win);
			}
		}
		this.emitState(win.isVisible());
		return this._mode;
	}

	setClickThrough(enabled: boolean): boolean {
		this._clickThrough = enabled;
		const win = this.getWindow();
		if (win) {
			if (this._mode === "overlay") {
				win.setIgnoreMouseEvents(enabled, { forward: true });
			} else {
				win.setIgnoreMouseEvents(false);
			}
		}
		this.emitState(win?.isVisible() ?? false);
		return this._clickThrough;
	}

	toggleClickThrough(): boolean {
		return this.setClickThrough(!this._clickThrough);
	}

	private restorePosition(win: BrowserWindow) {
		if (win.isDestroyed()) return;
		if (!this._restoredBounds) {
			this.dockToTray(win);
			return;
		}
		const pos = clampToVisibleWorkArea(this._restoredBounds.x, this._restoredBounds.y);
		this._restoredBounds = pos;
		win.setPosition(pos.x, pos.y);
	}

	private present(win: BrowserWindow) {
		if (this._mode === "overlay") {
			win.show();
			win.moveTop();
			return;
		}
		if (this._pinned) {
			this.revealPinned(win);
			return;
		}
		this.dockToTray(win);
		showOnActiveDesktop(win, { suppressBlur: (ms) => this.suppressBlur(ms) });
		if (!win.isDestroyed()) {
			this.applyPinFlags(win);
			win.moveTop();
		}
	}

	async open(): Promise<number> {
		const win = await this.ensureWindow();
		this.present(win);
		this.emitState(true);
		return win.id;
	}

	async hide(): Promise<void> {
		if (this._pinned || this._mode === "overlay") return;
		const win = this.getWindow();
		if (!win) return;
		if (win.isVisible()) win.hide();
		this.emitState(false);
	}

	async openMain(): Promise<void> {
		await this.hide();
		const main = this.windowContext.main;
		if (!main || main.isDestroyed()) return;
		if (!main.isVisible()) main.show();
		main.setSkipTaskbar(false);
		if (main.isMinimized()) main.restore();
		main.focus();
		main.moveTop();
	}

	async toggle(): Promise<number | null> {
		const win = await this.ensureWindow();
		if (this._mode === "overlay") {
			if (win.isVisible()) {
				win.hide();
				this.emitState(false);
				return null;
			}
			win.show();
			this.emitState(true);
			return win.id;
		}
		if (this._pinned) {
			this.revealPinned(win);
			win.focus();
			return win.id;
		}
		const blurJustHid = Date.now() - this._blurHiddenAt < 400;
		if (win.isVisible() || blurJustHid) {
			if (win.isVisible()) win.hide();
			this._blurHiddenAt = 0;
			this.emitState(false);
			return null;
		}
		this.present(win);
		this.emitState(true);
		return win.id;
	}

	async OnDestroy() {
		if (this._registeredHotkey) {
			try {
				globalShortcut.unregister(this._registeredHotkey);
			} catch {
				/* ignore */
			}
			this._registeredHotkey = null;
		}
		this.persistMoved.cancel();
		this._saveWindowState?.();
		const win = this.getWindow();
		if (!win) return;
		win.removeAllListeners("close");
		win.removeAllListeners("blur");
		win.removeAllListeners("move");
		win.removeAllListeners("moved");
		win.destroy();
		this.windowContext.views.trayViewWindow = undefined;
	}
}
