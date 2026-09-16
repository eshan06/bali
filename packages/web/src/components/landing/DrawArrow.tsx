'use client';

import { motion, type Variants } from 'framer-motion';

type Props = {
  /** Mirror the curve vertically so consecutive arrows don't look identical. */
  flip?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Hand-drawn style curved arrow that "draws" itself in the first time it
 * scrolls into view. Thin, light gray, no fill.
 */
export default function DrawArrow({ flip = false, className, style }: Props) {
  const stroke = '#C9CDD6';
  const draw: Variants = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: (delay: number) => ({
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { delay, duration: 1.1, ease: 'easeInOut' },
        opacity: { delay, duration: 0.2 },
      },
    }),
  };

  return (
    <motion.svg
      viewBox="0 0 140 110"
      width={140}
      height={110}
      fill="none"
      className={className}
      style={{ ...style, transform: flip ? 'scaleY(-1)' : undefined }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.6 }}
      aria-hidden="true"
    >
      {/* curve */}
      <motion.path
        d="M 10 34 C 48 22, 62 92, 122 76"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={draw}
        custom={0}
      />
      {/* arrowhead */}
      <motion.path
        d="M 108 60 L 124 76 L 106 88"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={draw}
        custom={0.95}
      />
    </motion.svg>
  );
}
