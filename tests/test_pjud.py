from __future__ import annotations

from datetime import date

from expedientes.services.pjud import (
    filtrar_nuevas,
    hash_movimiento,
    parse_fecha,
)


def test_parse_fecha_formatos():
    assert parse_fecha("15/03/2026") == date(2026, 3, 15)
    assert parse_fecha("2026-03-15") == date(2026, 3, 15)
    assert parse_fecha("15-03-2026") == date(2026, 3, 15)
    assert parse_fecha(None) is None
    assert parse_fecha("") is None


def test_parse_fecha_hora_incluida():
    assert parse_fecha("15/03/2026 10:30:00") == date(2026, 3, 15)


def test_hash_es_estable():
    a = hash_movimiento(date(2026, 1, 2), "  DECRETO  ")
    b = hash_movimiento(date(2026, 1, 2), "decreto")
    assert a == b


def test_hash_ignora_mayusculas_y_espacios():
    a = hash_movimiento(date(2026, 1, 2), "Decreto  ")
    assert a == hash_movimiento(date(2026, 1, 2), "decreto")


def test_filtrar_nuevas_descarta_anteriores_y_ordena():
    stories = [
        {"fecha": "10/03/2026", "dscr": "viejo"},
        {"fecha": "20/03/2026", "dscr": "nuevo 2"},
        {"fecha": "18/03/2026", "dscr": "nuevo 1"},
        {"fecha": "sin fecha", "dscr": "roto"},
    ]
    nuevas = filtrar_nuevas(stories, date(2026, 3, 15))
    assert [s["dscr"] for s in nuevas] == ["nuevo 1", "nuevo 2"]


def test_filtrar_nuevas_sin_fecha_referencia_devuelve_todo():
    stories = [
        {"fecha": "10/03/2026", "dscr": "a"},
        {"fecha": "20/03/2026", "dscr": "b"},
    ]
    assert len(filtrar_nuevas(stories, None)) == 2


def test_filtrar_nuevas_lista_vacia():
    assert filtrar_nuevas([], date(2026, 1, 1)) == []
