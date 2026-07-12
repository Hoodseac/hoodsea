"use client";

import { motion, useReducedMotion } from "framer-motion";

const SIGNATURE = [0.22, 1, 0.36, 1] as const;

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const word = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: SIGNATURE } },
};

/** Reveals its text word by word as it scrolls into view. */
export function RevealText({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();

  // Reduced motion: render the final text with no transforms.
  if (reduce) {
    return <span className={className}>{text}</span>;
  }

  return (
    <motion.span
      className={className}
      style={{ display: "inline-block" }}
      variants={container}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-12%" }}
    >
      {text.split(" ").map((w, i) => (
        <motion.span key={i} variants={word} style={{ display: "inline-block", whiteSpace: "pre" }}>
          {w}{" "}
        </motion.span>
      ))}
    </motion.span>
  );
}
