#!/usr/bin/env python3
"""
Sonda Bluetooth para la DEUS Band (B11 / MOYOUNG-V2).

Para qué sirve
--------------
La página ble-test.html sirve para probar desde el teléfono, pero cada intento
necesita que alguien toque un botón y copie el log. Este programa hace lo mismo
desde un computador con Bluetooth, sin intervención: prueba todas las
combinaciones de canal, formato y comando, y escribe un informe.

Lo que ya sabemos de la banda (verificado contra el dispositivo real):
  · Se identifica como MOYOUNG-V2, modelo B11.
  · fdd1 emite sola los contadores del día: pasos, metros y calorías,
    tres enteros de 3 bytes en little endian.
  · fdd3 emite un latido cada ~30 s con el comando 0x03.
  · El pulso aparece por el perfil ESTÁNDAR de Bluetooth (0x2a37).
  · Ningún comando obtuvo respuesta todavía: eso es lo que busca este programa.

Uso
---
    pip install bleak
    python3 scripts/ble_probe.py                # escanear y sondear
    python3 scripts/ble_probe.py --escuchar 120 # solo escuchar 2 minutos
    python3 scripts/ble_probe.py --mac AA:BB:.. # si ya sabés la dirección

Requisitos: Python 3.9+, un equipo con Bluetooth LE, y la banda cerca y
desconectada del teléfono (cerrá Da Halo antes).
"""

import argparse
import asyncio
import os
import sys
import time
import traceback
from collections import defaultdict
from datetime import datetime

# ── Registro a archivo ───────────────────────────────────────────────────
# Todo lo que se imprime se guarda además en ble_probe_salida.txt, al lado del
# programa. Es imprescindible en Windows: si alguien abre el archivo con doble
# clic, la ventana se cierra al terminar y la salida se pierde. Así siempre
# queda el archivo para revisar o mandar.
ARCHIVO_SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "ble_probe_salida.txt")


class Duplicador:
    """Escribe a la consola y al archivo al mismo tiempo."""

    def __init__(self, consola, archivo):
        self.consola, self.archivo = consola, archivo

    def write(self, texto):
        try:
            self.consola.write(texto)
        except UnicodeEncodeError:
            # Consolas viejas de Windows no soportan acentos ni símbolos
            self.consola.write(texto.encode("ascii", "replace").decode("ascii"))
        self.archivo.write(texto)
        self.archivo.flush()

    def flush(self):
        try:
            self.consola.flush()
        except Exception:
            pass
        self.archivo.flush()


_archivo_log = open(ARCHIVO_SALIDA, "w", encoding="utf-8")
sys.stdout = Duplicador(sys.__stdout__, _archivo_log)
sys.stderr = Duplicador(sys.__stderr__, _archivo_log)

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("Falta la librería bleak. Instalala con:   py -m pip install bleak")
    input("\nPresioná Enter para cerrar…")
    sys.exit(1)

# ── UUIDs de la banda ────────────────────────────────────────────────────
def u16(x: str) -> str:
    return f"0000{x}-0000-1000-8000-00805f9b34fb"

SVC_DATOS = u16("fdda")
CHR_CONTADORES = u16("fdd1")
CHR_PULSO_STD = u16("2a37")
CHR_BATERIA = u16("2a19")

# Canales que aceptan escritura, según el escaneo del dispositivo real
CANALES_ESCRITURA = [u16(c) for c in ("fea2", "fec7", "fdd2", "fdd5")]

# ── Formatos de trama candidatos ─────────────────────────────────────────
def trama_moyoung(cmd: int, payload: bytes = b"", version: int = 1) -> bytes:
    """fd da | marca | largo | comando | payload

    La marca es 0x10 en V1 y 0x20 más los bits altos del largo en V2. El largo
    incluye los cinco bytes de cabecera. Los dos primeros bytes son el UUID del
    servicio propio de la banda, igual que MoYoung usa 'fe ea' por feea.
    """
    largo = 5 + len(payload)
    marca = (0x20 + ((largo >> 8) & 0xFF)) if version == 2 else 0x10
    return bytes([0xFD, 0xDA, marca, largo & 0xFF, cmd]) + payload


def trama_bfh16(cmd: int, arg1: int = 0, arg2: int = 0) -> bytes:
    """Formato de las jyou BFH16: diez bytes, sin cabecera.

    Comando, dos enteros de 32 bits en big endian, y un checksum final que es
    la suma de los nueve bytes anteriores.
    """
    cuerpo = bytes([cmd]) + arg1.to_bytes(4, "big") + arg2.to_bytes(4, "big")
    return cuerpo + bytes([sum(cuerpo) & 0xFF])


FORMATOS = [
    ("MoYoung V1", lambda c, p=b"": trama_moyoung(c, p, 1)),
    ("MoYoung V2", lambda c, p=b"": trama_moyoung(c, p, 2)),
    ("BFH16+suma", lambda c, p=b"": trama_bfh16(c)),
]

# Solo consultas de lectura. Nada que altere configuración, alarmas ni hora.
CONSULTAS = [
    (0x32, "sueño de hoy"),
    (0x33, "sueño/pasos de ayer"),
    (0x36, "historial de pulso"),
    (0x37, "resumen de actividad"),
    (0x59, "categorías de pasos"),
]

# ── Estado ───────────────────────────────────────────────────────────────
recibidas = []          # (momento, uuid, bytes)
por_canal = defaultdict(int)


def es_ruido(uuid: str, datos: bytes) -> bool:
    """Tráfico que la banda emite sola y que no hay que confundir con respuesta.

    Este filtro es la pieza central: sin él, el latido periódico y los
    contadores hacen pasar por éxito a cualquier combinación.
    """
    corto = uuid[4:8].lower()
    if corto == "fdd1":
        return True                                   # contadores del día
    if corto == "fea1" and datos[:1] == b"\x01":
        return True                                   # espejo de pasos
    if corto == "2a37":
        return True                                   # pulso estándar
    if len(datos) >= 5 and datos[0] == 0xFD and datos[1] == 0xDA and datos[4] == 0x03:
        return True                                   # latido de estado
    return False


def al_recibir(uuid: str):
    def _cb(_carac, datos: bytearray):
        b = bytes(datos)
        recibidas.append((time.time(), uuid, b))
        por_canal[uuid[4:8]] += 1
        marca = "   " if es_ruido(uuid, b) else "★★★"
        print(f"  {marca} RX 0x{uuid[4:8]}  {b.hex(' ')}")
    return _cb


def decodificar_contadores(b: bytes):
    if len(b) < 9:
        return None
    u24 = lambda o: b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
    return {"pasos": u24(0), "metros": u24(3), "kcal": u24(6)}


# ── Conexión ─────────────────────────────────────────────────────────────
async def buscar_banda(mac):
    """Devuelve el OBJETO del dispositivo, no su dirección.

    En Windows, pasarle a BleakClient una dirección en texto suele fallar con
    "Device not found" aunque el escaneo lo acabe de encontrar: el backend de
    WinRT necesita el objeto que devolvió el escáner. Por eso acá siempre se
    escanea, incluso cuando se pasa --mac.
    """
    if mac:
        print(f"Buscando {mac}…")
        d = await BleakScanner.find_device_by_address(mac, timeout=15.0)
        if d:
            print(f"Encontrada: {d.name or '(sin nombre)'}  [{d.address}]")
            return d
        print(f"No apareció {mac}. ¿Está encendida y con Da Halo cerrado?")
        return None

    print("Buscando la banda… (que esté cerca y con Da Halo cerrado)")
    dispositivos = await BleakScanner.discover(timeout=10.0)
    for d in dispositivos:
        if d.name and ("B11" in d.name.upper() or "DEUS" in d.name.upper()):
            print(f"Encontrada: {d.name}  [{d.address}]")
            return d
    print("\nNo apareció ninguna B11. Dispositivos vistos:")
    for d in dispositivos:
        print(f"   {d.name or '(sin nombre)':24} {d.address}")
    print("\nSi reconocés tu banda, volvé a correr con:  --mac <dirección>")
    return None


async def suscribir_todo(cliente: BleakClient) -> list:
    """Escucha todo canal que notifique, y devuelve los que aceptan escritura."""
    escribibles = []
    for servicio in cliente.services:
        propio = not servicio.uuid.startswith(("00001800", "00001801", "0000180a",
                                               "0000180f", "0000180d"))
        print(f"  SERVICIO 0x{servicio.uuid[4:8]}{'   ← propietario' if propio else ''}")
        for c in servicio.characteristics:
            props = "".join(p[0].upper() for p in c.properties)
            valor = ""
            if "read" in c.properties:
                try:
                    v = await cliente.read_gatt_char(c.uuid)
                    txt = "".join(chr(x) if 32 <= x < 127 else "" for x in v)
                    valor = f"  = {bytes(v).hex(' ')}" + (f'  "{txt}"' if len(txt) >= 3 else "")
                except Exception:
                    valor = "  (lectura falló)"
            print(f"    0x{c.uuid[4:8]} [{props}]{valor}")

            if {"write", "write-without-response"} & set(c.properties):
                escribibles.append(c.uuid)
            if {"notify", "indicate"} & set(c.properties):
                try:
                    await cliente.start_notify(c.uuid, al_recibir(c.uuid))
                except Exception as e:
                    print(f"      (no se pudo escuchar: {e})")
    return escribibles


async def escuchar(segundos: int, titulo: str = "Escuchando"):
    print(f"\n{titulo} {segundos} s sin enviar nada…")
    inicio = len(recibidas)
    await asyncio.sleep(segundos)
    nuevas = recibidas[inicio:]
    print(f"  → {len(nuevas)} trama(s) recibidas por su cuenta")
    return nuevas


async def barrido(cliente: BleakClient, escribibles: list):
    """Cruza canales, formatos y consultas buscando cualquier respuesta nueva."""
    total = len(escribibles) * len(FORMATOS) * len(CONSULTAS)
    print(f"\n{'='*62}\nBARRIDO: {total} pruebas\n{'='*62}")
    hallazgos = []
    n = 0

    for canal in escribibles:
        for nombre_fmt, armar in FORMATOS:
            for cmd, que in CONSULTAS:
                n += 1
                antes = sum(1 for _, u, d in recibidas if not es_ruido(u, d))
                trama = armar(cmd)
                print(f"\n[{n}/{total}] 0x{canal[4:8]} · {nombre_fmt} · {que}")
                print(f"        TX {trama.hex(' ')}")
                try:
                    sin_resp = "write" not in (await _props(cliente, canal))
                    await cliente.write_gatt_char(canal, trama, response=not sin_resp)
                except Exception as e:
                    print(f"        escritura falló: {e}")
                    continue
                await asyncio.sleep(2.5)
                despues = sum(1 for _, u, d in recibidas if not es_ruido(u, d))
                if despues > antes:
                    h = f"0x{canal[4:8]} con {nombre_fmt} → {que}"
                    hallazgos.append(h)
                    print(f"        ★★★ RESPONDE: {h}")
    return hallazgos


async def _props(cliente: BleakClient, uuid: str):
    for s in cliente.services:
        for c in s.characteristics:
            if c.uuid == uuid:
                return c.properties
    return []


# ── Principal ────────────────────────────────────────────────────────────
async def principal(args):
    dispositivo = await buscar_banda(args.mac)
    if not dispositivo:
        return 1

    print(f"\nConectando a {dispositivo.address}…")
    try:
        cliente = BleakClient(dispositivo, timeout=25.0)
        await cliente.connect()
    except Exception as e:
        print(f"\nNo se pudo conectar: {e}")
        print("\nCosas que suelen destrabarlo:")
        print("  · Cerrá Da Halo en el teléfono (si tiene la banda tomada, nadie más entra).")
        print("  · Acercá la banda al computador, a menos de un metro.")
        print("  · Vinculá la banda desde Configuración de Windows → Bluetooth.")
        print("  · Apagá y prendé el Bluetooth del computador.")
        return 1

    try:
        print("Conectado.\n")

        for nombre, uuid in (("Fabricante", u16("2a29")), ("Modelo", u16("2a28")),
                             ("Nombre", u16("2a00"))):
            try:
                v = await cliente.read_gatt_char(uuid)
                print(f"  {nombre}: {v.decode(errors='ignore').strip()}")
            except Exception:
                pass
        try:
            bat = await cliente.read_gatt_char(CHR_BATERIA)
            print(f"  Batería: {bat[0]}%")
        except Exception:
            pass

        print("\n── Servicios y canales ──")
        escribibles = await suscribir_todo(cliente)
        print(f"\nEscuchando {len(recibidas)} canal(es). Escribibles: {len(escribibles)}.")

        try:
            v = await cliente.read_gatt_char(CHR_CONTADORES)
            c = decodificar_contadores(bytes(v))
            if c:
                print(f"Contadores de hoy: {c['pasos']} pasos · {c['metros']} m · {c['kcal']} kcal")
        except Exception:
            pass

        # Línea de base: qué emite sola. Sin esto no se puede saber qué es respuesta.
        await escuchar(args.escuchar, "Caracterizando el tráfico de fondo:")

        if args.solo_escuchar:
            print("\nResumen por canal:")
            for c, n in sorted(por_canal.items()):
                print(f"   0x{c} → {n} trama(s)")
            return 0

        hallazgos = await barrido(cliente, escribibles)

        print(f"\n{'='*62}\nRESULTADO\n{'='*62}")
        if hallazgos:
            for h in hallazgos:
                print("  ★ " + h)
            print("\nGuardá esta salida: con esas tramas se arma la descarga del historial.")
        else:
            print("  Ninguna combinación produjo tráfico nuevo.")
            print("  La banda exige emparejamiento previo: hay que capturar el saludo")
            print("  de Da Halo con el registro Bluetooth y replicarlo.")

        print("\nTramas que NO son tráfico de fondo conocido:")
        raras = [(t, u, d) for t, u, d in recibidas if not es_ruido(u, d)]
        if raras:
            for t, u, d in raras:
                print(f"   0x{u[4:8]}  {d.hex(' ')}")
        else:
            print("   (ninguna)")
    finally:
        # Desconectar siempre, aunque algo falle: si no, la banda queda tomada
        # y después la app del teléfono no la puede usar.
        try:
            await cliente.disconnect()
            print("\nDesconectado.")
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Sonda Bluetooth de la DEUS Band")
    ap.add_argument("--mac", help="dirección de la banda, si ya la sabés")
    ap.add_argument("--escuchar", type=int, default=45,
                    help="segundos de escucha previa (por defecto 45)")
    ap.add_argument("--solo-escuchar", action="store_true",
                    help="solo caracterizar lo que emite sola, sin enviar nada")

    print(f"Sonda DEUS Band · {datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"La salida también se guarda en:\n  {ARCHIVO_SALIDA}\n")

    codigo = 1
    try:
        codigo = asyncio.run(principal(ap.parse_args()))
    except KeyboardInterrupt:
        print("\nInterrumpido por el usuario.")
    except Exception:
        # Cualquier error se imprime completo Y queda en el archivo, en vez de
        # perderse cuando la ventana se cierre.
        print("\nEl programa falló:\n")
        traceback.print_exc()
    finally:
        print(f"\nSalida guardada en: {ARCHIVO_SALIDA}")
        _archivo_log.flush()
        # La pausa evita que la ventana se cierre sola al abrir con doble clic.
        try:
            input("\nPresioná Enter para cerrar…")
        except Exception:
            pass
    sys.exit(codigo)
