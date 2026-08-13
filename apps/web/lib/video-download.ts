import { createGeneratedVideoFilename } from "@chat-to-video/contracts";

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: ReadonlyArray<{
    accept: Readonly<Record<string, readonly string[]>>;
    description?: string;
  }>;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

const fetchVideo = async (playbackUrl: string): Promise<Blob> => {
  const response = await fetch(playbackUrl);
  if (!response.ok) throw new Error(`视频下载失败（HTTP ${response.status}）`);
  return response.blob();
};

const fallbackDownload = (blob: Blob, filename: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = objectUrl;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
};

export const downloadGeneratedVideo = async (input: {
  id: string;
  playbackUrl: string;
  title: string;
}): Promise<"cancelled" | "downloaded"> => {
  const filename = createGeneratedVideoFilename(input.title, input.id);
  const pickerWindow = window as SaveFilePickerWindow;
  if (pickerWindow.showSaveFilePicker) {
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: filename,
        types: [{ accept: { "video/mp4": [".mp4"] }, description: "MP4 视频" }],
      });
      const blob = await fetchVideo(input.playbackUrl);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "downloaded";
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  fallbackDownload(await fetchVideo(input.playbackUrl), filename);
  return "downloaded";
};
