"""Shared helpers for API test modules."""

import io

# A real dermoscopic lesion from samples/. Named once so regenerating the
# sample set (scripts/build_test_samples.py) is a one-line change here.
LESION_SAMPLE = "nv_1_ISIC_0032285.jpg"


def jpeg_bytes(img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG")
    return buf.getvalue()


def upload(client, name, data, content_type="image/jpeg"):
    return client.post("/api/analyze", files={"file": (name, data, content_type)})

