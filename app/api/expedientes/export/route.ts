import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { consultar } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { CAMPOS_LISTADO, FUENTE, construirFiltros, filasVista, orden } from "@/lib/consulta";
import { filaCsv, respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

const EXPORT_COLS: [key: string, label: string][] = [
  ["Centro Judicial", "Centro Judicial"],
  ["Unidad Judicial", "Unidad Judicial"],
  ["Expdte", "Expediente"],
  ["Actor", "Actor"],
  ["Demandado", "Demandado"],
  ["Fecha", "Fecha"],
  ["Descripcion", "Descripcion"],
  ["Documento", "Documento"],
  ["Fecha Procesado", "Fecha Procesado"],
  ["Estado", "Estado"],
];

const CSV_MAX = 10000;
const PDF_MAX = 800;

function buildCsv(rows: Record<string, unknown>[]): string {
  const header = filaCsv(EXPORT_COLS.map(([, label]) => label));
  const body = rows.map((r) => filaCsv(EXPORT_COLS.map(([key]) => r[key])));
  return "\uFEFF" + [header, ...body].join("\r\n");
}

function hoy(): string {
  return new Date().toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function buildPdf(rows: Record<string, unknown>[], logoPath: string | null, total: number): Promise<Buffer> {
  const fontRegular = path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf");
  const fontBold = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf");
  const hasFonts = fs.existsSync(fontRegular) && fs.existsSync(fontBold);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (hasFonts) {
      doc.registerFont("Base", fontRegular);
      doc.registerFont("Base-Bold", fontBold);
      doc.font("Base");
    }

    const accent = "#673de6";
    const left = 36;

    if (logoPath && fs.existsSync(logoPath)) {
      doc.image(logoPath, left, 28, { width: 120 });
    }
    doc.fontSize(17).fillColor("#1f1346").text("Expedientes Jurídicos", left + 130, 34);
    doc
      .fontSize(9.5)
      .fillColor("#555")
      .text(`Generado el ${hoy()} · Total: ${total} expedientes`, left + 130, 58);
    doc
      .moveTo(left, 92)
      .lineTo(doc.page.width - left, 92)
      .strokeColor(accent)
      .lineWidth(2)
      .stroke();

    const cols = [
      { key: "Expdte", label: "Expediente", w: 70 },
      { key: "Actor", label: "Actor", w: 110 },
      { key: "Demandado", label: "Demandado", w: 110 },
      { key: "Unidad Judicial", label: "Unidad", w: 100 },
      { key: "Fecha", label: "Fecha", w: 58 },
      { key: "Estado", label: "Estado", w: 45 },
    ];

    let y = 108;
    const pageH = doc.page.height - 40;

    doc.fontSize(8.5).fillColor(accent).font(hasFonts ? "Base-Bold" : "Helvetica-Bold");
    let x = left;
    for (const c of cols) {
      doc.text(c.label, x + 4, y + 4, { width: c.w - 8 });
      x += c.w;
    }
    doc
      .rect(left, y, cols.reduce((a, c) => a + c.w, 0), 20)
      .fill("#f2f0ff")
      .stroke();
    doc.fillColor("#1f1346");

    const rowsToDraw = rows.slice(0, PDF_MAX);
    y += 26;
    doc.font(hasFonts ? "Base" : "Helvetica").fontSize(8);

    for (const r of rowsToDraw) {
      if (y > pageH) {
        doc.addPage();
        y = 40;
      }
      doc
        .rect(left, y - 3, cols.reduce((a, c) => a + c.w, 0), 18)
        .fill(y % 36 === 0 ? "#ffffff" : "#fafafa")
        .stroke("#e0e0e0");
      x = left;
      for (const c of cols) {
        doc.fillColor("#1f1346").text(String(r[c.key] ?? "").trim(), x + 4, y, {
          width: c.w - 8,
          ellipsis: true,
          lineBreak: false,
        });
        x += c.w;
      }
      y += 16;
    }

    if (rows.length > PDF_MAX) {
      doc.fontSize(9).fillColor("#555").text(`Se muestran los primeros ${PDF_MAX} registros.`, left, y + 8);
    }

    doc.end();
  });
}

export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const formato = url.searchParams.get("formato") === "pdf" ? "pdf" : "csv";
    const { where, valores } = construirFiltros(url.searchParams);
    const orderSql = orden(url.searchParams);
    const maxRows = formato === "csv" ? CSV_MAX : PDF_MAX;

    // TOP (@maxRows) -> LIMIT $n: el tope va como parámetro, no concatenado.
    const filas = await consultar<Record<string, unknown>>(
      `SELECT ${CAMPOS_LISTADO.join(", ")}
         FROM ${FUENTE}
         ${where}
        ORDER BY ${orderSql}
        LIMIT $${valores.length + 1}`,
      [...valores, maxRows]
    );
    const rows = filasVista(filas);

    if (formato === "csv") {
      const csv = buildCsv(rows.slice(0, CSV_MAX));
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="expedientes.csv"`,
        },
      });
    }

    const logoPng = path.join(process.cwd(), "public", "logo.png");
    const logoJpg = path.join(process.cwd(), "public", "logo.jpg");
    const logoPath = fs.existsSync(logoPng) ? logoPng : logoJpg;
    const pdf = await buildPdf(rows, fs.existsSync(logoPath) ? logoPath : null, rows.length);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="expedientes.pdf"`,
      },
    });
  } catch (err) {
    return respuestaDeError("expedientes/export", err);
  }
}
