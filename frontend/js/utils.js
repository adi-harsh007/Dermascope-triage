/* Shared DOM, formatting, toast, and API helpers. */

import { API_BASE } from "./config.js";

export function toast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "fixed top-[68px] right-4 z-[60] flex flex-col gap-2 items-end";
        document.body.appendChild(container);
    }

    const colors = {
        info: "border-outline text-on-surface",
        success: "border-risk-low/50 text-risk-low",
        warning: "border-risk-mid/50 text-risk-mid",
        error: "border-risk-high/50 text-risk-high",
    };
    const iconName = type === "error" ? "error"
        : type === "success" ? "check_circle"
        : type === "warning" ? "warning"
        : "info";

    const el = document.createElement("div");
    el.className = "toast max-w-[22rem] px-4 py-3 rounded-xl border bg-surface-container-high " +
        "text-[13px] leading-5 shadow-lg flex items-start gap-2.5 transition-all duration-300 " +
        `transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
    el.innerHTML = `
        <span class="material-symbols-outlined text-[18px] shrink-0 mt-px">${iconName}</span>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(el);
    requestAnimationFrame(() => {
        el.classList.remove("translate-y-2", "opacity-0");
    });

    setTimeout(() => {
        el.classList.add("opacity-0", "-translate-y-2");
        setTimeout(() => el.remove(), 300);
    }, 4000);
}

export async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (!response.ok) {
            let errorMsg = `Server Error (${response.status})`;
            try {
                const errJson = await response.json();
                const detail = errJson.detail;
                if (typeof detail === "string") {
                    errorMsg = detail;
                } else if (detail && detail.message) {
                    errorMsg = detail.message;
                }
            } catch (_) { /* ignore malformed error payload */ }
            const error = new Error(errorMsg);
            error.status = response.status;
            throw error;
        }
        return await response.json();
    } catch (err) {
        const error = new Error(err.message || "Failed to communicate with DermaScope Triage server.");
        error.status = err.status;
        throw error;
    }
}

export function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function formatMs(value) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    if (value < 10) return `${value.toFixed(1)} ms`;
    return `${Math.round(value)} ms`;
}

export function formatPct(value, digits = 1) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    return `${(value * 100).toFixed(digits)}%`;
}

export function formatDeltaPP(value) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    const pp = value * 100;
    if (Math.abs(pp) < 0.05) return "0.0 pp";
    return `${pp > 0 ? "+" : "−"}${Math.abs(pp).toFixed(1)} pp`;
}

export function formatInterval(msA, msB) {
    if (!isFinite(msA) || !isFinite(msB)) return "—";
    const ms = Math.abs(msB - msA);
    const minutes = ms / 60000;
    if (minutes < 1) return "under a minute";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
    const days = hours / 24;
    if (days < 60) return `${Math.round(days)} days`;
    return `${(days / 30.44).toFixed(1)} months`;
}

export function formatRecordedAt(iso) {
    const dt = new Date(iso);
    if (isNaN(dt)) return "—";
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
           `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

