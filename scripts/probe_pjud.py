import json
import httpx

BASE = "https://conexpbe.justucuman.gov.ar/api/proceedings"
try:
    r = httpx.get(
        BASE,
        params={
            "jurisdiction": 11,
            "page": 1,
            "unit": "",
            "number": "0001/2024",
            "actor": "",
            "accused": "",
            "captcha": "token-invalido-de-prueba",
        },
        timeout=25,
        headers={"User-Agent": "expedientes-pjud/0.1"},
    )
    print("STATUS:", r.status_code)
    print("CT:", r.headers.get("content-type"))
    print("BODY:", r.text[:600])
except Exception as exc:
    print("ERROR:", type(exc).__name__, exc)
