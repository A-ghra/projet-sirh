/**
 * Signature développeur — OTOMIA GROUP
 */
const OTOMIA_BRANDING = {
    developerName: "OTOMIA GROUP",
    developerWebsite: "",
    developerSignature: "Développé par OTOMIA GROUP",
    appVersion: "OTOMIA RH v1.0",
    copyrightYear: 2026,
    solutions: [
        "Développement Web",
        "Développement Mobile",
        "Solutions RH",
        "ERP & Gestion d'entreprise",
        "Transformation numérique",
    ],
};

async function loadOtomiaBranding() {
    try {
        const host = window.OTOMIA_API_HOST
            || (window.OTOMIA_API_BASE || window.OTOMIA_API_URL || `${location.protocol}//${location.hostname}:8000/api`).replace(/\/api\/?$/, "");
        const r = await fetch(`${host}/api/public-branding/`);
        const b = await r.json();
        OTOMIA_BRANDING.developerName = b.developer_name || OTOMIA_BRANDING.developerName;
        OTOMIA_BRANDING.developerWebsite = b.developer_website || "";
        OTOMIA_BRANDING.developerSignature = b.developer_signature || OTOMIA_BRANDING.developerSignature;
        OTOMIA_BRANDING.appVersion = b.app_version || OTOMIA_BRANDING.appVersion;
        OTOMIA_BRANDING.copyrightYear = b.copyright_year || OTOMIA_BRANDING.copyrightYear;
        if (b.developer_solutions?.length) OTOMIA_BRANDING.solutions = b.developer_solutions;
    } catch (e) { /* valeurs par défaut */ }
}

function otomiaGroupLinkHtml(className = "otomia-group-link") {
    return `<a href="#" class="${className}" onclick="handleOtomiaGroupClick(event)" title="À propos de ${OTOMIA_BRANDING.developerName}">${OTOMIA_BRANDING.developerName}</a>`;
}

window.handleOtomiaGroupClick = (e) => {
    e.preventDefault();
    if (OTOMIA_BRANDING.developerWebsite) {
        window.open(OTOMIA_BRANDING.developerWebsite, "_blank", "noopener,noreferrer");
    } else {
        showAboutModal();
    }
};

window.showAboutModal = () => {
    let modal = document.getElementById("about-otomia-modal");
    if (!modal) {
        document.body.insertAdjacentHTML("beforeend", `
            <div id="about-otomia-modal" class="custom-modal" hidden>
                <div class="custom-modal-content panel about-modal-content">
                    <button class="about-close" onclick="closeAboutModal()" aria-label="Fermer">&times;</button>
                    <div class="about-header">
                        <i class="fas fa-code-branch"></i>
                        <h2 id="about-title">OTOMIA GROUP</h2>
                    </div>
                    <p id="about-desc">Éditeur et développeur officiel de la plateforme OTOMIA RH.</p>
                    <h4>Solutions</h4>
                    <ul id="about-solutions" class="about-solutions"></ul>
                    <p class="about-version"><strong>Version :</strong> <span id="about-version"></span></p>
                    <button class="btn btn-primary" onclick="closeAboutModal()">Fermer</button>
                </div>
            </div>`);
        modal = document.getElementById("about-otomia-modal");
    }
    document.getElementById("about-title").textContent = OTOMIA_BRANDING.developerName;
    document.getElementById("about-version").textContent = OTOMIA_BRANDING.appVersion;
    document.getElementById("about-solutions").innerHTML = OTOMIA_BRANDING.solutions
        .map((s) => `<li><i class="fas fa-check-circle"></i> ${s}</li>`).join("");
    modal.hidden = false;
    modal.onclick = (ev) => { if (ev.target === modal) closeAboutModal(); };
};

window.closeAboutModal = () => {
    const modal = document.getElementById("about-otomia-modal");
    if (modal) modal.hidden = true;
};

function initDeveloperFooters() {
    document.querySelectorAll(".otomia-developer-signature").forEach((el) => {
        const link = otomiaGroupLinkHtml();
        if (el.dataset.format === "login") {
            el.innerHTML = `Conçu et développé par ${link} &copy; ${OTOMIA_BRANDING.copyrightYear}`;
        } else if (el.dataset.format === "app") {
            el.innerHTML = `&copy; ${OTOMIA_BRANDING.copyrightYear} OTOMIA RH | Développé par ${link}`;
        } else {
            el.innerHTML = `${OTOMIA_BRANDING.developerSignature.replace(OTOMIA_BRANDING.developerName, link)}`;
        }
    });
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAboutModal();
});

document.addEventListener("DOMContentLoaded", async () => {
    await loadOtomiaBranding();
    initDeveloperFooters();
});
