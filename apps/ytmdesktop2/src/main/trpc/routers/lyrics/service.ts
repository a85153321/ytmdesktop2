import { EventEmitter } from "node:events";
import { AfterInit, BaseProvider, OnDestroy } from "@main/core/baseProvider";
import { serverMain } from "@main/ipc/serverEvents";
import type { LyricsStoreSnapshot } from "@plugins/youtube/lyrics/types";
import { observable } from "@trpc/server/observable";

function isIpcEvent(val: unknown): boolean {
	return !!val && typeof val === "object" && "sender" in (val as object);
}

/** Hot-toggles youtube `lyrics` plugin via settings → IPC cmds, and caches canonical lyrics snapshot. */
export default class LyricsProvider extends BaseProvider implements AfterInit, OnDestroy {
	private _currentSnapshot: LyricsStoreSnapshot | null = null;
	private _emitter = new EventEmitter();

	constructor() {
		super("lyrics");
		this._emitter.setMaxListeners(50);
	}

	get settingsInstance() {
		return this.getProvider("settings");
	}

	async AfterInit() {
		this.settingsInstance.onSettingChange("lyrics.enabled", (value) => void this.__onToggle(value), {
			debounce: 300,
		});

		serverMain.on("lyrics:snapshot", this.handleSnapshotIpc);
	}

	private handleSnapshotIpc = (_ev: unknown, data?: unknown) => {
		const payload = (isIpcEvent(_ev) ? data : (_ev ?? data)) as LyricsStoreSnapshot | undefined;
		if (!payload || typeof payload !== "object") return;
		this._currentSnapshot = payload;
		this._emitter.emit("snapshot", payload);
	};

	getSnapshot(): LyricsStoreSnapshot | null {
		if (!this._currentSnapshot) {
			// Trigger a background poll if empty
			void this.pullSnapshot();
		}
		return this._currentSnapshot;
	}

	async pullSnapshot(): Promise<LyricsStoreSnapshot | null> {
		try {
			const snap = await this.executeCommand<LyricsStoreSnapshot>("getSnapshot");
			if (snap && typeof snap === "object") {
				this._currentSnapshot = snap;
				this._emitter.emit("snapshot", snap);
				return snap;
			}
		} catch {
			/* ignore if ytm/plugin not ready */
		}
		return null;
	}

	subscribeSnapshot() {
		return observable<LyricsStoreSnapshot | null>((emit) => {
			const handler = (snap: LyricsStoreSnapshot) => emit.next(snap);
			this._emitter.on("snapshot", handler);
			if (this._currentSnapshot) {
				emit.next(this._currentSnapshot);
			}
			return () => {
				this._emitter.off("snapshot", handler);
			};
		});
	}

	private async __onToggle(value: unknown) {
		if (value) await this.enable();
		else await this.disable();
	}

	private async enable() {
		this.logger.debug("Enabling lyrics");
		try {
			await this.isYtmReady();
		} catch (err) {
			this.logger.warn("ytm not fully ready, enabling lyrics anyway", err);
		}
		await this.executeCommand("enable");
	}

	private async disable() {
		this.logger.debug("Disabling lyrics");
		try {
			await this.isYtmReady();
		} catch (err) {
			this.logger.warn("ytm not fully ready, disabling lyrics anyway", err);
		}
		await this.executeCommand("disable");
	}

	async OnDestroy() {
		serverMain.off("lyrics:snapshot", this.handleSnapshotIpc);
		this._emitter.removeAllListeners();
	}
}
