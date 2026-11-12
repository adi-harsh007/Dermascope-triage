/* Obsidian & graphite clinical palette: pure neutral blacks and greys with
   high-contrast alabaster primary controls and risk-only semantic colours. */
tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "background": "#0b0b0e",
                "surface": "#0b0b0e",
                "surface-dim": "#070709",
                "surface-container-lowest": "#070709",
                "surface-container-low": "#111115",
                "surface-container": "#15151a",
                "surface-container-high": "#1c1c22",
                "surface-container-highest": "#24242c",
                "outline": "#32323c",
                "outline-variant": "#23232b",
                "on-surface": "#f4f4f6",
                "on-background": "#f4f4f6",
                "on-surface-variant": "#a1a1aa",
                "on-surface-muted": "#6e6e7a",
                "primary": "#f4f4f6",
                "on-primary": "#09090b",
                "risk-low": "#34d399",
                "risk-mid": "#f59e0b",
                "risk-high": "#f87171"
            },
            borderRadius: {
                "DEFAULT": "8px",
                "lg": "10px",
                "xl": "14px",
                "2xl": "18px",
                "full": "9999px"
            },
            spacing: {
                "gutter": "20px",
                "margin-desktop": "28px",
                "margin-mobile": "16px",
                "stack-gap": "14px",
                "unit": "14px"
            },
            fontFamily: {
                "display-lg": ["Inter", "system-ui", "sans-serif"],
                "headline-lg": ["Inter", "system-ui", "sans-serif"],
                "headline-lg-mobile": ["Inter", "system-ui", "sans-serif"],
                "headline-md": ["Inter", "system-ui", "sans-serif"],
                "body-lg": ["Inter", "system-ui", "sans-serif"],
                "body-md": ["Inter", "system-ui", "sans-serif"],
                "data-lg": ["IBM Plex Mono", "ui-monospace", "monospace"],
                "data-sm": ["IBM Plex Mono", "ui-monospace", "monospace"]
            },
            fontSize: {
                "display-lg": ["36px", { "lineHeight": "42px", "letterSpacing": "-0.025em", "fontWeight": "600" }],
                "headline-lg": ["22px", { "lineHeight": "28px", "letterSpacing": "-0.02em", "fontWeight": "600" }],
                "headline-lg-mobile": ["19px", { "lineHeight": "26px", "fontWeight": "600" }],
                "headline-md": ["15px", { "lineHeight": "22px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
                "body-lg": ["15px", { "lineHeight": "24px", "fontWeight": "400" }],
                "body-md": ["13.5px", { "lineHeight": "21px", "fontWeight": "400" }],
                "data-lg": ["20px", { "lineHeight": "26px", "fontWeight": "500" }],
                "data-sm": ["12.5px", { "lineHeight": "18px", "fontWeight": "400" }]
            }
        }
    }
};
