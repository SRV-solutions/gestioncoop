"""Arma la presentación de GestiónCoop: PDF y una imagen PNG por diapositiva.

Uso (desde la raíz del proyecto, después de `node docs/presentacion/capturas.mjs`):
    python docs/presentacion/build.py
Necesita Google Chrome y PyMuPDF. Lo generado va a «GestionCoop - material para la cooperativa», al lado
del proyecto (fuera del repo).
"""
import os
import shutil
import subprocess
import tempfile

import pymupdf

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
SALIDA = os.environ.get('SALIDA') or os.path.join(os.path.dirname(RAIZ), 'GestionCoop - material para la cooperativa')
CHROME = os.environ.get('CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
TITULOS = [
    'Portada', 'Qué resuelve', 'Qué es', 'Del medidor a la caja', 'El socio', 'El operario',
    'La oficina', 'La gerencia', 'Cuidado de los datos', 'Cómo seguimos', 'Usuarios de prueba', 'Cierre',
]

fuente = os.path.join(SALIDA, '.fuente-presentacion')
if os.path.isdir(fuente):
    shutil.rmtree(fuente)
shutil.copytree(os.path.join(AQUI, 'deck'), fuente)
img = os.path.join(fuente, 'img')
os.makedirs(img, exist_ok=True)
for nombre in ['solvix-wave.png', 'solvix-think.png', 'solvix-cheer.png', 'srv-logo-512.png']:
    shutil.copy(os.path.join(RAIZ, 'docs', 'manual', 'img', nombre), img)
shutil.copy(os.path.join(RAIZ, 'api', 'src', 'seed', 'data', 'marcas', 'dosdemayo-factura.png'), os.path.join(img, 'logo-cooperativa.png'))
# Las capturas las usa con ../capturas/: tienen que estar en el material.
assert os.path.isdir(os.path.join(SALIDA, 'capturas')), 'Primero: node docs/presentacion/capturas.mjs'

pdf = os.path.join(SALIDA, 'GestionCoop - presentacion.pdf')
url = 'file:///' + os.path.join(fuente, 'index.html').replace('\\', '/').replace(' ', '%20')
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    subprocess.run(
        [CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--user-data-dir={os.path.join(tmp, "perfil")}',
         '--virtual-time-budget=10000', f'--print-to-pdf={pdf}', url],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

doc = pymupdf.open(pdf)
doc.set_metadata({'title': 'GestiónCoop — Propuesta para la Cooperativa AyE Dos de Mayo', 'author': 'SRV', 'creator': 'SRV · wearesrv.com', 'producer': 'SRV · wearesrv.com'})
doc.saveIncr()
imagenes = os.path.join(SALIDA, 'imagenes')
os.makedirs(imagenes, exist_ok=True)
for i, pagina in enumerate(doc):
    zoom = 1920 / pagina.rect.width
    titulo = TITULOS[i] if i < len(TITULOS) else f'Diapositiva {i + 1}'
    pagina.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).save(os.path.join(imagenes, f'{i + 1:02d} - {titulo}.png'))
print(f'{pdf} ({doc.page_count} diapositivas) e imágenes en {imagenes}')
doc.close()
shutil.rmtree(fuente, ignore_errors=True)
