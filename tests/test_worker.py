from __future__ import annotations

from expedientes.worker import TokenManager


def test_token_fijo_no_consulta_proveedor():
    llamadas = []

    def obtener():
        llamadas.append(1)
        return "nuevo"

    tokens = TokenManager(fijo="fijo", ttl_s=1, obtener=obtener)
    assert tokens.get() == "fijo"
    assert tokens.get(forzar=True) == "fijo"
    assert llamadas == []


def test_token_se_reutiliza_mientras_no_vence():
    llamadas = []

    def obtener():
        llamadas.append(1)
        return f"token-{len(llamadas)}"

    tokens = TokenManager(ttl_s=3600, obtener=obtener)
    assert tokens.get() == "token-1"
    assert tokens.get() == "token-1"
    assert tokens.get() == "token-1"
    assert len(llamadas) == 1


def test_token_se_renueva_al_vencer():
    llamadas = []

    def obtener():
        llamadas.append(1)
        return f"token-{len(llamadas)}"

    tokens = TokenManager(ttl_s=0, obtener=obtener)
    assert tokens.get() == "token-1"
    assert tokens.get() == "token-2"
    assert tokens.get(forzar=True) == "token-3"
