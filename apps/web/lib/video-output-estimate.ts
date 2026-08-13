export type VideoOutputEstimate = {
  duration: string;
  resolution: string;
};

export const getVideoOutputEstimate = (durationSeconds?: number | null): VideoOutputEstimate => ({
  duration: durationSeconds === null || durationSeconds === undefined ? "待确认" : `${durationSeconds} 秒`,
  resolution: "720p",
});
