"use client";

import type { CinematicArtifact } from "@chat-to-video/contracts";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ExternalLinkIcon,
  PaletteIcon,
  Volume2Icon,
} from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";

import { collapseExpandedDetails } from "@/lib/collapsible-details";

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

const PlanningSectionsExpandedContext = createContext(false);

const safeReferenceUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const transitionLabel = {
  cut: "直接切换",
  crossfade: "交叉淡化",
  fade_black: "淡出至黑",
  match_cut: "匹配剪辑",
} as const;

const SectionTitle = ({ children }: {
  readonly children: ReactNode;
}) => (
  <h3 className="font-sans text-xs font-semibold text-zinc-200">{children}</h3>
);

const InfoPanel = ({ children, title }: {
  readonly children: ReactNode;
  readonly title: string;
}) => {
  const areSectionsExpanded = useContext(PlanningSectionsExpandedContext);

  return <details className="group rounded-lg border border-white/8 bg-black/15" open={areSectionsExpanded}>
    <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1"><SectionTitle>{title}</SectionTitle></span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-zinc-600 transition-transform group-open:rotate-180" />
      </div>
    </summary>
    <div className="cursor-pointer border-t border-white/8 px-4 pb-4 pt-3 text-xs leading-6 text-zinc-400" onClick={collapseExpandedDetails}>{children}</div>
  </details>;
};

const Metric = ({ label, value }: {
  readonly label: string;
  readonly value: ReactNode;
}) => {
  const areSectionsExpanded = useContext(PlanningSectionsExpandedContext);

  return <details className="group rounded-md border border-white/8 bg-white/[0.025]" open={areSectionsExpanded}>
    <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0 transition-transform group-open:rotate-180" />
      </span>
    </summary>
    <div className="cursor-pointer border-t border-white/8 px-3 py-2.5 font-numeric text-xs font-medium tabular-nums text-zinc-200" onClick={collapseExpandedDetails}>{value}</div>
  </details>;
};

const CollapsiblePlanningBlock = ({ children, meta, title }: {
  readonly children: ReactNode;
  readonly meta?: ReactNode;
  readonly title: ReactNode;
}) => {
  const areSectionsExpanded = useContext(PlanningSectionsExpandedContext);

  return <details className="group rounded-lg border border-white/8 bg-black/15" open={areSectionsExpanded}>
    <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 font-sans text-xs font-semibold text-zinc-200">{title}</span>
        {meta ? <span className="shrink-0 font-numeric text-[11px] tabular-nums text-zinc-500">{meta}</span> : null}
        <ChevronDownIcon className="size-3.5 shrink-0 text-zinc-600 transition-transform group-open:rotate-180" />
      </div>
    </summary>
    <div className="cursor-pointer border-t border-white/8 px-4 pb-4 pt-3" onClick={collapseExpandedDetails}>{children}</div>
  </details>;
};

const ResearchView = ({ data }: { readonly data: ArtifactData<"research"> }) => (
  <div className="space-y-4">
    {data.moodKeywords.length > 0 ? (
      <p className="text-xs leading-5 text-zinc-500">{data.moodKeywords.join(" · ")}</p>
    ) : null}
    <InfoPanel title="创作摘要">{data.summary}</InfoPanel>
    <section>
      <SectionTitle>视觉参考</SectionTitle>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {data.visualReferences.map((reference, index) => {
          const url = safeReferenceUrl(reference.url);
          return (
            <CollapsiblePlanningBlock
              key={`${index}-${reference.title}`}
              meta={url ? <ExternalLinkIcon className="size-3.5" /> : null}
              title={reference.title}
            >
              <p className="text-xs leading-5 text-zinc-500">{reference.description}</p>
              {url ? <a className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200" href={url} rel="noreferrer" target="_blank">打开参考<ExternalLinkIcon className="size-3" /></a> : null}
            </CollapsiblePlanningBlock>
          );
        })}
      </div>
    </section>
    <div className="grid gap-3 sm:grid-cols-3">
      <InfoPanel title="全片背景音乐">{data.musicDirection}</InfoPanel>
      <InfoPanel title="Seedance 场景声音">{data.soundDirection}</InfoPanel>
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
    <div className="grid grid-cols-3 gap-2">
      <Metric label="时长" value={`${data.durationSeconds} 秒`} />
      <Metric label="预计成本" value={currency.format(data.estimatedCostUsd)} />
      <Metric label="渲染方式" value="FFmpeg" />
    </div>
    <div className="grid gap-3">
      {data.directions.map((direction, index) => {
        return (
          <CollapsiblePlanningBlock
            key={direction.id}
            meta={`方向 ${index + 1}`}
            title={direction.title}
          >
            <p className="text-xs leading-5 text-zinc-400">{direction.logline}</p>
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
            <div className="mt-3 grid gap-2 border-t border-white/8 pt-3 text-xs leading-5 text-zinc-500 sm:grid-cols-3">
              <p><span className="text-zinc-400">视觉：</span>{direction.visualTreatment}</p>
              <p><span className="text-zinc-400">全片背景音乐：</span>{direction.musicDirection}</p>
              <p><span className="text-zinc-400">场景声音：</span>{direction.soundDirection}</p>
            </div>
          </CollapsiblePlanningBlock>
        );
      })}
    </div>
    <InfoPanel title="交付承诺">{data.deliveryPromise}</InfoPanel>
  </div>
);

const ScriptView = ({ data }: { readonly data: ArtifactData<"script"> }) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="font-sans text-base font-semibold text-zinc-100">{data.title}</h3>
      <span className="ml-auto font-numeric text-[11px] tabular-nums text-zinc-500">{data.durationSeconds} 秒</span>
    </div>
    <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-white/10">
      {data.beats.map((beat) => (
        <li className="relative flex gap-3" key={beat.order}>
          <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full border border-violet-400/20 bg-[#17131f] font-numeric text-xs font-semibold tabular-nums text-violet-300">{beat.order}</span>
          <div className="min-w-0 flex-1">
            <CollapsiblePlanningBlock meta={`${beat.durationSeconds}s`} title={beat.purpose}>
              <p className="text-xs leading-5 text-zinc-400"><span className="text-zinc-600">画面：</span>{beat.visual}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500"><span className="text-zinc-600">声音：</span>{beat.audio}</p>
            </CollapsiblePlanningBlock>
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
    <div className="grid grid-cols-3 gap-2">
      <Metric label="画面比例" value={data.aspectRatio} />
      <Metric label="总时长" value={`${data.durationSeconds} 秒`} />
      <Metric label="场景数量" value={`${data.scenes.length} 个`} />
    </div>
    <ol className="grid gap-3">
      {data.scenes.map((scene) => (
        <li key={scene.order}>
          <CollapsiblePlanningBlock
            meta={<>
              成片 {scene.durationSeconds}s
              {scene.generationDurationSeconds
                ? " · 模型 " + scene.generationDurationSeconds + "s"
                : ""}
              {" · "}{transitionLabel[scene.transition]}
            </>}
            title={`场景 ${scene.order}`}
          >
            <p className="text-sm leading-6 text-zinc-300">{scene.narrativeBeat}</p>
            <div className="mt-3 rounded-md border border-white/5 bg-white/[0.025] p-3 text-xs leading-5 text-zinc-500">
              <p><span className="text-zinc-400">视觉提示：</span>{scene.visualPrompt}</p>
              <p className="mt-1"><span className="text-zinc-400">运镜：</span>{scene.camera}</p>
              <p className="mt-1"><span className="text-zinc-400">场景声音：</span>{scene.audioMode === "seedance" ? scene.audio : "无声（仅保留全片背景音乐）"}</p>
            </div>
          </CollapsiblePlanningBlock>
        </li>
      ))}
    </ol>
  </div>
);

const ConsistencyReferenceView = ({ data }: { readonly data: ArtifactData<"consistency_reference"> }) => (
  <div className="space-y-3">
    <InfoPanel title={data.status === "required" ? "需要一致性参考图" : "无需一致性参考图"}>{data.reason}</InfoPanel>
    {data.groups.map((group) => (
      <CollapsiblePlanningBlock key={group.id} meta={`镜头 ${group.sceneOrders.join("、")} · ${currency.format(group.estimatedCostUsd)}`} title={group.label}>
        <p className="text-xs leading-5 text-zinc-400">{group.canonicalDescription}</p>
        <p className="text-xs leading-5 text-zinc-500">{group.kind} · {group.aspectRatio}</p>
        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-500">{group.prompt}</p>
      </CollapsiblePlanningBlock>
    ))}
  </div>
);
const AssetsView = ({ data }: { readonly data: ArtifactData<"assets"> }) => {
  const riskTone = data.slideshowRisk >= 7 ? "bg-red-400" : data.slideshowRisk >= 4 ? "bg-amber-300" : "bg-emerald-400";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Metric label="素材数量" value={`${data.assets.length} 项`} />
        <Metric label="预计成本" value={currency.format(data.totalEstimatedCostUsd)} />
        <Metric label="幻灯片风险" value={`${data.slideshowRisk} / 10`} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5" aria-label={`幻灯片风险 ${data.slideshowRisk} / 10`} role="img">
        <div className={`h-full rounded-full ${riskTone}`} style={{ width: `${data.slideshowRisk * 10}%` }} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.assets.map((asset, index) => (
          <CollapsiblePlanningBlock
            key={`${asset.sceneOrder}-${asset.kind}-${index}`}
            meta={currency.format(asset.estimatedCostUsd)}
            title={`场景 ${asset.sceneOrder}`}
          >
            <p className="text-xs leading-5 text-zinc-400">{asset.prompt}</p>
          </CollapsiblePlanningBlock>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoPanel title="Seedance 场景声音">{data.seedanceAudioDirection}</InfoPanel>
        <InfoPanel title="全片背景音乐">{data.music.direction}</InfoPanel>
      </div>
    </div>
  );
};

const EditView = ({ data }: { readonly data: ArtifactData<"edit"> }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-3 gap-2">
      <Metric label="总时长" value={`${data.durationSeconds} 秒`} />
      <Metric label="渲染方式" value="FFmpeg" />
      <Metric label="剪辑片段" value={`${data.timeline.length} 段`} />
    </div>
    <section>
      <SectionTitle>剪辑时间线</SectionTitle>
      <div className="mt-3 flex h-9 gap-1 rounded-lg bg-black/20 p-1">
        {data.timeline.map((clip) => (
          <div className="grid min-w-0 basis-0 place-items-center rounded bg-amber-300/15 px-1 font-numeric text-[10px] tabular-nums text-amber-200" key={`${clip.sceneOrder}-${clip.startSeconds}`} style={{ flexGrow: clip.durationSeconds }} title={`场景 ${clip.sceneOrder} · ${clip.durationSeconds} 秒`}>
            S{clip.sceneOrder}
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.timeline.map((clip) => (
          <CollapsiblePlanningBlock
            key={`detail-${clip.sceneOrder}-${clip.startSeconds}`}
            meta={`${clip.startSeconds}s → ${clip.startSeconds + clip.durationSeconds}s`}
            title={`场景 ${clip.sceneOrder}`}
          >
            <p className="text-xs leading-5 text-zinc-500">{transitionLabel[clip.transition]} · 音量 {clip.audioGainDb} dB</p>
          </CollapsiblePlanningBlock>
        ))}
      </div>
    </section>
    <div className="grid gap-3 sm:grid-cols-2">
      <InfoPanel title="调色方案"><span className="inline-flex items-start gap-2"><PaletteIcon className="mt-1 size-3.5 shrink-0 text-amber-300" />{data.colorGrade}</span></InfoPanel>
      <InfoPanel title="声音混合"><span className="inline-flex items-start gap-2"><Volume2Icon className="mt-1 size-3.5 shrink-0 text-amber-300" />{data.audioMix}</span></InfoPanel>
    </div>
    <CollapsiblePlanningBlock title="质量检查">
      <ul className="grid gap-2 sm:grid-cols-2">
        {data.qualityChecks.map((check) => <li className="flex gap-2 text-xs leading-5 text-zinc-400" key={check}><CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-400/70" />{check}</li>)}
      </ul>
    </CollapsiblePlanningBlock>
    <CollapsiblePlanningBlock title="最终渲染提示词">
      <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-zinc-500">{data.renderPrompt}</p>
    </CollapsiblePlanningBlock>
  </div>
);

export function CinematicArtifactVisualization({ areSectionsExpanded, artifact }: {
  readonly areSectionsExpanded: boolean;
  readonly artifact: CinematicArtifact;
}) {
  let content: ReactNode;
  if (artifact.stage === "research") content = <ResearchView data={artifact.data} />;
  else if (artifact.stage === "proposal") content = <ProposalView data={artifact.data} />;
  else if (artifact.stage === "script") content = <ScriptView data={artifact.data} />;
  else if (artifact.stage === "scene_plan") content = <ScenePlanView data={artifact.data} />;
  else if (artifact.stage === "consistency_reference") content = <ConsistencyReferenceView data={artifact.data} />;
  else if (artifact.stage === "assets") content = <AssetsView data={artifact.data} />;
  else content = <EditView data={artifact.data} />;

  return (
    <PlanningSectionsExpandedContext value={areSectionsExpanded}>
      {content}
    </PlanningSectionsExpandedContext>
  );
}
