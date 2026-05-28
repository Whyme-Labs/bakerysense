import React from "react";
import {
	AbsoluteFill,
	Audio,
	Img,
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
// Dynamic motion-graphic spine for the self-evolving-harness story. Pure
// Remotion (frame-driven) — no screen recording dependency, so it renders and
// verifies standalone. Storyline:
//   1. Cold open — the problem (kinetic)
//   2. The loop — animated diagnose→propose→validate→approve cycle
//   3. The catch — WAPE count-down + the learned diff reveal
//   4. Divergence — two branches evolve different corrections (split screen)
//   5. Approval — controlled autonomy
//   6. Thesis — kinetic outro
// ---------------------------------------------------------------------------

const INK = "oklch(0.18 0.01 60)";
const SURFACE = "oklch(0.99 0.01 80)";
const AMBER = "oklch(0.76 0.14 70)";
const GREEN = "oklch(0.62 0.13 150)";
const RED = "oklch(0.58 0.18 25)";
const MUTED = "oklch(0.55 0.02 60)";
const FONT = "Geist, Inter, system-ui, sans-serif";
const MONO = "Geist Mono, ui-monospace, monospace";

const FPS = 30;
const VO_TAIL_FRAMES = 18; // ~0.6s hold after narration ends

interface VoEntry { id: string; anchor: string; audio_file: string; duration_ms: number }
const voByAnchor = new Map<string, VoEntry>((voManifest as VoEntry[]).map((v) => [v.anchor, v]));
function voFrames(anchor: string): number {
	const e = voByAnchor.get(anchor);
	return e ? Math.ceil((e.duration_ms / 1000) * FPS) + VO_TAIL_FRAMES : 0;
}

// Design minimums per scene; each scene is padded to fit its narration so
// the voiceover is never cut off.
const DESIGN = { cold: 120, loop: 210, product: 150, catch: 210, diverge: 210, approve: 135, thesis: 165 };
const D = {
	cold: Math.max(DESIGN.cold, voFrames("cold")),
	loop: Math.max(DESIGN.loop, voFrames("loop")),
	product: Math.max(DESIGN.product, voFrames("product")),
	catch: Math.max(DESIGN.catch, voFrames("catch")),
	diverge: Math.max(DESIGN.diverge, voFrames("diverge")),
	approve: Math.max(DESIGN.approve, voFrames("approve")),
	thesis: Math.max(DESIGN.thesis, voFrames("thesis")),
};
export const HARNESS_STORY_FRAMES =
	D.cold + D.loop + D.product + D.catch + D.diverge + D.approve + D.thesis;

// Per-scene voiceover, mounted at scene start.
const SceneVO: React.FC<{ anchor: string }> = ({ anchor }) => {
	const e = voByAnchor.get(anchor);
	if (!e) return null;
	return <Audio src={staticFile(`vo-harness/${e.audio_file}`)} />;
};

// Standard fade-in/out envelope so scene cuts feel continuous on a shared bg.
function envelope(frame: number, dur: number, fade = 12): number {
	return interpolate(frame, [0, fade, dur - fade, dur], [0, 1, 1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
}

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// A slowly drifting warm gradient backdrop, frame-driven (no CSS animation).
const Backdrop: React.FC<{ dark?: boolean }> = ({ dark }) => {
	const frame = useCurrentFrame();
	const x = interpolate(frame, [0, HARNESS_STORY_FRAMES], [30, 70]);
	const y = interpolate(frame, [0, HARNESS_STORY_FRAMES], [40, 60]);
	return (
		<AbsoluteFill
			style={{
				background: dark
					? `radial-gradient(120% 120% at ${x}% ${y}%, oklch(0.26 0.03 60) 0%, oklch(0.16 0.02 60) 60%, oklch(0.12 0.01 60) 100%)`
					: `radial-gradient(120% 120% at ${x}% ${y}%, oklch(0.99 0.02 85) 0%, oklch(0.96 0.03 80) 55%, oklch(0.93 0.04 75) 100%)`,
			}}
		/>
	);
};

// Word-by-word kinetic line.
const Kinetic: React.FC<{
	words: { t: string; accent?: boolean }[];
	startFrame?: number;
	size?: number;
	color?: string;
}> = ({ words, startFrame = 0, size = 64, color = INK }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "0 18px", justifyContent: "center", maxWidth: 1100 }}>
			{words.map((w, i) => {
				const appear = startFrame + i * 4;
				const s = spring({ frame: frame - appear, fps, config: { damping: 200 } });
				const y = interpolate(s, [0, 1], [28, 0]);
				return (
					<span
						key={i}
						style={{
							display: "inline-block",
							transform: `translateY(${y}px)`,
							opacity: s,
							fontFamily: FONT,
							fontSize: size,
							fontWeight: 700,
							letterSpacing: "-0.02em",
							color: w.accent ? AMBER : color,
						}}
					>
						{w.t}
					</span>
				);
			})}
		</div>
	);
};

// ---------------------------------------------------------------------------
// 1. Cold open
// ---------------------------------------------------------------------------
const ColdOpen: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = envelope(frame, D.cold);
	const pct = Math.round(interpolate(frame, [10, 55], [0, 38], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }));
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 24 }}>
				<div style={{ fontFamily: FONT, fontSize: 22, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase" }}>
					Every independent bakery throws out
				</div>
				<div style={{ fontFamily: FONT, fontSize: 200, fontWeight: 800, color: RED, lineHeight: 1, letterSpacing: "-0.04em" }}>
					{pct}%
				</div>
				<Kinetic
					startFrame={40}
					size={40}
					words={[
						{ t: "of" }, { t: "what" }, { t: "they" }, { t: "bake." },
						{ t: "The" }, { t: "waste" }, { t: "is" }, { t: "uncertainty,", accent: true },
						{ t: "not" }, { t: "ignorance." },
					]}
				/>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------------------
// 2. Animated loop diagram
// ---------------------------------------------------------------------------
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
	const cx = 720;
	const cy = 430;
	const r = 230;
	// Active node advances every ~28 frames after a short intro.
	const active = Math.floor(interpolate(frame, [40, D.loop - 20], [0, 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) % 4;
	const titleS = spring({ frame, fps, config: { damping: 200 } });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", opacity: titleS, transform: `translateY(${interpolate(titleS, [0, 1], [20, 0])}px)` }}>
				<div style={{ fontFamily: MONO, fontSize: 18, color: AMBER, letterSpacing: "0.18em", textTransform: "uppercase" }}>The self-evolving loop</div>
				<div style={{ fontFamily: FONT, fontSize: 46, fontWeight: 700, color: "#fff8ee", marginTop: 8 }}>It learns from its own decisions</div>
			</div>
			{/* ring */}
			<svg width={1440} height={900} style={{ position: "absolute", inset: 0 }}>
				<circle cx={cx} cy={cy} r={r} fill="none" stroke="oklch(0.4 0.02 60)" strokeWidth={2} strokeDasharray="6 10" />
				{nodes.map((_, i) => {
					const a0 = (i / 4) * Math.PI * 2 - Math.PI / 2;
					const a1 = ((i + 1) / 4) * Math.PI * 2 - Math.PI / 2;
					const lit = i === active ? 1 : 0.15;
					const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
					const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
					const mx = cx + r * 1.0 * Math.cos((a0 + a1) / 2), my = cy + r * 1.0 * Math.sin((a0 + a1) / 2);
					return <path key={i} d={`M ${x0} ${y0} Q ${mx} ${my} ${x1} ${y1}`} fill="none" stroke={AMBER} strokeWidth={4} opacity={lit} strokeLinecap="round" />;
				})}
			</svg>
			{nodes.map((n, i) => {
				const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
				const x = cx + r * Math.cos(a);
				const y = cy + r * Math.sin(a);
				const on = i === active;
				const pop = on ? spring({ frame: frame - 40 - i * 28, fps, config: { damping: 120 } }) : 0;
				const scale = 1 + 0.12 * pop;
				return (
					<div key={i} style={{
						position: "absolute", left: x - 95, top: y - 52, width: 190, height: 104,
						transform: `scale(${scale})`,
						borderRadius: 16,
						background: on ? AMBER : "oklch(0.24 0.02 60)",
						border: `2px solid ${on ? AMBER : "oklch(0.4 0.02 60)"}`,
						boxShadow: on ? `0 0 ${30 + 20 * pop}px oklch(0.76 0.14 70 / 0.6)` : "none",
						display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
						fontFamily: FONT,
					}}>
						<div style={{ fontSize: 26, fontWeight: 700, color: on ? INK : "oklch(0.8 0.02 70)" }}>{n.label}</div>
						<div style={{ fontSize: 14, color: on ? "oklch(0.3 0.06 60)" : MUTED, marginTop: 2, fontFamily: MONO }}>{n.sub}</div>
					</div>
				);
			})}
			<div style={{ position: "absolute", left: cx - 90, top: cy - 26, width: 180, textAlign: "center", fontFamily: MONO, fontSize: 15, color: "oklch(0.7 0.02 70)" }}>
				gemma narrates ·<br />numbers stay deterministic
			</div>
		</AbsoluteFill>
	);
};

// Ken Burns: slow frame-driven zoom + pan on an image.
const KenBurns: React.FC<{
	src: string;
	dur: number;
	from?: { scale: number; x: number; y: number };
	to?: { scale: number; x: number; y: number };
	radius?: number;
	style?: React.CSSProperties;
}> = ({ src, dur, from = { scale: 1.06, x: 0, y: -2 }, to = { scale: 1.14, x: 0, y: 4 }, radius = 14, style }) => {
	const frame = useCurrentFrame();
	const t = interpolate(frame, [0, dur], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
	const scale = interpolate(t, [0, 1], [from.scale, to.scale]);
	const x = interpolate(t, [0, 1], [from.x, to.x]);
	const y = interpolate(t, [0, 1], [from.y, to.y]);
	return (
		<div style={{ overflow: "hidden", borderRadius: radius, ...style }}>
			<Img src={src} style={{ width: "100%", display: "block", transform: `scale(${scale}) translate(${x}%, ${y}%)` }} />
		</div>
	);
};

// ---------------------------------------------------------------------------
// 2b. Product reveal — the real /harness page (Ken Burns) + callout
// ---------------------------------------------------------------------------
const ProductReveal: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = envelope(frame, D.product);
	const chip = spring({ frame: frame - 16, fps, config: { damping: 160 } });
	const ring = interpolate(frame, [60, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
				<div style={{ position: "relative", width: 1080, boxShadow: "0 30px 80px oklch(0.4 0.05 70 / 0.25)", borderRadius: 16 }}>
					<KenBurns src={staticFile("captures/harness-full.png")} dur={D.product} radius={16} />
					{/* pulsing highlight over the proposals region */}
					<div style={{
						position: "absolute", left: "5%", top: "52%", width: "90%", height: "40%",
						border: `3px solid ${AMBER}`, borderRadius: 12,
						opacity: ring * (0.5 + 0.5 * Math.sin(frame / 5)),
					}} />
				</div>
			</AbsoluteFill>
			<div style={{
				position: "absolute", top: 70, left: 0, width: "100%", textAlign: "center",
				opacity: chip, transform: `translateY(${interpolate(chip, [0, 1], [-16, 0])}px)`,
			}}>
				<span style={{
					display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 18px", borderRadius: 999,
					background: INK, color: "#fff8ee", fontFamily: MONO, fontSize: 18, letterSpacing: "0.06em",
				}}>
					<span style={{ width: 9, height: 9, borderRadius: 999, background: GREEN }} />
					The actual product · proposals waiting for review
				</span>
			</div>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------------------
// 3. The catch — WAPE count-down + diff reveal
// ---------------------------------------------------------------------------
const CatchScene: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = envelope(frame, D.catch);
	const before = 0.0305, after = 0.0204;
	const wape = interpolate(frame, [50, 110], [before, after], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
	const barW = interpolate(wape, [0, before], [0, 520]);
	const diffS = spring({ frame: frame - 120, fps, config: { damping: 200 } });
	const titleS = spring({ frame, fps, config: { damping: 200 } });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 8 }}>
				<div style={{ opacity: titleS, transform: `translateY(${interpolate(titleS, [0, 1], [18, 0])}px)`, textAlign: "center", marginBottom: 30 }}>
					<div style={{ fontFamily: MONO, fontSize: 17, color: AMBER, letterSpacing: "0.16em", textTransform: "uppercase" }}>Bukit Bintang · nightly self-inspection</div>
					<div style={{ fontFamily: FONT, fontSize: 44, fontWeight: 700, color: INK, marginTop: 6 }}>Croissants run ~25% high every Wednesday</div>
				</div>
				{/* WAPE meter */}
				<div style={{ display: "flex", alignItems: "baseline", gap: 16, fontFamily: MONO }}>
					<span style={{ fontSize: 22, color: MUTED }}>holdout WAPE</span>
					<span style={{ fontSize: 64, fontWeight: 800, color: GREEN }}>{(wape * 100).toFixed(2)}%</span>
				</div>
				<div style={{ width: 520, height: 14, borderRadius: 999, background: "oklch(0.88 0.02 70)", overflow: "hidden", marginTop: 4 }}>
					<div style={{ width: barW, height: "100%", background: `linear-gradient(90deg, ${GREEN}, ${AMBER})`, borderRadius: 999 }} />
				</div>
				<div style={{ fontFamily: MONO, fontSize: 15, color: MUTED, marginTop: 6 }}>3.05% → 2.04% · validated on weeks 9–16</div>
				{/* diff card */}
				<div style={{
					marginTop: 34, opacity: diffS, transform: `translateY(${interpolate(diffS, [0, 1], [24, 0])}px) scale(${interpolate(diffS, [0, 1], [0.96, 1])})`,
					background: "#fff", borderRadius: 14, padding: "18px 26px", border: `2px solid ${GREEN}`,
					boxShadow: "0 12px 40px oklch(0.5 0.05 70 / 0.18)", fontFamily: MONO, fontSize: 26,
					display: "flex", alignItems: "center", gap: 16,
				}}>
					<span style={{ color: MUTED }}>CROISSANT · Wed</span>
					<span style={{ color: RED, textDecoration: "line-through" }}>1.00</span>
					<span style={{ color: MUTED }}>→</span>
					<span style={{ color: GREEN, fontWeight: 800 }}>0.80</span>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------------------
// 4. Divergence split-screen
// ---------------------------------------------------------------------------
const BranchPanel: React.FC<{ name: string; day: string; card: string; appear: number; align: "left" | "right" }> = ({ name, day, card, appear, align }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - appear, fps, config: { damping: 200 } });
	const dx = interpolate(s, [0, 1], [align === "left" ? -60 : 60, 0]);
	const cardS = spring({ frame: frame - appear - 18, fps, config: { damping: 160 } });
	return (
		<div style={{ flex: 1, opacity: s, transform: `translateX(${dx}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: 36 }}>
			<div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 700, color: "#fff8ee" }}>{name}</div>
			{/* the real proposal card screenshot */}
			<div style={{
				width: 520, opacity: cardS,
				transform: `translateY(${interpolate(cardS, [0, 1], [20, 0])}px) scale(${interpolate(cardS, [0, 1], [0.96, 1])})`,
				borderRadius: 12, overflow: "hidden", boxShadow: "0 18px 50px oklch(0.1 0.02 60 / 0.5)",
				border: `2px solid ${AMBER}`,
			}}>
				<Img src={staticFile(card)} style={{ width: "100%", display: "block" }} />
			</div>
			<div style={{ fontFamily: MONO, fontSize: 16, color: AMBER }}>learned {day} on its own</div>
		</div>
	);
};

const Divergence: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = envelope(frame, D.diverge);
	const titleS = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<div style={{ position: "absolute", top: 64, width: "100%", textAlign: "center", opacity: titleS }}>
				<div style={{ fontFamily: MONO, fontSize: 18, color: AMBER, letterSpacing: "0.16em", textTransform: "uppercase" }}>Same brand · same model</div>
				<div style={{ fontFamily: FONT, fontSize: 46, fontWeight: 700, color: "#fff8ee", marginTop: 8 }}>Each shop evolves a different playbook</div>
			</div>
			<AbsoluteFill style={{ flexDirection: "row", alignItems: "center", paddingTop: 90 }}>
				<BranchPanel name="Bukit Bintang" day="Wed" card="captures/harness-card-2.png" appear={24} align="left" />
				<div style={{ width: 2, height: 300, background: "oklch(0.4 0.02 60)" }} />
				<BranchPanel name="Subang Jaya" day="Sun" card="captures/harness-card-1.png" appear={48} align="right" />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------------------
// 5. Approval — controlled autonomy
// ---------------------------------------------------------------------------
const Approval: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = envelope(frame, D.approve);
	const press = spring({ frame: frame - 55, fps, config: { damping: 120, stiffness: 200 } });
	const ripple = interpolate(frame, [55, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const checked = frame > 70;
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 30 }}>
				<Kinetic words={[{ t: "The" }, { t: "harness" }, { t: "proposes." }, { t: "The" }, { t: "owner", accent: true }, { t: "decides." }]} size={52} />
				<div style={{ position: "relative", marginTop: 10 }}>
					<div style={{ position: "absolute", inset: 0, borderRadius: 14, border: `3px solid ${GREEN}`, opacity: (1 - ripple) * 0.8, transform: `scale(${1 + ripple * 0.8})` }} />
					<div style={{
						transform: `scale(${interpolate(press, [0, 1], [1, 0.96])})`,
						background: checked ? GREEN : AMBER, color: checked ? "#fff" : INK,
						borderRadius: 14, padding: "18px 40px", fontFamily: FONT, fontSize: 28, fontWeight: 700,
						display: "flex", alignItems: "center", gap: 12, boxShadow: "0 12px 36px oklch(0.5 0.05 70 / 0.25)",
					}}>
						{checked ? "✓ Approved — live next forecast" : "Approve correction"}
					</div>
				</div>
				<div style={{ fontFamily: MONO, fontSize: 16, color: MUTED }}>controlled autonomy · every edit is auditable</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------------------
// 6. Thesis outro
// ---------------------------------------------------------------------------
const Thesis: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = envelope(frame, D.thesis, 16);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 28 }}>
				<Kinetic words={[{ t: "The" }, { t: "model" }, { t: "stays" }, { t: "frozen." }]} size={58} color="#fff8ee" />
				<Kinetic startFrame={18} words={[{ t: "The" }, { t: "skills", accent: true }, { t: "evolve." }]} size={58} color="#fff8ee" />
				<div style={{ height: 20 }} />
				<Kinetic startFrame={40} words={[{ t: "BakerySense" }, { t: "—" }, { t: "a" }, { t: "self-evolving", accent: true }, { t: "harness" }, { t: "for" }, { t: "perishable" }, { t: "SMEs." }]} size={30} color="oklch(0.85 0.02 70)" />
				<div style={{ fontFamily: MONO, fontSize: 17, color: AMBER, marginTop: 14, letterSpacing: "0.06em" }}>
					bakerysense.swmengappdev.workers.dev
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

export const HarnessStory: React.FC = () => {
	let f = 0;
	const scenes: [React.FC, number, string][] = [
		[ColdOpen, D.cold, "cold"],
		[LoopDiagram, D.loop, "loop"],
		[ProductReveal, D.product, "product"],
		[CatchScene, D.catch, "catch"],
		[Divergence, D.diverge, "diverge"],
		[Approval, D.approve, "approve"],
		[Thesis, D.thesis, "thesis"],
	];
	return (
		<AbsoluteFill style={{ backgroundColor: SURFACE }}>
			{scenes.map(([Comp, dur, anchor], i) => {
				const from = f;
				f += dur;
				return (
					<Sequence key={i} from={from} durationInFrames={dur}>
						<Comp />
						<SceneVO anchor={anchor} />
					</Sequence>
				);
			})}
		</AbsoluteFill>
	);
};
