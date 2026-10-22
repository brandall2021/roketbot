"""Modelo de datos.

Equivalencias con el esquema legado (SQL Server `LegajoExpdtes`):

    ExpdtesCaratula  -> expedientes
    ExpdtesLineas    -> movimientos   (con UNIQUE que el bot NO tenía)
    CentrosJudiciales-> catálogo simple (centros_judiciales)
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# Resultados posibles de una consulta, igual que el bot: SI / NO / KO
RESULTADOS = ("SI", "NO", "KO")


class CentroJudicial(Base):
    __tablename__ = "centros_judiciales"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nombre repetido a propósito: el PJud usa varios centros con el mismo nombre
    # (p. ej. cinco "Capital") y distinto código de endpoint.
    nombre: Mapped[str] = mapped_column(String(120))
    # Código que usa la API del PJud. NULL = todavía no relevado.
    codigo_endpoint: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    # Id original en LegajoExpdtes.dbo.CentrosJudiciales (para reimportar sin duplicar).
    legado_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)

    expedientes: Mapped[list[Expediente]] = relationship(back_populates="centro")


class Expediente(Base):
    __tablename__ = "expedientes"
    __table_args__ = (
        UniqueConstraint("numero", "jurisdiccion", name="uq_expediente_numero_jurisdiccion"),
        Index("ix_expedientes_pendientes", "estado", "fch_ult_proc"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    numero: Mapped[str] = mapped_column(String(64), index=True)
    jurisdiccion: Mapped[int] = mapped_column(Integer, default=11)
    centro_id: Mapped[int | None] = mapped_column(
        ForeignKey("centros_judiciales.id", ondelete="SET NULL")
    )
    caratula: Mapped[str | None] = mapped_column(Text)
    actor: Mapped[str | None] = mapped_column(Text)
    demandado: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(8), default="ACT", index=True)

    # Último movimiento conocido (equivale a ExpdteFchUltMov / ExpdteUltMovDescripcion)
    fch_ult_mov: Mapped[date | None] = mapped_column(Date)
    ult_mov_desc: Mapped[str | None] = mapped_column(Text)

    # Resultado de la última consulta (equivale a ExpdteActualizado / ExpdteFchUltProc)
    actualizado: Mapped[str | None] = mapped_column(String(4))
    fch_ult_proc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    centro: Mapped[CentroJudicial | None] = relationship(back_populates="expedientes")
    movimientos: Mapped[list[Movimiento]] = relationship(
        back_populates="expediente", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Expediente {self.numero} ({self.actualizado})>"


class Movimiento(Base):
    """Línea de historial. El UNIQUE es la defensa contra duplicados."""

    __tablename__ = "movimientos"
    __table_args__ = (
        UniqueConstraint("expediente_id", "hash_unico", name="uq_movimiento_expediente_hash"),
        Index("ix_movimientos_expediente_fecha", "expediente_id", "fecha"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    expediente_id: Mapped[int] = mapped_column(
        ForeignKey("expedientes.id", ondelete="CASCADE"), index=True
    )
    fecha: Mapped[date | None] = mapped_column(Date)
    descripcion: Mapped[str | None] = mapped_column(Text)
    texto: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(Text)
    histid: Mapped[str | None] = mapped_column(String(64))
    origen: Mapped[str] = mapped_column(String(16), default="pjud")
    hash_unico: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    expediente: Mapped[Expediente] = relationship(back_populates="movimientos")


class Corrida(Base):
    """Una ejecución del worker (equivale a una ejecución de Rocketbot)."""

    __tablename__ = "corridas"

    id: Mapped[int] = mapped_column(primary_key=True)
    inicio: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    modo: Mapped[str] = mapped_column(String(16), default="pjud")
    estado: Mapped[str] = mapped_column(String(16), default="RUNNING")

    total: Mapped[int] = mapped_column(Integer, default=0)
    cnt_si: Mapped[int] = mapped_column(Integer, default=0)
    cnt_no: Mapped[int] = mapped_column(Integer, default=0)
    cnt_ko: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)

    items: Mapped[list[CorridaItem]] = relationship(
        back_populates="corrida", cascade="all, delete-orphan"
    )


class CorridaItem(Base):
    """Detalle por expediente: sirve para reprocesar solo los KO."""

    __tablename__ = "corrida_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    corrida_id: Mapped[int] = mapped_column(
        ForeignKey("corridas.id", ondelete="CASCADE"), index=True
    )
    expediente_id: Mapped[int | None] = mapped_column(
        ForeignKey("expedientes.id", ondelete="SET NULL")
    )
    resultado: Mapped[str] = mapped_column(String(4))
    motivo: Mapped[str | None] = mapped_column(Text)
    movimientos_nuevos: Mapped[int] = mapped_column(Integer, default=0)
    duracion_ms: Mapped[int] = mapped_column(Integer, default=0)

    corrida: Mapped[Corrida] = relationship(back_populates="items")


class TokenCaptcha(Base):
    """Tokens obtenidos, para reutilizarlos y auditar consumo."""

    __tablename__ = "tokens_captcha"

    id: Mapped[int] = mapped_column(primary_key=True)
    valor: Mapped[str] = mapped_column(Text)
    proveedor: Mapped[str] = mapped_column(String(16))
    obtenido_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    valido_hasta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estado: Mapped[str] = mapped_column(String(12), default="NUEVO")


class Notificacion(Base):
    """Outbox de mails: se guarda aunque el envío falle, y se reintenta."""

    __tablename__ = "notificaciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    corrida_id: Mapped[int | None] = mapped_column(
        ForeignKey("corridas.id", ondelete="SET NULL")
    )
    destinatarios: Mapped[str] = mapped_column(Text)
    asunto: Mapped[str] = mapped_column(Text)
    cuerpo: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(12), default="PENDIENTE")
    error: Mapped[str | None] = mapped_column(Text)
    enviado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
