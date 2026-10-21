// The one quiet row reveal: a row fades in and settles 4px, staggered by
// the parent. Apply with Motion's `variants`:
//
//   <motion.tbody variants={rowRevealContainer} initial="hidden" animate="visible">
//     <motion.tr variants={rowReveal} />
//
// <ThemeProvider> wraps the app in MotionConfig reducedMotion="user", so
// under prefers-reduced-motion the y-shift is dropped and only the fade stays.
import type { Variants } from "motion/react";
import { duration, easing } from "./tokens";

const REVEAL_OFFSET = 4;
const STAGGER = 0.03;

export const rowRevealContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER } },
};

export const rowReveal: Variants = {
  hidden: { opacity: 0, y: REVEAL_OFFSET },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: [...easing.enter] },
  },
};
