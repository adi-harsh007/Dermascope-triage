/* SPA view router and mobile navigation drawer. */

const viewHandlers = new Map();

export function registerViewHandler(viewId, handler) {
    viewHandlers.set(viewId, handler);
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

export function navigate(viewId, payload = null) {
    document.querySelectorAll(".view-container").forEach(view => {
        view.classList.add("hidden");
    });

    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "auto" });
    }

    document.querySelectorAll(".nav-item").forEach(link => {
        const isActive = link.getAttribute("data-view") === viewId;
        link.classList.toggle("is-active", isActive);
        if (isActive) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });

    closeNavDrawer();

    const handler = viewHandlers.get(viewId);
    if (handler) handler(payload);
}

