/* Application configuration, constants, pathology metadata, and shared state. */

export const API_BASE = "/api";
export const IMG_INPUT_SIZE = 300;
export const ADMIN_TOKEN_KEY = "dermascan.adminToken";

export const state = {
    selectedFile: null,
    selectedAnatomicSite: "Anterior Torso",
    zoom: 1.0,
    panX: 0,
    panY: 0,
    heatmapVisible: false,
    resultsHeatmapVisible: false,
    heatmapBase64: null,
    calibration: {
        brightness: 100,
        contrast: 100,
        saturation: 100,
    },
    latestResult: null,
    history: [],
    compare: { a: null, b: null, pendingA: null },
    modelCard: null,
    cases: null,
    compareCase: null,
};

export const PATHOLOGY_META = {
    akiec: {
        name: "Actinic Keratosis",
        code: "ICD-11: EK90",
        type: "Pre-Malignant",
        desc: "Rough, scaly patch on sun-damaged skin. Precursor to squamous cell carcinoma requiring topical treatment or cryotherapy.",
    },
    bcc: {
        name: "Basal Cell Carcinoma",
        code: "ICD-11: 2C31",
        type: "Malignant",
        desc: "Slow-growing malignant epidermal tumor. Common in sun-exposed areas; rarely metastasizes but causes local damage.",
    },
    bkl: {
        name: "Benign Keratosis",
        code: "ICD-11: ED50",
        type: "Benign",
        desc: "Non-cancerous skin growth including seborrheic keratosis and solar lentigines. No malignant potential.",
    },
    df: {
        name: "Dermatofibroma",
        code: "ICD-11: EA81",
        type: "Benign",
        desc: "Common benign cutaneous nodule consisting of fibrous tissue. Typical 'dimple sign' upon lateral compression.",
    },
    mel: {
        name: "Melanoma",
        code: "ICD-11: 2C30",
        type: "Malignant / High Risk",
        desc: "Aggressive malignant tumor derived from melanocytes. Requires urgent surgical excision and dermatological evaluation.",
    },
    nv: {
        name: "Melanocytic Nevus",
        code: "ICD-11: ED20",
        type: "Benign",
        desc: "Common benign nevomelanocytic proliferation (mole). Benign morphology with uniform pigmentation.",
    },
    vasc: {
        name: "Vascular Lesion",
        code: "ICD-11: ED90",
        type: "Benign",
        desc: "Vascular proliferation including cherry angiomas and pyogenic granulomas. Non-malignant vascular structure.",
    },
};

export const CLINICAL_SAMPLES = [
    {
        id: "sample-mel",
        name: "Melanoma (MEL)",
        site: "Back",
        category: "Malignant",
        desc: "Histopathology-confirmed melanoma, HAM10000 held-out test case",
        url: "/samples/mel_1_ISIC_0026120.jpg",
    },
    {
        id: "sample-bcc",
        name: "Basal Cell Carcinoma (BCC)",
        site: "Trunk",
        category: "Malignant",
        desc: "Histopathology-confirmed basal cell carcinoma",
        url: "/samples/bcc_1_ISIC_0029230.jpg",
    },
    {
        id: "sample-akiec",
        name: "Actinic Keratosis (AKIEC)",
        site: "Face",
        category: "Pre-Malignant",
        desc: "Histopathology-confirmed actinic keratosis / intraepithelial carcinoma",
        url: "/samples/akiec_1_ISIC_0029659.jpg",
    },
    {
        id: "sample-nv",
        name: "Melanocytic Nevus (NV)",
        site: "Abdomen",
        category: "Benign",
        desc: "Benign nevomelanocytic mole, confirmed by clinical follow-up",
        url: "/samples/nv_1_ISIC_0032285.jpg",
    },
    {
        id: "sample-bkl",
        name: "Benign Keratosis (BKL)",
        site: "Upper Extremity",
        category: "Benign",
        desc: "Histopathology-confirmed benign keratosis-like lesion",
        url: "/samples/bkl_1_ISIC_0025915.jpg",
    },
    {
        id: "sample-df",
        name: "Dermatofibroma (DF)",
        site: "Lower Extremity",
        category: "Benign",
        desc: "Histopathology-confirmed dermatofibroma",
        url: "/samples/df_1_ISIC_0029760.jpg",
    },
    {
        id: "sample-vasc",
        name: "Vascular Lesion (VASC)",
        site: "Back",
        category: "Benign",
        desc: "Histopathology-confirmed vascular lesion",
        url: "/samples/vasc_1_ISIC_0029486.jpg",
    },
    {
        id: "sample-ood",
        name: "Non-Skin Control",
        site: "Not applicable",
        category: "Control",
        desc: "Non-clinical image. Rejected only once the feature-space OOD stage is calibrated",
        url: "/samples/cat.jpg",
    },
];

// Mirrors ANATOMIC_SITES in backend/config.py.
export const ANATOMIC_SITES = [
    "Head & Neck",
    "Anterior Torso",
    "Posterior Torso",
    "Upper Extremities",
    "Lower Extremities",
    "Palms & Soles",
];

export const HAM_SITE_TO_API_SITE = {
    "Back": "Posterior Torso",
    "Trunk": "Anterior Torso",
    "Abdomen": "Anterior Torso",
    "Chest": "Anterior Torso",
    "Face": "Head & Neck",
    "Scalp": "Head & Neck",
    "Neck": "Head & Neck",
    "Ear": "Head & Neck",
    "Upper Extremity": "Upper Extremities",
    "Hand": "Upper Extremities",
    "Lower Extremity": "Lower Extremities",
    "Foot": "Lower Extremities",
    "Acral": "Palms & Soles",
};

export const COMPARE_CLASS_ORDER = ["mel", "bcc", "akiec", "nv", "bkl", "df", "vasc"];
export const HIGH_RISK_CLASSES = ["mel", "bcc", "akiec"];
export const MODEL_CARD_CLASS_ORDER = ["mel", "bcc", "akiec", "nv", "bkl", "df", "vasc"];

