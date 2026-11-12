/* Calm clinical palette: neutral slate surfaces, one interactive accent, and
   colour reserved for risk semantics. */
tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "background": "#0e1116",
                "surface": "#0e1116",
                "surface-dim": "#0a0d11",
                "surface-container-lowest": "#0a0d11",
                "surface-container-low": "#141922",
                "surface-container": "#191f29",
                "surface-container-high": "#212936",
                "surface-container-highest": "#2a3341",
                "outline": "#3a4655",
                "outline-variant": "#2c3542",
                "on-surface": "#e6eaf0",
                "on-background": "#e6eaf0",
                "on-surface-variant": "#9aa6b6",
                "on-surface-muted": "#6d7b8c",
                "primary": "#62a8e8",
                "on-primary": "#06192b",
                "risk-low": "#6fc0a4",
                "risk-mid": "#d8a44f",
                "risk-high": "#e8746c"
            },
            borderRadius: {
                "DEFAULT": "6px",
                "lg": "8px",
                "xl": "12px",
                "2xl": "16px",
                "full": "9999px"
            },
            spacing: {
                "gutter": "20px",
                "margin-desktop": "28px",
                "margin-mobile": "16px",
                "stack-gap": "14px",
                "unit": "12px"
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
                "display-lg": ["38px", { "lineHeight": "44px", "letterSpacing": "-0.02em", "fontWeight": "600" }],
                "headline-lg": ["22px", { "lineHeight": "30px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
                "headline-lg-mobile": ["20px", { "lineHeight": "28px", "fontWeight": "600" }],
                "headline-md": ["16px", { "lineHeight": "24px", "fontWeight": "600" }],
                "body-lg": ["16px", { "lineHeight": "26px", "fontWeight": "400" }],
                "body-md": ["14px", { "lineHeight": "22px", "fontWeight": "400" }],
                "data-lg": ["21px", { "lineHeight": "28px", "fontWeight": "500" }],
                "data-sm": ["13px", { "lineHeight": "18px", "fontWeight": "400" }]
            }
        }
    }
};

