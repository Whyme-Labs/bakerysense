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
// HYBRID product walkthrough: REAL app UI (in a browser frame, zoomed, with
// callouts) is the star; motion graphics carry only the conceptual beats
// (the daily gamble, the nightly self-check loop, the close). Shows a
// complete, shipped product — not a mockup.
// ---------------------------------------------------------------------------

const INK = "oklch(0.18 0.01 60)";
const SURFACE = "oklch(0.985 0.012 85)";
const AMBER = "oklch(0.76 0.14 70)";
const AMBER_D = "oklch(0.64 0.13 60)";
const GREEN = "oklch(0.62 0.13 150)";
const RED = "oklch(0.58 0.18 25)";
const MUTED = "oklch(0.62 0.02 60)";
const CREAMTX = "oklch(0.92 0.02 80)";
const FONT = "Geist, Inter, system-ui, sans-serif";
const MONO = "Geist Mono, ui-monospace, monospace";

const FPS = 30;
const VO_TAIL = 22;
const EASE = Easing.bezier(0.16, 1, 0.3, 1);

interface VoEntry { anchor: string; audio_file: string; duration_ms: number }
const voByAnchor = new Map<string, VoEntry>((voManifest as VoEntry[]).map((v) => [v.anchor, v]));
function voFrames(a: string): number {
	const e = voByAnchor.get(a);
	return e ? Math.ceil((e.duration_ms / 1000) * FPS) + VO_TAIL : 0;
}
const dur = (a: string, min: number) => Math.max(min, voFrames(a));

// Recorded clip lengths (seconds) — rich natural-speed interactions.
const CLIP_SEC: Record<string, number> = { plan: 27.64, input: 19.08, review: 17.44, approve: 10.52 };

const D = {
	cold: dur("cold", 200),
	plan: dur("plan", 240),
	input: dur("input", 170),
	loop: dur("loop", 230),
	review: dur("review", 260),
	approve: dur("approve", 190),
	skills: dur("skills", 220),
	diverge: dur("diverge", 230),
	thesis: dur("thesis", 200),
};
const BRAND_FRAMES = 60;
export const HARNESS_STORY_FRAMES = BRAND_FRAMES + Object.values(D).reduce((a, b) => a + b, 0);

const SceneVO: React.FC<{ anchor: string }> = ({ anchor }) => {
	const e = voByAnchor.get(anchor);
	return e ? <Audio src={staticFile(`vo-harness/${e.audio_file}`)} /> : null;
};

function env(frame: number, d: number, fade = 12): number {
	return interpolate(frame, [0, fade, d - fade, d], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}
function useSpring(delay = 0, damping = 200) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return spring({ frame: frame - delay, fps, config: { damping } });
}

const Backdrop: React.FC<{ dark?: boolean }> = ({ dark }) => {
	const frame = useCurrentFrame();
	const x = interpolate(frame, [0, HARNESS_STORY_FRAMES], [35, 65]);
	const y = interpolate(frame, [0, HARNESS_STORY_FRAMES], [42, 58]);
	return <AbsoluteFill style={{ background: dark
		? `radial-gradient(120% 120% at ${x}% ${y}%, oklch(0.26 0.03 60), oklch(0.15 0.02 60) 62%, oklch(0.11 0.01 60))`
		: `radial-gradient(120% 120% at ${x}% ${y}%, oklch(0.99 0.02 88), oklch(0.96 0.03 82) 55%, oklch(0.93 0.045 76))` }} />;
};

const SceneTitle: React.FC<{ kicker: string; title: string; dark?: boolean }> = ({ kicker, title, dark }) => {
	const s = useSpring(0);
	return (
		<div style={{ position: "absolute", top: 40, width: "100%", textAlign: "center", opacity: s, transform: `translateY(${interpolate(s, [0, 1], [-16, 0])}px)`, zIndex: 5 }}>
			<div style={{ fontFamily: MONO, fontSize: 15, letterSpacing: "0.16em", textTransform: "uppercase", color: AMBER }}>{kicker}</div>
			<div style={{ fontFamily: FONT, fontSize: 34, fontWeight: 700, marginTop: 6, color: dark ? "#fff8ee" : INK }}>{title}</div>
		</div>
	);
};

// Caption tag (INPUT/OUTPUT/...) that slides up at the bottom.
const TagChip: React.FC<{ label: string; text: string; color: string; delay?: number }> = ({ label, text, color, delay = 14 }) => {
	const s = useSpring(delay, 160);
	return (
		<div style={{ position: "absolute", bottom: 44, width: "100%", textAlign: "center", opacity: s, transform: `translateY(${interpolate(s, [0, 1], [18, 0])}px)`, zIndex: 5 }}>
			<span style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "10px 20px", borderRadius: 999, background: "oklch(0.20 0.02 60)", border: `1px solid ${color}` }}>
				<span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color, letterSpacing: "0.08em" }}>{label}</span>
				<span style={{ fontFamily: FONT, fontSize: 17, color: "#fff8ee" }}>{text}</span>
			</span>
		</div>
	);
};

// macOS-style browser window frame around real app footage.
const BrowserFrame: React.FC<{ children: React.ReactNode; appear?: number }> = ({ children, appear = 0 }) => {
	const s = useSpring(appear, 200);
	return (
		<div style={{ width: 1080, transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px) scale(${interpolate(s, [0, 1], [0.96, 1])})`, opacity: s, borderRadius: 14, overflow: "hidden", boxShadow: "0 40px 100px oklch(0.08 0.02 60 / 0.65)", border: "1px solid oklch(0.4 0.02 60)" }}>
			<div style={{ height: 40, background: "oklch(0.22 0.01 60)", display: "flex", alignItems: "center", padding: "0 16px", gap: 8 }}>
				<span style={{ width: 12, height: 12, borderRadius: 999, background: "#ff5f57" }} />
				<span style={{ width: 12, height: 12, borderRadius: 999, background: "#febc2e" }} />
				<span style={{ width: 12, height: 12, borderRadius: 999, background: "#28c840" }} />
				<div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
					<div style={{ background: "oklch(0.16 0.01 60)", borderRadius: 7, padding: "5px 16px", fontFamily: MONO, fontSize: 13, color: "oklch(0.7 0.02 70)" }}>bakerysense.swmengappdev.workers.dev</div>
				</div>
			</div>
			{children}
		</div>
	);
};

// A real recorded clip, stretched to fill the scene, framed + slow zoom.
const RealClip: React.FC<{ src: string; clipKey: string; sceneFrames: number; kicker: string; title: string; tagLabel: string; tag: string; tagColor: string }>
	= ({ src, clipKey, sceneFrames, kicker, title, tagLabel, tag, tagColor }) => {
	const frame = useCurrentFrame();
	const opacity = env(frame, sceneFrames);
	const clipFrames = Math.ceil(CLIP_SEC[clipKey] * FPS);
	// Fit the clip into the scene with at most mild speed change, so the full
	// interaction (including the payoff) plays and never freezes or drags.
	const rate = Math.max(0.7, Math.min(1.4, clipFrames / sceneFrames));
	const zoom = interpolate(frame, [10, sceneFrames], [1.0, 1.05], { extrapolateRight: "clamp", easing: EASE });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<SceneTitle kicker={kicker} title={title} dark />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingTop: 36 }}>
				<div style={{ transform: `scale(${zoom})` }}>
					<BrowserFrame appear={6}>
						<OffthreadVideo src={staticFile(src)} playbackRate={rate} style={{ width: "100%", display: "block" }} />
					</BrowserFrame>
				</div>
			</AbsoluteFill>
			<TagChip label={tagLabel} text={tag} color={tagColor} />
		</AbsoluteFill>
	);
};

const Loaf: React.FC<{ size?: number; color?: string; opacity?: number }> = ({ size = 40, color = AMBER_D, opacity = 1 }) => (
	<svg width={size} height={size * 0.7} viewBox="0 0 40 28" style={{ opacity }}>
		<ellipse cx="20" cy="18" rx="18" ry="9" fill={color} />
		<path d="M10 14 L14 9 M18 14 L22 8 M26 14 L30 9" stroke={SURFACE} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
	</svg>
);

// ---- 0. Brand intro ---------------------------------------------------------
const BrandIntro: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, BRAND_FRAMES, 10);
	const s = useSpring(0);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
				<Img src={staticFile("logo-full.png")} style={{ width: 540, transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})` }} />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- 1. Hook — the daily gamble (motion) -----------------------------------
const Hook: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.cold);
	const q = useSpring(6);
	const leftIn = interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const rightIn = interpolate(frame, [56, 76], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const wasteN = Math.round(interpolate(frame, [62, 100], [0, 84], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }));
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
				<div style={{ opacity: q, transform: `translateY(${interpolate(q, [0, 1], [18, 0])}px)`, textAlign: "center", marginBottom: 44 }}>
					<div style={{ fontFamily: MONO, fontSize: 16, color: MUTED, letterSpacing: "0.12em", textTransform: "uppercase" }}>Every morning, the same gamble</div>
					<div style={{ fontFamily: FONT, fontSize: 60, fontWeight: 800, color: INK, marginTop: 8, letterSpacing: "-0.02em" }}>How much do I bake?</div>
				</div>
				<div style={{ display: "flex", gap: 40 }}>
					<div style={{ opacity: leftIn, transform: `translateX(${interpolate(leftIn, [0, 1], [-30, 0])}px)`, width: 380, background: "#fff", borderRadius: 16, padding: 24, border: "1px solid oklch(0.9 0.02 70)", boxShadow: "0 14px 40px oklch(0.5 0.05 70 / 0.12)" }}>
						<div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: INK }}>Bake too much</div>
						<div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "16px 0" }}>
							{Array.from({ length: 14 }).map((_, i) => {
								const wasted = i >= 9;
								const fade = wasted ? interpolate(frame, [70, 95], [1, 0.28], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
								return <Loaf key={i} size={34} color={wasted ? "oklch(0.6 0.02 60)" : AMBER_D} opacity={fade} />;
							})}
						</div>
						<div style={{ fontFamily: MONO, fontSize: 18, color: RED, fontWeight: 700 }}>RM {wasteN} binned</div>
					</div>
					<div style={{ opacity: rightIn, transform: `translateX(${interpolate(rightIn, [0, 1], [30, 0])}px)`, width: 380, background: "#fff", borderRadius: 16, padding: 24, border: "1px solid oklch(0.9 0.02 70)", boxShadow: "0 14px 40px oklch(0.5 0.05 70 / 0.12)" }}>
						<div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: INK }}>Bake too little</div>
						<div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "16px 0", minHeight: 56 }}>
							{Array.from({ length: 5 }).map((_, i) => <Loaf key={i} size={34} color={AMBER_D} />)}
							<div style={{ alignSelf: "center", fontFamily: MONO, fontSize: 13, color: MUTED }}>· sold out 11am</div>
						</div>
						<div style={{ fontFamily: MONO, fontSize: 18, color: RED, fontWeight: 700 }}>customers turned away</div>
					</div>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- The loop diagram (motion) ---------------------------------------------
const LoopDiagram: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = env(frame, D.loop);
	const nodes = [
		{ label: "predict", sub: "tomorrow's plan" },
		{ label: "check", sub: "vs what sold" },
		{ label: "fix", sub: "tested on past sales" },
		{ label: "approve", sub: "you decide" },
	];
	const cx = 720, cy = 500, r = 215;
	const active = Math.floor(interpolate(frame, [40, D.loop - 20], [0, 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) % 4;
	const titleS = spring({ frame, fps, config: { damping: 200 } });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<div style={{ position: "absolute", top: 58, width: "100%", textAlign: "center", opacity: titleS, transform: `translateY(${interpolate(titleS, [0, 1], [18, 0])}px)` }}>
				<div style={{ fontFamily: MONO, fontSize: 17, color: AMBER, letterSpacing: "0.18em", textTransform: "uppercase" }}>It gets smarter on its own</div>
				<div style={{ fontFamily: FONT, fontSize: 42, fontWeight: 700, color: "#fff8ee", marginTop: 8 }}>Every night, it checks its own work</div>
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
						<div style={{ fontSize: 13, color: on ? "oklch(0.3 0.06 60)" : MUTED, marginTop: 2, fontFamily: MONO }}>{n.sub}</div>
					</div>
				);
			})}
		</AbsoluteFill>
	);
};

// ---- Under the hood — every fix is a versioned skill (motion) --------------
const SkillsBeat: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = env(frame, D.skills);
	const versions = [
		{ v: "v1", note: "baseline" },
		{ v: "v2", note: "Wed −20%" },
		{ v: "v3", note: "Fri +12%" },
	];
	const traits = ["version-controlled", "validated on real sales", "reversible"];
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<SceneTitle kicker="Under the hood" title="Every fix is a versioned skill" dark />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 44, paddingTop: 40 }}>
				{/* skill name */}
				<div style={{ fontFamily: MONO, fontSize: 18, color: "oklch(0.72 0.02 70)" }}>forecast.skill</div>
				{/* version lineage */}
				<div style={{ display: "flex", alignItems: "center", gap: 0 }}>
					{versions.map((ver, i) => {
						const s = spring({ frame: frame - 16 - i * 22, fps, config: { damping: 160 } });
						const latest = i === versions.length - 1;
						const lit = latest ? interpolate(frame, [16 + i * 22 + 10, 16 + i * 22 + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
						return (
							<React.Fragment key={ver.v}>
								{i > 0 && (
									<svg width={70} height={20} style={{ opacity: s }}>
										<line x1={4} y1={10} x2={56} y2={10} stroke={AMBER} strokeWidth={3} strokeLinecap="round" />
										<path d={`M 56 4 L 66 10 L 56 16`} fill="none" stroke={AMBER} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								)}
								<div style={{ opacity: s, transform: `scale(${interpolate(s, [0, 1], [0.85, 1])})`, width: 176, height: 132, borderRadius: 16, background: latest ? AMBER : "oklch(0.24 0.02 60)", border: `2px solid ${latest ? AMBER : "oklch(0.4 0.02 60)"}`, boxShadow: latest ? `0 0 ${28 * lit}px oklch(0.76 0.14 70 / 0.55)` : "none", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 6 }}>
									<div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 800, color: latest ? INK : "oklch(0.82 0.02 70)" }}>{ver.v}</div>
									<div style={{ fontFamily: MONO, fontSize: 15, color: latest ? "oklch(0.3 0.06 60)" : MUTED }}>{ver.note}</div>
									{latest && <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "oklch(0.32 0.08 60)", textTransform: "uppercase", letterSpacing: "0.06em" }}>active</div>}
								</div>
							</React.Fragment>
						);
					})}
				</div>
				{/* traits */}
				<div style={{ display: "flex", gap: 14 }}>
					{traits.map((t, i) => {
						const s = spring({ frame: frame - 80 - i * 10, fps, config: { damping: 150 } });
						return (
							<span key={t} style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [12, 0])}px)`, fontFamily: MONO, fontSize: 15, color: CREAMTX, background: "oklch(0.22 0.02 60)", border: "1px solid oklch(0.4 0.02 60)", borderRadius: 999, padding: "8px 16px" }}>
								<span style={{ color: GREEN, fontWeight: 700 }}>✓</span> {t}
							</span>
						);
					})}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- Divergence — large readable native cards (styled like the app) --------
const Divergence: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = env(frame, D.diverge);
	const titleS = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
	const card = (
		shop: string, day: string, pct: string, wapeFrom: string, wapeTo: string, appear: number, align: "left" | "right",
	) => {
		const s = spring({ frame: frame - appear, fps, config: { damping: 200 } });
		const dx = interpolate(s, [0, 1], [align === "left" ? -50 : 50, 0]);
		return (
			<div style={{ width: 540, opacity: s, transform: `translateX(${dx}px)`, background: "#fff", borderRadius: 18, padding: "30px 34px", border: `2px solid ${AMBER}`, boxShadow: "0 24px 60px oklch(0.08 0.02 60 / 0.5)" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
					<div style={{ fontFamily: MONO, fontSize: 16, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>forecast · {shop}</div>
					<div style={{ fontFamily: MONO, fontSize: 16, color: MUTED }}>WAPE <span style={{ color: MUTED }}>{wapeFrom}</span> <span style={{ color: GREEN, fontWeight: 700 }}>{wapeTo}</span></div>
				</div>
				<div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: INK, marginTop: 14 }}>Croissants, every <span style={{ color: AMBER_D }}>{day}</span></div>
				<div style={{ fontFamily: FONT, fontSize: 18, color: "oklch(0.45 0.02 60)", marginTop: 6 }}>forecast ran {pct} too high</div>
				<div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, fontFamily: MONO, fontSize: 26 }}>
					<span style={{ color: MUTED }}>bake</span>
					<span style={{ color: RED, textDecoration: "line-through" }}>1.00×</span>
					<span style={{ color: MUTED }}>→</span>
					<span style={{ color: GREEN, fontWeight: 800 }}>0.80×</span>
				</div>
			</div>
		);
	};
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", opacity: titleS }}>
				<div style={{ fontFamily: MONO, fontSize: 16, color: AMBER, letterSpacing: "0.16em", textTransform: "uppercase" }}>Same app · different shops</div>
				<div style={{ fontFamily: FONT, fontSize: 42, fontWeight: 700, color: "#fff8ee", marginTop: 8 }}>Each one learns its own habits</div>
			</div>
			<AbsoluteFill style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 28, paddingTop: 56 }}>
				<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
					<div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: "#fff8ee" }}>Bukit Bintang</div>
					{card("Bukit Bintang", "Wednesday", "20%", "3.0%", "2.0%", 18, "left")}
				</div>
				<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
					<div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: "#fff8ee" }}>Subang Jaya</div>
					{card("Subang Jaya", "Sunday", "23%", "3.4%", "2.2%", 40, "right")}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- Close (motion) ---------------------------------------------------------
const Thesis: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.thesis, 16);
	const a = useSpring(6); const b = useSpring(22); const c = useSpring(40);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 16 }}>
				<Img src={staticFile("logo-icon.png")} style={{ width: 130, marginBottom: 12, opacity: a, transform: `scale(${interpolate(a, [0, 1], [0.8, 1])})` }} />
				<div style={{ fontFamily: FONT, fontSize: 46, fontWeight: 800, color: "#fff8ee", opacity: b, transform: `translateY(${interpolate(b, [0, 1], [16, 0])}px)` }}>It doesn't just predict.</div>
				<div style={{ fontFamily: FONT, fontSize: 46, fontWeight: 800, color: AMBER, opacity: c, transform: `translateY(${interpolate(c, [0, 1], [16, 0])}px)` }}>It learns your bakery.</div>
				<div style={{ fontFamily: FONT, fontSize: 20, color: CREAMTX, marginTop: 14, opacity: c }}>Built on self-evolving skills.</div>
				<div style={{ fontFamily: MONO, fontSize: 16, color: "oklch(0.7 0.02 70)", marginTop: 14, opacity: c }}>bakerysense.swmengappdev.workers.dev</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- Assembly ---------------------------------------------------------------
export const HarnessStory: React.FC = () => {
	let f = 0;
	const scenes: { node: React.ReactNode; d: number; anchor: string }[] = [
		{ node: <BrandIntro />, d: BRAND_FRAMES, anchor: "" },
		{ node: <Hook />, d: D.cold, anchor: "cold" },
		{ node: <RealClip src="recordings/plan.webm" clipKey="plan" sceneFrames={D.plan} kicker="What you get" title="Tomorrow's bake plan" tagLabel="OUTPUT" tag="3 options per item · waste · stockout · units" tagColor={AMBER} />, d: D.plan, anchor: "plan" },
		{ node: <RealClip src="recordings/input.webm" clipKey="input" sceneFrames={D.input} kicker="Getting started" title="Connect your sales" tagLabel="INPUT" tag="a spreadsheet, or your till" tagColor={GREEN} />, d: D.input, anchor: "input" },
		{ node: <LoopDiagram />, d: D.loop, anchor: "loop" },
		{ node: <RealClip src="recordings/review.webm" clipKey="review" sceneFrames={D.review} kicker="It found a pattern" title="A correction, ready to review" tagLabel="RESULT" tag="held-out error 3.0% → 2.0%" tagColor={GREEN} />, d: D.review, anchor: "review" },
		{ node: <RealClip src="recordings/approve.webm" clipKey="approve" sceneFrames={D.approve} kicker="You decide" title="One tap to approve" tagLabel="ACTION" tag="next forecast uses the fix" tagColor={AMBER} />, d: D.approve, anchor: "approve" },
		{ node: <SkillsBeat />, d: D.skills, anchor: "skills" },
		{ node: <Divergence />, d: D.diverge, anchor: "diverge" },
		{ node: <Thesis />, d: D.thesis, anchor: "thesis" },
	];
	return (
		<AbsoluteFill style={{ backgroundColor: SURFACE }}>
			{scenes.map((sc, i) => {
				const from = f; f += sc.d;
				return <Sequence key={i} from={from} durationInFrames={sc.d}>{sc.node}<SceneVO anchor={sc.anchor} /></Sequence>;
			})}
		</AbsoluteFill>
	);
};
