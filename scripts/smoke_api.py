import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fastapi.testclient import TestClient

from expedientes.api import app

client = TestClient(app)
for path in ("/health", "/api/resumen", "/api/corridas", "/api/expedientes", "/"):
    r = client.get(path)
    print(f"{path:20s} -> {r.status_code} {r.headers.get('content-type','')[:30]}")

print("\n--- /api/resumen ---")
print(client.get("/api/resumen").json())
print("\n--- /api/expedientes ---")
print(client.get("/api/expedientes?limite=3").json())
