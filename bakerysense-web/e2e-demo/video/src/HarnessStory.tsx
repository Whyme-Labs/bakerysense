import React from "react";
import {
	AbsoluteFill,
	Audio,
	Img,
	OffthreadVideo,
	Sequence,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
	interpolate,
	spring,
	Easing,
} from "remotion";
import voManifest from "../public/vo-harness/manifest.json";

// ---------------------------------------------------------------------------
// "How it works" walkthrough: motion-graphic framing (problem, the loop,
// branch divergence, thesis) interleaved with real Playwright click-through
// clips of the live app (connect data → bake plan → review → approve), each
// with an Input/Output caption. Frame-driven only (no CSS transitions).
// ---------------------------------------------------------------------------

const INK = "oklch(0.18 0.01 60)";
const SURFACE = "oklch(0.99 0.01 80)";
const AMBER = "oklch(0.76 0.14 70)";
const GREEN = "oklch(0.62 0.13 150)";
const RED = "oklch(0.58 0.18 25)";
const MUTED = "oklch(0.62 0.02 60)";
const FONT = "Geist, Inter, system-ui, sans-serif";
const MONO = "Geist Mono, ui-monospace, monospace";

const FPS = 30;
const VO_TAIL = 18;
const EASE = Easing.bezier(0.16, 1, 0.3, 1);

interface VoEntry { id: string; anchor: string; audio_file: string; duration_ms: number }
const voByAnchor = new Map<string, VoEntry>((voManifest as VoEntry[]).map((v) => [v.anchor, v]));
function voFrames(anchor: string): number {
	const e = voByAnchor.get(anchor);
	return e ? Math.ceil((e.duration_ms / 1000) * FPS) + VO_TAIL : 0;
}

// Recorded clip lengths (seconds) → frames.
const CLIP_SEC: Record<string, number> = { input: 8.04, plan: 9.32, review: 8.64, approve: 8.08 };
const clipFrames = (n: string) => Math.ceil(CLIP_SEC[n] * FPS);

// Scene duration: clips fit max(clip, narration); motion fits max(design, narration).
const clipDur = (a: string) => Math.max(clipFrames(a), voFrames(a));
const motionDur = (a: string, min: number) => Math.max(min, voFrames(a));

const D = {
	cold: motionDur("cold", 110),
	input: clipDur("input"),
	plan: clipDur("plan"),
	loop: motionDur("loop", 200),
	review: clipDur("review"),
	approve: clipDur("approve"),
	diverge: motionDur("diverge", 185),
	thesis: motionDur("thesis", 150),
};
export const HARNESS_STORY_FRAMES = Object.values(D).reduce((a, b) => a + b, 0);

const SceneVO: React.FC<{ anchor: string }> = ({ anchor }) => {
	const e = voByAnchor.get(anchor);
	return e ? <Audio src={staticFile(`vo-harness/${e.audio_file}`)} /> : null;
};

function envelope(frame: number, dur: number, fade = 12): number {
	return interpolate(frame, [0, fade, dur - fade, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

const Backdrop: React.FC<{ dark?: boolean }> = ({ dark }) => {
	const frame = useCurrentFrame();
	const x = interpolate(frame, [0, HARNESS_STORY_FRAMES], [35, 65]);
	const y = interpolate(frame, [0, HARNESS_STORY_FRAMES], [42, 58]);
	return (
		<AbsoluteFill style={{
			background: dark
				? `radial-gradient(120% 120% at ${x}% ${y}%, oklch(0.26 0.03 60) 0%, oklch(0.16 0.02 60) 60%, oklch(0.12 0.01 60) 100%)`
				: `radial-gradient(120% 120% at ${x}% ${y}%, oklch(0.99 0.02 85) 0%, oklch(0.96 0.03 80) 55%, oklch(0.93 0.04 75) 100%)`,
		}} />
	);
};

const Kinetic: React.FC<{ words: { t: string; accent?: boolean }[]; startFrame?: number; size?: number; color?: string }> = ({ words, startFrame = 0, size = 64, color = INK }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "0 18px", justifyContent: "center", maxWidth: 1100 }}>
			{words.map((w, i) => {
				const s = spring({ frame: frame - (startFrame + i * 4), fps, config: { damping: 200 } });
				return (
					<span key={i} style={{ display: "inline-block", transform: `translateY(${interpolate(s, [0, 1], [28, 0])}px)`, opacity: s, fontFamily: FONT, fontSize: size, fontWeight: 700, letterSpacing: "-0.02em", color: w.accent ? AMBER : color }}>{w.t}</span>
				);
			})}
		</div>
	);
};

// ---- 1. Cold open -----------------------------------------------------------
const ColdOpen: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = envelope(frame, D.cold);
	const pct = Math.round(interpolate(frame, [10, 55], [0, 38], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }));
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 22 }}>
				<div style={{ fontFamily: FONT, fontSize: 22, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase" }}>Every independent bakery throws out</div>
				<div style={{ fontFamily: FONT, fontSize: 200, fontWeight: 800, color: RED, lineHeight: 1, letterSpacing: "-0.04em" }}>{pct}%</div>
				<Kinetic startFrame={40} size={40} words={[{ t: "of" }, { t: "what" }, { t: "they" }, { t: "bake." }, { t: "The" }, { t: "waste" }, { t: "is" }, { t: "uncertainty,", accent: true }, { t: "not" }, { t: "ignorance." }]} />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- Clip scene (real app footage) -----------------------------------------
const ClipScene: React.FC<{ src: string; dur: number; step: string; title: string; tagLabel: string; tag: string; tagColor: string }>
	= ({ src, dur, step, title, tagLabel, tag, tagColor }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = envelope(frame, dur);
	const head = spring({ frame, fps, config: { damping: 200 } });
	const tagS = spring({ frame: frame - 14, fps, config: { damping: 160 } });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			{/* step heading */}
			<div style={{ position: "absolute", top: 44, width: "100%", textAlign: "center", opacity: head, transform: `translateY(${interpolate(head, [0, 1], [-14, 0])}px)` }}>
				<div style={{ fontFamily: MONO, fontSize: 15, color: AMBER, letterSpacing: "0.16em", textTransform: "uppercase" }}>{step}</div>
				<div style={{ fontFamily: FONT, fontSize: 34, fontWeight: 700, color: "#fff8ee", marginTop: 4 }}>{title}</div>
			</div>
			{/* framed real clip */}
			<div style={{ position: "absolute", top: 158, left: (1440 - 1000) / 2, width: 1000, borderRadius: 12, overflow: "hidden", border: "1px solid oklch(0.45 0.02 60)", boxShadow: "0 26px 70px oklch(0.08 0.02 60 / 0.6)" }}>
				<OffthreadVideo src={staticFile(src)} style={{ width: "100%", display: "block" }} />
			</div>
			{/* Input/Output tag */}
			<div style={{ position: "absolute", bottom: 52, width: "100%", textAlign: "center", opacity: tagS }}>
				<span style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "9px 18px", borderRadius: 999, background: "oklch(0.22 0.02 60)", border: `1px solid ${tagColor}`, fontFamily: MONO, fontSize: 16 }}>
					<span style={{ color: tagColor, fontWeight: 700 }}>{tagLabel}</span>
					<span style={{ color: "#efe7d6" }}>{tag}</span>
				</span>
			</div>
		</AbsoluteFill>
	);
};

// ---- The loop diagram (fixed: ring pushed down, clear of title) -------------
const LoopDiagram: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = envelope(frame, D.loop);
	const nodes = [
		{ label: "diagnose", sub: "classify each miss" },
		{ label: "propose", sub: "bounded edit" },
		{ label: "validate", sub: "held-out WAPE" },
		{ label: "approve", sub: "owner decides" },
	];
	const cx = 720, cy = 500, r = 215;
	const active = Math.floor(interpolate(frame, [40, D.loop - 20], [0, 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) % 4;
	const titleS = spring({ frame, fps, config: { damping: 200 } });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<div style={{ position: "absolute", top: 58, width: "100%", textAlign: "center", opacity: titleS, transform: `translateY(${interpolate(titleS, [0, 1], [18, 0])}px)` }}>
				<div style={{ fontFamily: MONO, fontSize: 17, color: AMBER, letterSpacing: "0.18em", textTransform: "uppercase" }}>The self-evolving loop</div>
				<div style={{ fontFamily: FONT, fontSize: 42, fontWeight: 700, color: "#fff8ee", marginTop: 8 }}>It learns from its own decisions</div>
			</div>
			<svg width={1440} height={900} style={{ position: "absolute", inset: 0 }}>
				<circle cx={cx} cy={cy} r={r} fill="none" stroke="oklch(0.4 0.02 60)" strokeWidth={2} strokeDasharray="6 10" />
				{nodes.map((_, i) => {
					const a0 = (i / 4) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 4) * Math.PI * 2 - Math.PI / 2;
					const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
					const mx = cx + r * Math.cos((a0 + a1) / 2), my = cy + r * Math.sin((a0 + a1) / 2);
					return <path key={i} d={`M ${x0} ${y0} Q ${mx} ${my} ${x1} ${y1}`} fill="none" stroke={AMBER} strokeWidth={4} opacity={i === active ? 1 : 0.15} strokeLinecap="round" />;
				})}
			</svg>
			{nodes.map((n, i) => {
				const a = (i / 4) * Math.PI * 2 - Math.PI / 2, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), on = i === active;
				const pop = on ? spring({ frame: frame - 40 - i * 28, fps, config: { damping: 120 } }) : 0;
				return (
					<div key={i} style={{ position: "absolute", left: x - 95, top: y - 52, width: 190, height: 104, transform: `scale(${1 + 0.1 * pop})`, borderRadius: 16, background: on ? AMBER : "oklch(0.24 0.02 60)", border: `2px solid ${on ? AMBER : "oklch(0.4 0.02 60)"}`, boxShadow: on ? `0 0 ${30 + 20 * pop}px oklch(0.76 0.14 70 / 0.6)` : "none", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", fontFamily: FONT }}>
						<div style={{ fontSize: 26, fontWeight: 700, color: on ? INK : "oklch(0.8 0.02 70)" }}>{n.label}</div>
						<div style={{ fontSize: 14, color: on ? "oklch(0.3 0.06 60)" : MUTED, marginTop: 2, fontFamily: MONO }}>{n.sub}</div>
					</div>
				);
			})}
			<div style={{ position: "absolute", left: cx - 90, top: cy - 26, width: 180, textAlign: "center", fontFamily: MONO, fontSize: 15, color: "oklch(0.72 0.02 70)" }}>gemma narrates ·<br />numbers stay deterministic</div>
		</AbsoluteFill>
	);
};

// ---- Divergence (fixed: real cards + big readable diff line) ----------------
const BranchPanel: React.FC<{ name: string; day: string; diff: string; card: string; appear: number; align: "left" | "right" }>
	= ({ name, day, diff, card, appear, align }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - appear, fps, config: { damping: 200 } });
	const dx = interpolate(s, [0, 1], [align === "left" ? -60 : 60, 0]);
	const cardS = spring({ frame: frame - appear - 16, fps, config: { damping: 160 } });
	return (
		<div style={{ flex: 1, opacity: s, transform: `translateX(${dx}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 30 }}>
			<div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: "#fff8ee" }}>{name}</div>
			<div style={{ width: 540, opacity: cardS, transform: `translateY(${interpolate(cardS, [0, 1], [18, 0])}px)`, borderRadius: 12, overflow: "hidden", boxShadow: "0 16px 44px oklch(0.08 0.02 60 / 0.55)", border: `2px solid ${AMBER}` }}>
				<Img src={staticFile(card)} style={{ width: "100%", display: "block" }} />
			</div>
			<div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: AMBER, marginTop: 4 }}>{diff}</div>
			<div style={{ fontFamily: BODYFONT, fontSize: 15, color: MUTED }}>learned {day} on its own</div>
		</div>
	);
};
const BODYFONT = "Inter, system-ui, sans-serif";

const Divergence: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = envelope(frame, D.diverge);
	const titleS = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<div style={{ position: "absolute", top: 56, width: "100%", textAlign: "center", opacity: titleS }}>
				<div style={{ fontFamily: MONO, fontSize: 17, color: AMBER, letterSpacing: "0.16em", textTransform: "uppercase" }}>Same brand · same model</div>
				<div style={{ fontFamily: FONT, fontSize: 44, fontWeight: 700, color: "#fff8ee", marginTop: 8 }}>Each shop evolves a different playbook</div>
			</div>
			<AbsoluteFill style={{ flexDirection: "row", alignItems: "center", paddingTop: 70 }}>
				<BranchPanel name="Bukit Bintang" day="Wed" diff="CROISSANT · Wed → 0.80" card="captures/harness-card-2.png" appear={20} align="left" />
				<div style={{ width: 2, height: 280, background: "oklch(0.4 0.02 60)" }} />
				<BranchPanel name="Subang Jaya" day="Sun" diff="CROISSANT · Sun → 0.80" card="captures/harness-card-1.png" appear={40} align="right" />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- Thesis -----------------------------------------------------------------
const Thesis: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = envelope(frame, D.thesis, 16);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 26 }}>
				<Kinetic words={[{ t: "The" }, { t: "model" }, { t: "stays" }, { t: "frozen." }]} size={56} color="#fff8ee" />
				<Kinetic startFrame={16} words={[{ t: "The" }, { t: "skills", accent: true }, { t: "evolve." }]} size={56} color="#fff8ee" />
				<div style={{ height: 16 }} />
				<Kinetic startFrame={36} words={[{ t: "BakerySense" }, { t: "—" }, { t: "a" }, { t: "self-evolving", accent: true }, { t: "harness" }, { t: "for" }, { t: "perishable" }, { t: "SMEs." }]} size={28} color="oklch(0.85 0.02 70)" />
				<div style={{ fontFamily: MONO, fontSize: 17, color: AMBER, marginTop: 14, letterSpacing: "0.06em" }}>bakerysense.swmengappdev.workers.dev</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- Assembly ---------------------------------------------------------------
export const HarnessStory: React.FC = () => {
	let f = 0;
	const scenes: { node: React.ReactNode; dur: number; anchor: string }[] = [
		{ node: <ColdOpen />, dur: D.cold, anchor: "cold" },
		{ node: <ClipScene src="recordings/input.webm" dur={D.input} step="Step 1 · connect" title="Connect your sales data" tagLabel="INPUT" tag="14+ days of sales · CSV or POS" tagColor={GREEN} />, dur: D.input, anchor: "input" },
		{ node: <ClipScene src="recordings/plan.webm" dur={D.plan} step="Step 2 · plan" title="Tomorrow's bake plan" tagLabel="OUTPUT" tag="3 options / SKU · waste · stockout · units" tagColor={AMBER} />, dur: D.plan, anchor: "plan" },
		{ node: <LoopDiagram />, dur: D.loop, anchor: "loop" },
		{ node: <ClipScene src="recordings/review.webm" dur={D.review} step="Step 3 · review" title="A validated correction" tagLabel="RESULT" tag="held-out WAPE 3.0% → 2.0%" tagColor={GREEN} />, dur: D.review, anchor: "review" },
		{ node: <ClipScene src="recordings/approve.webm" dur={D.approve} step="Step 4 · approve" title="One tap to apply it" tagLabel="ACTION" tag="next forecast uses the fix · auditable" tagColor={AMBER} />, dur: D.approve, anchor: "approve" },
		{ node: <Divergence />, dur: D.diverge, anchor: "diverge" },
		{ node: <Thesis />, dur: D.thesis, anchor: "thesis" },
	];
	return (
		<AbsoluteFill style={{ backgroundColor: SURFACE }}>
			{scenes.map((sc, i) => {
				const from = f; f += sc.dur;
				return (
					<Sequence key={i} from={from} durationInFrames={sc.dur}>
						{sc.node}
						<SceneVO anchor={sc.anchor} />
					</Sequence>
				);
			})}
		</AbsoluteFill>
	);
};
