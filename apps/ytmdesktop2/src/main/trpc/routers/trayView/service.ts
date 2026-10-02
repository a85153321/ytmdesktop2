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
const MIN_TRAY_VIEW_WIDTH = 360;
const MIN_TRAY_VIEW_HEIGHT = 140;

export type ContentMode = "player" | "lyrics";
export type TrayViewMode = "player" | "lyrics" | "overlay";

export interface TrayViewBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

function clampToVisibleWorkArea(
	x: number,
	y: number,
	width = TRAY_VIEW_WIDTH,
	height = TRAY_VIEW_HEIGHT,
): TrayViewBounds {
	const b = screen.getDisplayNearestPoint({ x, y }).workArea;
	const clampedWidth = Math.max(MIN_TRAY_VIEW_WIDTH, Math.min(width, b.width));
	const clampedHeight = Math.max(MIN_TRAY_VIEW_HEIGHT, Math.min(height, b.height));
	return {
		x: Math.round(Math.min(Math.max(x, b.x), b.x + b.width - clampedWidth)),
		y: Math.round(Math.min(Math.max(y, b.y), b.y + b.height - clampedHeight)),
		width: Math.round(clampedWidth),
		height: Math.round(clampedHeight),
	};
}

export default class TrayViewProvider extends BaseProvider implements AfterInit, OnDestroy {
	private _ready: Promise<BrowserWindow> | null = null;
	private _blurHiddenAt = 0;
	private _suppressBlurUntil = 0;
	private _pinned = false;
	private _contentMode: ContentMode = "player";
	private _desktopOverlay = false;
	private _clickThrough = false;
	private _registeredHotkey: string | null = null;
	private _saveWindowState: (() => void) | null = null;
	private _restoredBounds: TrayViewBounds | null = null;
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

	get contentMode(): ContentMode {
		return this._contentMode;
	}

	getContentMode(): ContentMode {
		return this._contentMode;
	}

	get desktopOverlay(): boolean {
		return this._desktopOverlay;
	}

	isDesktopOverlay(): boolean {
		return this._desktopOverlay;
	}

	get mode(): TrayViewMode {
		return this._desktopOverlay ? "overlay" : this._contentMode;
	}

	isClickThrough(): boolean {
		return this._clickThrough;
	}

	isPinned(): boolean {
		return this._pinned;
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
					if (this._desktopOverlay) {
						void this.toggleClickThrough();
					} else {
						void this.setDesktopOverlay(true);
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
		const savedContentMode = this.settings.get<ContentMode>("trayView.contentMode", "player");
		this._contentMode = savedContentMode === "lyrics" ? "lyrics" : "player";
		this._desktopOverlay = !!this.settings.get("trayView.desktopOverlay", false);

		if (!this._settingsWired) {
			this._settingsWired = true;
			this.settings.onSettingChange("trayView.pinned", (value) => {
				const pinned = !!value;
				if (pinned === this._pinned) return;
				this.setPinned(pinned, false);
			});
			this.settings.onSettingChange("trayView.contentMode", (value) => {
				const mode = value === "lyrics" ? "lyrics" : "player";
				if (mode === this._contentMode) return;
				this.setContentMode(mode, false);
			});
			this.settings.onSettingChange("trayView.desktopOverlay", (value) => {
				const overlay = !!value;
				if (overlay === this._desktopOverlay) return;
				void this.setDesktopOverlay(overlay, false);
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
		if (!this._pinned && !this._desktopOverlay) return;
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
		const currentBounds = win.getBounds();
		const width = this._restoredBounds?.width ?? currentBounds.width ?? TRAY_VIEW_WIDTH;
		const height = this._restoredBounds?.height ?? currentBounds.height ?? TRAY_VIEW_HEIGHT;
		positionNearTray(win, tray && !tray.isDestroyed() ? tray : null, {
			width,
			height,
		});
	}

	private async ensureWindow(): Promise<BrowserWindow> {
		const existing = this.getWindow();
		if (existing) return existing;
		if (this._ready) return this._ready;

		this._ready = (async () => {
			const win = await createAppWindow({
				path: "/trayview",
				width: TRAY_VIEW_WIDTH,
				height: TRAY_VIEW_HEIGHT,
				minWidth: MIN_TRAY_VIEW_WIDTH,
				minHeight: MIN_TRAY_VIEW_HEIGHT,
				show: false,
				showTaskBar: false,
				minimizeable: false,
				maximizeable: false,
				devtools: false,
				transparent: true,
				...(platform.isMacOS ? { type: "panel" as const } : {}),
			});

			win.setResizable(true);
			win.setMinimizable(false);
			win.setMaximizable(false);
			win.webContents.setBackgroundThrottling(false);

			const { state, saveState, restored } = await wrapWindowHandler(win, "trayview", {
				width: TRAY_VIEW_WIDTH,
				height: TRAY_VIEW_HEIGHT,
				persist: () => this._pinned || this._desktopOverlay,
			});
			this._saveWindowState = saveState;
			if (restored && typeof state?.x === "number" && typeof state?.y === "number") {
				this._restoredBounds = {
					x: state.x,
					y: state.y,
					width: typeof state.width === "number" ? state.width : TRAY_VIEW_WIDTH,
					height: typeof state.height === "number" ? state.height : TRAY_VIEW_HEIGHT,
				};
			}

			this.applyPinFlags(win);
			win.on("move", () => this.persistMoved());
			win.on("moved", () => this.persistMoved());
			win.on("resize", () => this.persistMoved());
			win.on("resized", () => this.persistMoved());

			const dismiss = () => {
				if (this._pinned || this._desktopOverlay) return;
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
				if (this._pinned || this._desktopOverlay) return;
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
			contentMode: this._contentMode,
			desktopOverlay: this._desktopOverlay,
			clickThrough: this._clickThrough,
			mode: this._desktopOverlay ? "overlay" : this._contentMode,
		});
	}

	private applyPinFlags(win: BrowserWindow) {
		if (win.isDestroyed()) return;
		this.suppressBlur(400);

		const isOverlay = this._desktopOverlay;
		const isPinned = this._pinned;
		const shouldBeAlwaysOnTop = isOverlay || isPinned;

		// 1. Mouse events: ignore only when overlay is active AND clickThrough is true
		if (isOverlay && this._clickThrough) {
			win.setIgnoreMouseEvents(true, { forward: true });
		} else {
			win.setIgnoreMouseEvents(false);
		}

		// 2. Movable & Resizable
		win.setResizable(true);
		win.setMovable(isOverlay || isPinned);

		// 3. Keep skipTaskbar: true so it behaves as floating HUD and doesn't steal taskbar focus
		win.setSkipTaskbar(true);

		// 4. Always on top:
		// When pinned OR desktop overlay is ON:
		// Always use "screen-saver" level (highest official Electron level on Windows & macOS)
		// so it stays reliably above normal, maximized, and borderless fullscreen windows (YouTube, browser, games).
		if (shouldBeAlwaysOnTop) {
			win.setAlwaysOnTop(true, "screen-saver");
			win.setVisibleOnAllWorkspaces(true, {
				visibleOnFullScreen: true,
				skipTransformProcessType: true,
			});
		} else {
			// Normal unpinned tray popup: standard pop-up level, dismissed on blur
			win.setAlwaysOnTop(true, "pop-up-menu");
			win.setVisibleOnAllWorkspaces(false);
		}
	}

	setPinned(pinned: boolean, persist = true): boolean {
		this._pinned = pinned;
		if (persist) this.settings.set("trayView.pinned", pinned);
		const win = this.getWindow();
		if (win) {
			this.applyPinFlags(win);
			if (!this._pinned && !this._desktopOverlay) this.dockToTray(win);
			else if (this._pinned || this._desktopOverlay) this._saveWindowState?.();
		}
		this.emitState(win?.isVisible() ?? false);
		return this._pinned;
	}

	togglePinned(): boolean {
		return this.setPinned(!this._pinned);
	}

	setContentMode(mode: ContentMode, persist = true): ContentMode {
		this._contentMode = mode === "lyrics" ? "lyrics" : "player";
		if (persist) this.settings.set("trayView.contentMode", this._contentMode);
		const win = this.getWindow();
		this.emitState(win?.isVisible() ?? false);
		return this._contentMode;
	}

	async setDesktopOverlay(enabled: boolean, persist = true): Promise<boolean> {
		this._desktopOverlay = enabled;
		if (persist) this.settings.set("trayView.desktopOverlay", enabled);
		const win = await this.ensureWindow();

		if (enabled) {
			this.applyPinFlags(win);
			if (!win.isVisible()) win.show();
			win.moveTop();
		} else {
			this._clickThrough = false;
			win.setIgnoreMouseEvents(false);
			this.applyPinFlags(win);
			if (!this._pinned) {
				this.dockToTray(win);
			} else {
				this.restorePosition(win);
			}
		}
		this.emitState(win.isVisible());
		return this._desktopOverlay;
	}

	async toggleDesktopOverlay(): Promise<boolean> {
		return await this.setDesktopOverlay(!this._desktopOverlay);
	}

	// Backward compatibility for legacy mode API
	async setMode(mode: TrayViewMode): Promise<TrayViewMode> {
		if (mode === "overlay") {
			await this.setDesktopOverlay(true);
		} else {
			this.setContentMode(mode);
			if (this._desktopOverlay) {
				await this.setDesktopOverlay(false);
			}
		}
		return this.mode;
	}

	setClickThrough(enabled: boolean): boolean {
		this._clickThrough = enabled;
		const win = this.getWindow();
		if (win) {
			if (this._desktopOverlay) {
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

	setBounds(bounds: TrayViewBounds): TrayViewBounds {
		const win = this.getWindow();
		const clamped = clampToVisibleWorkArea(bounds.x, bounds.y, bounds.width, bounds.height);
		this._restoredBounds = clamped;
		if (win && !win.isDestroyed()) {
			win.setBounds(clamped);
			if (this._pinned || this._desktopOverlay) {
				this.persistMoved();
			}
		}
		return clamped;
	}

	private restorePosition(win: BrowserWindow) {
		if (win.isDestroyed()) return;
		if (!this._restoredBounds) {
			this.dockToTray(win);
			return;
		}
		const pos = clampToVisibleWorkArea(
			this._restoredBounds.x,
			this._restoredBounds.y,
			this._restoredBounds.width,
			this._restoredBounds.height,
		);
		this._restoredBounds = pos;
		win.setBounds(pos);
	}

	private present(win: BrowserWindow) {
		if (this._desktopOverlay) {
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
		if (this._pinned || this._desktopOverlay) return;
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
		if (this._desktopOverlay) {
			if (win.isVisible()) {
				win.hide();
				this.emitState(false);
				return null;
			}
			win.show();
			win.moveTop();
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
