import type { SceneVariant } from "./sceneVariant";

export const VIEW_BOX = "0 0 1440 900";
export const SUN = { cx: 980, cy: 470, r: 70, opacity: 0.85 } as const;
export const paths = {
  far: "M0 520 L160 440 L290 490 L430 400 L560 470 L700 380 L860 460 L1000 410 L1150 470 L1300 420 L1440 470 L1440 900 L0 900 Z",
  mid: "M0 600 L120 540 L240 580 L380 510 L520 590 L660 540 L820 610 L960 550 L1120 600 L1260 540 L1440 590 L1440 900 L0 900 Z",
  near: "M0 700 L60 660 L80 680 L100 640 L130 690 L200 650 L260 700 L340 670 L420 720 L560 690 L700 730 L840 690 L980 720 L1080 680 L1120 650 L1140 690 L1200 660 L1260 700 L1320 650 L1360 690 L1440 670 L1440 900 L0 900 Z",
} as const;

export const scenes: Record<
  SceneVariant,
  { sky: string; sun: string; far: string; mid: string; near: string }
> = {
  dusk: {
    sky: "linear-gradient(180deg, #2E2A45 0%, #6E4E6B 38%, #C98478 62%, #E7AE88 78%)",
    sun: "#FFD3A6",
    far: "#7A5A6E",
    mid: "#4A3A52",
    near: "#221C2C",
  },
  night: {
    sky: "linear-gradient(180deg, #0E1222 0%, #1B2140 50%, #34355A 78%)",
    sun: "#E8E6F4",
    far: "#2C2F4C",
    mid: "#1E2038",
    near: "#0F1020",
  },
  morning: {
    sky: "linear-gradient(180deg, #4F6E9A 0%, #8BA6C4 45%, #E8C9A6 78%)",
    sun: "#FFF1D6",
    far: "#6F86A0",
    mid: "#4C5F78",
    near: "#28323F",
  },
};
