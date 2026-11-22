# -*- coding: utf-8 -*-
"""Construye el directorio turístico de Jujuy a partir de datos_crudos/.
Uso: python construir.py
"""
import csv, json, math, os, re, time, unicodedata, urllib.request, collections, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
CRUDO = os.path.join(BASE, "datos_crudos")
EST = json.load(open(os.path.join(BASE, "estructura.json"), encoding="utf-8"))
REGION_DE = {d: r for r, ds in EST["regiones"].items() for d in ds}
ORDEN_PRECIO = {k: i for i, k in enumerate(["gratis", "$", "$$", "$$$", "$$$$", "sin_dato"])}
ORDEN_CAT = {k: i for i, k in enumerate(EST["categorias"])}


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def dist_km(a, b, c, d):
    p = math.pi / 180
    x = (d - b) * p * math.cos((a + c) / 2 * p)
    y = (c - a) * p
    return 6371 * math.hypot(x, y)


# ---------- clasificación ----------
T_ALOJ = {"hotel": "hotel", "hostel": "hostel", "guest_house": "hosteria_posada", "chalet": "cabana",
          "apartment": "departamento_turistico", "camp_site": "camping", "caravan_site": "camping",
          "camp_pitch": "camping", "motel": "motel", "alpine_hut": "refugio", "wilderness_hut": "refugio"}
NAT = {"peak": "cerro_pico", "volcano": "volcan", "waterfall": "cascada", "hot_spring": "termas",
       "geyser": "termas", "cave_entrance": "cueva", "salt_pond": "salar_laguna"}
HIST = {"archaeological_site": "sitio_arqueologico", "ruins": "ruinas", "monument": "monumento",
        "memorial": "monumento", "wayside_shrine": "monumento", "wayside_cross": "monumento",
        "manor": "edificio_historico", "building": "edificio_historico", "yes": "edificio_historico",
        "church": "iglesia_capilla", "fort": "ruinas", "castle": "edificio_historico"}
AMEN = {"restaurant": ("gastronomia", "restaurante"), "cafe": ("gastronomia", "cafe"),
        "bar": ("gastronomia", "bar_pub"), "pub": ("gastronomia", "bar_pub"),
        "biergarten": ("gastronomia", "bar_pub"), "fast_food": ("gastronomia", "comida_rapida"),
        "ice_cream": ("gastronomia", "heladeria"), "food_court": ("gastronomia", "patio_de_comidas"),
        "nightclub": ("vida_nocturna_ocio", "boliche"), "casino": ("vida_nocturna_ocio", "casino"),
        "cinema": ("vida_nocturna_ocio", "cine"), "theatre": ("vida_nocturna_ocio", "teatro"),
        "arts_centre": ("atractivo_cultural", "centro_cultural"),
        "marketplace": ("compras", "mercado_feria"),
        "car_rental": ("servicios_al_viajero", "alquiler_de_autos"),
        "bicycle_rental": ("actividad_excursion", "alquiler_bicicletas"),
        "bus_station": ("servicios_al_viajero", "terminal_de_omnibus"),
        "fuel": ("servicios_al_viajero", "estacion_de_servicio"),
        "bureau_de_change": ("servicios_al_viajero", "casa_de_cambio")}
SHOP = {"craft": "artesanias", "art": "artesanias", "gift": "regalos_souvenirs", "souvenir": "regalos_souvenirs",
        "wine": "vinoteca_bodega", "deli": "delicatessen", "confectionery": "delicatessen",
        "chocolate": "delicatessen", "outdoor": "outdoor"}
LEIS = {"park": ("atractivo_natural", "parque_plaza"), "nature_reserve": ("atractivo_natural", "area_protegida"),
        "water_park": ("actividad_excursion", "parque_acuatico"), "resort": ("alojamiento", "hotel"),
        "sports_centre": ("actividad_excursion", "complejo_deportivo"),
        "stadium": ("actividad_excursion", "complejo_deportivo"),
        "swimming_pool": ("actividad_excursion", "pileta"), "horse_riding": ("actividad_excursion", "cabalgata"),
        "golf_course": ("actividad_excursion", "golf")}


def clasificar(t):
    tu, am, na, hi = t.get("tourism"), t.get("amenity"), t.get("natural"), t.get("historic")
    if tu in T_ALOJ: return "alojamiento", T_ALOJ[tu]
    if tu == "museum": return "atractivo_cultural", "museo"
    if na in NAT: return "atractivo_natural", NAT[na]
    if am == "place_of_worship": return "atractivo_cultural", "iglesia_capilla"
    if hi in HIST: return "atractivo_cultural", HIST[hi]
    if tu == "viewpoint": return "atractivo_natural", "mirador"
    if tu == "artwork": return "atractivo_cultural", "obra_de_arte"
    if tu == "information": return "servicios_al_viajero", "informacion_turistica"
    if tu == "picnic_site": return "actividad_excursion", "area_de_picnic"
    if tu == "theme_park": return "actividad_excursion", "parque_tematico"
    if tu == "trail_riding_station": return "actividad_excursion", "cabalgata"
    if am in AMEN: return AMEN[am]
    sh = t.get("shop")
    if sh in ("bakery", "pastry"): return "gastronomia", "panaderia"
    if sh == "travel_agency": return "actividad_excursion", "agencia_de_viajes"
    if sh in SHOP: return "compras", SHOP[sh]
    of, cr = t.get("office"), t.get("craft")
    if of in ("travel_agent", "tourism"): return "actividad_excursion", "agencia_de_viajes"
    if of == "guide": return "actividad_excursion", "guia"
    if cr == "winery": return "compras", "vinoteca_bodega"
    if cr == "brewery": return "compras", "cerveceria_artesanal"
    if cr in ("pottery", "weaver", "handicraft"): return "compras", "artesanias"
    if t.get("leisure") in LEIS: return LEIS[t["leisure"]]
    if t.get("boundary") in ("national_park", "protected_area"): return "atractivo_natural", "area_protegida"
    if t.get("aeroway") == "aerodrome": return "servicios_al_viajero", "aeropuerto"
    if tu in ("attraction", "yes"): return "atractivo_cultural", "atractivo_general"
    return None


# ---------- precio ----------
P_SUB = {"hostel": "$", "camping": "$", "refugio": "$", "hosteria_posada": "$$", "cabana": "$$",
         "departamento_turistico": "$$", "motel": "$$", "hotel": "$$",
         "restaurante": "$$", "bar_pub": "$$", "cafe": "$", "comida_rapida": "$", "heladeria": "$",
         "panaderia": "$", "patio_de_comidas": "$",
         "museo": "$", "termas": "$", "sitio_arqueologico": "$",
         "pileta": "$", "parque_acuatico": "$", "alquiler_bicicletas": "$", "golf": "$$$",
         "area_de_picnic": "gratis", "parque_tematico": "$",
         "cine": "$", "teatro": "$", "boliche": "$$", "informacion_turistica": "gratis"}


def precio(cat, sub, t):
    est = None
    try:
        est = float(str(t.get("stars", "")).replace(",", ".").rstrip("sS"))
    except ValueError:
        pass
    if cat == "alojamiento" and est:
        return ("$$$$" if est >= 5 else "$$$" if est >= 4 else "$$" if est >= 3 else "$"), "estimado", est
    fee = t.get("fee")
    if fee == "no": return "gratis", "dato", est
    if fee and fee != "no" and cat != "alojamiento": return "$", "dato", est
    if sub in P_SUB: return P_SUB[sub], "estimado", est
    if cat in ("atractivo_natural", "atractivo_cultural"): return "gratis", "estimado", est
    return "sin_dato", "sin_dato", est


# ---------- ubicación ----------
def georef(puntos):
    cache_f = os.path.join(CRUDO, "georef_cache.json")
    cache = json.load(open(cache_f, encoding="utf-8")) if os.path.exists(cache_f) else {}
    falta = [p for p in puntos if "%.5f,%.5f" % p not in cache]
    for i in range(0, len(falta), 500):
        lote = falta[i:i + 500]
        body = json.dumps({"ubicaciones": [{"lat": a, "lon": b, "aplanar": True} for a, b in lote]}).encode()
        for intento in range(5):
            try:
                req = urllib.request.Request("https://apis.datos.gob.ar/georef/api/ubicacion", body,
                                             {"Content-Type": "application/json"})
                res = json.load(urllib.request.urlopen(req, timeout=120))["resultados"]
                break
            except Exception as ex:
                print("georef reintento", intento, ex); time.sleep(5 * (intento + 1))
        else:
            raise SystemExit("Georef no respondió")
        for p, r in zip(lote, res):
            u = r["ubicacion"]
            cache["%.5f,%.5f" % p] = [u.get("provincia_nombre"), u.get("departamento_nombre"), u.get("municipio_nombre")]
        json.dump(cache, open(cache_f, "w", encoding="utf-8"), ensure_ascii=False)
        print("georef", min(i + 500, len(falta)), "/", len(falta))
    return cache


def titulo(s):
    if s and s == s.upper():
        s = " ".join(w if w.lower() in ("de", "del", "la", "las", "los", "el", "y") and i else w.capitalize()
                     for i, w in enumerate(s.lower().split()))
    return s


def main():
    elems = json.load(open(os.path.join(CRUDO, "osm.json"), encoding="utf-8"))["elements"]
    asent = json.load(open(os.path.join(CRUDO, "asent.json"), encoding="utf-8"))["asentamientos"]
    asent = [(a["centroide"]["lat"], a["centroide"]["lon"], titulo(a["nombre"]), a["departamento"]["nombre"]) for a in asent]

    regs = []
    for e in elems:
        t = e.get("tags", {})
        nombre = (t.get("name") or t.get("name:es") or "").strip()
        if not nombre: continue
        c = clasificar(t)
        if not c: continue
        lat = e.get("lat", e.get("center", {}).get("lat")); lon = e.get("lon", e.get("center", {}).get("lon"))
        if lat is None: continue
        regs.append((e, t, nombre, c[0], c[1], round(lat, 6), round(lon, 6)))

    geo = georef(sorted({(r[5], r[6]) for r in regs}))
    salida, vistos, fuera = [], [], 0
    for e, t, nombre, cat, sub, lat, lon in regs:
        prov, depto, muni = geo["%.5f,%.5f" % (lat, lon)]
        if prov != "Jujuy" or depto not in REGION_DE:
            fuera += 1; continue
        k = (norm(nombre), sub)
        if any(k == v[0] and dist_km(lat, lon, v[1], v[2]) < 0.3 for v in vistos): continue
        vistos.append((k, lat, lon))
        cand = [a for a in asent if a[3] == depto] or asent
        loc = min(cand, key=lambda a: dist_km(lat, lon, a[0], a[1]))
        rango, origen, est = precio(cat, sub, t)
        calle = " ".join(x for x in (t.get("addr:street"), t.get("addr:housenumber")) if x) or None
        redes = t.get("contact:instagram") or t.get("contact:facebook") or t.get("instagram") or t.get("facebook")
        ele = None
        try: ele = round(float(t["ele"]))
        except (KeyError, ValueError): pass
        salida.append({
            "id": "osm-%s-%s" % (e["type"], e["id"]), "nombre": nombre, "categoria": cat, "subcategoria": sub,
            "region": REGION_DE[depto], "departamento": depto, "localidad": loc[2], "direccion": calle,
            "lat": lat, "lon": lon, "rango_precio": rango, "precio_origen": origen, "estrellas": est,
            "cocina": t.get("cuisine") if cat == "gastronomia" else None,
            "telefono": t.get("phone") or t.get("contact:phone"), "email": t.get("email") or t.get("contact:email"),
            "web": t.get("website") or t.get("contact:website"), "redes": redes,
            "horario": t.get("opening_hours"), "descripcion": t.get("description") or t.get("description:es"),
            "altitud_m": ele, "fuente": "OpenStreetMap",
            "fuente_url": "https://www.openstreetmap.org/%s/%s" % (e["type"], e["id"])})

    salida.sort(key=lambda r: (ORDEN_CAT[r["categoria"]], r["region"], norm(r["localidad"]),
                               ORDEN_PRECIO[r["rango_precio"]], norm(r["nombre"])))
    cnt = lambda campo: dict(collections.Counter(r[campo] for r in salida).most_common())
    meta = {"generado": datetime.date.today().isoformat(), "total_registros": len(salida),
            "fuentes": ["OpenStreetMap (© colaboradores de OpenStreetMap, licencia ODbL)",
                        "Georef - API del Servicio de Normalización de Datos Geográficos de Argentina (departamento y localidad)"],
            "conteo_por_categoria": cnt("categoria"), "conteo_por_region": cnt("region"),
            "conteo_por_rango_precio": cnt("rango_precio"), "conteo_por_precio_origen": cnt("precio_origen")}
    json.dump({"meta": meta, "registros": salida}, open(os.path.join(BASE, "jujuy_turismo.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    os.makedirs(os.path.join(BASE, "por_categoria"), exist_ok=True)
    for cat in EST["categorias"]:
        rs = [r for r in salida if r["categoria"] == cat]
        json.dump({"categoria": cat, "total": len(rs), "registros": rs},
                  open(os.path.join(BASE, "por_categoria", cat + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(os.path.join(BASE, "jujuy_turismo.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(EST["registro"]), delimiter=";")
        w.writeheader(); w.writerows(salida)
    print(json.dumps(meta, ensure_ascii=False, indent=1))
    print("fuera de Jujuy descartados:", fuera)
    print(json.dumps(dict(collections.Counter(r["categoria"] + "/" + r["subcategoria"] for r in salida).most_common()), ensure_ascii=False))
    print(collections.Counter(r["departamento"] for r in salida))
    malas = [s for c, ss in EST["categorias"].items() for s in []]
    validas = {(c, s) for c, ss in EST["categorias"].items() for s in ss}
    print("subcategorias fuera de estructura:", {(r["categoria"], r["subcategoria"]) for r in salida} - validas)


if __name__ == "__main__":
    main()
