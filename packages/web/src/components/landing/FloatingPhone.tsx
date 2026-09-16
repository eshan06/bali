'use client';

import type { ReactNode, RefObject } from 'react';
import { motion, useScroll, useSpring, useTransform } from 'framer-motion';

type Props = {
  /** Section whose scroll position drives the settle-in tilt. */
  targetRef: RefObject<HTMLElement>;
  children: ReactNode;
  /** Vertical drift distance in px (default 8). */
  drift?: number;
  /** One full up-and-down cycle in seconds (default 4.5). */
  duration?: number;
  /** Delay before the drift loop starts, used to stagger siblings (default 0). */
  delay?: number;
  /** Starting rotateY in degrees before the image settles face-on (default -14). */
  tilt?: number;
  /** Stretch wrappers to the parent's width (for images sized with width: 100%). */
  fullWidth?: boolean;
};

/**
 * Wraps an image so it (1) settles from a slight 3D angle into a straight-on
 * pose as its section scrolls into view, (2) drifts gently up and down forever,
 * and (3) casts a soft offset shadow beneath it so it reads as hovering above
 * the page. The child image itself is untouched.
 */
export default function FloatingPhone({
  targetRef,
  children,
  drift = 8,
  duration = 4.5,
  delay = 0,
  tilt = -14,
  fullWidth = false,
}: Props) {
  // 0 when the section's top reaches the bottom of the viewport,
  // 1 when the section's center reaches the viewport center.
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ['start end', 'center center'],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 80, damping: 22, mass: 0.6 });

  const rotateY = useTransform(progress, [0, 1], [tilt, 0]);
  const rotateX = useTransform(progress, [0, 1], [6, 0]);

  const w = fullWidth ? 'w-full' : '';

  return (
    <div style={{ perspective: 1200 }} className={`relative flex justify-center ${w}`}>
      {/* settle-in tilt driven by scroll */}
      <motion.div
        style={{ rotateY, rotateX, transformStyle: 'preserve-3d', willChange: 'transform' }}
        className={`relative ${w}`}
      >
        {/* continuous floating drift */}
        <motion.div
          animate={{ y: [0, -drift, 0] }}
          transition={{ duration, delay, ease: 'easeInOut', repeat: Infinity }}
          className={`relative ${w}`}
          style={{ filter: 'drop-shadow(0 36px 40px rgba(0,0,0,0.22))' }}
        >
          {children}
        </motion.div>

        {/* ground shadow: blurred ellipse under the image that breathes with the drift */}
        <motion.div
          aria-hidden="true"
          animate={{ scaleX: [1, 0.92, 1], opacity: [0.35, 0.25, 0.35] }}
          transition={{ duration, delay, ease: 'easeInOut', repeat: Infinity }}
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
          style={{
            bottom: -34,
            width: '70%',
            height: 28,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.45)',
            filter: 'blur(18px)',
          }}
        />
      </motion.div>
    </div>
  );
}
