import type { CinematicArtifact } from "@chat-to-video/contracts";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  FilmIcon,
  ImageIcon,
  PaletteIcon,
  Volume2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

type ArtifactData<Stage extends CinematicArtifact["stage"]> = Extract<
  CinematicArtifact,
  { stage: Stage }
>["data"];

const currency = new Intl.NumberFormat("zh-CN", {
  currency: "USD",
  currencyDisplay: "symbol",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const safeReferenceUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const sourceModeLabel = {
  generated: "完全生成",
  source_led: "素材驱动",
  hybrid: "混合创作",
} as const;

const sceneSourceLabel = {
  generated_video: "生成视频",
  generated_image: "生成图片",
  supplied_video: "已有视频",
  title_card: "标题卡",
} as const;

const transitionLabel = {
  cut: "直接切换",
  crossfade: "交叉淡化",
  fade_black: "淡出至黑",
  match_cut: "匹配剪辑",
} as const;

const assetKindLabel = {
  video: "视频",
  image: "图片",
  title_card: "标题卡",
  audio: "音频",
} as const;

const assetSourceLabel = {
  generate: "生成",
  supplied: "已有素材",
  library: "素材库",
} as const;

const SectionTitle = ({ children, icon }: {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
}) => (
  <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
    {icon}
    {children}
  </h3>
);

const InfoPanel = ({ children, title }: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <section className="rounded-xl border border-white/8 bg-black/15 p-4">
    <SectionTitle>{title}</SectionTitle>
    <div className="mt-2 text-xs leading-6 text-zinc-400">{children}</div>
  </section>
);

const TagList = ({ items }: { readonly items: readonly string[] }) => (
  <div className="flex flex-wrap gap-2">
    {items.map((item) => (
      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-300" key={item}>
        {item}
      </span>
    ))}
  </div>
);

const Metric = ({ label, value }: {
  readonly label: string;
  readonly value: ReactNode;
}) => (
  <div className="rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2.5">
    <dt className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">{label}</dt>
    <dd className="mt-1 text-xs font-medium text-zinc-200">{value}</dd>
  </div>
);

const ResearchView = ({ data }: { readonly data: ArtifactData<"research"> }) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">
        {sourceModeLabel[data.sourceMode]}
      </span>
      <TagList items={data.moodKeywords} />
    </div>
    <InfoPanel title="创作摘要">{data.summary}</InfoPanel>
    <section>
      <SectionTitle icon={<ImageIcon className="size-3.5 text-cyan-300" />}>视觉参考</SectionTitle>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {data.visualReferences.map((reference, index) => {
          const url = safeReferenceUrl(reference.url);
          return (
            <article className="rounded-xl border border-white/8 bg-black/15 p-4" key={`${index}-${reference.title}`}>
              <div className="flex items-start gap-2">
                <h4 className="text-xs font-medium text-zinc-200">{reference.title}</h4>
                {url ? (
                  <a aria-label={`打开参考：${reference.title}`} className="ml-auto text-zinc-500 hover:text-cyan-300" href={url} rel="noreferrer" target="_blank">
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">{reference.description}</p>
            </article>
          );
        })}
      </div>
    </section>
    <div className="grid gap-3 sm:grid-cols-2">
      <InfoPanel title="音乐方向">{data.musicDirection}</InfoPanel>
      <InfoPanel title="制作约束">
        <ul className="space-y-1.5">
          {data.productionConstraints.map((constraint) => <li key={constraint}>• {constraint}</li>)}
        </ul>
      </InfoPanel>
    </div>
  </div>
);

const ProposalView = ({ data }: { readonly data: ArtifactData<"proposal"> }) => (
  <div className="space-y-4">
    <dl className="grid grid-cols-3 gap-2">
      <Metric label="时长" value={`${data.durationSeconds} 秒`} />
      <Metric label="预计成本" value={currency.format(data.estimatedCostUsd)} />
      <Metric label="渲染方式" value="FFmpeg" />
    </dl>
    <div className="grid gap-3">
      {data.directions.map((direction, index) => {
        const isRecommended = direction.id === data.recommendedDirectionId;
        return (
          <article className={isRecommended
            ? "rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-4"
            : "rounded-xl border border-white/8 bg-black/15 p-4"} key={direction.id}>
            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/5 text-xs font-semibold text-zinc-300">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-zinc-100">{direction.title}</h4>
                  {isRecommended ? <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-semibold text-zinc-950">推荐方向</span> : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-400">{direction.logline}</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">情绪曲线</p>
                    <ol className="mt-2 flex flex-wrap items-center gap-1.5">
                      {direction.emotionalArc.map((beat, beatIndex) => (
                        <li className="flex items-center gap-1.5 text-[11px] text-zinc-400" key={`${beatIndex}-${beat}`}>
                          {beatIndex > 0 ? <span className="text-zinc-700">→</span> : null}{beat}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">色彩方向</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {direction.colorPalette.map((color) => {
                        const swatch = /^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(color) ? color : undefined;
                        return <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400" key={color}>
                          <span className="size-2.5 rounded-full border border-white/20 bg-zinc-700" style={swatch ? { backgroundColor: swatch } : undefined} />{color}
                        </span>;
                      })}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 border-t border-white/8 pt-3 text-xs leading-5 text-zinc-500 sm:grid-cols-2">
                  <p><span className="text-zinc-400">视觉：</span>{direction.visualTreatment}</p>
                  <p><span className="text-zinc-400">音乐：</span>{direction.musicDirection}</p>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
    <InfoPanel title="交付承诺">{data.deliveryPromise}</InfoPanel>
  </div>
);

const ScriptView = ({ data }: { readonly data: ArtifactData<"script"> }) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="text-base font-semibold text-zinc-100">{data.title}</h3>
      <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-zinc-500">{data.durationSeconds} 秒</span>
    </div>
    <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-white/10">
      {data.beats.map((beat) => (
        <li className="relative flex gap-3" key={beat.order}>
          <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full border border-violet-400/20 bg-[#17131f] text-xs font-semibold text-violet-300">{beat.order}</span>
          <div className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="flex items-center gap-2"><h4 className="text-xs font-semibold text-zinc-200">{beat.purpose}</h4><span className="ml-auto text-[11px] text-zinc-500">{beat.durationSeconds}s</span></div>
            <p className="mt-2 text-xs leading-5 text-zinc-400"><span className="text-zinc-600">画面：</span>{beat.visual}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500"><span className="text-zinc-600">声音：</span>{beat.audio}</p>
          </div>
        </li>
      ))}
    </ol>
    {data.dialogue.length > 0 || data.titleCards.length > 0 ? (
      <div className="grid gap-3 sm:grid-cols-2">
        {data.dialogue.length > 0 ? <InfoPanel title="对白 / 旁白"><ul className="space-y-1.5">{data.dialogue.map((line) => <li key={line}>“{line}”</li>)}</ul></InfoPanel> : null}
        {data.titleCards.length > 0 ? <InfoPanel title="标题卡"><ul className="space-y-1.5">{data.titleCards.map((title) => <li key={title}>{title}</li>)}</ul></InfoPanel> : null}
      </div>
    ) : null}
  </div>
);

const ScenePlanView = ({ data }: { readonly data: ArtifactData<"scene_plan"> }) => (
  <div className="space-y-4">
    <dl className="grid grid-cols-3 gap-2">
      <Metric label="画面比例" value={data.aspectRatio} />
      <Metric label="总时长" value={`${data.durationSeconds} 秒`} />
      <Metric label="场景数量" value={`${data.scenes.length} 个`} />
    </dl>
    <ol className="grid gap-3">
      {data.scenes.map((scene) => (
        <li className="rounded-xl border border-white/8 bg-black/15 p-4" key={scene.order}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">场景 {scene.order}</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400">{sceneSourceLabel[scene.sourceType]}</span>
            <span className={scene.motionRequired ? "rounded-full bg-violet-400/10 px-2 py-0.5 text-[10px] text-violet-300" : "rounded-full bg-zinc-400/10 px-2 py-0.5 text-[10px] text-zinc-500"}>{scene.motionRequired ? "需要动态" : "静态可用"}</span>
            <span className="ml-auto text-[11px] text-zinc-500">
              成片 {scene.durationSeconds}s
              {scene.generationDurationSeconds
                ? " · 模型 " + scene.generationDurationSeconds + "s"
                : ""}
              {" · "}{transitionLabel[scene.transition]}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{scene.narrativeBeat}</p>
          <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.025] p-3 text-xs leading-5 text-zinc-500">
            <p><span className="text-zinc-400">视觉提示：</span>{scene.visualPrompt}</p>
            <p className="mt-1"><span className="text-zinc-400">运镜：</span>{scene.camera}</p>
            <p className="mt-1"><span className="text-zinc-400">声音：</span>{scene.audio}</p>
          </div>
        </li>
      ))}
    </ol>
  </div>
);

const AssetsView = ({ data }: { readonly data: ArtifactData<"assets"> }) => {
  const riskTone = data.slideshowRisk >= 7 ? "bg-red-400" : data.slideshowRisk >= 4 ? "bg-amber-300" : "bg-emerald-400";
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-2">
        <Metric label="素材数量" value={`${data.assets.length} 项`} />
        <Metric label="预计成本" value={currency.format(data.totalEstimatedCostUsd)} />
        <Metric label="幻灯片风险" value={`${data.slideshowRisk} / 10`} />
      </dl>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5" aria-label={`幻灯片风险 ${data.slideshowRisk} / 10`} role="img">
        <div className={`h-full rounded-full ${riskTone}`} style={{ width: `${data.slideshowRisk * 10}%` }} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.assets.map((asset, index) => (
          <article className="rounded-xl border border-white/8 bg-black/15 p-4" key={`${asset.sceneOrder}-${asset.kind}-${index}`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-200">场景 {asset.sceneOrder}</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400">{assetKindLabel[asset.kind]} · {assetSourceLabel[asset.sourceMode]}</span>
              <span className="ml-auto text-[11px] text-zinc-500">{currency.format(asset.estimatedCostUsd)}</span>
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-400">{asset.prompt}</p>
          </article>
        ))}
      </div>
      <InfoPanel title="音乐素材"><span className="text-zinc-500">{assetSourceLabel[data.music.sourceMode]} · </span>{data.music.direction}</InfoPanel>
    </div>
  );
};

const EditView = ({ data }: { readonly data: ArtifactData<"edit"> }) => (
  <div className="space-y-4">
    <dl className="grid grid-cols-3 gap-2">
      <Metric label="总时长" value={`${data.durationSeconds} 秒`} />
      <Metric label="渲染方式" value="FFmpeg" />
      <Metric label="剪辑片段" value={`${data.timeline.length} 段`} />
    </dl>
    <section>
      <SectionTitle icon={<FilmIcon className="size-3.5 text-amber-300" />}>剪辑时间线</SectionTitle>
      <div className="mt-3 flex h-9 gap-1 rounded-lg bg-black/20 p-1">
        {data.timeline.map((clip) => (
          <div className="grid min-w-0 basis-0 place-items-center rounded bg-amber-300/15 px-1 text-[10px] text-amber-200" key={`${clip.sceneOrder}-${clip.startSeconds}`} style={{ flexGrow: clip.durationSeconds }} title={`场景 ${clip.sceneOrder} · ${clip.durationSeconds} 秒`}>
            S{clip.sceneOrder}
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.timeline.map((clip) => (
          <div className="rounded-lg border border-white/8 bg-black/15 px-3 py-2.5 text-[11px] text-zinc-500" key={`detail-${clip.sceneOrder}-${clip.startSeconds}`}>
            <div className="flex items-center gap-2"><span className="font-medium text-zinc-300">场景 {clip.sceneOrder}</span><span className="ml-auto">{clip.startSeconds}s → {clip.startSeconds + clip.durationSeconds}s</span></div>
            <p className="mt-1">{transitionLabel[clip.transition]} · 音量 {clip.audioGainDb} dB</p>
          </div>
        ))}
      </div>
    </section>
    <div className="grid gap-3 sm:grid-cols-2">
      <InfoPanel title="调色方案"><span className="inline-flex items-start gap-2"><PaletteIcon className="mt-1 size-3.5 shrink-0 text-amber-300" />{data.colorGrade}</span></InfoPanel>
      <InfoPanel title="声音混合"><span className="inline-flex items-start gap-2"><Volume2Icon className="mt-1 size-3.5 shrink-0 text-amber-300" />{data.audioMix}</span></InfoPanel>
    </div>
    <section className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
      <SectionTitle icon={<CheckCircle2Icon className="size-3.5 text-emerald-300" />}>质量检查</SectionTitle>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.qualityChecks.map((check) => <li className="flex gap-2 text-xs leading-5 text-zinc-400" key={check}><CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-400/70" />{check}</li>)}
      </ul>
    </section>
    <details className="rounded-xl border border-white/8 bg-black/15 px-4 py-3">
      <summary className="cursor-pointer text-xs text-zinc-400">查看最终渲染提示词</summary>
      <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-zinc-500">{data.renderPrompt}</p>
    </details>
  </div>
);

export function CinematicArtifactVisualization({ artifact }: {
  readonly artifact: CinematicArtifact;
}) {
  if (artifact.stage === "research") return <ResearchView data={artifact.data} />;
  if (artifact.stage === "proposal") return <ProposalView data={artifact.data} />;
  if (artifact.stage === "script") return <ScriptView data={artifact.data} />;
  if (artifact.stage === "scene_plan") return <ScenePlanView data={artifact.data} />;
  if (artifact.stage === "assets") return <AssetsView data={artifact.data} />;
  return <EditView data={artifact.data} />;
}
