// Bali — Tailwind config block (Pass 1)
// Drop into tailwind.config.js `theme.extend`. Pair with tokens/tokens.css
// (CSS variables carry light/dark; Tailwind names map onto them).
// Usage: bg-surface-card text-state-focused-fg rounded-md shadow-2 …

const baliTokens = {
  colors: {
    green: { 50:"#F0F7F3",100:"#DCEDE3",200:"#BCDCCA",300:"#92C3A9",400:"#62A483",
             500:"#3F8765",600:"#2C6F51",700:"#245A43",800:"#1E4936",900:"#18392B",950:"#0E251C" },
    stone: { 50:"#F7F5F2",100:"#EFECE7",200:"#E3DFD8",300:"#D2CCC2",400:"#ABA59A",
             500:"#8A847A",600:"#6B665D",700:"#524E47",800:"#3A3733",900:"#26241F",950:"#161513" },
    orange:{ 50:"#FBF4EC",100:"#F7E6D2",200:"#EFCEA4",300:"#E5AF6F",400:"#DB9347",
             500:"#C97A2D",600:"#AE6322",700:"#8C4F1E",800:"#6F3F1B",900:"#5A3418" },
    blue:  { 50:"#EFF4FC",100:"#E0EBFA",200:"#BDD4F2",300:"#8FB4E8",400:"#5E90D9",
             500:"#3D77C9",600:"#2F62AC",700:"#28528E",800:"#224371",900:"#1C3659" },
    red:   { 50:"#FCF0EE",100:"#FAE3E0",200:"#F2C3BD",300:"#E89B92",400:"#D96E61",
             500:"#C44A3C",600:"#A93D31",700:"#8C342B",800:"#702B24",900:"#59241F" },

    // Semantic aliases → CSS variables (theme-aware)
    surface: {
      page:  "var(--surface-page)",  card:  "var(--surface-card)",
      sunken:"var(--surface-sunken)",raised:"var(--surface-raised)",
      brand: "var(--surface-brand)",
    },
    ink: {
      primary:  "var(--text-primary)",  secondary:"var(--text-secondary)",
      tertiary: "var(--text-tertiary)", disabled: "var(--text-disabled)",
      onbrand:  "var(--text-on-brand)", brand:    "var(--text-brand)",
    },
    line: { DEFAULT: "var(--border-default)", strong: "var(--border-strong)" },
    state: {
      "notjoined-fg":"var(--state-notjoined-fg)","notjoined-bg":"var(--state-notjoined-bg)",
      "focused-fg":  "var(--state-focused-fg)",  "focused-bg":  "var(--state-focused-bg)",
      "pass-fg":     "var(--state-pass-fg)",     "pass-bg":     "var(--state-pass-bg)",
      "emergency-fg":"var(--state-emergency-fg)","emergency-bg":"var(--state-emergency-bg)",
      "revoked-fg":  "var(--state-revoked-fg)",  "revoked-bg":  "var(--state-revoked-bg)",
      "nodevice-fg": "var(--state-nodevice-fg)",
      "ended-fg":    "var(--state-ended-fg)",    "ended-bg":    "var(--state-ended-bg)",
    },
  },

  fontFamily: {
    sans: ['"Instrument Sans"', "system-ui", "sans-serif"],
    num:  ["ui-rounded", '"SF Pro Rounded"', '"Instrument Sans"', "sans-serif"],
    mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
  },

  fontSize: {
    display: ["56px", { lineHeight: "60px", letterSpacing: "-0.02em", fontWeight: "600" }],
    h1:      ["32px", { lineHeight: "38px", letterSpacing: "-0.01em", fontWeight: "600" }],
    h2:      ["24px", { lineHeight: "30px", fontWeight: "600" }],
    h3:      ["18px", { lineHeight: "24px", fontWeight: "600" }],
    "body-lg":["17px",{ lineHeight: "26px" }],
    body:    ["15px", { lineHeight: "22px" }],
    caption: ["13px", { lineHeight: "18px" }],
    label:   ["12px", { lineHeight: "16px", letterSpacing: "0.06em", fontWeight: "600" }],
    data:    ["14px", { lineHeight: "20px", fontWeight: "500" }], // + tabular-nums
    "data-lg":["28px",{ lineHeight: "32px", fontWeight: "600" }], // + tabular-nums
    code:    ["14px", { lineHeight: "20px", fontWeight: "500" }],
  },

  borderRadius: {
    xs: "6px", sm: "10px", md: "14px", lg: "20px", full: "999px",
  },

  boxShadow: {
    1: "var(--shadow-1)", 2: "var(--shadow-2)", 3: "var(--shadow-3)",
    focus: "var(--focus-ring)",
  },

  transitionTimingFunction: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    spring:   "cubic-bezier(0.34, 1.3, 0.64, 1)",
  },
  transitionDuration: { fast: "150ms", base: "200ms", slow: "300ms", arc: "600ms" },
};

module.exports = { baliTokens };
