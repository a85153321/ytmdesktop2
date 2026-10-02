import { fromIpcEvent } from "@main/trpc/fromIpcEvent";
import { provider } from "@main/trpc/provider";
import type { ContentMode, TrayViewMode } from "@main/trpc/routers/trayView/service";
import { publicProcedure, router } from "@shared/trpc/trpc";
import { z } from "zod";

export type { ContentMode, TrayViewMode };

export type TrayViewState = {
	active?: boolean;
	pinned?: boolean;
	contentMode?: ContentMode;
	desktopOverlay?: boolean;
	clickThrough?: boolean;
	mode?: TrayViewMode;
};

export const trayViewRouter = router({
	toggle: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").toggle()),
	open: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").open()),
	hide: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").hide()),
	openMain: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").openMain()),
	togglePinned: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").togglePinned()),
	pinned: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").isPinned()),
	contentMode: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").contentMode),
	setContentMode: publicProcedure
		.input(z.enum(["player", "lyrics"]))
		.mutation(({ ctx, input }) => provider(ctx, "trayView").setContentMode(input)),
	desktopOverlay: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").isDesktopOverlay()),
	setDesktopOverlay: publicProcedure
		.input(z.boolean())
		.mutation(({ ctx, input }) => provider(ctx, "trayView").setDesktopOverlay(input)),
	toggleDesktopOverlay: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").toggleDesktopOverlay()),
	clickThrough: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").isClickThrough()),
	setClickThrough: publicProcedure
		.input(z.boolean())
		.mutation(({ ctx, input }) => provider(ctx, "trayView").setClickThrough(input)),
	toggleClickThrough: publicProcedure.mutation(({ ctx }) => provider(ctx, "trayView").toggleClickThrough()),
	// Backward compatibility
	mode: publicProcedure.query(({ ctx }) => provider(ctx, "trayView").mode),
	setMode: publicProcedure
		.input(z.enum(["player", "lyrics", "overlay"]))
		.mutation(({ ctx, input }) => provider(ctx, "trayView").setMode(input)),
	setBounds: publicProcedure
		.input(
			z.object({
				x: z.number(),
				y: z.number(),
				width: z.number(),
				height: z.number(),
			}),
		)
		.mutation(({ ctx, input }) => provider(ctx, "trayView").setBounds(input)),
	onState: publicProcedure.subscription(() => fromIpcEvent<TrayViewState | null>("trayview.state")),
});
