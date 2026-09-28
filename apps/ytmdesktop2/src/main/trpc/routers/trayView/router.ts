import { fromIpcEvent } from "@main/trpc/fromIpcEvent";
import { provider } from "@main/trpc/provider";
import type { TrayViewMode } from "@main/trpc/routers/trayView/service";
import { publicProcedure, router } from "@shared/trpc/trpc";
import { z } from "zod";

export type { TrayViewMode };

export type TrayViewState = {
	active?: boolean;
	pinned?: boolean;
	mode?: TrayViewMode;
	clickThrough?: boolean;
};

export const trayViewRouter = router({
	toggle: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").toggle()),
	open: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").open()),
	hide: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").hide()),
	openMain: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").openMain()),
	togglePinned: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").togglePinned()),
	pinned: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").isPinned()),
	mode: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").mode),
	setMode: publicProcedure
		.input(z.enum(["player", "lyrics", "overlay"]))
		.mutation(({ ctx, input }) => provider(ctx, "trayView").setMode(input)),
	clickThrough: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").isClickThrough()),
	setClickThrough: publicProcedure
		.input(z.boolean())
		.mutation(({ ctx, input }) => provider(ctx, "trayView").setClickThrough(input)),
	toggleClickThrough: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").toggleClickThrough()),
	onState: publicProcedure.subscription(() => fromIpcEvent<TrayViewState | null>("trayview.state")),
});
