/**
 * Type definitions for dub-rip
 */

export interface VideoPreview {
	success: boolean;
	videoTitle: string;
	artist: string;
	title: string;
	thumbnail: string;
	duration?: number;
}

export interface DownloadProgress {
	percent: number;
	speed: string;
	eta: string;
}

export type DownloadMethod = "cobalt" | "yt-dlp";

export interface EnrichedMetadata {
	album?: string;
	year?: string;
	genre?: string;
	trackNumber?: string;
	label?: string;
	hasArtwork: boolean;
}

export interface StreamEvent {
	type: "status" | "info" | "progress" | "complete" | "error" | "event" | "metadata";
	message?: string;
	title?: string;
	artist?: string;
	track?: string;
	percent?: number;
	speed?: string;
	eta?: string;
	filename?: string;
	size?: number;
	data?: string;
	eventType?: string;
	eventData?: string;
	downloadMethod?: DownloadMethod;
	metadata?: EnrichedMetadata;
}

export interface ApiError {
	error: string;
}
