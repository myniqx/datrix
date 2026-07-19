---
name: Digital Core
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1c1b1d'
  surface-container: '#201f22'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e5e1e4'
  on-surface-variant: '#ccc3d8'
  inverse-surface: '#e5e1e4'
  inverse-on-surface: '#313032'
  outline: '#958da1'
  outline-variant: '#4a4455'
  surface-tint: '#d2bbff'
  primary: '#d2bbff'
  on-primary: '#3f008e'
  primary-container: '#7c3aed'
  on-primary-container: '#ede0ff'
  inverse-primary: '#732ee4'
  secondary: '#4cd7f6'
  on-secondary: '#003640'
  secondary-container: '#03b5d3'
  on-secondary-container: '#00424e'
  tertiary: '#ffafd3'
  on-tertiary: '#620040'
  tertiary-container: '#ae397b'
  on-tertiary-container: '#ffdce9'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#eaddff'
  primary-fixed-dim: '#d2bbff'
  on-primary-fixed: '#25005a'
  on-primary-fixed-variant: '#5a00c6'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#ffd8e7'
  tertiary-fixed-dim: '#ffafd3'
  on-tertiary-fixed: '#3d0026'
  on-tertiary-fixed-variant: '#85145a'
  background: '#131315'
  on-background: '#e5e1e4'
  surface-variant: '#353437'
  background-deep: '#020617'
  surface-elevated: '#0F172A'
  border-subtle: '#1E293B'
  code-cyan: '#22D3EE'
  code-purple: '#A78BFA'
  text-muted: '#94A3B8'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 64px
    fontWeight: '800'
    lineHeight: 72px
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '450'
    lineHeight: 20px
  label-xs:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  container-max: 1280px
  gutter: 24px
  section-gap: 80px
  stack-sm: 8px
  stack-md: 16px
---

## Brand & Style
The design system is engineered for developers, emphasizing precision, technical depth, and high-performance aesthetics. It creates a "command center" atmosphere that feels both robust and cutting-edge.

The visual direction combines **Minimalism** with **high-tech accents**, utilizing a deep-space backdrop to let code and data visualizations take center stage. Key characteristics include:
- **Utility-First:** Every element serves a functional purpose with zero ornamental "fluff."
- **Digital-First:** High-vibrancy accents that mimic the glow of a high-end IDE.
- **Precision:** Tight alignment, consistent stroke weights, and clear information hierarchy.
- **Atmospheric Depth:** Using subtle gradients and glows to suggest a 3D space within a 2D interface.

## Colors
The palette is optimized for long-duration coding sessions, using a high-contrast dark theme. 

- **Primary (Electric Violet):** Used for primary actions, success states, and brand-defining glows.
- **Secondary (Cyber Cyan):** Used for informational accents, syntax highlighting, and secondary interactive elements.
- **Backgrounds:** We utilize a "layered black" approach. The base layer is a near-black navy (`#020617`), while UI containers use slightly lighter tones to create a sense of physical stacking.
- **Accents:** Vibrant purple and cyan glows are used sparingly (1-2px blurs) to highlight active states or critical path data.

## Typography
Typography is treated with mathematical rigor. We use **Inter** for all UI and prose to ensure maximum legibility and a modern, neutral feel. **JetBrains Mono** is reserved for code blocks, technical metadata, and labels to reinforce the developer-focused nature of the tool.

- **Scale:** High contrast between headlines and body text helps users scan documentation quickly.
- **Formatting:** Use tight letter-spacing for large headlines to create a dense, "engineered" look. 
- **Code Blocks:** Should always use a slightly reduced font size compared to body text to maintain visual balance within containers.

