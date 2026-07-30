/**
 * Named boundaries for the single 0-100 progress percent sent over SSE.
 * Collected here so the pipeline's stages can't silently drift out of order
 * by editing one of try-yt-dlp.ts, download-stream's +server.ts, or
 * finalize-mp3.ts without the others — see each file for where its constant
 * is sent.
 */
export const DOWNLOAD_START_PERCENT = 5;
export const DOWNLOAD_COMPLETE_PERCENT = 75;
export const METADATA_PROCESSING_PERCENT = 78;
export const ID3_TAGS_WRITTEN_PERCENT = 90;
export const PREPARING_DOWNLOAD_PERCENT = 95;

export const PROGRESS_STAGES = [
	DOWNLOAD_START_PERCENT,
	DOWNLOAD_COMPLETE_PERCENT,
	METADATA_PROCESSING_PERCENT,
	ID3_TAGS_WRITTEN_PERCENT,
	PREPARING_DOWNLOAD_PERCENT,
] as const;
