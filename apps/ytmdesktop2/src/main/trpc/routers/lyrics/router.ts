import { provider } from "@main/trpc/provider";
import { publicProcedure, router } from "@shared/trpc/trpc";

export const lyricsRouter = router({
	snapshot: publicProcedure.query(({ ctx }) => provider(ctx, "lyrics").getSnapshot()),
	onSnapshot: publicProcedure.subscription(({ ctx }) => provider(ctx, "lyrics").subscribeSnapshot()),
});
