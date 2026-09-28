import type { LyricsStoreSnapshot } from "@plugins/youtube/lyrics/types";
import { trpc } from "@/lib/trpc";

export function useLyrics(): LyricsStoreSnapshot | null {
	const utils = trpc.useUtils();
	const { data } = trpc.lyrics.snapshot.useQuery();

	trpc.lyrics.onSnapshot.useSubscription(undefined, {
		onData: (snapshot) => {
			if (!snapshot) return;
			utils.lyrics.snapshot.setData(undefined, snapshot);
		},
	});

	return (data as LyricsStoreSnapshot | null) ?? null;
}
