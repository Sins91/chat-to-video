export const dramas = [
  { id: "1", slug: "midnight-letter", title: "午夜来信", subtitle: "她收到了一封来自十年后的信", genre: "悬疑", episodes: 12, tone: "cool" },
  { id: "2", slug: "summer-train", title: "夏日末班车", subtitle: "错过的终点，也许是重逢的起点", genre: "都市", episodes: 8, tone: "warm" },
  { id: "3", slug: "paper-moon", title: "纸月亮", subtitle: "当记忆可以被剪辑，真相还剩多少", genre: "科幻", episodes: 16, tone: "cool" },
  { id: "4", slug: "old-street", title: "旧街十三号", subtitle: "一间只在雨夜营业的照相馆", genre: "奇幻", episodes: 10, tone: "warm" },
  { id: "5", slug: "north-star", title: "北辰", subtitle: "少年将军与失落王朝的最后一战", genre: "古装", episodes: 24, tone: "cool" },
  { id: "6", slug: "one-more-song", title: "再唱一首歌", subtitle: "散场之后，青春才真正开始", genre: "青春", episodes: 6, tone: "warm" },
] as const;

export const libraryItems = ["林夏 · 女主角", "程述 · 男主角", "雨夜旧街", "复古相机", "城市天台", "温柔旁白"] as const;
export const filmSteps = ["故事", "角色", "场景", "道具", "分镜脚本", "分镜图", "视频", "合成"] as const;
