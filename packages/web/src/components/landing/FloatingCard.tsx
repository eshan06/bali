'use client';

import type { RefObject } from 'react';
import { motion, useScroll, useSpring, useTransform } from 'framer-motion';

type Props = {
  /** The section whose scroll position drives the animation. */
  targetRef: RefObject<HTMLElement>;
  src: string;
  alt: string;
  maxHeight?: number;
};

/**
 * Card image that tilts and drifts in 3D as its section scrolls through the
 * viewport. Progress runs 0 → 1 from the moment the section's top enters the
 * bottom of the viewport until its bottom leaves the top.
 */
export default function FloatingCard({ targetRef, src, alt, maxHeight = 450 }: Props) {
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ['start end', 'end start'],
  });

  // Smooth the raw scroll value so the motion feels weighted rather than 1:1.
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.6 });

  const rotateX = useTransform(progress, [0, 0.5, 1], [16, 0, -12]);
  const rotateY = useTransform(progress, [0, 0.5, 1], [-24, 0, 22]);
  const y = useTransform(progress, [0, 1], [36, -36]);
  const x = useTransform(progress, [0, 0.5, 1], [-12, 0, 12]);

  return (
    <div style={{ perspective: 1200, width: '100%' }} className="flex items-center justify-center">
      <motion.img
        src={src}
        alt={alt}
        className="rounded-2xl object-contain"
        style={{
          maxHeight,
          width: '100%',
          rotateX,
          rotateY,
          x,
          y,
          transformStyle: 'preserve-3d',
          boxShadow: '0 32px 80px rgba(0,0,0,0.14)',
          willChange: 'transform',
        }}
      />
    </div>
  );
}
