#!/usr/bin/env python3
"""Convierte el Excel de ventas de Mercado Libre en un lote para el panel.

Uso:
    python3 scripts/ml_reporte.py "Ventas_CL_Mercado_Libre_....xlsx"

Escribe services/datos/mercadolibre-AAAA-MM-DD.json (la fecha es la del
reporte). Al arrancar, el servidor lo aplica UNA vez con
metrics.importarMercadoLibre(): cada venta entra en su DÍA DE COMPRA con lo
que deposita ML, cada devolución resta lo que cobró ML y no cuenta banda, y las
canceladas no entran. services/ no se publica en Netlify (netlify.toml).

Solo guarda n° de venta, fecha, monto, unidades y tipo: nada de nombres, RUT
ni direcciones de los compradores, que el Excel sí trae.

El Excel de ML a veces viene con filas SIN montos ("No pudimos mostrar algunos
datos"). Esas se estiman igual que las demás del reporte: precio de la
publicación ese día, menos el 12% de cargo de ML, menos el envío de las ventas
más cercanas en fecha; una devolución sin montos toma lo que cobró ML en la
devolución más cercana. Quedan marcadas "estimado" y el panel las señala.

OJO: lo depositado NO trae la publicidad de ML, que se cobra aparte. Desde el
28-oct-2026 el panel carga las ventas de ML a mano con el precio completo y les
descuenta los cargos de ML, publicidad incluida (services/utilidad.js,
CARGOS_ML). Un reporte reemplaza las cargadas a mano en sus fechas, así que
esos días dejan de restar la publicidad de ML.
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import openpyxl

CHILE = ZoneInfo('America/Santiago')
CARGO_ML = 0.12  # cargo por venta de ML sobre el precio (calza con todas las filas con montos)
MESES = {m: i + 1 for i, m in enumerate(
    ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
     'septiembre', 'octubre', 'noviembre', 'diciembre'])}


def fecha_ml(txt):
    """'27 de octubre de 2026 04:43 hs.' -> datetime con huso de Chile."""
    m = re.match(r'\s*(\d{1,2}) de (\w+) de (\d{4})(?: (\d{1,2}):(\d{2}))?', str(txt or ''))
    if not m:
        return None
    d, mes, a, h, mi = m.groups()
    return datetime(int(a), MESES[mes.lower()], int(d), int(h or 12), int(mi or 0), tzinfo=CHILE)


def num(v):
    try:
        return None if v is None or str(v).strip() == '' else float(v)
    except ValueError:
        return None


def leer(ruta):
    filas = list(openpyxl.load_workbook(ruta, data_only=True, read_only=True).worksheets[0].iter_rows(values_only=True))
    i_hdr = next(i for i, r in enumerate(filas) if r and r[0] == '# de venta')
    hdr = filas[i_hdr]
    # Los nombres se repiten en otros bloques (Unidades, Estado…): vale el primero.
    col = {}
    for i, h in enumerate(hdr):
        if h and h not in col:
            col[h] = i
    aviso = next((str(r[0]) for r in filas[:i_hdr] if r and r[0] and 'Estado de tus ventas al' in str(r[0])), '')
    m = re.search(r'al (\d{1,2} de \w+ de \d{4})', aviso)
    al = fecha_ml(m.group(1)) if m else datetime.now(CHILE)
    datos = []
    for r in filas[i_hdr + 1:]:
        if not r or not r[col['# de venta']]:
            continue
        g = lambda nombre: r[col[nombre]]
        datos.append({
            'venta': str(g('# de venta')).strip(),
            'fecha': fecha_ml(g('Fecha de venta')),
            'estado': str(g('Estado') or ''),
            'unidades': int(num(g('Unidades')) or 1),
            'ingresos': num(g('Ingresos por productos (CLP)')),
            'cargo': num(g('Cargo por venta e impuestos (CLP)')),
            'envio': num(g('Costos de envío (CLP)')),
            'total': num(g('Total (CLP)')),
            'precio': num(g('Precio unitario de venta de la publicación (CLP)')),
        })
    return al, datos


def tipo(f):
    e = f['estado'].lower()
    if e.startswith('cancelada'):
        return 'cancelada'
    if 'devoluci' in e:
        return 'devolucion'
    return 'venta'


def cercana(f, candidatas):
    return min(candidatas, key=lambda c: abs((c['fecha'] - f['fecha']).total_seconds())) if candidatas else None


def armar(al, datos):
    ventas_ok = [f for f in datos if tipo(f) == 'venta' and f['total'] is not None and f['envio'] is not None]
    devs_ok = [f for f in datos if tipo(f) == 'devolucion' and f['total'] is not None]
    # El 12% tiene que calzar con lo que ML cobró de verdad; si ML cambia su
    # cargo, las estimaciones saldrían mal y es mejor enterarse acá.
    for f in ventas_ok:
        if f['ingresos'] and abs(-f['cargo'] - round(f['ingresos'] * CARGO_ML)) > 1:
            print(f"  ⚠ venta {f['venta'][-6:]}: el cargo de ML no es el 12% — revisa las estimadas", file=sys.stderr)
    salida, resumen = [], {'ventas': 0, 'devoluciones': 0, 'canceladas': 0, 'estimadas': 0,
                           'depositado': 0, 'cobradoPorDevoluciones': 0}
    for f in datos:
        t = tipo(f)
        if t == 'cancelada':
            resumen['canceladas'] += 1
            continue
        reg = {'orden': 'ml-' + f['venta'], 'fecha': f['fecha'].astimezone(ZoneInfo('UTC')).isoformat().replace('+00:00', 'Z')}
        if t == 'devolucion':
            monto = f['total']
            if monto is None:
                ref = cercana(f, devs_ok)
                monto = ref['total'] if ref else 0
                reg['estimado'] = True
            reg.update({'monto': int(round(monto)), 'unidades': 0, 'devolucion': True})
            resumen['devoluciones'] += 1
            resumen['cobradoPorDevoluciones'] += int(round(monto))
        else:
            monto = f['total']
            if monto is None:
                precio = (f['precio'] or 0) * f['unidades']
                ref = cercana(f, ventas_ok)
                envio = -(ref['envio']) if ref else 0
                monto = precio - round(precio * CARGO_ML) - envio
                reg['estimado'] = True
            reg.update({'monto': int(round(monto)), 'unidades': f['unidades']})
            resumen['ventas'] += 1
            resumen['depositado'] += int(round(monto))
        if reg.get('estimado'):
            resumen['estimadas'] += 1
        salida.append(reg)
    salida.sort(key=lambda x: x['fecha'])
    return {
        'id': 'ml-' + al.strftime('%Y-%m-%d'),
        'reporte': 'Ventas CL Mercado Libre y Mercado Shops al ' + al.strftime('%Y-%m-%d'),
        'resumen': resumen,
        'ventas': salida,
    }


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    al, datos = leer(sys.argv[1])
    lote = armar(al, datos)
    destino = Path(__file__).resolve().parent.parent / 'services' / 'datos' / f"mercadolibre-{al.strftime('%Y-%m-%d')}.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(lote, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    r = lote['resumen']
    print(f"{destino.relative_to(Path.cwd()) if destino.is_relative_to(Path.cwd()) else destino}")
    print(f"  {r['ventas']} ventas (${r['depositado']:,} depositado), {r['devoluciones']} devoluciones "
          f"(${r['cobradoPorDevoluciones']:,}), {r['canceladas']} canceladas no entran, {r['estimadas']} estimadas".replace(',', '.'))


if __name__ == '__main__':
    main()
