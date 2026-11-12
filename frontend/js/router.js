/* SPA view router, View Transitions API integration, hash sync, and nav indicator. */

import { state } from "./config.js";

const viewHandlers = new Map();

const VIEW_META = {
    "view-console": { label: "Scan console", hash: "console" },
    "view-results": { label: "Result", hash: "result" },
    "view-compare": { label: "Compare", hash: "compare" },
    "view-analytics": { label: "History", hash: "history" },
    "view-knowledge": { label: "Class reference", hash: "reference" },
    "view-model": { label: "Model card", hash: "model" },
};

const HASH_TO_VIEW = Object.fromEntries(
    Object.entries(VIEW_META).map(([id, meta]) => [meta.hash, id])
);

export function registerViewHandler(viewId, handler) {
    viewHandlers.set(viewId, handler);
}

export function getViewFromHash() {
    const clean = window.location.hash.replace(/^#/, "").trim().toLowerCase();
    return HASH_TO_VIEW[clean] || null;
}

export function openNavDrawer() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("nav-backdrop");
    const opener = document.getElementById("btn-nav-open");
    if (sidebar) sidebar.classList.add("is-open");
    if (backdrop) backdrop.classList.remove("hidden");
    if (opener) opener.setAttribute("aria-expanded", "true");
}

export function closeNavDrawer() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("nav-backdrop");
    const opener = document.getElementById("btn-nav-open");
    if (sidebar) sidebar.classList.remove("is-open");
    if (backdrop) backdrop.classList.add("hidden");
    if (opener) opener.setAttribute("aria-expanded", "false");
}

export function syncNavIndicator(activeLink) {
    const pill = document.getElementById("nav-active-pill");
    const nav = document.getElementById("main-nav");
    if (!pill || !nav || !activeLink) return;

    const top = activeLink.offsetTop;
    const height = activeLink.offsetHeight;
    pill.style.transform = `translateY(${top - 12}px)`;
    pill.style.height = `${height}px`;
    pill.style.opacity = "1";
}

function updateTopbarContext(viewId) {
    const meta = VIEW_META[viewId] || { label: "Workspace" };
    const titleEl = document.getElementById("topbar-view-name");
    const exportBtn = document.getElementById("btn-export-pdf");

    if (titleEl) titleEl.textContent = meta.label;
    if (exportBtn) {
        const showExport = Boolean(state.latestResult) && (viewId === "view-results" || viewId === "view-console");
        exportBtn.classList.toggle("hidden", !showExport);
    }
}

function applyViewSwitch(viewId, payload) {
    document.querySelectorAll(".view-container").forEach(view => {
        view.classList.add("hidden");
        view.classList.remove("is-entering");
    });

    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.remove("hidden");
        // Trigger subtle CSS entrance when View Transitions API isn't driving it.
        if (typeof document.startViewTransition !== "function") {
            void targetView.offsetWidth;
            targetView.classList.add("is-entering");
        }
        window.scrollTo({ top: 0, behavior: "auto" });
    }

    let activeLink = null;
    document.querySelectorAll(".nav-item").forEach(link => {
        const isActive = link.getAttribute("data-view") === viewId;
        link.classList.toggle("is-active", isActive);
        if (isActive) {
            link.setAttribute("aria-current", "page");
            activeLink = link;
        } else {
            link.removeAttribute("aria-current");
        }
    });

    syncNavIndicator(activeLink);
    updateTopbarContext(viewId);
    closeNavDrawer();

    const handler = viewHandlers.get(viewId);
    if (handler) handler(payload);
}

export function navigate(viewId, payload = null, { updateHash = true } = {}) {
    const meta = VIEW_META[viewId];
    if (!meta) return;

    if (updateHash && window.location.hash !== `#${meta.hash}`) {
        history.pushState({ viewId }, "", `#${meta.hash}`);
    }

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof document.startViewTransition === "function" && !prefersReduced) {
        document.startViewTransition(() => applyViewSwitch(viewId, payload));
    } else {
        applyViewSwitch(viewId, payload);
    }
}
