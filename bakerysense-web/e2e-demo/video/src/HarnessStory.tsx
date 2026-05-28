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
// Cold-viewer-first, SHOW-don't-tell motion-graphic walkthrough.
// Brand → the daily gamble → what you get (a number) → setup → it learns
// (forecast vs actual chart) → the fix (waste bars closing) → you approve →
// every shop learns differently → close. All frame-driven (Remotion rules).
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

const D = {
	cold: dur("cold", 200),
	plan: dur("plan", 240),
	input: dur("input", 170),
	loop: dur("loop", 230),
	review: dur("review", 260),
	approve: dur("approve", 190),
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
		<div style={{ position: "absolute", top: 56, width: "100%", textAlign: "center", opacity: s, transform: `translateY(${interpolate(s, [0, 1], [-16, 0])}px)` }}>
			<div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: "0.16em", textTransform: "uppercase", color: AMBER }}>{kicker}</div>
			<div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 700, marginTop: 8, color: dark ? "#fff8ee" : INK }}>{title}</div>
		</div>
	);
};

// A brand bread/loaf "item" used to show quantities (waste, baked).
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

// ---- 1. Hook — the daily gamble --------------------------------------------
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
					{/* too much */}
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
					{/* too little */}
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

// ---- 2. What you get — the recommendation ----------------------------------
const WhatYouGet: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.plan);
	const n = Math.round(interpolate(frame, [24, 70], [0, 90], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }));
	const opts = [
		{ k: "Conservative", v: 75, sub: "low waste" },
		{ k: "Balanced", v: 90, sub: "recommended", on: true },
		{ k: "Aggressive", v: 121, sub: "never sell out" },
	];
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<SceneTitle kicker="What you get" title="Tomorrow's bake plan, decided" />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", paddingTop: 70 }}>
				<div style={{ display: "flex", alignItems: "baseline", gap: 18, fontFamily: FONT }}>
					<span style={{ fontSize: 30, color: MUTED }}>Bake</span>
					<span style={{ fontSize: 150, fontWeight: 800, color: AMBER_D, lineHeight: 1, letterSpacing: "-0.03em" }}>{n}</span>
					<span style={{ fontSize: 34, color: INK, fontWeight: 600 }}>croissants</span>
				</div>
				<div style={{ fontFamily: MONO, fontSize: 16, color: MUTED, marginTop: 6 }}>not 120 like yesterday — that binned 30</div>
				<div style={{ display: "flex", gap: 18, marginTop: 40 }}>
					{opts.map((o, i) => {
						const s = useSpring(34 + i * 8, 160);
						return (
							<div key={o.k} style={{ width: 240, opacity: s, transform: `translateY(${interpolate(s, [0, 1], [20, 0])}px)`, background: o.on ? AMBER : "#fff", border: `2px solid ${o.on ? AMBER : "oklch(0.9 0.02 70)"}`, borderRadius: 14, padding: "16px 20px", boxShadow: o.on ? "0 14px 40px oklch(0.76 0.14 70 / 0.3)" : "0 8px 24px oklch(0.5 0.05 70 / 0.08)" }}>
								<div style={{ fontFamily: MONO, fontSize: 13, color: o.on ? "oklch(0.32 0.08 60)" : MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>{o.k}</div>
								<div style={{ fontFamily: FONT, fontSize: 44, fontWeight: 800, color: INK }}>{o.v}</div>
								<div style={{ fontFamily: FONT, fontSize: 14, color: o.on ? "oklch(0.32 0.08 60)" : MUTED }}>{o.sub}</div>
							</div>
						);
					})}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- 3. Getting started — data flows in ------------------------------------
const GettingStarted: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.input);
	const rows = ["2026-05-12  CROISSANT  88", "2026-05-13  BAGUETTE  140", "2026-05-14  CROISSANT  95", "2026-05-15  PAIN AU CHOC  72", "2026-05-16  CROISSANT  130"];
	const logoS = useSpring(20, 160);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<SceneTitle kicker="Getting started" title="Connect your sales — that's it" dark />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 90, paddingTop: 60 }}>
				<div style={{ width: 460 }}>
					<div style={{ fontFamily: MONO, fontSize: 14, color: MUTED, marginBottom: 10 }}>sales.csv</div>
					{rows.map((r, i) => {
						const a = interpolate(frame, [20 + i * 8, 40 + i * 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
						return <div key={i} style={{ opacity: a, transform: `translateX(${interpolate(a, [0, 1], [-24, 0])}px)`, fontFamily: MONO, fontSize: 16, color: CREAMTX, background: "oklch(0.24 0.02 60)", border: "1px solid oklch(0.36 0.02 60)", borderRadius: 8, padding: "9px 14px", marginBottom: 7 }}>{r}</div>;
					})}
				</div>
				<div style={{ fontFamily: MONO, fontSize: 40, color: AMBER, opacity: interpolate(frame, [50, 65], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>→</div>
				<div style={{ opacity: logoS, transform: `scale(${interpolate(logoS, [0, 1], [0.85, 1])})`, textAlign: "center" }}>
					<Img src={staticFile("logo-icon.png")} style={{ width: 150 }} />
					<div style={{ fontFamily: MONO, fontSize: 15, color: AMBER, marginTop: 10 }}>two weeks is enough</div>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- chart helpers ----------------------------------------------------------
// Animated bar pair (forecast vs actual) with a waste gap that can close.
const CHART = { x: 320, y: 250, w: 800, h: 360 };

// ---- 4. The magic — it checks itself ---------------------------------------
const ItLearns: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.loop);
	// 7 days; actual sales (green) with a Wednesday dip; forecast flat-high (amber).
	const days = ["M", "T", "W", "T", "F", "S", "S"];
	const actual = [96, 92, 78, 95, 110, 130, 88];
	const forecast = 100;
	const maxV = 140;
	const draw = interpolate(frame, [20, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
	const colW = CHART.w / days.length;
	const yOf = (v: number) => CHART.y + CHART.h - (v / maxV) * CHART.h;
	const fLineY = yOf(forecast);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<SceneTitle kicker="The part that's different" title="Every night, it checks its own guesses" dark />
			<svg width={1440} height={900} style={{ position: "absolute", inset: 0 }}>
				{/* forecast flat line */}
				<line x1={CHART.x} y1={fLineY} x2={CHART.x + CHART.w * draw} y2={fLineY} stroke={AMBER} strokeWidth={4} strokeDasharray="2 8" strokeLinecap="round" />
				{/* actual sales line */}
				<polyline fill="none" stroke={GREEN} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"
					points={actual.map((v, i) => `${CHART.x + colW * (i + 0.5)},${yOf(v)}`).filter((_, i) => i / days.length <= draw).join(" ")} />
				{actual.map((v, i) => {
					const show = i / days.length <= draw ? 1 : 0;
					return <circle key={i} cx={CHART.x + colW * (i + 0.5)} cy={yOf(v)} r={6} fill={GREEN} opacity={show} />;
				})}
				{/* Wednesday gap highlight */}
				{(() => { const i = 2; const gap = interpolate(frame, [90, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }); const cx = CHART.x + colW * (i + 0.5);
					return <g opacity={gap}><line x1={cx} y1={fLineY} x2={cx} y2={yOf(actual[i])} stroke={RED} strokeWidth={3} /><rect x={cx - 30} y={(fLineY + yOf(actual[i])) / 2 - 16} width={60} height={28} rx={6} fill={RED} /></g>; })()}
			</svg>
			<div style={{ position: "absolute", left: CHART.x + 2.5 * (CHART.w / 7) + 36, top: (yOf(100) + yOf(78)) / 2 - 14, opacity: interpolate(frame, [108, 125], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), fontFamily: MONO, fontSize: 15, color: "#fff8ee" }}>over-baked Wednesday</div>
			<div style={{ position: "absolute", top: yOf(100) - 30, left: CHART.x - 110, fontFamily: MONO, fontSize: 14, color: AMBER }}>forecast</div>
			<div style={{ position: "absolute", top: yOf(130) - 4, left: CHART.x + CHART.w + 16, fontFamily: MONO, fontSize: 14, color: GREEN }}>actually<br />sold</div>
			<div style={{ position: "absolute", bottom: 150, width: "100%", textAlign: "center", fontFamily: FONT, fontSize: 22, color: CREAMTX, opacity: interpolate(frame, [120, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>It keeps guessing 100. It keeps selling ~78. <span style={{ color: AMBER }}>Same miss, every week.</span></div>
		</AbsoluteFill>
	);
};

// ---- 5. The fix — waste bars close -----------------------------------------
const TheFix: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.review);
	const weeks = 5;
	const actual = 80, forecastBefore = 100;
	const maxV = 120;
	const bx = 360, by = 230, bw = 720, bh = 330;
	const slot = bw / weeks;
	const yOf = (v: number) => by + bh - (v / maxV) * bh;
	const grow = interpolate(frame, [16, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
	const fix = interpolate(frame, [110, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
	const fc = forecastBefore - (forecastBefore - actual) * fix; // forecast bar drops to actual
	const wape = (3.0 - 1.0 * fix).toFixed(1);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<SceneTitle kicker="The fix" title="It spots the pattern, and corrects it" dark />
			<svg width={1440} height={900} style={{ position: "absolute", inset: 0 }}>
				{Array.from({ length: weeks }).map((_, i) => {
					const cx = bx + slot * i + slot / 2;
					const aBarH = (actual / maxV) * bh * grow;
					const fBarH = (fc / maxV) * bh * grow;
					return (
						<g key={i}>
							{/* waste gap (forecast above actual) */}
							<rect x={cx - 26} y={yOf(fc)} width={52} height={Math.max(0, yOf(actual) - yOf(fc))} fill={RED} opacity={(1 - fix) * 0.85} rx={4} />
							{/* forecast bar (amber, drops on fix) */}
							<rect x={cx - 26} y={by + bh - fBarH} width={52} height={fBarH} rx={4} fill={AMBER} opacity={0.5} />
							{/* actual bar (green) */}
							<rect x={cx - 26} y={by + bh - aBarH} width={52} height={aBarH} rx={4} fill={GREEN} />
							<text x={cx} y={by + bh + 26} textAnchor="middle" fontFamily={MONO} fontSize={14} fill={MUTED}>Wed {i + 1}</text>
						</g>
					);
				})}
			</svg>
			<div style={{ position: "absolute", top: by - 6, left: bx + bw + 28, fontFamily: MONO, fontSize: 15, opacity: 1 - fix }}>
				<div style={{ color: AMBER }}>forecast 100</div>
				<div style={{ color: GREEN, marginTop: 4 }}>sold 80</div>
				<div style={{ color: RED, marginTop: 4 }}>20% wasted</div>
			</div>
			<div style={{ position: "absolute", bottom: 150, width: "100%", textAlign: "center", opacity: interpolate(frame, [120, 145], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), fontFamily: FONT, fontSize: 24, color: CREAMTX }}>
				Wednesday forecast <span style={{ color: GREEN, fontWeight: 700 }}>−20%</span> · tested on past sales · error <span style={{ fontFamily: MONO, color: GREEN }}>{wape}%</span>
			</div>
		</AbsoluteFill>
	);
};

// ---- 6. You decide — approve -----------------------------------------------
const YouDecide: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.approve);
	const card = useSpring(8, 180);
	const press = interpolate(frame, [70, 80], [1, 0.96], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const done = frame > 84;
	const ripple = interpolate(frame, [72, 120], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop />
			<SceneTitle kicker="You stay in control" title="It proposes. You approve." />
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingTop: 60 }}>
				<div style={{ width: 720, opacity: card, transform: `translateY(${interpolate(card, [0, 1], [22, 0])}px)`, background: "#fff", borderRadius: 18, padding: 30, border: "1px solid oklch(0.9 0.02 70)", boxShadow: "0 20px 60px oklch(0.5 0.05 70 / 0.16)" }}>
					<div style={{ fontFamily: MONO, fontSize: 14, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>Proposed correction · Bukit Bintang</div>
					<div style={{ fontFamily: FONT, fontSize: 28, fontWeight: 700, color: INK, marginTop: 8 }}>Bake 20% fewer croissants on Wednesdays</div>
					<div style={{ fontFamily: MONO, fontSize: 15, color: MUTED, marginTop: 6 }}>validated on 8 weeks of sales · error 3.0% → 2.0%</div>
					<div style={{ display: "flex", gap: 14, marginTop: 24, alignItems: "center" }}>
						<div style={{ position: "relative" }}>
							<div style={{ position: "absolute", inset: 0, borderRadius: 12, border: `3px solid ${GREEN}`, opacity: (1 - ripple) * 0.8, transform: `scale(${1 + ripple})` }} />
							<div style={{ transform: `scale(${press})`, background: done ? GREEN : AMBER, color: done ? "#fff" : INK, borderRadius: 12, padding: "14px 30px", fontFamily: FONT, fontSize: 20, fontWeight: 700 }}>{done ? "✓ Approved" : "Approve"}</div>
						</div>
						<div style={{ background: "#fff", border: "1px solid oklch(0.88 0.02 70)", borderRadius: 12, padding: "14px 24px", fontFamily: FONT, fontSize: 20, color: MUTED }}>Reject</div>
						{done && <div style={{ fontFamily: MONO, fontSize: 16, color: GREEN, marginLeft: 8, opacity: interpolate(frame, [86, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>applied to tomorrow's plan</div>}
					</div>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- 7. Every shop learns differently --------------------------------------
const MiniChart: React.FC<{ dipDay: number; label: string; appear: number }> = ({ dipDay, label, appear }) => {
	const frame = useCurrentFrame();
	const s = useSpring(appear, 200);
	const fix = interpolate(frame, [appear + 30, appear + 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
	const days = ["M", "T", "W", "T", "F", "S", "S"];
	const w = 460, h = 200, pad = 10;
	const slot = (w - pad * 2) / 7;
	const base = 70;
	return (
		<div style={{ flex: 1, opacity: s, transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
			<div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: "#fff8ee" }}>{label}</div>
			<svg width={w} height={h}>
				{days.map((dd, i) => {
					const over = i === dipDay;
					const fH = over ? (100 / 130) * (h - 40) : (base / 130) * (h - 40);
					const aH = over ? (80 / 130) * (h - 40) : (base / 130) * (h - 40);
					const x = pad + slot * i + slot / 2;
					const fNow = over ? fH - (fH - aH) * fix : fH;
					return (
						<g key={i}>
							{over && <rect x={x - 14} y={h - 24 - fNow} width={28} height={Math.max(0, fNow - aH)} fill={RED} opacity={(1 - fix) * 0.8} rx={3} />}
							<rect x={x - 14} y={h - 24 - aH} width={28} height={aH} rx={3} fill={over ? GREEN : "oklch(0.4 0.02 60)"} />
							<text x={x} y={h - 6} textAnchor="middle" fontFamily={MONO} fontSize={12} fill={over ? AMBER : MUTED}>{dd}</text>
						</g>
					);
				})}
			</svg>
			<div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: AMBER }}>learned {days[dipDay] === "W" ? "Wednesdays" : "Sundays"}</div>
		</div>
	);
};

const Divergence: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = env(frame, D.diverge);
	return (
		<AbsoluteFill style={{ opacity }}>
			<Backdrop dark />
			<SceneTitle kicker="Same system · different shops" title="Each shop learns its own habits" dark />
			<AbsoluteFill style={{ flexDirection: "row", alignItems: "center", paddingTop: 70, paddingLeft: 70, paddingRight: 70 }}>
				<MiniChart dipDay={2} label="Bukit Bintang" appear={16} />
				<div style={{ width: 2, height: 300, background: "oklch(0.4 0.02 60)" }} />
				<MiniChart dipDay={6} label="Subang Jaya" appear={40} />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---- 8. Close ---------------------------------------------------------------
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
				<div style={{ fontFamily: MONO, fontSize: 17, color: CREAMTX, marginTop: 18, opacity: c }}>bakerysense.swmengappdev.workers.dev</div>
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
		{ node: <WhatYouGet />, d: D.plan, anchor: "plan" },
		{ node: <GettingStarted />, d: D.input, anchor: "input" },
		{ node: <ItLearns />, d: D.loop, anchor: "loop" },
		{ node: <TheFix />, d: D.review, anchor: "review" },
		{ node: <YouDecide />, d: D.approve, anchor: "approve" },
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
