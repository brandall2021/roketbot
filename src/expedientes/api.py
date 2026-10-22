"""API y panel mínimo de monitoreo."""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .db import get_session
from .models import Corrida, Expediente, Movimiento

app = FastAPI(
    title="Expedientes PJud",
    version="0.1.0",
    description="Consulta y seguimiento de expedientes — sistema paralelo al bot Rocketbot",
)

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


@app.get("/health")
def health(session: Session = Depends(get_session)) -> dict[str, str]:
    session.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@app.get("/api/resumen")
def resumen(session: Session = Depends(get_session)) -> dict:
    total = session.scalar(select(func.count()).select_from(Expediente)) or 0
    por_resultado = dict(
        session.execute(
            select(Expediente.actualizado, func.count()).group_by(Expediente.actualizado)
        ).all()
    )
    movimientos = session.scalar(select(func.count()).select_from(Movimiento)) or 0
    return {
        "expedientes": total,
        "por_resultado": {str(k): v for k, v in por_resultado.items()},
        "movimientos": movimientos,
    }


@app.get("/api/corridas")
def listar_corridas(
    limite: int = Query(20, ge=1, le=200),
    session: Session = Depends(get_session),
) -> list[dict]:
    corridas = session.scalars(select(Corrida).order_by(Corrida.id.desc()).limit(limite))
    return [
        {
            "id": c.id,
            "inicio": c.inicio,
            "fin": c.fin,
            "estado": c.estado,
            "total": c.total,
            "si": c.cnt_si,
            "no": c.cnt_no,
            "ko": c.cnt_ko,
            "error": c.error,
        }
        for c in corridas
    ]


@app.get("/api/expedientes")
def listar_expedientes(
    q: str | None = None,
    actualizado: str | None = None,
    limite: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> list[dict]:
    stmt = select(Expediente).order_by(Expediente.id.desc()).limit(limite).offset(offset)
    if q:
        stmt = stmt.where(Expediente.numero.ilike(f"%{q}%"))
    if actualizado:
        stmt = stmt.where(Expediente.actualizado == actualizado.upper())
    return [
        {
            "id": e.id,
            "numero": e.numero,
            "jurisdiccion": e.jurisdiccion,
            "estado": e.estado,
            "actualizado": e.actualizado,
            "fch_ult_mov": e.fch_ult_mov,
            "ult_mov_desc": e.ult_mov_desc,
            "fch_ult_proc": e.fch_ult_proc,
        }
        for e in session.scalars(stmt)
    ]


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, session: Session = Depends(get_session)) -> HTMLResponse:
    corridas = list(session.scalars(select(Corrida).order_by(Corrida.id.desc()).limit(10)))
    total = session.scalar(select(func.count()).select_from(Expediente)) or 0
    movimientos = session.scalar(select(func.count()).select_from(Movimiento)) or 0
    pendientes = (
        session.scalar(
            select(func.count())
            .select_from(Expediente)
            .where(Expediente.actualizado.is_(None))
        )
        or 0
    )
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={
            "corridas": corridas,
            "total": total,
            "movimientos": movimientos,
            "pendientes": pendientes,
        },
    )
